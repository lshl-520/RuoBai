import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { requireAuth } from './middleware.js';
import { createChatRouter } from './chat.js';

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
