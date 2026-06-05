import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createMomentsRouter } from './moments.js';

function createApp(router) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.userId = 1;
    req.session = { userId: 1 };
    next();
  });
  app.use('/api/moments', router);
  app.use((error, _req, res, _next) => {
    res.status(500).json({
      success: false,
      error: error.message
    });
  });
  return app;
}

async function withServer(app, run) {
  const server = app.listen(0);

  try {
    const { port } = server.address();
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('GET /api/moments returns filtered list with comments and liked state', async () => {
  const calls = [];
  const router = createMomentsRouter({
    pool: {
      query: async (sql, params) => {
        calls.push({ sql, params });

        if (sql.includes('FROM moments')) {
          return [[{
            id: 5,
            user_id: 1,
            character_id: 2,
            content: 'hello',
            images: '["a.png"]',
            likes_count: 1,
            created_at: '2026-05-21 23:30:00',
            is_deleted: 0
          }]];
        }

        if (sql.includes('FROM moment_comments')) {
          return [[{
            id: 9,
            moment_id: 5,
            user_id: 1,
            character_id: 2,
            content: 'comment',
            created_at: '2026-05-21 23:31:00'
          }]];
        }

        if (sql.includes('FROM moment_likes')) {
          return [[{ moment_id: 5 }]];
        }

        throw new Error(`Unexpected query: ${sql}`);
      }
    },
    withTransaction: async work => work({ query: async () => { throw new Error('unused'); } })
  });

  await withServer(createApp(router), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/moments?character_id=2&limit=10&offset=5`);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.items.length, 1);
    assert.deepEqual(payload.items[0].images, ['a.png']);
    assert.equal(payload.items[0].liked, true);
    assert.equal(payload.items[0].comments.length, 1);
    assert.deepEqual(calls[0].params, [1, 2, 10, 5]);
  });
});

test('GET /api/moments/:id returns one moment with comments and liked state', async () => {
  const calls = [];
  const router = createMomentsRouter({
    pool: {
      query: async (sql, params) => {
        calls.push({ sql, params });

        if (sql.includes('FROM moments') && sql.includes('LIMIT 1')) {
          assert.deepEqual(params, [12, 1]);
          return [[{
            id: 12,
            user_id: 1,
            character_id: 3,
            content: 'detail',
            images: '["detail.png"]',
            likes_count: 2,
            created_at: '2026-05-25 20:00:00',
            is_deleted: 0
          }]];
        }

        if (sql.includes('FROM moment_comments')) {
          assert.deepEqual(params, [1, 12]);
          return [[{
            id: 21,
            moment_id: 12,
            user_id: 1,
            character_id: null,
            content: 'first',
            created_at: '2026-05-25 20:01:00'
          }]];
        }

        if (sql.includes('FROM moment_likes')) {
          assert.deepEqual(params, [1, 12]);
          return [[{ moment_id: 12 }]];
        }

        throw new Error(`Unexpected query: ${sql}`);
      }
    },
    withTransaction: async work => work({ query: async () => { throw new Error('unused'); } })
  });

  await withServer(createApp(router), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/moments/12`);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.item.id, 12);
    assert.deepEqual(payload.item.images, ['detail.png']);
    assert.equal(payload.item.liked, true);
    assert.equal(payload.item.comments_count, 1);
    assert.equal(payload.item.comments[0].content, 'first');
    assert.equal(calls.length, 3);
  });
});

