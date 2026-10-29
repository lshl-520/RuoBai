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

test('POST /api/chat sends image_url payload to vision model when image message is forwarded', async (t) => {
  const upstreamCalls = [];

  // 2026/10/19：本地图片现在会先按文件头验真实格式再转 base64 发给上游，
  // 所以这里必须先造两张真图，否则会被当成"读不到的坏图"降级成文字占位。
  const fsModule = await import('node:fs/promises');
  const pathModule = await import('node:path');
  const urlModule = await import('node:url');
  const repoRoot = pathModule.resolve(pathModule.dirname(urlModule.fileURLToPath(import.meta.url)), '..');
  const fixtureDir = pathModule.join(repoRoot, 'user_assets', 'chat');
  const pngFixture = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
  await fsModule.mkdir(fixtureDir, { recursive: true });
  const milkTeaPath = pathModule.join(fixtureDir, 'new-milk-tea.png');
  const historyCatPath = pathModule.join(fixtureDir, 'history-cat.png');
  await fsModule.writeFile(milkTeaPath, pngFixture);
  await fsModule.writeFile(historyCatPath, pngFixture);
  t.after(async () => {
    await fsModule.rm(milkTeaPath, { force: true });
    await fsModule.rm(historyCatPath, { force: true });
  });
  const expectedImageUrl = 'data:image/png;base64,' + pngFixture.toString('base64');

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
    // 2026/9/16 起，每条用户消息前面会带一行「【现在是…】…」的时段标注
    // （防止她把下午当成深夜）。断言正文时要先去掉它。
    const lastContent = requestBody.messages.at(-1).content.map((part) => (
      part?.type === 'text'
        ? { ...part, text: String(part.text).replace(/^【现在是[^】]*】[^\n]*\n/, '') }
        : part
    ));
    assert.deepEqual(lastContent, [
      { type: 'text', text: '看看这张图里有什么' },
      {
        type: 'image_url',
        image_url: { url: expectedImageUrl }
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
        image_url: { url: expectedImageUrl }
      }
    ]);
  });
});

test('POST /api/chat never forwards an assistant image as image_url (upstream forbids assistant images)', async () => {
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
          // 这正是踩到 400 的历史：角色自己生成的图，存成 role=assistant + message_type=image，
          // 且 content 为空（生成图没有正文）。
          return [[
            {
              id: 20,
              role: 'user',
              content: '帮我画一只猫',
              message_type: 'text',
              media_url: null,
              is_active: 1,
              created_at: '2026-05-25 10:00:00'
            },
            {
              id: 21,
              role: 'assistant',
              content: '',
              message_type: 'image',
              media_url: '/user_assets/chat/generated-cat.png',
              is_active: 1,
              created_at: '2026-05-25 10:00:30'
            }
          ]];
        }

        if (sql.includes('FROM capability_assignments ca') && params?.[1] === 'vision') {
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
          choices: [{ message: { content: '画好啦，你看看。' } }]
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
        content: '再给我看看刚才那只猫',
        message_type: 'text',
        skip_server_persistence: true
      })
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(upstreamCalls.length, 1);

    const requestBody = JSON.parse(upstreamCalls[0].options.body);

    // 任何 assistant 消息都不允许出现 image_url 内容块。
    for (const item of requestBody.messages) {
      if (item.role !== 'assistant') continue;
      assert.equal(Array.isArray(item.content), false, 'assistant 消息不能是数组内容');
      assert.equal(
        JSON.stringify(item.content).includes('image_url'),
        false,
        'assistant 消息不能带 image_url'
      );
    }

    // 她发的那张图降级成文字占位，仍然保留“当时有图”这层上下文。
    const assistantHistory = requestBody.messages.find(item => item.role === 'assistant');
    assert.equal(assistantHistory.content, '[她当时发了一张图]');
    assert.equal(JSON.stringify(assistantHistory).includes('generated-cat.png'), false);

    // 本轮不是图片提问，最后一轮仍是普通文字。
    assert.equal(requestBody.messages.at(-1).role, 'user');
    // 去掉 2026/9/16 起的「【现在是…】」时段前缀（见 chat.js buildNowBlock）
    assert.equal(
      String(requestBody.messages.at(-1).content).replace(/^【现在是[^】]*】[^\n]*\n/, ''),
      '再给我看看刚才那只猫'
    );
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
    assert.equal(requestBody.messages.at(-1).role, 'user');
    // 去掉 2026/9/16 起的「【现在是…】」时段前缀（见 chat.js buildNowBlock）
    assert.equal(
      String(requestBody.messages.at(-1).content).replace(/^【现在是[^】]*】[^\n]*\n/, ''),
      '你看到了吗\n[用户当时发了一张图]'
    );
  });
});

// ─────────────────────────────────────────────────────────────
// 2026/10/19：HEIC（手机"高效图片"）坏图防护
// ─────────────────────────────────────────────────────────────

const HEIC_BYTES = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x1c]),
  Buffer.from('ftypheic', 'ascii'),
  Buffer.alloc(16)
]);

