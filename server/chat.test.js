import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { requireAuth } from './middleware.js';
import { buildSystemPrompt, createChatRouter } from './chat.js';

function createApp({ router, sessionUser = { userId: 1, username: 'user-1', role: 'user' } }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = sessionUser
      ? {
          userId: sessionUser.userId,
          username: sessionUser.username,
          role: sessionUser.role
        }
      : null;
    next();
  });
  app.use('/api/chat', requireAuth, router);
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

test('DELETE /api/chat clears all messages for the current user and character', async () => {
  const calls = [];
  const router = createChatRouter({
    pool: {
      query: async (sql, params) => {
        calls.push({ sql, params });

        if (sql.includes('FROM characters')) {
          assert.deepEqual(params, [7, 1]);
          return [[{ id: 7, user_id: 1, is_deleted: 0 }]];
        }

        if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) {
          return [[{ column_name: 'is_deleted' }]];
        }

        if (sql.includes('UPDATE messages')) {
          assert.deepEqual(params, [1, 7]);
          assert.match(sql, /is_deleted\s*=\s*1/i);
          assert.match(sql, /is_active\s*=\s*0/i);
          return [{ affectedRows: 3 }];
        }

        throw new Error(`Unexpected query: ${sql}`);
      }
    }
  });

  await withServer(createApp({ router }), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/chat?character_id=7`, {
      method: 'DELETE'
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(payload, {
      success: true,
      deleted: 3
    });
    assert.ok(calls.some(call => call.sql.includes('FROM characters')));
    assert.ok(calls.some(call => call.sql.includes('UPDATE messages')));
  });
});

test('DELETE /api/chat requires authentication', async () => {
  const router = createChatRouter({
    pool: {
      query: async () => {
        throw new Error('pool should not be called');
      }
    }
  });

  await withServer(createApp({ router, sessionUser: null }), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/chat?character_id=7`, {
      method: 'DELETE'
    });
    const payload = await response.json();

    assert.equal(response.status, 401);
    assert.equal(payload.success, false);
  });
});

test('DELETE /api/chat rejects clearing another user character', async () => {
  const calls = [];
  const router = createChatRouter({
    pool: {
      query: async (sql, params) => {
        calls.push({ sql, params });

        if (sql.includes('FROM characters')) {
          assert.deepEqual(params, [99, 1]);
          return [[]];
        }

        throw new Error(`Unexpected query: ${sql}`);
      }
    }
  });

  await withServer(createApp({ router }), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/chat?character_id=99`, {
      method: 'DELETE'
    });
    const payload = await response.json();

    assert.equal(response.status, 404);
    assert.equal(payload.success, false);
    assert.equal(typeof payload.error, 'string');
    assert.equal(calls.filter(call => call.sql.includes('UPDATE messages')).length, 0);
  });
});

test('POST /api/chat save records first chat time only for user messages', async () => {
  const calls = [];
  const router = createChatRouter({
    pool: {
      query: async (sql, params) => {
        calls.push({ sql, params });

        if (sql.includes('FROM characters')) {
          assert.deepEqual(params, [7, 1]);
          return [[{ id: 7, user_id: 1, is_deleted: 0 }]];
        }

        if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) {
          return [[{ column_name: 'is_deleted' }]];
        }

        if (sql.includes('INSERT INTO messages')) {
          assert.deepEqual(params, [1, 7, 'user', 'hello', 'text', null]);
          return [{ insertId: 33 }];
        }

        if (sql.includes('UPDATE characters') && sql.includes('first_chat_at')) {
          assert.deepEqual(params, [7, 1]);
          assert.match(sql, /first_chat_at = COALESCE\(first_chat_at, NOW\(\)\)/i);
          return [{ affectedRows: 1 }];
        }

        if (sql.includes('SELECT id, user_id, character_id')) {
          assert.deepEqual(params, [33, 1]);
          return [[{
            id: 33,
            user_id: 1,
            character_id: 7,
            role: 'user',
            content: 'hello',
            message_type: 'text',
            media_url: null,
            is_active: 1,
            created_at: '2026-05-26 12:00:00'
          }]];
        }

        throw new Error(`Unexpected query: ${sql}`);
      }
    }
  });

  await withServer(createApp({ router }), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/chat/save?character_id=7`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'user', content: 'hello' })
    });
    const payload = await response.json();

    assert.equal(response.status, 201);
    assert.equal(payload.success, true);
    assert.equal(calls.filter(call => call.sql.includes('UPDATE characters')).length, 1);
  });
});

