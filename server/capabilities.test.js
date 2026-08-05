import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createCapabilitiesRouter, supportsDynamicSingleImage } from './capabilities.js';

function createApp(router) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.userId = 7;
    next();
  });
  app.use('/api/capabilities', router);
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

test('GET /api/capabilities returns 6 capabilities with current assignment and available models', async () => {
  const router = createCapabilitiesRouter({
    pool: {
      query: async (sql, params) => {
        if (sql.includes('FROM capability_assignments ca')) {
          assert.equal(params[0], 7);
          return [[
            {
              capability: 'chat',
              enabled: 1,
              model_id: 'gpt-5.5',
              credential_id: 3,
              credential_name: '饼干姐姐',
              extras: null
            },
            {
              capability: 'tts',
              enabled: 1,
              model_id: 'qwen-tts',
              credential_id: 4,
              credential_name: '千问',
              extras: '{"voice_id":"longwan"}'
            }
          ]];
        }

        if (sql.includes('FROM credentials c') && sql.includes('INNER JOIN credential_models cm')) {
          assert.equal(params[0], 7);
          return [[
            {
              credential_id: 3,
              credential_name: '饼干姐姐',
              model_id: 'gpt-5.5',
              capabilities: '["chat"]'
            },
            {
              credential_id: 3,
              credential_name: '饼干姐姐',
              model_id: 'gpt-4o',
              capabilities: '["chat","vision"]'
            },
            {
              credential_id: 4,
              credential_name: '千问',
              model_id: 'qwen-tts',
              capabilities: '["tts"]'
            }
          ]];
        }

        throw new Error(`Unexpected query: ${sql}`);
      }
    }
  });

  await withServer(createApp(router), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/capabilities`);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.items.length, 6);

    const chat = payload.items.find(item => item.capability === 'chat');
    const vision = payload.items.find(item => item.capability === 'vision');
    const tts = payload.items.find(item => item.capability === 'tts');
    const image = payload.items.find(item => item.capability === 'image');

    assert.equal(chat.enabled, true);
    assert.equal(chat.current.model_id, 'gpt-5.5');
    assert.equal(chat.options.length, 2);
    assert.deepEqual(vision.options.map(item => item.model_id), ['gpt-5.5', 'gpt-4o']);
    assert.equal(tts.current.extras.voice_id, 'longwan');
    assert.equal(image.enabled, false);
    assert.equal(image.options.length, 0);
  });
});

test('GET /api/capabilities 把豆包语音分别列进实时通话和文字转语音', async () => {
  const router = createCapabilitiesRouter({
    pool: {
      query: async sql => {
        if (sql.includes('FROM capability_assignments ca')) return [[]];
        if (sql.includes('FROM credentials c') && sql.includes('INNER JOIN credential_models cm')) {
          return [[
            {
              credential_id: 3,
              credential_name: '普通中转',
              provider_type: 'openai-compatible',
              model_id: 'gpt-4o-realtime-preview',
              capabilities: '[\"chat\",\"realtime\"]'
            },
            {
              credential_id: 9,
              credential_name: '火山实时通话',
              provider_type: 'volc-realtime',
              model_id: '2.2.0.0',
              capabilities: '[\"realtime\"]'
            },
            {
              credential_id: 9,
              credential_name: '火山实时通话',
              provider_type: 'volc-realtime',
              model_id: 'seed-tts-2.0',
              capabilities: '[\"tts\"]'
            }
          ]];
        }
        throw new Error(`Unexpected query: ${sql}`);
      }
    }
  });

  await withServer(createApp(router), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/capabilities`);
    const payload = await response.json();
    const realtime = payload.items.find(item => item.capability === 'realtime');
    const tts = payload.items.find(item => item.capability === 'tts');

    assert.equal(response.status, 200);
    assert.deepEqual(realtime.options.map(item => item.credential_name), ['豆包语音']);
    assert.deepEqual(realtime.options.map(item => item.model_id), ['2.2.0.0']);
    assert.deepEqual(tts.options.map(item => item.credential_name), ['豆包语音']);
    assert.deepEqual(tts.options.map(item => item.model_id), ['seed-tts-2.0']);
  });
});

test('图片模型同时可选给画图和动态，但两个能力项保持独立', async () => {
  const router = createCapabilitiesRouter({
    pool: {
      query: async sql => {
        if (sql.includes('FROM capability_assignments ca')) return [[{
          capability: 'image', enabled: 1, model_id: 'gpt-image-2', credential_id: 3, credential_name: '图片渠道', extras: null
        }]];
        if (sql.includes('FROM credentials c') && sql.includes('INNER JOIN credential_models cm')) {
          return [[{
            credential_id: 3, credential_name: '图片渠道', provider_type: 'openai-compatible', model_id: 'gpt-image-2', capabilities: '["image"]'
          }]];
        }
        throw new Error(`Unexpected query: ${sql}`);
      }
    }
  });

  await withServer(createApp(router), async baseUrl => {
    const payload = await (await fetch(`${baseUrl}/api/capabilities`)).json();
    const image = payload.items.find(item => item.capability === 'image');
    const dynamic = payload.items.find(item => item.capability === 'dynamic');
    assert.equal(image.current.model_id, 'gpt-image-2');
    assert.equal(dynamic.current, null);
    assert.deepEqual(dynamic.options.map(item => item.model_id), ['gpt-image-2']);
  });
});