function createVisionTestRouter({ upstreamCalls, history = [], fileStorage, publicBaseUrl = 'https://ruobai.example.com' }) {
  return createChatRouter({
    publicBaseUrl,
    ...(fileStorage ? { fileStorage } : {}),
    pool: {
      query: async (sql, params) => {
        if (sql.includes('FROM characters')) return [[createCharacterRow()]];
        if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) return [[{ column_name: 'is_deleted' }]];
        if (sql.includes('SELECT city FROM users')) return [[{ city: '' }]];
        if (sql.includes('FROM messages') && sql.includes('ORDER BY id DESC')) return [history];
        if (sql.includes('FROM capability_assignments ca') && params?.[1] === 'vision') {
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
        if (sql.includes('UPDATE users')) return [{ affectedRows: 1 }];
        if (sql.includes('FROM memories')) return [[]];
        throw new Error('Unexpected query: ' + sql);
      }
    },
    fetchImpl: async (url, options) => {
      upstreamCalls.push({ url, options });
      return { ok: true, json: async () => ({ choices: [{ message: { content: '嗯，我看到了。' } }] }) };
    }
  });
}

test('POST /api/chat downgrades a HEIC image in history to text (no image_url, no upstream 400)', async (t) => {
  const fsModule = await import('node:fs/promises');
  const pathModule = await import('node:path');
  const urlModule = await import('node:url');
  const repoRoot = pathModule.resolve(pathModule.dirname(urlModule.fileURLToPath(import.meta.url)), '..');
  const fixtureDir = pathModule.join(repoRoot, 'user_assets', 'chat');
  const fixturePath = pathModule.join(fixtureDir, 'test-heic-history.png');
  await fsModule.mkdir(fixtureDir, { recursive: true });
  await fsModule.writeFile(fixturePath, HEIC_BYTES);
  t.after(async () => { await fsModule.rm(fixturePath, { force: true }); });

  const upstreamCalls = [];
  const router = createVisionTestRouter({
    upstreamCalls,
    history: [
      {
        id: 30,
        role: 'user',
        content: '这张图什么意思',
        message_type: 'image',
        media_url: '/user_assets/chat/test-heic-history.png',
        is_active: 1,
        created_at: '2026-10-19 18:00:00'
      }
    ]
  });

  await withServer(createApp({ router }), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/chat?character_id=7`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'user',
        content: '现在再说说这张',
        message_type: 'image',
        media_url: '/user_assets/chat/test-heic-history.png',
        skip_server_persistence: true
      })
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(upstreamCalls.length, 1);

    const requestBody = JSON.parse(upstreamCalls[0].options.body);
    assert.equal(JSON.stringify(requestBody).includes('image_url'), false, 'HEIC 坏图绝不能以 image_url 发给上游');
    assert.equal(JSON.stringify(requestBody).includes('test-heic-history.png'), false, '也不应把坏图 URL 透传');
    const textContents = requestBody.messages
      .map(item => (typeof item.content === 'string' ? item.content : ''))
      .join('\n');
    assert.match(textContents, /用户当时发了一张图/);
  });
});

test('POST /api/chat never sends a missing local image as an unusable localhost URL', async () => {
  const upstreamCalls = [];
  const router = createVisionTestRouter({ upstreamCalls });

  await withServer(createApp({ router }), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/chat?character_id=7`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'user',
        content: '看看这个',
        message_type: 'image',
        media_url: '/user_assets/chat/definitely-missing-file.png',
        skip_server_persistence: true
      })
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.success, true);

    const requestBody = JSON.parse(upstreamCalls[0].options.body);
    assert.equal(JSON.stringify(requestBody).includes('image_url'), false);
    assert.equal(JSON.stringify(requestBody).includes('definitely-missing-file.png'), false);
  });
});

test('POST /api/chat/upload-image rejects HEIC bytes disguised as PNG', async () => {
  const writes = [];
  const router = createChatRouter({
    pool: { query: async () => [[]] },
    fileStorage: {
      mkdir: async () => {},
      writeFile: async (filePath) => { writes.push(filePath); }
    }
  });

  await withServer(createApp({ router }), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/chat/upload-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_data: 'data:image/png;base64,' + HEIC_BYTES.toString('base64') })
    });
    const payload = await response.json();
    assert.equal(response.status, 400);
    assert.match(payload.error, /HEIC/);
    assert.equal(writes.length, 0, 'HEIC 不应该被存盘');
  });
});

test('POST /api/chat/upload-image stores the real detected format extension', async () => {
  const writes = [];
  const pngOnePixel = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
  const router = createChatRouter({
    pool: { query: async () => [[]] },
    fileStorage: {
      mkdir: async () => {},
      writeFile: async (filePath, buffer) => { writes.push({ filePath, buffer }); }
    }
  });

  await withServer(createApp({ router }), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/chat/upload-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_data: 'data:image/jpeg;base64,' + pngOnePixel.toString('base64') })
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(writes.length, 1);
    assert.match(writes[0].filePath, /\.png$/);
    assert.match(payload.media_url, /\.png$/);
  });
});