test('POST /api/chat save does not record first chat time for assistant messages', async () => {
  const calls = [];
  const router = createChatRouter({
    pool: {
      query: async (sql, params) => {
        calls.push({ sql, params });

        if (sql.includes('FROM characters')) {
          return [[{ id: 7, user_id: 1, is_deleted: 0 }]];
        }

        if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) {
          return [[{ column_name: 'is_deleted' }]];
        }

        if (sql.includes('INSERT INTO messages')) {
          return [{ insertId: 34 }];
        }

        if (sql.includes('SELECT id, user_id, character_id')) {
          return [[{
            id: 34,
            user_id: 1,
            character_id: 7,
            role: 'assistant',
            content: 'hi',
            message_type: 'text',
            media_url: null,
            is_active: 1,
            created_at: '2026-05-26 12:00:00'
          }]];
        }

        throw new Error(`Unexpected query: ${sql}`);
      }
    }
  });

  await withServer(createApp({ router }), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/chat/save?character_id=7`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'assistant', content: 'hi' })
    });

    assert.equal(response.status, 201);
    assert.equal(calls.filter(call => call.sql.includes('UPDATE characters')).length, 0);
  });
});

test('POST /api/chat save grows intimacy only for user messages', async () => {
  const calls = [];
  const router = createChatRouter({
    pool: {
      query: async (sql, params) => {
        calls.push({ sql, params });

        if (sql.includes('FROM characters')) {
          return [[{ id: 7, user_id: 1, is_deleted: 0 }]];
        }

        if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) {
          return [[{ column_name: 'is_deleted' }]];
        }

        if (sql.includes('INSERT INTO messages')) {
          return [{ insertId: 35 }];
        }

        if (sql.includes('UPDATE characters')) {
          assert.deepEqual(params, [7, 1]);
          assert.match(sql, /intimacy = LEAST\(100, intimacy \+ 0\.5\)/i);
          return [{ affectedRows: 1 }];
        }

        if (sql.includes('SELECT id, user_id, character_id')) {
          return [[{
            id: 35,
            user_id: 1,
            character_id: 7,
            role: 'user',
            content: 'grow',
            message_type: 'text',
            media_url: null,
            is_active: 1,
            created_at: '2026-05-26 12:00:00'
          }]];
        }

        throw new Error(`Unexpected query: ${sql}`);
      }
    }
  });

  await withServer(createApp({ router }), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/chat/save?character_id=7`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'user', content: 'grow' })
    });

    assert.equal(response.status, 201);
    assert.equal(calls.filter(call => call.sql.includes('UPDATE characters')).length, 1);
  });
});

