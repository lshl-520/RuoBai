import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEmbeddingsUrl,
  createHashEmbedder,
  createOpenAICompatibleEmbedder
} from './embedding.js';

test('buildEmbeddingsUrl normalizes OpenAI compatible base URLs', () => {
  assert.equal(buildEmbeddingsUrl('https://api.example.com'), 'https://api.example.com/v1/embeddings');
  assert.equal(buildEmbeddingsUrl('https://api.example.com/v1'), 'https://api.example.com/v1/embeddings');
  assert.equal(buildEmbeddingsUrl('https://api.example.com/v1/embeddings'), 'https://api.example.com/v1/embeddings');
});

test('createOpenAICompatibleEmbedder calls embeddings endpoint in batches', async () => {
  const calls = [];
  const embedder = createOpenAICompatibleEmbedder({
    apiBase: 'http://127.0.0.1:11434/v1',
    apiKey: 'secret',
    model: 'text-embedding-nomic-embed-text-v1.5',
    batchSize: 2,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const body = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          data: body.input.map((_, index) => ({ embedding: [index, index + 1, index + 2] }))
        })
      };
    }
  });

  const vectors = await embedder.embedTexts(['一', '二', '三']);

  assert.equal(embedder.vectorSize, 768);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'http://127.0.0.1:11434/v1/embeddings');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer secret');
  assert.deepEqual(vectors, [[0, 1, 2], [1, 2, 3], [0, 1, 2]]);
});

test('createHashEmbedder creates deterministic normalized local vectors', async () => {
  const embedder = createHashEmbedder({ vectorSize: 32 });
  const [left, right] = await embedder.embedTexts(['想你', '想你']);

  assert.equal(embedder.vectorSize, 32);
  assert.deepEqual(left, right);
  assert.ok(Math.abs(Math.sqrt(left.reduce((sum, value) => sum + value * value, 0)) - 1) < 0.000001);
});
