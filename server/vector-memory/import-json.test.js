import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCharacterMap, parseImportArgs, runImport } from './import-json.js';

test('parseImportArgs requires file and explicit user id', () => {
  assert.throws(() => parseImportArgs(['--file', 'chat.json']), /userId/);
  assert.throws(() => parseImportArgs(['--user-id', '1']), /--file/);

  assert.deepEqual(parseImportArgs([
    '--file', 'chat.json',
    '--user-id', '1',
    '--batch-size', '8',
    '--dry-run'
  ]), {
    file: 'chat.json',
    userId: 1,
    qdrantUrl: 'http://127.0.0.1:6333',
    collection: 'ruobai_memories_local',
    credentialId: null,
    model: '',
    vectorSize: null,
    hashEmbedding: false,
    batchSize: 8,
    dryRun: true
  });
});

test('loadCharacterMap maps owned characters and prefers non-test duplicates', async () => {
  const calls = [];
  const map = await loadCharacterMap({
    userId: 1,
    pool: {
      query: async (sql, params) => {
        calls.push({ sql, params });
        return [[
          { id: 7, name: '小白', char_key: 'xiaobai', is_deleted: 0 },
          { id: 8, name: '糖糖', char_key: 'role-old', is_deleted: 1 },
          { id: 9, name: '糖糖', char_key: 'test_tangtang', is_deleted: 0 },
          { id: 10, name: 'ISFP / 燕云人格馆', char_key: 'isfp', is_deleted: 1 }
        ]];
      }
    }
  });

  assert.deepEqual(calls[0].params, [1]);
  assert.match(calls[0].sql, /WHERE user_id = \?/);
  assert.equal(map.get('小白'), 7);
  assert.equal(map.get('糖糖'), 8);
  assert.equal(map.get('ISFP人格馆'), 10);
});

test('runImport supports dry-run without touching Qdrant', async () => {
  const writes = [];
  const result = await runImport({
    args: {
      file: 'unused.json',
      userId: 1,
      batchSize: 8,
      dryRun: true
    },
    pool: {
      query: async () => [[{ id: 7, name: '小白' }]]
    },
    embedder: {
      vectorSize: 384,
      embedTexts: async () => {
        throw new Error('dry-run 不应生成向量');
      }
    },
    client: {
      ensureCollection: async () => {
        throw new Error('dry-run 不应连接 Qdrant');
      }
    },
    write: message => writes.push(message),
    readExport: async () => ({
      total_messages: 2,
      characters: [
        {
          name: '小白',
          message_count: 2,
          messages: [
            { role: 'user', content: '你好', type: 'text', date: '2026-05-22 17:02:44', source: '本地' },
            { role: 'assistant', content: '你好呀', type: 'text', date: '2026-05-22 17:02:49', source: '本地' }
          ]
        }
      ]
    })
  });

  assert.equal(result.imported, 0);
  assert.equal(result.chunks.length, 1);
  assert.ok(writes.some(message => message.includes('dry-run')));
});