test('POST /api/chat prefers capability_assignments chat model and falls back to model_configs', async () => {
  const upstreamCalls = [];

  const router = createChatRouter({
    pool: {
      query: async (sql, params) => {
        if (sql.includes('FROM characters')) {
          return [[{
            id: 7,
            user_id: 1,
            is_deleted: 0,
            name: '若白',
            persona: '温柔陪伴'
          }]];
        }

        if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) {
          return [[{ column_name: 'is_deleted' }]];
        }

        if (sql.includes('SELECT city FROM users')) {
          return [[{ city: '' }]];
        }

        if (sql.includes('FROM messages') && sql.includes('ORDER BY id DESC')) {
          return [[
            { role: 'user', content: '你好', is_active: 1, created_at: '2026-05-24 10:00:00' }
          ]];
        }

        if (sql.includes('FROM capability_assignments ca')) {
          assert.deepEqual(params, [1]);
          return [[{
            id: 5,
            name: '新聊天配置',
            provider_type: 'openai',
            api_base: 'https://api.new.example',
            api_key: 'sk-new',
            model: 'gpt-5.5'
          }]];
        }

        if (sql.includes('FROM model_configs')) {
          return [[{
            id: 2,
            name: '旧聊天配置',
            provider_type: 'openai',
            api_base: 'https://api.old.example',
            api_key: 'sk-old',
            model: 'gpt-4'
          }]];
        }

        if (sql.includes('UPDATE users')) {
          return [{ affectedRows: 1 }];
        }

        if (sql.includes('FROM memories')) {
          return [[]];
        }

        throw new Error(`Unexpected query: ${sql}`);
      }
    },
    fetchImpl: async (url, options) => {
      upstreamCalls.push({ url, options });
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '收到' } }]
        })
      };
    }
  });

  await withServer(createApp({ router }), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/chat?character_id=7`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: '你在吗？',
        skip_server_persistence: true
      })
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.item.content, '收到');
    assert.equal(upstreamCalls.length, 1);
    assert.equal(upstreamCalls[0].url, 'https://api.new.example/v1/chat/completions');
    const requestBody = JSON.parse(upstreamCalls[0].options.body);
    assert.equal(requestBody.model, 'gpt-5.5');
  });
});

test('POST /api/chat falls back to legacy model_configs when chat capability is missing', async () => {
  const upstreamCalls = [];

  const router = createChatRouter({
    pool: {
      query: async (sql, params) => {
        if (sql.includes('FROM characters')) {
          return [[{
            id: 7,
            user_id: 1,
            is_deleted: 0,
            name: '若白',
            persona: '温柔陪伴'
          }]];
        }

        if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) {
          return [[{ column_name: 'is_deleted' }]];
        }

        if (sql.includes('SELECT city FROM users')) {
          return [[{ city: '' }]];
        }

        if (sql.includes('FROM messages') && sql.includes('ORDER BY id DESC')) {
          return [[]];
        }

        if (sql.includes('FROM capability_assignments ca')) {
          return [[]];
        }

        if (sql.includes('FROM model_configs')) {
          return [[{
            id: 2,
            name: '旧聊天配置',
            provider_type: 'openai',
            api_base: 'https://api.old.example',
            api_key: 'sk-old',
            model: 'gpt-4'
          }]];
        }

        if (sql.includes('UPDATE users')) {
          return [{ affectedRows: 1 }];
        }

        if (sql.includes('FROM memories')) {
          return [[]];
        }

        throw new Error(`Unexpected query: ${sql}`);
      }
    },
    fetchImpl: async (url, options) => {
      upstreamCalls.push({ url, options });
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '旧配置也能用' } }]
        })
      };
    }
  });

  await withServer(createApp({ router }), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/chat?character_id=7`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: '还在吗？',
        skip_server_persistence: true
      })
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.item.content, '旧配置也能用');
    assert.equal(upstreamCalls.length, 1);
    assert.equal(upstreamCalls[0].url, 'https://api.old.example/v1/chat/completions');
    const requestBody = JSON.parse(upstreamCalls[0].options.body);
    assert.equal(requestBody.model, 'gpt-4');
  });
});

test('POST /api/chat includes active memories and anti-roleplay rules in the system prompt', async () => {
  const upstreamCalls = [];
  const queries = [];

  const router = createChatRouter({
    pool: {
      query: async (sql) => {
        queries.push(sql);

        if (sql.includes('FROM characters')) {
          return [[{
            id: 7,
            user_id: 1,
            is_deleted: 0,
            name: 'Xiaobai',
            persona: 'Warm companion'
          }]];
        }

        if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) {
          return [[{ column_name: 'is_deleted' }]];
        }

        if (sql.includes('SELECT city FROM users')) {
          return [[{ city: '' }]];
        }

        if (sql.includes('FROM messages') && sql.includes('ORDER BY id DESC')) {
          return [[
            { role: 'user', content: 'Hello', is_active: 1, created_at: '2026-05-24 10:00:00' }
          ]];
        }

        if (sql.includes('FROM capability_assignments ca')) {
          return [[]];
        }

        if (sql.includes('FROM model_configs')) {
          return [[{
            id: 2,
            name: 'Legacy chat config',
            provider_type: 'openai',
            api_base: 'https://api.old.example',
            api_key: 'sk-old',
            model: 'gpt-4'
          }]];
        }

        if (sql.includes('UPDATE users')) {
          return [{ affectedRows: 1 }];
        }

        if (sql.includes('FROM memories')) {
          return [[
            {
              id: 9,
              user_id: 1,
              character_id: 7,
              content: 'I like blueberry cake',
              tag: 'Preference',
              category: 'Food',
              is_important: 1,
              is_deleted: 0,
              created_at: '2026-05-23 10:00:00'
            }
          ]];
        }

        throw new Error(`Unexpected query: ${sql}`);
      }
    },
    fetchImpl: async (url, options) => {
      upstreamCalls.push({ url, options });
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Got it' } }]
        })
      };
    }
  });

  await withServer(createApp({ router }), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/chat?character_id=7`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: 'Do you remember me?',
        skip_server_persistence: true
      })
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(upstreamCalls.length, 1);
    assert.ok(queries.some(sql => sql.includes('FROM memories')));

    const requestBody = JSON.parse(upstreamCalls[0].options.body);
    const systemPrompt = requestBody.messages[0].content;
    assert.match(systemPrompt, /I like blueberry cake/);
    assert.match(systemPrompt, /Preference/);
    assert.match(systemPrompt, /说话风格/);
    assert.match(systemPrompt, /禁止动作描写/);
    assert.match(systemPrompt, /只输出可直接发送的聊天回复/);
    assert.match(systemPrompt, /本轮陪伴上下文/);
    assert.match(systemPrompt, /场景：/);
  });
});

test('POST /api/chat sends a friendly SSE error when upstream stream breaks', async () => {
  const router = createChatRouter({
    pool: {
      query: async (sql) => {
        if (sql.includes('FROM characters')) {
          return [[{
            id: 7,
            user_id: 1,
            is_deleted: 0,
            name: 'Xiaobai',
            persona: 'Warm companion'
          }]];
        }

        if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) {
          return [[{ column_name: 'is_deleted' }]];
        }

        if (sql.includes('SELECT city FROM users')) {
          return [[{ city: '' }]];
        }

        if (sql.includes('FROM messages') && sql.includes('ORDER BY id DESC')) {
          return [[]];
        }

        if (sql.includes('FROM capability_assignments ca')) {
          return [[]];
        }

        if (sql.includes('FROM model_configs')) {
          return [[{
            id: 2,
            name: 'Legacy chat config',
            provider_type: 'openai',
            api_base: 'https://api.old.example',
            api_key: 'sk-old',
            model: 'gpt-4'
          }]];
        }

        if (sql.includes('UPDATE users')) {
          return [{ affectedRows: 1 }];
        }

        if (sql.includes('FROM memories')) {
          return [[]];
        }

        throw new Error(`Unexpected query: ${sql}`);
      }
    },
    fetchImpl: async () => ({
      ok: true,
      body: (async function* brokenStream() {
        yield Buffer.from('data: {"choices":[{"delta":{"content":"半句"}}]}\n\n');
        throw new Error('socket closed');
      })()
    })
  });

  await withServer(createApp({ router }), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/chat?character_id=7`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream'
      },
      body: JSON.stringify({
        content: 'Are you there?',
        skip_server_persistence: true
      })
    });
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(body, /"type":"error"/);
    assert.match(body, /她暂时没反应，稍后再试好吗/);
  });
});


