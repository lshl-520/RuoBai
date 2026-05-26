import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { buildChatCompletionsUrl, createModelConfigRouter } from './model-config.js';
import { DEFAULT_MODEL_CONFIG } from './defaults.js';

function createApp(router) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.userId = 7;
    next();
  });
  app.use('/api/model-configs', router);
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

test('GET /api/model-configs/status marks default seeded config as onboarding-only', async () => {
  const router = createModelConfigRouter({
    pool: {
      query: async (sql, params) => {
        assert.equal(params[0], 7);
        if (sql.includes('FROM model_configs')) {
          return [[{
            id: 3,
            user_id: 7,
            name: DEFAULT_MODEL_CONFIG.name,
            provider_type: DEFAULT_MODEL_CONFIG.provider_type,
            api_base: DEFAULT_MODEL_CONFIG.api_base,
            api_key: DEFAULT_MODEL_CONFIG.api_key,
            model: DEFAULT_MODEL_CONFIG.model,
            is_active: 1,
            created_at: '2026-05-22 00:00:00'
          }]];
        }
        throw new Error(`Unexpected query: ${sql}`);
      }
    }
  });

  await withServer(createApp(router), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/model-configs/status`);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.item.needs_onboarding, true);
    assert.equal(payload.item.has_test_config, true);
    assert.equal(payload.item.has_custom_config, false);
    assert.equal(payload.item.active_config_is_test, true);
    assert.equal(payload.item.can_use_test_config, false);
  });
});

test('POST /api/model-configs/use-test-config returns a clear message when open source build has no bundled test config', async () => {
  const router = createModelConfigRouter({
    pool: {
      query: async () => {
        throw new Error('Pool query should not be called when bundled test config is disabled');
      }
    },
    withTransaction: async () => {
      throw new Error('Transaction should not start when bundled test config is disabled');
    }
  });

  await withServer(createApp(router), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/model-configs/use-test-config`, {
      method: 'POST'
    });
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.equal(payload.success, false);
    assert.equal(payload.error, '公开版没有内置测试模型，请先填写你自己的模型 key');
  });
});

test('POST /api/model-configs/use-test-config creates and activates the default test config when configured for private deployments', async () => {
  if (!DEFAULT_MODEL_CONFIG.api_base || !DEFAULT_MODEL_CONFIG.api_key || !DEFAULT_MODEL_CONFIG.model) {
    return;
  }

  const calls = [];
  let hasInsertedTestConfig = false;

  const router = createModelConfigRouter({
    pool: {
      query: async () => {
        throw new Error('Pool query should not be called directly in this test');
      }
    },
    withTransaction: async work => work({
      query: async (sql, params) => {
        calls.push({ sql, params });

        if (sql.includes('SELECT id, user_id, name, provider_type, api_base, api_key, model, purpose, is_active, created_at')) {
          if (params.length === 1) {
            return [hasInsertedTestConfig ? [{
              id: 9,
              user_id: 7,
              name: DEFAULT_MODEL_CONFIG.name,
              provider_type: DEFAULT_MODEL_CONFIG.provider_type,
              api_base: DEFAULT_MODEL_CONFIG.api_base,
              api_key: DEFAULT_MODEL_CONFIG.api_key,
              model: DEFAULT_MODEL_CONFIG.model,
              purpose: 'chat',
              is_active: 1,
              created_at: '2026-05-22 00:00:00'
            }] : []];
          }
          return [[{
            id: 9,
            user_id: 7,
            name: DEFAULT_MODEL_CONFIG.name,
            provider_type: DEFAULT_MODEL_CONFIG.provider_type,
            api_base: DEFAULT_MODEL_CONFIG.api_base,
            api_key: DEFAULT_MODEL_CONFIG.api_key,
            model: DEFAULT_MODEL_CONFIG.model,
            purpose: 'chat',
            is_active: 1,
            created_at: '2026-05-22 00:00:00'
          }]];
        }

        if (sql.includes('UPDATE model_configs SET is_active = 0 WHERE user_id = ?')) {
          assert.equal(params[0], 7);
          return [{ affectedRows: 0 }];
        }

        if (sql.includes('INSERT INTO model_configs')) {
          assert.equal(params[0], 7);
          assert.equal(params[1], DEFAULT_MODEL_CONFIG.name);
          assert.equal(params[2], DEFAULT_MODEL_CONFIG.provider_type);
          assert.equal(params[3], DEFAULT_MODEL_CONFIG.api_base);
          assert.equal(params[4], DEFAULT_MODEL_CONFIG.api_key);
          assert.equal(params[5], DEFAULT_MODEL_CONFIG.model);
          hasInsertedTestConfig = true;
          return [{ insertId: 9 }];
        }

        throw new Error(`Unexpected query: ${sql}`);
      }
    })
  });

  await withServer(createApp(router), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/model-configs/use-test-config`, {
      method: 'POST'
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.item.id, 9);
    assert.equal(payload.status.has_test_config, true);
    assert.equal(payload.status.active_config_is_test, true);
    assert.ok(calls.some(call => call.sql.includes('INSERT INTO model_configs')));
  });
});

test('buildChatCompletionsUrl supports plain domain, /v1, and full path', () => {
  assert.equal(
    buildChatCompletionsUrl('https://api.x.ai'),
    'https://api.x.ai/v1/chat/completions'
  );
  assert.equal(
    buildChatCompletionsUrl('https://api.x.ai/v1'),
    'https://api.x.ai/v1/chat/completions'
  );
  assert.equal(
    buildChatCompletionsUrl('https://ark.cn-beijing.volces.com/api/v3'),
    'https://ark.cn-beijing.volces.com/api/v3/chat/completions'
  );
  assert.equal(
    buildChatCompletionsUrl('https://api.example.com/v1/chat/completions'),
    'https://api.example.com/v1/chat/completions'
  );
});

test('POST /api/model-configs/discover-models returns available models', async () => {
  const router = createModelConfigRouter({
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://api.x.ai/v1/models');
      assert.equal(options.method, 'GET');
      assert.equal(options.headers.Authorization, 'Bearer sk-test');
      return {
        ok: true,
        text: async () => JSON.stringify({
          data: [
            { id: 'grok-4.1-fast' },
            { id: 'grok-4.1' }
          ]
        })
      };
    }
  });

  await withServer(createApp(router), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/model-configs/discover-models`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_base: 'https://api.x.ai',
        api_key: 'sk-test'
      })
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.deepEqual(payload.items, ['grok-4.1-fast', 'grok-4.1']);
    assert.equal(payload.suggested_model, 'grok-4.1-fast');
  });
});