test('免费 Agnes 图片模型保留给聊天画图，但不能配置为动态发图', async () => {
  assert.equal(supportsDynamicSingleImage('agnes-image-2.1-flash'), false);
  assert.equal(supportsDynamicSingleImage('gpt-image-2'), true);

  const router = createCapabilitiesRouter({
    pool: {
      query: async (sql, params) => {
        if (sql.includes('FROM credential_models cm') && sql.includes('INNER JOIN credentials c')) {
          assert.deepEqual(params, [16, 7, 'agnes-image-2.1-flash']);
          return [[{
            credential_id: 16,
            credential_name: '免费',
            provider_type: 'openai-compatible',
            model_id: 'agnes-image-2.1-flash',
            capabilities: '["image"]'
          }]];
        }
        throw new Error(`Unexpected query: ${sql}`);
      }
    }
  });

  await withServer(createApp(router), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/capabilities/dynamic`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential_id: 16, model_id: 'agnes-image-2.1-flash', enabled: true })
    });
    const payload = await response.json();
    assert.equal(response.status, 400);
    assert.match(payload.error, /九宫格/);
  });
});

test('PUT /api/capabilities/:cap upserts assignment for current user and accepts extras', async () => {
  const calls = [];
  let savedAssignment = {
    capability: 'tts',
    enabled: 1,
    credential_id: 4,
    model_id: 'qwen-tts',
    extras: '{"voice_id":"longwan"}',
    credential_name: '千问'
  };

  const router = createCapabilitiesRouter({
    pool: {
      query: async (sql, params) => {
        if (sql.includes('FROM credential_models cm') && sql.includes('INNER JOIN credentials c')) {
          assert.deepEqual(params, [4, 7, 'qwen-tts']);
          return [[{
            credential_id: 4,
            credential_name: '千问',
            model_id: 'qwen-tts',
            capabilities: '["tts"]'
          }]];
        }

        if (sql.includes('FROM credentials c') && sql.includes('INNER JOIN credential_models cm')) {
          assert.deepEqual(params, [7]);
          return [[{
            credential_id: 4,
            credential_name: '千问',
            model_id: 'qwen-tts',
            capabilities: '["tts"]'
          }]];
        }

        if (sql.includes('FROM capability_assignments ca')) {
          return [[savedAssignment]];
        }

        throw new Error(`Unexpected pool query: ${sql}`);
      }
    },
    withTransaction: async work => work({
      query: async (sql, params) => {
        calls.push({ sql, params });

        if (sql.includes('SELECT id FROM capability_assignments WHERE user_id = ? AND capability = ? LIMIT 1')) {
          return [[]];
        }

        if (sql.includes('INSERT INTO capability_assignments')) {
          assert.equal(params[0], 7);
          assert.equal(params[1], 'tts');
          assert.equal(params[2], 4);
          assert.equal(params[3], 'qwen-tts');
          return [{ insertId: 6 }];
        }

        throw new Error(`Unexpected tx query: ${sql}`);
      }
    })
  });

  await withServer(createApp(router), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/capabilities/tts`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        credential_id: 4,
        model_id: 'qwen-tts',
        enabled: true,
        extras: { voice_id: 'longwan' }
      })
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.item.current.model_id, 'qwen-tts');
    assert.equal(payload.item.current.extras.voice_id, 'longwan');
    assert.ok(calls.some(call => call.sql.includes('INSERT INTO capability_assignments')));
  });
});

test('POST /api/capabilities/:cap/test runs capability-specific connectivity check', async () => {
  const router = createCapabilitiesRouter({
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://api.x.ai/v1/chat/completions');
      assert.equal(options.method, 'POST');
      assert.equal(options.headers.Authorization, 'Bearer sk-chat');
      const body = JSON.parse(options.body);
      assert.equal(body.model, 'gpt-5.5');
      return {
        ok: true,
        text: async () => JSON.stringify({
          choices: [{ message: { content: 'ok' } }]
        })
      };
    },
    pool: {
      query: async (sql, params) => {
        assert.equal(params[0], 7);
        if (sql.includes('FROM capability_assignments ca')) {
          return [[{
            capability: 'chat',
            enabled: 1,
            model_id: 'gpt-5.5',
            credential_id: 3,
            credential_name: '饼干姐姐',
            api_base: 'https://api.x.ai',
            api_key: 'sk-chat',
            extras: null
          }]];
        }

        throw new Error(`Unexpected query: ${sql}`);
      }
    }
  });

  await withServer(createApp(router), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/capabilities/chat/test`, {
      method: 'POST'
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.match(payload.message, /测试通过/);
  });
});