test('POST /api/chat/draw uses the enabled image capability and keeps the full selfie prompt', async () => {
  const inserted = [];
  let generated = null;
  const character = {
    id: 7,
    user_id: 1,
    name: '林夏',
    persona: '温柔中带点小傲娇的恋人',
    is_deleted: 0
  };
  const prompt = '林夏，你陪我一段时间了，我想看看你的样子。请生成一张类似你自己用iPhone随手自拍的照片：没有明确主题，没有刻意构图，照片略带运动模糊，光线不均，轻微曝光过度，角度尴尬，构图混乱。';

  const router = createChatRouter({
    requireCharacterForUser: async (userId, characterId) => {
      assert.equal(userId, 1);
      assert.equal(characterId, 7);
      return character;
    },
    generateImageImpl: async (subject, options) => {
      generated = { subject, options };
      return '/user_assets/chat/generated-selfie.png';
    },
    pool: {
      query: async (sql, params) => {
        if (sql.includes('FROM capability_assignments ca') && params?.[1] === 'image') {
          assert.deepEqual(params, [1, 'image']);
          return [[{
            id: 9,
            capability: 'image',
            enabled: 1,
            extras: '{"size":"1024x1024"}',
            name: '免费',
            provider_type: 'custom',
            api_base: 'https://apihub.agnes-ai.com/v1',
            api_key: 'selected-key',
            model: 'agnes-image-2.0-flash'
          }]];
        }

        if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) {
          return [[]];
        }

        if (sql.includes('INSERT INTO messages')) {
          const id = inserted.length + 101;
          inserted.push({ id, params });
          return [{ insertId: id }];
        }

        if (sql.includes('UPDATE characters')) {
          assert.deepEqual(params, [7, 1]);
          return [{ affectedRows: 1 }];
        }

        if (sql.includes('FROM messages') && sql.includes('WHERE id = ?')) {
          const row = inserted.find(item => item.id === params[0]);
          return [[{
            id: row.id,
            user_id: 1,
            character_id: 7,
            role: row.params[2],
            content: row.params[3],
            message_type: row.params[4],
            media_url: row.params[5],
            is_active: 1,
            created_at: '2026-07-21 18:00:00'
          }]];
        }

        throw new Error(`Unexpected query: ${sql}`);
      }
    }
  });

  await withServer(createApp({ router }), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/chat/draw?character_id=7`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: prompt })
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.media_url, '/user_assets/chat/generated-selfie.png');
    assert.equal(generated.subject, prompt);
    assert.equal(generated.options.apiBase, 'https://apihub.agnes-ai.com/v1');
    assert.equal(generated.options.apiKey, 'selected-key');
    assert.equal(generated.options.model, 'agnes-image-2.0-flash');
    assert.deepEqual(generated.options.character, character);
    assert.equal(inserted.length, 2);
    assert.equal(inserted[1].params[3], '');
  });
});


test('POST /api/chat/draw returns 503 for temporary image upstream failures', async () => {
  const router = createChatRouter({
    requireCharacterForUser: async () => ({ id: 7, user_id: 1, name: '林夏', persona: '', is_deleted: 0 }),
    generateImageImpl: async () => {
      throw new Error('图片渠道上游暂时繁忙，已自动重试 3 次，请稍后再试（中转站返回 503）');
    },
    pool: {
      query: async (sql, params) => {
        if (sql.includes('FROM capability_assignments ca') && params?.[1] === 'image') {
          return [[{
            id: 9,
            capability: 'image',
            enabled: 1,
            extras: null,
            name: 'grok',
            provider_type: 'custom',
            api_base: 'https://middle.example.com',
            api_key: 'selected-key',
            model: 'grok-imagine-image-lite'
          }]];
        }
        throw new Error(`Unexpected query: ${sql}`);
      }
    }
  });

  await withServer(createApp({ router }), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/chat/draw?character_id=7`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '请生成一张自拍照片' })
    });
    const payload = await response.json();
    assert.equal(response.status, 503);
    assert.equal(payload.success, false);
    assert.match(payload.error, /上游暂时繁忙/);
  });
});


