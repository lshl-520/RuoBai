import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMemoryFilter,
  createVectorMemoryClient,
  createPointId,
  mapChunkToPoint
} from './qdrant.js';

test('buildMemoryFilter requires user and character filters', () => {
  assert.deepEqual(buildMemoryFilter({ userId: 1, characterId: 7 }), {
    must: [
      { key: 'user_id', match: { value: 1 } },
      { key: 'character_id', match: { value: 7 } }
    ]
  });

  assert.throws(() => buildMemoryFilter({ userId: 1 }), /characterId/);
  assert.throws(() => buildMemoryFilter({ characterId: 7 }), /userId/);
});

test('mapChunkToPoint stores text vector and isolation payload', () => {
  const chunk = {
    user_id: 1,
    character_id: 7,
    character_name: '小白',
    roles: ['user', 'assistant'],
    start_date: '2026-05-22 17:02:44',
    end_date: '2026-05-22 17:02:49',
    source: '服务器',
    chunk_index: 0,
    chunk_type: 'turn_pair',
    content_preview: '用户：想你',
    text: '用户：想你\n小白：我也想你'
  };

  const point = mapChunkToPoint(chunk, [0.1, 0.2, 0.3]);

  assert.equal(point.id, createPointId(chunk));
  assert.deepEqual(point.vector, [0.1, 0.2, 0.3]);
  assert.equal(point.payload.user_id, 1);
  assert.equal(point.payload.character_id, 7);
  assert.equal(point.payload.text, chunk.text);
});

test('createVectorMemoryClient creates collection, upserts points, and searches with filters', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if ((options.method || 'GET') === 'GET') {
      return { ok: false, status: 404, text: async () => 'not found' };
    }
    if (options.method === 'PUT' || options.method === 'POST') {
      return { ok: true, status: 200, json: async () => ({ result: [] }), text: async () => '' };
    }
    throw new Error(`Unexpected request ${options.method || 'GET'} ${url}`);
  };
  const client = createVectorMemoryClient({
    baseUrl: 'http://127.0.0.1:6333',
    collectionName: 'test_collection',
    vectorSize: 3,
    fetchImpl
  });

  await client.ensureCollection();
  await client.upsertChunks([
    {
      user_id: 1,
      character_id: 7,
      character_name: '小白',
      roles: ['user'],
      start_date: '2026-05-22 17:02:44',
      end_date: '2026-05-22 17:02:44',
      source: '服务器',
      chunk_index: 0,
      chunk_type: 'user_only',
      content_preview: '用户：想你',
      text: '用户：想你'
    }
  ], [[0.1, 0.2, 0.3]]);
  await client.search({
    vector: [0.3, 0.2, 0.1],
    userId: 1,
    characterId: 7,
    limit: 12
  });

  assert.equal(calls.length, 4);
  assert.match(calls[0].url, /\/collections\/test_collection$/);
  assert.equal(calls[0].options.method, 'GET');
  assert.match(calls[1].url, /\/collections\/test_collection$/);
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    vectors: { size: 3, distance: 'Cosine' }
  });

  assert.match(calls[2].url, /\/collections\/test_collection\/points\?wait=true$/);
  assert.equal(JSON.parse(calls[2].options.body).points.length, 1);

  assert.match(calls[3].url, /\/collections\/test_collection\/points\/search$/);
  assert.deepEqual(JSON.parse(calls[3].options.body).filter, buildMemoryFilter({
    userId: 1,
    characterId: 7
  }));
});

test('createVectorMemoryClient reports friendly connection errors', async () => {
  const client = createVectorMemoryClient({
    fetchImpl: async () => ({ ok: false, status: 503, text: async () => 'down' })
  });

  await assert.rejects(
    () => client.ensureCollection(),
    /Qdrant 请求失败：503 down/
  );
});
