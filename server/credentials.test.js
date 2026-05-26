import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createCredentialsRouter } from './credentials.js';

function createApp(router, userId = 7) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.userId = userId;
    next();
  });
  app.use('/api/credentials', router);
  app.use((error, _req, res, _next) => {
    res.status(500).json({ success: false, error: error.message });
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

test('GET /api/credentials returns current user credentials with masked key', async () => {
  const router = createCredentialsRouter({
    pool: {
      query: async (sql, params) => {
        assert.equal(params[0], 7);
        assert.match(sql, /from credentials c/i);
        return [[{
          id: 3,
          user_id: 7,
          name: '饼干姐姐',
          provider_type: 'openai',
          api_base: 'https://ai98pro.xyz',
          api_key: 'sk-1234567890abcd',
          created_at: '2026-05-24 10:00:00',
          models_count: 12
        }]];
      }
    }
  });

  await withServer(createApp(router), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/credentials`);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.items.length, 1);
    assert.equal(payload.items[0].name, '饼干姐姐');
    assert.equal(payload.items[0].models_count, 12);
    assert.equal(payload.items[0].api_key_masked, 'sk-1***abcd');
  });
});

test('POST /api/credentials creates a credential and PATCH updates only the current user credential', async () => {
  const calls = [];
  let created = {
    id: 9,
    user_id: 7,
    name: '千问官方',
    provider_type: 'openai-compatible',
    api_base: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    api_key: 'sk-created',
    created_at: '2026-05-24 11:00:00',
    models_count: 0
  };

  const router = createCredentialsRouter({
    pool: {
      query: async () => {
        throw new Error('pool should not be called directly in this test');
      }
    },
    withTransaction: async work => work({
      query: async (sql, params) => {
        calls.push({ sql, params });

        if (sql.includes('FROM credentials WHERE user_id = ? AND api_base = ? AND api_key = ?')) {
          return [[]];
        }

        if (sql.includes('INSERT INTO credentials')) {
          assert.equal(params[0], 7);
          assert.equal(params[1], '千问官方');
          return [{ insertId: 9 }];
        }

        if (sql.includes('FROM credentials') && sql.includes('WHERE id = ? AND user_id = ?')) {
          return [[created]];
        }

        if (sql.includes('UPDATE credentials SET')) {
          assert.equal(params[params.length - 2], 9);
          assert.equal(params[params.length - 1], 7);
          created = {
            ...created,
            name: '千问新名字',
            api_key: 'sk-updated'
          };
          return [{ affectedRows: 1 }];
        }

        throw new Error(`Unexpected query: ${sql}`);
      }
    })
  });

  await withServer(createApp(router), async baseUrl => {
    const createResponse = await fetch(`${baseUrl}/api/credentials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '千问官方',
        api_base: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        api_key: 'sk-created'
      })
    });
    const createPayload = await createResponse.json();

    assert.equal(createResponse.status, 201);
    assert.equal(createPayload.success, true);
    assert.equal(createPayload.item.id, 9);

    const updateResponse = await fetch(`${baseUrl}/api/credentials/9`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '千问新名字',
        api_key: 'sk-updated'
      })
    });
    const updatePayload = await updateResponse.json();

    assert.equal(updateResponse.status, 200);
    assert.equal(updatePayload.success, true);
    assert.equal(updatePayload.item.name, '千问新名字');
    assert.equal(updatePayload.item.api_key_masked, 'sk-u***ated');
    assert.ok(calls.some(call => call.sql.includes('INSERT INTO credentials')));
    assert.ok(calls.some(call => call.sql.includes('UPDATE credentials SET')));
  });
});

