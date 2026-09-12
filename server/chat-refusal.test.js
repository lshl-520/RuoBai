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
      ? { userId: sessionUser.userId, username: sessionUser.username, role: sessionUser.role }
      : null;
    next();
  });
  app.use('/api/chat', requireAuth, router);
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

function createCharacterRow() {
  return { id: 7, user_id: 1, is_deleted: 0, name: '若白', persona: '温柔陪伴' };
}

function createPool() {
  return {
    query: async (sql, params) => {
      if (sql.includes('FROM characters')) return [[createCharacterRow()]];
      if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) return [[{ column_name: 'is_deleted' }]];
      if (sql.includes('SELECT city FROM users')) return [[{ city: '' }]];
      if (sql.includes('FROM messages') && sql.includes('ORDER BY id DESC')) return [[]];
      if (sql.includes('FROM model_configs')) {
        return [[{
          id: 5,
          name: '聊天模型',
          provider_type: 'openai-compatible',
          api_base: 'https://chat.example.com',
          api_key: 'sk-chat',
          model: 'gpt-4o-mini',
          purpose: 'chat',
          is_active: 1
        }]];
      }
      if (sql.includes('FROM capability_assignments ca') && params?.[1] === 'vision') return [[]];
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
      throw new Error(`Unexpected query: ${sql}`);
    }
  };
}

/** 造一个上游：先返回英文拒答，第二次返回正常中文。 */
function refusingUpstream(calls) {
  return async (_url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body);
    const systemText = JSON.stringify(body.messages || body.input || body.system || '');
    const retried = /上一轮你没有输出/.test(systemText);
    return {
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: retried ? '嗯，我在呢。你刚才说到吃撑了，来，咱俩一起消消食。' : "I can't discuss that."
          }
        }]
      })
    };
  };
}

test('上游返回英文拒答时会重试一次，且不会把拒答当成她的回复', async () => {
  const calls = [];
  const router = createChatRouter({
    publicBaseUrl: 'https://ruobai.example.com',
    pool: createPool(),
    fetchImpl: refusingUpstream(calls)
  });

  await withServer(createApp({ router }), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/chat?character_id=7`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'user', content: '我就是笨蛋吃撑了', skip_server_persistence: true })
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    // 必须重试了一次
    assert.equal(calls.length, 2, '检出拒答后应重试一次');
    // 第一次请求里不含纠偏指令，第二次必须含
    assert.match(JSON.stringify(calls[0]), /吃撑了/);
    assert.doesNotMatch(JSON.stringify(calls[0]), /上一轮你没有输出/);
    assert.match(JSON.stringify(calls[1]), /上一轮你没有输出/);
    // 返回给用户的是中文，绝不是英文拒答
    const reply = String(payload.item?.content || payload.reply || payload.content || '');
    assert.doesNotMatch(reply, /I can't discuss that/i);
    assert.match(reply, /[\u4e00-\u9fa5]/, '回复应当是中文');
  });
});

test('重试后仍拒答时用中文兜底，用户永远看不到英文拒答', async () => {
  const calls = [];
  const alwaysRefusing = async (_url, options) => {
    calls.push(JSON.parse(options.body));
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: "I can't discuss that." } }] })
    };
  };

  const router = createChatRouter({
    publicBaseUrl: 'https://ruobai.example.com',
    pool: createPool(),
    fetchImpl: alwaysRefusing
  });

  await withServer(createApp({ router }), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/chat?character_id=7`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'user', content: '我想要你', skip_server_persistence: true })
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(calls.length, 2, '应当只重试一次，不做无限重试');
    const reply = String(payload.item?.content || payload.reply || payload.content || '');
    assert.doesNotMatch(reply, /I can't discuss that|I cannot|unable to/i);
    assert.match(reply, /[\u4e00-\u9fa5]/, '兜底必须是中文');
  });
});

test('正常中文回复不受拒答门闸影响', async () => {
  const calls = [];
  const normalUpstream = async (_url, options) => {
    calls.push(JSON.parse(options.body));
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: '哈哈这条回复本身没有任何问题。' } }] })
    };
  };

  const router = createChatRouter({
    publicBaseUrl: 'https://ruobai.example.com',
    pool: createPool(),
    fetchImpl: normalUpstream
  });

  await withServer(createApp({ router }), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/chat?character_id=7`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'user', content: '今天出门走了走', skip_server_persistence: true })
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(calls.length, 1, '正常回复不应该重试');
    const reply = String(payload.item?.content || payload.reply || payload.content || '');
    assert.match(reply, /这条回复本身没有任何问题/, '正常中文回复必须原样返回');
  });
});