test('buildSystemPrompt keeps adult companion intimacy and relationship continuity', () => {
  const prompt = buildSystemPrompt({
    name: '小白',
    tag: '恋人',
    persona: '双方均为成年人，是长期恋人。',
    speech_style: 'compact'
  });
  assert.match(prompt, /双方均为成年人/);
  assert.match(prompt, /双方自愿的亲密表达视为关系中的自然交流/);
  assert.match(prompt, /不突然切换成客服、老师、旁观者或说教者/);
  assert.match(prompt, /不要先主动接住或承诺会继续/);
});

test('POST /api/chat uses the current role dedicated model before the global default', async () => {
  const upstreamCalls = [];
  let globalModelQueried = false;
  const character = {
    id: 7,
    user_id: 1,
    is_deleted: 0,
    name: '小白',
    tag: '恋人',
    persona: '双方均为成年人，是长期恋人。',
    speech_style: 'compact',
    chat_credential_id: 12,
    chat_model_id: 'companion-model',
    chat_thinking_level: 'low'
  };
  const router = createChatRouter({
    requireCharacterForUser: async () => character,
    pool: {
      query: async (sql, params) => {
        if (sql.includes('INNER JOIN credential_models')) {
          assert.deepEqual(params, [12, 1, 'companion-model']);
          return [[{
            id: 12,
            name: '伴侣渠道',
            provider_type: 'openai-compatible',
            api_base: 'https://companion.example/v1',
            api_key: 'secret',
            model: 'companion-model',
            capabilities: '["chat"]'
          }]];
        }
        if (sql.includes('FROM capability_assignments ca') && !sql.includes('credential_models')) {
          globalModelQueried = true;
          return [[]];
        }
        if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) return [[{ column_name: 'is_deleted' }]];
        if (sql.includes('SELECT city FROM users')) return [[{ city: '' }]];
        if (sql.includes('FROM messages') && sql.includes('ORDER BY id DESC')) return [[]];
        if (sql.includes('FROM memories')) return [[]];
        if (sql.includes('UPDATE users')) return [{ affectedRows: 1 }];
        throw new Error(`Unexpected query: ${sql}`);
      }
    },
    fetchImpl: async (url, options) => {
      upstreamCalls.push({ url, options });
      return { ok: true, json: async () => ({ choices: [{ message: { content: '一直是我呀' } }] }) };
    }
  });

  await withServer(createApp({ router }), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/chat?character_id=7`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '你还是小白吗', skip_server_persistence: true })
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.item.content, '一直是我呀');
    assert.equal(globalModelQueried, false);
    assert.equal(upstreamCalls[0].url, 'https://companion.example/v1/chat/completions');
    const body = JSON.parse(upstreamCalls[0].options.body);
    assert.equal(body.model, 'companion-model');
    assert.equal(body.thinking.budget_tokens, 1024);
  });
});