test('POST /api/moments creates a moment', async () => {
  const router = createMomentsRouter({
    pool: {
      query: async (sql, params) => {
        if (sql.includes('INSERT INTO moments')) {
          assert.equal(params[0], 1);
          assert.equal(params[1], null);
          assert.equal(params[2], 'new moment');
          assert.equal(params[3], '["x.png"]');
          return [{ insertId: 7 }];
        }

        if (sql.includes('FROM moments')) {
          return [[{
            id: 7,
            user_id: 1,
            character_id: null,
            content: 'new moment',
            images: '["x.png"]',
            likes_count: 0,
            created_at: '2026-05-21 23:32:00',
            is_deleted: 0
          }]];
        }

        throw new Error(`Unexpected query: ${sql}`);
      }
    },
    withTransaction: async work => work({ query: async () => { throw new Error('unused'); } })
  });

  await withServer(createApp(router), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/moments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: 'new moment',
        images: ['x.png']
      })
    });
    const payload = await response.json();

    assert.equal(response.status, 201);
    assert.equal(payload.success, true);
    assert.equal(payload.item.id, 7);
    assert.deepEqual(payload.item.images, ['x.png']);
  });
});

test('POST /api/moments/draft generates a character moment draft without saving it', async () => {
  const calls = [];
  const upstreamCalls = [];
  const router = createMomentsRouter({
    pool: {
      query: async (sql, params) => {
        calls.push({ sql, params });

        if (sql.includes('FROM capability_assignments ca')) {
          assert.deepEqual(params, [1]);
          return [[{
            id: 4,
            name: 'chat provider',
            provider_type: 'openai',
            api_base: 'https://api.example.test',
            api_key: 'sk-test',
            model: 'gpt-test'
          }]];
        }

        if (sql.includes('FROM messages')) {
          assert.deepEqual(params, [1, 6, 6]);
          return [[
            { role: 'user', content: 'We talked about rain.', created_at: '2026-05-25 20:00:00' },
            { role: 'assistant', content: 'I like quiet rainy nights.', created_at: '2026-05-25 20:01:00' }
          ]];
        }

        if (sql.includes('FROM memories')) {
          assert.deepEqual(params, [1, 6, 4]);
          return [[
            { tag: 'preference', content: 'She likes tea.' }
          ]];
        }

        if (sql.includes('INSERT INTO moments')) {
          throw new Error('draft must not insert a moment');
        }

        throw new Error(`Unexpected query: ${sql}`);
      }
    },
    requireCharacter: async (userId, characterId) => {
      assert.equal(userId, 1);
      assert.equal(characterId, 6);
      return {
        id: 6,
        user_id: 1,
        name: 'Ruobai',
        persona: 'Warm companion'
      };
    },
    fetchImpl: async (url, options) => {
      upstreamCalls.push({ url, options });
      return {
        ok: true,
        text: async () => JSON.stringify({
          choices: [{ message: { content: 'Rain made the evening softer.' } }]
        })
      };
    },
    withTransaction: async work => work({ query: async () => { throw new Error('unused'); } })
  });

  await withServer(createApp(router), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/moments/draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ character_id: 6 })
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.item.character_id, 6);
    assert.equal(payload.item.content, 'Rain made the evening softer.');
    assert.equal(upstreamCalls.length, 1);
    assert.equal(upstreamCalls[0].url, 'https://api.example.test/v1/chat/completions');
    const requestBody = JSON.parse(upstreamCalls[0].options.body);
    assert.equal(requestBody.model, 'gpt-test');
    assert.equal(calls.filter(call => call.sql.includes('INSERT INTO moments')).length, 0);
  });
});

