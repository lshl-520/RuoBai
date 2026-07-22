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

function createCharacterRow() {
  return {
    id: 7,
    user_id: 1,
    is_deleted: 0,
    name: '若白',
    persona: '温柔陪伴'
  };
}

test('POST /api/chat sends image_url payload to vision model when image message is forwarded', async () => {
  const upstreamCalls = [];

  const router = createChatRouter({
    publicBaseUrl: 'https://ruobai.example.com',
    pool: {
      query: async (sql, params) => {
        if (sql.includes('FROM characters')) {
          return [[createCharacterRow()]];
        }

        if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) {
          return [[{ column_name: 'is_deleted' }]];
        }

        if (sql.includes('SELECT city FROM users')) {
          return [[{ city: '' }]];
        }

        if (sql.includes('FROM messages') && sql.includes('ORDER BY id DESC')) {
          return [[
            {
              id: 10,
              role: 'assistant',
              content: '上一条回复',
              message_type: 'text',
              media_url: null,
              is_active: 1,
              created_at: '2026-05-25 10:00:00'
            },
            {
              id: 11,
              role: 'user',
              content: '这是上一张图',
              message_type: 'image',
              media_url: '/user_assets/chat/history-cat.png',
              is_active: 1,
              created_at: '2026-05-25 10:01:00'
            }
          ]];
        }

        if (sql.includes('FROM capability_assignments ca') && params?.[1] === 'vision') {
          assert.deepEqual(params, [1, 'vision']);
          return [[{
            id: 8,
            name: '千问看图',
            provider_type: 'openai-compatible',
            api_base: 'https://vision.example.com',
            api_key: 'sk-vision',
            model: 'qwen-vl-max-2025-04-08'
          }]];
        }

        if (sql.includes('FROM capability_assignments ca') && params?.length === 1) {
          return [[{
            id: 5,
            name: '聊天模型',
            provider_type: 'openai-compatible',
            api_base: 'https://chat.example.com',
            api_key: 'sk-chat',
            model: 'gpt-4o-mini'
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
          choices: [{ message: { content: '我看到了这张图。' } }]
        })
      };
    }
  });

  await withServer(createApp({ router }), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/chat?character_id=7`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'user',
        content: '看看这张图里有什么',
        message_type: 'image',
        media_url: '/user_assets/chat/new-milk-tea.png',
        skip_server_persistence: true
      })
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(upstreamCalls.length, 1);
    assert.equal(upstreamCalls[0].url, 'https://vision.example.com/v1/chat/completions');

    const requestBody = JSON.parse(upstreamCalls[0].options.body);
    assert.equal(requestBody.model, 'qwen-vl-max-2025-04-08');
    assert.equal(requestBody.messages[0].role, 'system');
    assert.equal(requestBody.messages.at(-1).role, 'user');
    assert.deepEqual(requestBody.messages.at(-1).content, [
      { type: 'text', text: '看看这张图里有什么' },
      {
        type: 'image_url',
        image_url: { url: 'https://ruobai.example.com/user_assets/chat/new-milk-tea.png' }
      }
    ]);
    const historyImageMessage = requestBody.messages.find(item =>
      Array.isArray(item.content) &&
      item.content[0]?.text === '这是上一张图'
    );
    assert.deepEqual(historyImageMessage?.content, [
      { type: 'text', text: '这是上一张图' },
      {
        type: 'image_url',
        image_url: { url: 'https://ruobai.example.com/user_assets/chat/history-cat.png' }
      }
    ]);
  });
});

test('POST /api/chat falls back to chat model with downgrade hint when vision capability is unavailable', async () => {
  const upstreamCalls = [];

  const router = createChatRouter({
    publicBaseUrl: 'https://ruobai.example.com',
    pool: {
      query: async (sql, params) => {
        if (sql.includes('FROM characters')) {
          return [[createCharacterRow()]];
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

        if (sql.includes('FROM capability_assignments ca') && params?.[1] === 'vision') {
          return [[]];
        }

        if (sql.includes('FROM capability_assignments ca') && params?.length === 1) {
          return [[{
            id: 5,
            name: '聊天模型',
            provider_type: 'openai-compatible',
            api_base: 'https://chat.example.com',
            api_key: 'sk-chat',
            model: 'gpt-4o-mini'
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
          choices: [{ message: { content: '你描述给我听听。' } }]
        })
      };
    }
  });

  await withServer(createApp({ router }), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/chat?character_id=7`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'user',
        content: '你看到了吗',
        message_type: 'image',
        media_url: '/user_assets/chat/new-milk-tea.png',
        skip_server_persistence: true
      })
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(upstreamCalls.length, 1);
    assert.equal(upstreamCalls[0].url, 'https://chat.example.com/v1/chat/completions');

    const requestBody = JSON.parse(upstreamCalls[0].options.body);
    assert.equal(requestBody.messages[0].role, 'system');
    assert.match(requestBody.messages[0].content, /用户给你看了一张图/);
    assert.equal(requestBody.messages.at(-1).content, '你看到了吗\n[用户当时发了一张图]');
  });
});
