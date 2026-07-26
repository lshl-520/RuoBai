import test from 'node:test';
import assert from 'node:assert/strict';
import { getVectorMemoryStatus } from './status.js';

function response({ status = 200, body = {} } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body
  };
}

test('reports enabled only when both services and imported history are ready', async () => {
  const status = await getVectorMemoryStatus({
    embeddingUrl: 'http://embedding.test',
    qdrantUrl: 'http://qdrant.test',
    fetchImpl: async (url) => url.includes('/health')
      ? response()
      : response({ body: { result: { points_count: 879 } } })
  });

  assert.equal(status.status, 'enabled');
  assert.equal(status.history.chunks, 879);
  assert.match(status.summary, /聊天会查找相关旧回忆/);
});

test('reports a clear degraded state when the collection has not been imported', async () => {
  const status = await getVectorMemoryStatus({
    fetchImpl: async (url) => url.includes('/health') ? response() : response({ status: 404 })
  });

  assert.equal(status.status, 'degraded');
  assert.equal(status.history.status, 'missing');
  assert.match(status.summary, /还没有导入旧聊天回忆/);
});

test('does not claim that old memories are active when a service cannot be reached', async () => {
  const status = await getVectorMemoryStatus({
    fetchImpl: async () => { throw new Error('connection refused'); }
  });

  assert.equal(status.status, 'degraded');
  assert.match(status.summary, /聊天不会使用旧回忆/);
});
