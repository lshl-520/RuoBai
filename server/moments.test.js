import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createMomentsRouter } from './moments.js';

function createApp(router) {
  const app = express();
  const session = { userId: 1 };
  app.use(express.json());
  app.use((req, _res, next) => {
    req.userId = 1;
    req.session = session;
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

test('GET /api/moments keeps all and mine scopes separate at the SQL boundary', async () => {
  const momentQueries = [];
  const router = createMomentsRouter({
    pool: {
      query: async (sql, params) => {
        if (sql.includes('FROM moments')) {
          momentQueries.push({ sql, params });
          return [[]];
        }
        throw new Error(`Unexpected query: ${sql}`);
      }
    },
    withTransaction: async work => work({ query: async () => { throw new Error('unused'); } })
  });

  await withServer(createApp(router), async baseUrl => {
    const allResponse = await fetch(`${baseUrl}/api/moments?scope=all`);
    const mineResponse = await fetch(`${baseUrl}/api/moments?scope=mine`);
    assert.equal(allResponse.status, 200);
    assert.equal(mineResponse.status, 200);
  });

  assert.equal(momentQueries.length, 2);
  assert.deepEqual(momentQueries[0].params, [1, 20, 0]);
  assert.doesNotMatch(momentQueries[0].sql, /m\.character_id IS NULL/);
  assert.deepEqual(momentQueries[1].params, [1, 20, 0]);
  assert.match(momentQueries[1].sql, /m\.character_id IS NULL/);
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
    assert.equal(calls.length, 4);
  });
});

test('POST /api/moments creates a moment', async () => {
  const router = createMomentsRouter({
    pool: {
      query: async (sql, params) => {
        if (sql.includes('INSERT INTO moments')) {
          assert.equal(params[0], 1);
          assert.equal(params[1], null);
          assert.equal(params[2], 'private');
          assert.equal(params[3], 'new moment');
          assert.equal(params[4], '["x.png"]');
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

test('POST /api/moments/:id/share only shares a user moment to explicitly selected roles', async () => {
  const queries = [];
  const connection = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (sql.includes('SELECT id, character_id FROM moments')) {
        return [[{ id: 7, character_id: null }]];
      }
      if (sql.includes('DELETE FROM moment_audiences')) return [{ affectedRows: 0 }];
      if (sql.includes('INSERT IGNORE INTO moment_audiences')) return [{ affectedRows: 1 }];
      if (sql.includes('UPDATE moments SET visibility_mode')) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected query: ${sql}`);
    }
  };
  const router = createMomentsRouter({
    pool: { query: async () => { throw new Error('unused'); } },
    requireCharacter: async (userId, characterId) => {
      assert.equal(userId, 1);
      assert.equal(characterId, 6);
      return { id: 6, user_id: 1 };
    },
    withTransaction: async work => work(connection)
  });

  await withServer(createApp(router), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/moments/7/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ character_ids: [6, 6, 'bad'] })
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(payload.character_ids, [6]);
    assert.equal(queries.filter((item) => item.sql.includes('INSERT IGNORE INTO moment_audiences')).length, 1);
  });
});

test('POST /api/moments/:id/share rejects a role moment', async () => {
  const router = createMomentsRouter({
    pool: { query: async () => { throw new Error('unused'); } },
    withTransaction: async work => work({
      query: async (sql) => {
        if (sql.includes('SELECT id, character_id FROM moments')) return [[{ id: 8, character_id: 6 }]];
        throw new Error(`Unexpected query: ${sql}`);
      }
    })
  });

  await withServer(createApp(router), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/moments/8/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ character_ids: [6] })
    });
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.match(payload.error, /角色动态不能由用户重新分享/);
  });
});

test('POST /api/moments rejects direct character identity', async () => {
  const router = createMomentsRouter({
    pool: { query: async () => { throw new Error('普通角色动态不应写入数据库'); } },
    requireCharacter: async () => { throw new Error('未授权的角色流程不应校验角色'); }
  });

  await withServer(createApp(router), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/moments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        character_id: 6,
        content: '冒充角色发动态'
      })
    });
    const payload = await response.json();

    assert.equal(response.status, 403);
    assert.equal(payload.success, false);
    assert.match(payload.error, /普通动态只能由你发布/);
  });
});

test('角色自拍流程在草稿失败时仍可发布一次角色动态', async () => {
  const inserted = [];
  const router = createMomentsRouter({
    pool: {
      query: async (sql, params) => {
        if (sql.includes('FROM capability_assignments ca')) return [[]];
        if (sql.includes('FROM model_configs')) return [[]];
        if (sql.includes('INSERT INTO moments')) {
          inserted.push(params);
          return [{ insertId: 19 }];
        }
        if (sql.includes('FROM moments')) {
          return [[{
            id: 19,
            user_id: 1,
            character_id: 6,
            content: '自拍兜底文案',
            images: '["/user_assets/chat/selfie.png"]',
            likes_count: 0,
            created_at: '2026-05-26 00:00:00',
            is_deleted: 0
          }]];
        }
        throw new Error(`Unexpected query: ${sql}`);
      }
    },
    requireCharacter: async (userId, characterId) => {
      assert.equal(userId, 1);
      assert.equal(characterId, 6);
      return { id: 6, user_id: 1, name: '小白', persona: '温柔' };
    }
  });

  await withServer(createApp(router), async baseUrl => {
    const draftResponse = await fetch(`${baseUrl}/api/moments/draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ character_id: 6, media_url: '/user_assets/chat/selfie.png' })
    });
    assert.equal(draftResponse.status, 400);

    const postResponse = await fetch(`${baseUrl}/api/moments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        character_id: 6,
        content: '自拍兜底文案',
        images: ['/user_assets/chat/selfie.png'],
        mood: '随手自拍'
      })
    });
    const payload = await postResponse.json();

    assert.equal(postResponse.status, 201);
    assert.equal(payload.item.character_id, 6);
    assert.equal(inserted.length, 1);

    const replayResponse = await fetch(`${baseUrl}/api/moments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ character_id: 6, content: '重复冒用' })
    });
    assert.equal(replayResponse.status, 403);
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

      if (sql.includes('SELECT character_id, content FROM moments')) {
        return [[{ character_id: 6, content: '原动态' }]];
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

test('POST /api/moments/:id/comment rejects character identity', async () => {
  const router = createMomentsRouter({
    pool: { query: async () => { throw new Error('角色评论不应写入数据库'); } },
    withTransaction: async () => { throw new Error('角色评论不应开启事务'); }
  });

  await withServer(createApp(router), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/moments/8/comment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-character-id': '6'
      },
      body: JSON.stringify({ content: '冒充角色评论' })
    });
    const payload = await response.json();

    assert.equal(response.status, 403);
    assert.equal(payload.success, false);
    assert.match(payload.error, /评论只能由你发布/);
  });
});