test('POST /api/moments/draft accepts SSE-style upstream payloads', async () => {
  const router = createMomentsRouter({
    pool: {
      query: async (sql) => {
        if (sql.includes('FROM capability_assignments ca')) {
          return [[{
            id: 4,
            name: 'chat provider',
            provider_type: 'openai',
            api_base: 'https://api.example.test',
            api_key: 'sk-test',
            model: 'gpt-test'
          }]];
        }

        if (sql.includes('FROM messages')) {
          return [[
            { role: 'user', content: 'We talked about rain.', created_at: '2026-05-25 20:00:00' }
          ]];
        }

        if (sql.includes('FROM memories')) {
          return [[
            { tag: 'preference', content: 'She likes tea.' }
          ]];
        }

        throw new Error(`Unexpected query: ${sql}`);
      }
    },
    requireCharacter: async () => ({
      id: 6,
      user_id: 1,
      name: 'Ruobai',
      persona: 'Warm companion'
    }),
    fetchImpl: async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError(`Unexpected token 'd', "data: {\\"id\\"..." is not valid JSON`);
      },
      text: async () => [
        'data: {"choices":[{"delta":{"content":"Rain made "}}]}',
        'data: {"choices":[{"delta":{"content":"the evening softer."}}]}',
        'data: [DONE]'
      ].join('\n')
    }),
    withTransaction: async work => work({ query: async () => { throw new Error('unused'); } })
  });

  await withServer(createApp(router), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/moments/draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ character_id: 6 })
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.item.character_id, 6);
    assert.equal(payload.item.content, 'Rain made the evening softer.');
  });
});

test('POST /api/moments/:id/like toggles like state', async () => {
  let liked = false;

  const connection = {
    query: async (sql, params) => {
      if (sql.includes('SELECT id FROM moments')) {
        assert.deepEqual(params, [3, 1]);
        return [[{ id: 3 }]];
      }

      if (sql.includes('SELECT id FROM moment_likes')) {
        return [liked ? [{ id: 1 }] : []];
      }

      if (sql.includes('INSERT INTO moment_likes')) {
        liked = true;
        return [{ affectedRows: 1 }];
      }

      if (sql.includes('DELETE FROM moment_likes')) {
        liked = false;
        return [{ affectedRows: 1 }];
      }

      if (sql.includes('SELECT COUNT(*) AS count FROM moment_likes')) {
        return [[{ count: liked ? 1 : 0 }]];
      }

      if (sql.includes('UPDATE moments SET likes_count')) {
        return [{ affectedRows: 1 }];
      }

      throw new Error(`Unexpected query: ${sql}`);
    }
  };

  const router = createMomentsRouter({
    pool: { query: async () => { throw new Error('unused'); } },
    withTransaction: async work => work(connection)
  });

  await withServer(createApp(router), async baseUrl => {
    const first = await fetch(`${baseUrl}/api/moments/3/like`, { method: 'POST' });
    const firstPayload = await first.json();
    assert.equal(first.status, 200);
    assert.equal(firstPayload.liked, true);
    assert.equal(firstPayload.likes_count, 1);

    const second = await fetch(`${baseUrl}/api/moments/3/like`, { method: 'POST' });
    const secondPayload = await second.json();
    assert.equal(second.status, 200);
    assert.equal(secondPayload.liked, false);
    assert.equal(secondPayload.likes_count, 0);
  });
});

test('POST /api/moments/:id/comment creates a comment', async () => {
  const connection = {
    query: async (sql, params) => {
      if (sql.includes('SELECT id FROM moments')) {
        assert.deepEqual(params, [8, 1]);
        return [[{ id: 8 }]];
      }

      if (sql.includes('INSERT INTO moment_comments')) {
        assert.deepEqual(params, [8, 1, null, 'nice']);
        return [{ insertId: 11 }];
      }

      if (sql.includes('SELECT id, moment_id, user_id, character_id, content, created_at')) {
        return [[{
          id: 11,
          moment_id: 8,
          user_id: 1,
          character_id: null,
          content: 'nice',
          created_at: '2026-05-21 23:33:00'
        }]];
      }

      throw new Error(`Unexpected query: ${sql}`);
    }
  };

  const router = createMomentsRouter({
    pool: { query: async () => { throw new Error('unused'); } },
    withTransaction: async work => work(connection)
  });

  await withServer(createApp(router), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/moments/8/comment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'nice' })
    });
    const payload = await response.json();

    assert.equal(response.status, 201);
    assert.equal(payload.success, true);
    assert.equal(payload.item.id, 11);
    assert.equal(payload.item.content, 'nice');
  });
});