test('DELETE /api/credentials returns affected capabilities and respects user isolation for models list', async () => {
  const router = createCredentialsRouter({
    pool: {
      query: async (sql, params) => {
        if (sql.includes('FROM credentials') && sql.includes('WHERE id = ? AND user_id = ?')) {
          assert.deepEqual(params, [22, 7]);
          return [[]];
        }

        throw new Error(`Unexpected pool query: ${sql}`);
      }
    },
    withTransaction: async work => work({
      query: async (sql, params) => {
        if (sql.includes('FROM credentials') && sql.includes('WHERE id = ? AND user_id = ?')) {
          assert.deepEqual(params, [9, 7]);
          return [[{
            id: 9,
            user_id: 7,
            name: '饼干姐姐',
            provider_type: 'openai',
            api_base: 'https://ai98pro.xyz',
            api_key: 'sk-delete',
            created_at: '2026-05-24 10:00:00'
          }]];
        }

        if (sql.includes('FROM capability_assignments') && sql.includes('credential_id = ? AND user_id = ?')) {
          return [[
            { capability: 'chat' },
            { capability: 'vision' }
          ]];
        }

        if (sql.includes('DELETE FROM credentials') && sql.includes('WHERE id = ? AND user_id = ?')) {
          return [{ affectedRows: 1 }];
        }

        throw new Error(`Unexpected tx query: ${sql}`);
      }
    })
  });

  await withServer(createApp(router), async baseUrl => {
    const modelsResponse = await fetch(`${baseUrl}/api/credentials/22/models`);
    const modelsPayload = await modelsResponse.json();

    assert.equal(modelsResponse.status, 404);
    assert.equal(modelsPayload.success, false);

    const deleteResponse = await fetch(`${baseUrl}/api/credentials/9`, {
      method: 'DELETE'
    });
    const deletePayload = await deleteResponse.json();

    assert.equal(deleteResponse.status, 200);
    assert.equal(deletePayload.success, true);
    assert.deepEqual(deletePayload.disabled_capabilities, ['chat', 'vision']);
  });
});

test('POST /api/credentials/:id/refresh-models infers capabilities and caches models', async () => {
  const insertedModels = [];

  const router = createCredentialsRouter({
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://api.x.ai/v1/models');
      assert.equal(options.method, 'GET');
      assert.equal(options.headers.Authorization, 'Bearer sk-refresh');
      return {
        ok: true,
        text: async () => JSON.stringify({
          data: [
            { id: 'gpt-5.5' },
            { id: 'gpt-4o' },
            { id: 'qwen-tts' },
            { id: 'doubao-seed-image' }
          ]
        })
      };
    },
    pool: {
      query: async (sql, params) => {
        if (sql.includes('FROM credentials') && sql.includes('WHERE id = ? AND user_id = ?')) {
          return [[{
            id: 5,
            user_id: 7,
            name: '测试中转',
            provider_type: 'openai',
            api_base: 'https://api.x.ai',
            api_key: 'sk-refresh',
            created_at: '2026-05-24 10:00:00'
          }]];
        }

        throw new Error(`Unexpected pool query: ${sql}`);
      }
    },
    withTransaction: async work => work({
      query: async (sql, params) => {
        if (sql.includes('DELETE FROM credential_models WHERE credential_id = ?')) {
          assert.equal(params[0], 5);
          return [{ affectedRows: 2 }];
        }

        if (sql.includes('INSERT INTO credential_models')) {
          insertedModels.push({
            credential_id: params[0],
            model_id: params[1],
            capabilities: JSON.parse(params[2])
          });
          return [{ insertId: insertedModels.length }];
        }

        throw new Error(`Unexpected tx query: ${sql}`);
      }
    })
  });

  await withServer(createApp(router), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/credentials/5/refresh-models`, {
      method: 'POST'
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.items.length, 4);
    assert.deepEqual(payload.summary.chat, ['gpt-5.5', 'gpt-4o']);
    assert.deepEqual(payload.summary.vision, ['gpt-4o']);
    assert.deepEqual(payload.summary.tts, ['qwen-tts']);
    assert.deepEqual(payload.summary.image, ['doubao-seed-image']);
    assert.equal(insertedModels.length, 4);
  });
});

test('POST /api/credentials/:id/test checks /v1/models connectivity for the current user credential', async () => {
  const router = createCredentialsRouter({
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://dashscope.aliyuncs.com/compatible-mode/v1/models');
      assert.equal(options.method, 'GET');
      assert.equal(options.headers.Authorization, 'Bearer sk-test');
      return {
        ok: true,
        text: async () => JSON.stringify({ data: [{ id: 'qwen-max' }] })
      };
    },
    pool: {
      query: async (sql, params) => {
        assert.deepEqual(params, [6, 7]);
        return [[{
          id: 6,
          user_id: 7,
          name: '千问',
          provider_type: 'openai-compatible',
          api_base: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
          api_key: 'sk-test',
          created_at: '2026-05-24 10:00:00'
        }]];
      }
    }
  });

  await withServer(createApp(router), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/credentials/6/test`, {
      method: 'POST'
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.match(payload.message, /连通正常/);
  });
});
