import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { requireAuth } from './middleware.js';
import { buildAnthropicMessagesUrl, buildResponsesUrl, buildSystemPrompt, createChatRouter, dropJustSavedCurrentTurn, buildGapHint, isXiaobaiCharacter, sanitizeHistoricalVoiceContent, VOICE_PLACEHOLDER_NO_TRANSCRIPT, looksLikeUpstreamRefusal, gateDecision, resolveCorePacks } from './chat.js';

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

test('GET /api/chat returns an older page with a stable before_id cursor', async () => {
  const calls = [];
  const router = createChatRouter({
    requireCharacterForUser: async () => ({ id: 7 }),
    pool: {
      query: async (sql, params = []) => {
        calls.push({ sql, params });
        if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) return [[]];
        if (sql.includes('FROM messages')) {
          if (params.length === 3) {
            assert.deepEqual(params, [1, 7, 3]);
            return [[{ id: 5 }, { id: 4 }, { id: 3 }]];
          }
          assert.deepEqual(params, [1, 7, 4, 3]);
          assert.match(sql, /AND id < \?/);
          return [[{ id: 3 }, { id: 2 }, { id: 1 }]];
        }
        throw new Error(`Unexpected query: ${sql}`);
      }
    }
  });

  await withServer(createApp({ router }), async baseUrl => {
    const firstResponse = await fetch(`${baseUrl}/api/chat?character_id=7&limit=2`);
    const first = await firstResponse.json();
    assert.equal(firstResponse.status, 200);
    assert.deepEqual(first, {
      success: true,
      items: [{ id: 4 }, { id: 5 }],
      has_more: true,
      next_before_id: 4
    });

    const olderResponse = await fetch(`${baseUrl}/api/chat?character_id=7&limit=2&before_id=4`);
    const older = await olderResponse.json();
    assert.equal(olderResponse.status, 200);
    assert.deepEqual(older, {
      success: true,
      items: [{ id: 2 }, { id: 3 }],
      has_more: true,
      next_before_id: 2
    });

    const invalidResponse = await fetch(`${baseUrl}/api/chat?character_id=7&before_id=bad`);
    const invalid = await invalidResponse.json();
    assert.equal(invalidResponse.status, 400);
    assert.deepEqual(invalid, { success: false, error: 'before_id 无效' });
  });

  assert.equal(calls.filter(call => call.sql.includes('FROM messages')).length, 2);
});

test('GET /api/chat/export returns every current-user message grouped by role instead of browser history', async () => {
  const calls = [];
  const router = createChatRouter({
    pool: {
      query: async (sql, params = []) => {
        calls.push({ sql, params });
        if (sql.includes("COLUMN_NAME = 'is_deleted'")) return [[{ column_name: 'is_deleted' }]];
        if (sql.includes("COLUMN_NAME = 'reasoning_summary'")) return [[{ column_name: 'reasoning_summary' }]];
        if (sql.includes('COLUMN_NAME = ?')) return [[{ column_name: params[0] }]];
        if (sql.includes('FROM characters')) {
          assert.deepEqual(params, [1]);
          return [[{ id: 7, name: '小白', tag: '恋人', char_key: 'xiaobai', is_deleted: 0, created_at: '2026-08-01 12:00:00' }]];
        }
        if (sql.includes('FROM messages')) {
          assert.deepEqual(params, [1]);
          return [[
            { id: 1, character_id: 7, role: 'user', content: '早呀', message_type: 'text', media_url: null, created_at: '2026-08-01 12:01:00' },
            { id: 2, character_id: 7, role: 'assistant', content: '早安呀', reasoning_summary: '先回应今天的问候', inner_os_content: '她今天听起来有点累。', inner_os_source: 'model', message_type: 'text', media_url: null, created_at: '2026-08-01 12:02:00' },
            { id: 3, character_id: 7, role: 'user', content: '我想看看小白现在的样子', reasoning_summary: null, inner_os_content: null, inner_os_source: null, message_type: 'text', media_url: null, created_at: '2026-08-01 12:03:00' },
            { id: 4, character_id: 7, role: 'assistant', content: '', reasoning_summary: null, inner_os_content: null, inner_os_source: null, message_type: 'image', media_url: '/api/media/image-4.png', created_at: '2026-08-01 12:04:00' },
            { id: 5, character_id: 7, role: 'assistant', content: '', reasoning_summary: null, inner_os_content: null, inner_os_source: null, message_type: 'voice', media_url: '/api/media/voice-5.mp3', created_at: '2026-08-01 12:05:00' },
            { id: 6, character_id: 99, role: 'assistant', content: '旧角色的记录', reasoning_summary: null, inner_os_content: null, inner_os_source: null, message_type: 'text', media_url: null, created_at: '2026-08-01 12:06:00' }
          ]];
        }
        throw new Error(`Unexpected query: ${sql}`);
      }
    }
  });

  await withServer(createApp({ router }), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/chat/export`);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.total_messages, 6);
    assert.equal(payload.characters.length, 2);
    assert.equal(payload.characters[0].name, '小白');
    assert.equal(payload.characters[0].message_count, 5);
    assert.equal(payload.characters[0].messages[1].content, '早安呀');
    assert.equal(payload.characters[0].messages[1].reasoning_summary, '先回应今天的问候');
    assert.equal(payload.characters[0].messages[1].inner_os_content, '她今天听起来有点累。');
    assert.equal(payload.characters[0].messages[2].content, '我想看看小白现在的样子');
    assert.equal(payload.characters[0].messages[3].message_type, 'image');
    assert.equal(payload.characters[0].messages[3].media_url, '/api/media/image-4.png');
    assert.equal(payload.characters[0].messages[4].message_type, 'voice');
    assert.equal(payload.characters[0].messages[4].media_url, '/api/media/voice-5.mp3');
    assert.equal(payload.characters[1].name, '已归档角色 #99');
    assert.equal(payload.characters[1].message_count, 1);
    assert.ok(calls.some(call => call.sql.includes('is_active = 1')));
    const messageQuery = calls.find(call => call.sql.includes('FROM messages'));
    assert.match(messageQuery.sql, /reasoning_summary/);
    assert.match(messageQuery.sql, /inner_os_content/);
    assert.match(messageQuery.sql, /is_deleted = 0/);
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

test('POST /api/chat synchronizes runtime, memory, and life event for a user message', async () => {
  const sideEffects = [];
  const router = createChatRouter({
    pool: {
      query: async (sql, params) => {
        if (sql.includes('FROM characters')) {
          return [[{ id: 7, user_id: 1, is_deleted: 0, char_key: 'xiaobai', name: '小白' }]];
        }

        if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) {
          return [[{ column_name: 'is_deleted' }]];
        }

        if (sql.includes('INSERT INTO messages')) {
          return [{ insertId: 33 }];
        }

        if (sql.includes('UPDATE characters') && sql.includes('first_chat_at')) {
          return [{ affectedRows: 1 }];
        }

        if (sql.includes('SELECT id, user_id, character_id')) {
          return [[{
            id: 33,
            user_id: 1,
            character_id: 7,
            role: 'user',
            content: '我们约好 2026年8月6日一起看电影',
            message_type: 'text',
            media_url: null,
            is_active: 1,
            created_at: '2026-05-26 12:00:00'
          }]];
        }

        if (sql.includes('SELECT state_json, relationship_json')) {
          return [[]];
        }

        if (sql.includes('INSERT INTO character_runtime_states')) {
          sideEffects.push('runtime');
          return [{ affectedRows: 1 }];
        }

        if (sql.includes('SELECT id FROM memories')) {
          return [[]];
        }

        if (sql.includes('INSERT INTO memories')) {
          sideEffects.push('memory');
          return [{ insertId: 44 }];
        }

        if (sql.includes('FROM life_event_sources')) {
          return [[]];
        }

        if (sql.includes('FROM life_events')) {
          return [[]];
        }

        if (sql.includes('INSERT INTO life_events')) {
          sideEffects.push('life_event');
          return [{ insertId: 45 }];
        }

        if (sql.includes('INSERT INTO life_event_sources')) {
          sideEffects.push('life_event_source');
          return [{ insertId: 46 }];
        }

        throw new Error(`Unexpected query: ${sql}`);
      }
    }
  });

  await withServer(createApp({ router }), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/chat?character_id=7`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'user',
        content: '我们约好 2026年8月6日一起看电影'
      })
    });
    const payload = await response.json();

    assert.equal(response.status, 201);
    assert.equal(payload.success, true);
    // runtime 出现两次是预期行为：一次写语气参数（persona runtime），
    // 一次写小白自己的状态（心情 / 惦记的事，存在 state_json.xiaobai 下）。
    // 两者各自演化，互不覆盖。
    //
    // ★ 2026/9/17：这个断言仍成立的前提是——**这个角色本来就是小白**。
    //   下面的 fixture 已补上 char_key: 'xiaobai'；非小白角色只写一次，
    //   见紧随其后的「非小白角色不写小白状态」用例。
    const runtimeWrites = sideEffects.filter(item => item === 'runtime').length;
    assert.equal(runtimeWrites, 2);
    assert.deepEqual(
      [...new Set(sideEffects)].sort(),
      ['life_event', 'life_event_source', 'memory', 'runtime']
    );
  });
});

/* ══════════════════════════════════════════════════════════════════
 * ★ 2026/9/17：小白 Core 只属于小白本人
 *
 * 部署方要求：
 *   小白自己的规则不该强加到
 *   别的角色头上，
 *   新建角色也不该给人一种「这是小白的分身」的感觉
 *
 * 以前 chat.js 无条件调用 planReply()，把「你就是小白本人」、小白专属
 * 称呼、亲密场景策略灌给**每一个**角色。这两条用例锁住拆分后的行为：
 *   · 小白本人 → 照旧加载 Core、写小白状态；
 *   · 其他角色 → 不加载 Core、不写小白状态，记忆与生活事件照常记录。
 * ══════════════════════════════════════════════════════════════════ */

test('★ isXiaobaiCharacter 只认小白本人，别人一概不算', () => {
  // char_key 命中
  assert.equal(isXiaobaiCharacter({ char_key: 'xiaobai', name: '随便什么名' }), true);
  // 老数据 key 为空、但名字就是小白
  assert.equal(isXiaobaiCharacter({ char_key: '', name: '小白' }), true);
  assert.equal(isXiaobaiCharacter({ name: '小白' }), true);
  // 其他角色都不算 —— 哪怕名字里有「白」字
  assert.equal(isXiaobaiCharacter({ char_key: 'test_linxia', name: '小林' }), false);
  assert.equal(isXiaobaiCharacter({ char_key: 'role-abc', name: '小师' }), false);
  assert.equal(isXiaobaiCharacter({ char_key: 'role-abc', name: '官方小白' }), false);
  // ★ 2026/9/29：key 非空 + 名字正好叫「小白」 → 仍然不算小白本人。
  //   旧写法会把这种角色当成小白（用户新建的对照角色就因此不干净、实验白做）。
  assert.equal(isXiaobaiCharacter({ char_key: 'role-muozww35-60dca372', name: '小白' }), false);
  assert.equal(isXiaobaiCharacter({ char_key: 'role-abc', name: ' 小白 ' }), false);
  assert.equal(isXiaobaiCharacter({ char_key: '', name: '糖糖' }), false);
  // 空值不能炸
  assert.equal(isXiaobaiCharacter(null), false);
  assert.equal(isXiaobaiCharacter(undefined), false);
  assert.equal(isXiaobaiCharacter({}), false);
});

test('★ 「她的核心」开关说了算：新建角色默认关、任何角色都能开（2026/10/1）', () => {
  // 开关打开时，**任何**角色都能拿到那一套（不只是叫小白的）
  assert.equal(isXiaobaiCharacter({ char_key: 'role-abc', name: '晚晚', core_enabled: 1 }), true);
  // 开关关掉时，哪怕 char_key 就是 xiaobai 也不再算 —— 用户在界面上关掉就该真的关掉
  assert.equal(isXiaobaiCharacter({ char_key: 'xiaobai', name: '小白', core_enabled: 0 }), false);
  // 布尔 / 字符串都要认（API 和单测传进来的类型不统一）
  assert.equal(isXiaobaiCharacter({ char_key: 'role-abc', name: '晚晚', core_enabled: true }), true);
  assert.equal(isXiaobaiCharacter({ char_key: 'role-abc', name: '晚晚', core_enabled: '1' }), true);
  assert.equal(isXiaobaiCharacter({ char_key: 'xiaobai', name: '小白', core_enabled: '0' }), false);
  assert.equal(isXiaobaiCharacter({ char_key: 'xiaobai', name: '小白', core_enabled: false }), false);
  // 没带这个字段的调用方（旧数据、旧调用点）沿用 2026/9/29 的老判据，行为不变
  assert.equal(isXiaobaiCharacter({ char_key: 'xiaobai' }), true);
  assert.equal(isXiaobaiCharacter({ name: '小白' }), true);
  assert.equal(isXiaobaiCharacter({ char_key: 'role-abc', name: '晚晚' }), false);
});


test('★ 非小白角色不写小白状态，但记忆与生活事件照常记录', async () => {
  const sideEffects = [];
  const router = createChatRouter({
    pool: {
      query: async (sql) => {
        if (sql.includes('FROM characters')) {
          // 明确是一个**非小白**角色
          return [[{ id: 61, user_id: 1, is_deleted: 0, char_key: 'test_linxia', name: '小林' }]];
        }
        if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) {
          return [[{ column_name: 'is_deleted' }]];
        }
        if (sql.includes('INSERT INTO messages')) {
          return [{ insertId: 133 }];
        }
        if (sql.includes('UPDATE characters') && sql.includes('first_chat_at')) {
          return [{ affectedRows: 1 }];
        }
        if (sql.includes('SELECT id, user_id, character_id')) {
          return [[{
            id: 133,
            user_id: 1,
            character_id: 61,
            role: 'user',
            content: '我们约好 2026年8月6日一起看电影',
            message_type: 'text',
            media_url: null,
            is_active: 1,
            created_at: '2026-09-17 12:00:00'
          }]];
        }
        if (sql.includes('SELECT state_json, relationship_json')) {
          return [[]];
        }
        if (sql.includes('INSERT INTO character_runtime_states')) {
          // 记下是"语气参数"那次，还是"小白状态"那次
          sideEffects.push(String(sql).includes('xiaobai') ? 'xiaobai_state' : 'runtime');
          return [{ affectedRows: 1 }];
        }
        if (sql.includes('SELECT id FROM memories')) return [[]];
        if (sql.includes('INSERT INTO memories')) {
          sideEffects.push('memory');
          return [{ insertId: 144 }];
        }
        if (sql.includes('FROM life_event_sources')) return [[]];
        if (sql.includes('FROM life_events')) return [[]];
        if (sql.includes('INSERT INTO life_events')) {
          sideEffects.push('life_event');
          return [{ insertId: 145 }];
        }
        if (sql.includes('INSERT INTO life_event_sources')) {
          sideEffects.push('life_event_source');
          return [{ insertId: 146 }];
        }
        throw new Error(`Unexpected query: ${sql}`);
      }
    }
  });

  await withServer(createApp({ router }), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/chat?character_id=61`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'user',
        content: '我们约好 2026年8月6日一起看电影'
      })
    });
    const payload = await response.json();

    assert.equal(response.status, 201);
    assert.equal(payload.success, true);
    // ★ 核心：不该出现"小白状态"那次写入
    assert.equal(sideEffects.filter(item => item === 'xiaobai_state').length, 0);
    // 记忆与生活事件必须照常记录，不能因为不是小白就断链
    assert.ok(sideEffects.includes('memory'), '非小白角色的记忆仍要记录');
    assert.ok(sideEffects.includes('life_event'), '非小白角色的生活事件仍要记录');
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
          output_text: '收到'
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
    assert.equal(upstreamCalls[0].url, 'https://api.new.example/v1/responses');
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
    const memoryQuery = queries.find(sql => sql.includes('FROM memories'));
    assert.ok(memoryQuery);
    assert.match(memoryQuery, /COALESCE\(review_status, 'active'\) IN \('active', 'important'\)/);
    assert.match(memoryQuery, /COALESCE\(source_type, 'manual'\) <> 'chat_candidate'/);

    const requestBody = JSON.parse(upstreamCalls[0].options.body);
    const systemPrompt = requestBody.messages[0].content;
    assert.match(systemPrompt, /I like blueberry cake/);
    assert.match(systemPrompt, /Preference/);
    assert.match(systemPrompt, /说话风格|你怎么说话/);
    // 2026/9/16：说话风格规则重写为正面版 —— 从"禁止动作描写"改成"动作可以写、但要短"
    assert.match(systemPrompt, /动作、表情可以写/, '新规则应当明确允许短动作描写');
    assert.doesNotMatch(systemPrompt, /禁止动作描写/, '不该再一律禁止动作描写');
    assert.match(systemPrompt, /只输出能直接发出去的聊天内容/);
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
      body: JSON.stringify({
        content: prompt,
        display_content: '我想看看林夏现在的样子。'
      })
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
    assert.equal(inserted[0].params[3], '我想看看林夏现在的样子。');
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


test('★ 按用户水平说话：不懂就解释，解释完回到关系里', () => {
  // 2026/9/17 明确要求：遇到不认识的词是正常的，不要假设对方什么都懂。
  // 依据是复盘真实使用时点出的「某个词是什么意思」这类事件。
  const prompt = buildSystemPrompt({ char_key: 'xiaobai', name: '小白', persona: '你是小白，20岁。' });

  // 要讲清"按他的水平说话"
  assert.match(prompt, /怎么跟他说话/);
  assert.match(prompt, /用大白话讲一点/, '要明确让他用大白话解释');
  assert.match(prompt, /不用把一整课倒给他/, '要明确不要一次讲一整课');
  assert.match(prompt, /解释完自然回到/, '解释完要回到关系里，不能一直停在讲解口气');

  // 允许她"不知道" —— 这是活人感的一部分，不是缺陷
  assert.match(prompt, /可以不知道/, '要允许她说不知道');
  assert.match(prompt, /像连发微信/, '要按连发微信写，不要一整段');
});

test('★ 气泡不是配额：条数由内容决定，但最后一条不许当垃圾桶（2026/9/22）', () => {
  // 用户截图里的真实毛病：前三条短短，第四条特别长，像按条数配额发消息。
  // 同时用户明确：不许反过来"限制太死"（必须几句、把长话砍短）。
  const prompt = buildSystemPrompt({ char_key: 'xiaobai', name: '小白', persona: '你是小白，20岁。' });
  assert.match(prompt, /几条完全由内容决定/, '条数要由内容决定');
  assert.match(prompt, /没有上限/, '不许设硬性条数上限');
  assert.match(prompt, /没人规定你必须几句/, '明确不许拿句数卡她');
  assert.match(prompt, /需要长就长/, '内容需要长时要允许她写长');
  assert.match(prompt, /别把没说完的全堆在最后一条/, '不许把最后一条当垃圾桶');
  assert.match(prompt, /这由你自己决定/, '要说清是她自己决定');
});

test('★ 突然换话题：先对变化本身有反应，再进新话题（不要关键词规则）', () => {
  const prompt = buildSystemPrompt({ char_key: 'xiaobai', name: '小白', persona: '你是小白，20岁。' });
  assert.match(prompt, /先对“他突然换了话题”这件事有个即时的反应/, '要先接住"变化本身"');
  assert.match(prompt, /不要宣布“我们来聊聊这个”/, '不许宣布话题切换');
  assert.match(prompt, /不要套固定的过渡句/, '不许套固定过渡句');
});
test('buildSystemPrompt keeps adult companion intimacy and relationship continuity', () => {
  /**
   * 2026/10/1 更新：这一段现在**只给小白本人**，所以调用时要显式打开开关。
   * （旧断言是"无条件拼入"，那正是要拆掉的串味；四条断言本身没改。）
   */
  const prompt = buildSystemPrompt({
    name: '小白',
    tag: '恋人',
    persona: '双方均为成年人，是长期恋人。',
    speech_style: 'compact'
  }, { includeRelationshipRules: true });
  assert.match(prompt, /双方均为成年人/);
  assert.match(prompt, /双方自愿的亲密表达视为关系中的自然交流/);
  assert.match(prompt, /不突然切换成客服、老师、旁观者或说教者/);
  assert.match(prompt, /不要先主动接住或承诺会继续/);
});

test('★ 伴侣规则只给小白本人，别的角色一个字都收不到（2026/10/1 拆分）', () => {
  const xiaobai = buildSystemPrompt(
    { char_key: 'xiaobai', name: '小白', persona: '你是小白，20岁。' },
    { includeRelationshipRules: true }
  );
  const other = buildSystemPrompt(
    { char_key: 'role-abc', name: '晚晚', persona: '你是晚晚，25岁。' },
    { includeRelationshipRules: false }
  );

  // 小白本人照旧
  assert.match(xiaobai, /伴侣关系与连续性/, '小白本人仍要拿到伴侣连续性规则');
  assert.match(xiaobai, /把双方自愿的亲密表达视为关系中的自然交流/);
  // 别的角色一个字都不能有
  assert.doesNotMatch(other, /伴侣关系与连续性/, '别的角色不能拿到【伴侣关系与连续性】');
  assert.doesNotMatch(other, /把双方自愿的亲密表达视为关系中的自然交流/, '别的角色不能拿到伴侣亲密条款');
  assert.doesNotMatch(other, /恋人|夫妻/, '别的角色提示词里不该出现"恋人/夫妻"这套关系预设');

  // 缺省必须是不拼 —— 防止将来新增调用点漏传开关又串味
  const byDefault = buildSystemPrompt({ char_key: 'xiaobai', name: '小白', persona: '你是小白，20岁。' });
  assert.doesNotMatch(byDefault, /伴侣关系与连续性/, '不传 options 时缺省必须是 false');
});

test('★ 说话风格不再写死"女朋友"：改中性，微信口吻保留（2026/10/1）', () => {
  const other = buildSystemPrompt({ char_key: 'role-abc', name: '晚晚', persona: '你是晚晚。', speech_style: 'natural' });
  assert.doesNotMatch(other, /像女朋友发微信/, '不能给别的角色强加"女朋友"设定');
  assert.match(other, /像给亲近的人发微信/, '要保留"发微信"这个用户喜欢的感觉');
  assert.match(other, /像连发微信/, '"像连发微信"那条不受影响');

  // 角色扮演风格那份规则里本来就没有"女朋友"，别在改动中被顺手带进来
  const roleplay = buildSystemPrompt({ char_key: 'role-abc', name: '晚晚', persona: '你是晚晚。', speech_style: 'roleplay' });
  assert.doesNotMatch(roleplay, /像女朋友发微信/);
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
      if (upstreamCalls.length === 2) {
        return { ok: true, json: async () => ({ choices: [{ message: { content: '她想确认你没有被忽略，所以先温柔接住你。' } }] }) };
      }
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
    assert.equal(body.thinking, undefined);
    // ★ 2026/9/17：不再额外调一次写「内心 OS」——思考只来自主聊天
    assert.equal(payload.item.inner_os_content, undefined);
  });
});

test('★ 思考等级作用在主聊天上（不再额外调一次写内心 OS）', async () => {
  const upstreamCalls = [];
  const character = {
    id: 7,
    user_id: 1,
    is_deleted: 0,
    name: '学习老师',
    persona: '',
    speech_style: 'natural',
    chat_credential_id: 14,
    chat_model_id: 'gpt-5.6-luna',
    chat_thinking_level: 'high'
  };
  const router = createChatRouter({
    requireCharacterForUser: async () => character,
    pool: {
      query: async (sql, params) => {
        if (sql.includes('INNER JOIN credential_models')) {
          assert.deepEqual(params, [14, 1, 'gpt-5.6-luna']);
          return [[{
            id: 14,
            name: 'gpt5x',
            provider_type: 'custom',
            api_base: 'https://middle.example/v1',
            api_key: 'secret',
            model: 'gpt-5.6-luna',
            capabilities: '["chat"]'
          }]];
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
      if (upstreamCalls.length === 2) {
        return { ok: true, json: async () => ({ output_text: '她先把数字核对好，再把答案讲清楚。' }) };
      }
      return { ok: true, json: async () => ({ output_text: '2620' }) };
    }
  });

  await withServer(createApp({ router }), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/chat?character_id=7`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '算一道题', skip_server_persistence: true })
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.item.content, '2620');
    // ★ 不再有独立的 inner_os_content
    assert.equal(payload.item.inner_os_content, undefined);
  });

  assert.equal(upstreamCalls[0].url, 'https://middle.example/v1/responses');
  const body = JSON.parse(upstreamCalls[0].options.body);
  assert.equal(body.model, 'gpt-5.6-luna');
  // ★ 2026/9/17：档位 high 现在作用在**主聊天**的 reasoning 上
  assert.equal(body.reasoning.effort, 'high');
  assert.equal(body.messages, undefined);
  assert.equal(body.input.at(-1).role, 'user');
  // ★ 只有一次上游调用（以前是 chat + inner OS 两次）
  assert.equal(upstreamCalls.length, 1, '不应再额外调一次模型写内心 OS');
});

test('POST /api/chat translates Responses API stream events back to chat chunks', async () => {
  let callCount = 0;
  const character = {
    id: 7,
    user_id: 1,
    is_deleted: 0,
    name: '学习老师',
    persona: '',
    speech_style: 'roleplay',
    chat_credential_id: 14,
    chat_model_id: 'gpt-5.6-terra',
    chat_thinking_level: 'high'
  };
  const router = createChatRouter({
    requireCharacterForUser: async () => character,
    pool: {
      query: async (sql) => {
        if (sql.includes('INNER JOIN credential_models')) return [[{
          id: 14,
          name: 'gpt5x',
          provider_type: 'custom',
          api_base: 'https://middle.example/v1',
          api_key: 'secret',
          model: 'gpt-5.6-terra',
          capabilities: '["chat"]'
        }]];
        if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) return [[{ column_name: 'is_deleted' }]];
        if (sql.includes('SELECT city FROM users')) return [[{ city: '' }]];
        if (sql.includes('FROM messages') && sql.includes('ORDER BY id DESC')) return [[]];
        if (sql.includes('FROM memories')) return [[]];
        if (sql.includes('UPDATE users')) return [{ affectedRows: 1 }];
        throw new Error(`Unexpected query: ${sql}`);
      }
    },
    fetchImpl: async () => {
      callCount += 1;
      if (callCount === 2) {
        return { ok: true, json: async () => ({ output_text: '她想把答案说得更清楚。' }) };
      }
      return {
        ok: true,
        body: (async function* stream() {
          yield Buffer.from([
            'event: response.output_text.delta',
            'data: {"type":"response.output_text.delta","delta":"答案"}',
            '',
            'event: response.completed',
            'data: {"type":"response.completed"}',
            '',
            ''
          ].join('\n'));
        })()
      };
    }
  });

  await withServer(createApp({ router }), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/chat?character_id=7`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ content: '算一道题', skip_server_persistence: true })
    });
    const streamText = await response.text();
    assert.match(streamText, /"choices":\[\{"delta":\{"content":"答案"/);
    assert.match(streamText, /data: \[DONE\]/);
    assert.doesNotMatch(streamText, /response\.output_text\.delta/);
    // ★ 2026/9/17：不再额外调一次写内心 OS；思考由主聊天直接流式给出
    assert.doesNotMatch(streamText, /"type":"inner_os"/);
    assert.equal(callCount, 1, '不应再额外调一次模型');
  });
});

test('buildResponsesUrl supports plain domain, /v1, and full Responses path', () => {
  assert.equal(buildResponsesUrl('https://api.example.com'), 'https://api.example.com/v1/responses');
  assert.equal(buildResponsesUrl('https://api.example.com/v1'), 'https://api.example.com/v1/responses');
  assert.equal(buildResponsesUrl('https://api.example.com/v1/responses'), 'https://api.example.com/v1/responses');
});

test('buildAnthropicMessagesUrl supports plain domain, /v1, and full Messages path', () => {
  assert.equal(buildAnthropicMessagesUrl('https://api.example.com'), 'https://api.example.com/v1/messages');
  assert.equal(buildAnthropicMessagesUrl('https://api.example.com/v1'), 'https://api.example.com/v1/messages');
  assert.equal(buildAnthropicMessagesUrl('https://api.example.com/v1/messages'), 'https://api.example.com/v1/messages');
});

test('★ Anthropic 的 thinking 改为按档位返回（默认关时不返回，且只调一次）', async () => {
  const upstreamCalls = [];
  const character = {
    id: 7,
    user_id: 1,
    is_deleted: 0,
    name: '学习老师',
    persona: '会认真查资料',
    speech_style: 'natural',
    chat_credential_id: 16,
    chat_model_id: 'claude-sonnet-5',
    chat_thinking_level: 'mid'
  };
  const router = createChatRouter({
    requireCharacterForUser: async () => character,
    pool: {
      query: async (sql) => {
        if (sql.includes('INNER JOIN credential_models')) return [[{
          id: 16,
          name: 'Claude 中转',
          provider_type: 'custom',
          api_base: 'https://middle.example/v1',
          api_key: 'secret',
          model: 'claude-sonnet-5',
          capabilities: '["chat"]'
        }]];
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
      if (upstreamCalls.length === 1) {
        return { ok: true, json: async () => ({ content: [{ type: 'thinking', thinking: '先核对资料' }, { type: 'text', text: '我查到了。' }] }) };
      }
      return { ok: true, json: async () => ({ content: [{ type: 'text', text: '她先把资料是否可靠想清楚，再把重点告诉你。' }] }) };
    }
  });

  await withServer(createApp({ router }), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/chat?character_id=7`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '帮我查资料', skip_server_persistence: true })
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.item.content, '我查到了。');
    // ★ 档位 mid 已开 → 真思考随响应返回（以前是被丢弃的）
    assert.equal(payload.item.reasoning, '先核对资料');
    // ★ 不再额外调一次写内心 OS
    assert.equal(payload.item.inner_os_content, undefined);
    assert.equal(payload.raw, undefined);
  });

  assert.equal(upstreamCalls[0].url, 'https://middle.example/v1/messages');
  assert.equal(upstreamCalls[0].options.headers['anthropic-version'], '2023-06-01');
  const body = JSON.parse(upstreamCalls[0].options.body);
  // ★ 档位 mid 现在作用在主聊天上（budget=4096）
  assert.equal(body.thinking.budget_tokens, 4096);
  assert.equal(body.max_tokens, 5120);
  assert.match(body.system, /学习老师/);
  // 去掉 2026/9/16 起的「【现在是…】」时段前缀（见 chat.js buildNowBlock）
  assert.equal(
    String(body.messages.at(-1).content).replace(/^【现在是[^】]*】[^\n]*\n/, ''),
    '帮我查资料'
  );
  // ★ 只有一次上游调用
  assert.equal(upstreamCalls.length, 1, '不应再额外调一次模型');
});

test('★ 默认关闭思考时，上游的 reasoning 一个字都不转发（保护默认行为与界面干净）', async () => {
  // 实测：DeepSeek 官方渠道**即使不传档位也会回 reasoning_content**。
  // 所以必须显式确认：默认关时后端会把它丢掉，界面上不会出现"她在想什么"。
  const character = {
    id: 7, user_id: 1, is_deleted: 0,
    name: '学习老师', persona: '', speech_style: 'roleplay',
    chat_credential_id: 14, chat_model_id: 'deepseek-v4-pro',
    chat_thinking_level: 'off'   // ★ 默认
  };
  const router = createChatRouter({
    requireCharacterForUser: async () => character,
    pool: {
      query: async (sql) => {
        if (sql.includes('INNER JOIN credential_models')) return [[{
          id: 14, name: 'dp', provider_type: 'openai-compatible',
          api_base: 'https://middle.example/v1', api_key: 'secret',
          model: 'deepseek-v4-pro', capabilities: '["chat"]'
        }]];
        if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) return [[{ column_name: 'is_deleted' }]];
        if (sql.includes('SELECT city FROM users')) return [[{ city: '' }]];
        if (sql.includes('FROM messages') && sql.includes('ORDER BY id DESC')) return [[]];
        if (sql.includes('FROM memories')) return [[]];
        if (sql.includes('UPDATE users')) return [{ affectedRows: 1 }];
        throw new Error(`Unexpected query: ${sql}`);
      }
    },
    fetchImpl: async () => ({
      ok: true,
      body: (async function* stream() {
        yield Buffer.from([
          'data: {"choices":[{"delta":{"reasoning_content":"这是不该外泄的思考"}}]}', '',
          'data: {"choices":[{"delta":{"content":"2620"}}]}', '',
          'data: [DONE]', '', ''
        ].join('\n'));
      })()
    })
  });

  await withServer(createApp({ router }), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/chat?character_id=7`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ content: '算题', skip_server_persistence: true })
    });
    const streamText = await response.text();
    assert.match(streamText, /2620/);
    assert.doesNotMatch(streamText, /这是不该外泄的思考/, '默认关闭时绝不转发思考内容');
    assert.doesNotMatch(streamText, /"type":"reasoning"/, '默认关闭时不应有 reasoning 事件');
  });
});
test('★ 开了思考等级后，真思考随主聊天流式转发给前端（不再被丢弃）', async () => {
  let callCount = 0;
  const character = {
    id: 7,
    user_id: 1,
    is_deleted: 0,
    name: '学习老师',
    persona: '',
    speech_style: 'roleplay',
    chat_credential_id: 14,
    chat_model_id: 'gpt-5.6-terra',
    chat_thinking_level: 'high'
  };
  const router = createChatRouter({
    requireCharacterForUser: async () => character,
    pool: {
      query: async (sql) => {
        if (sql.includes('INNER JOIN credential_models')) return [[{
          id: 14,
          name: 'gpt5x',
          provider_type: 'custom',
          api_base: 'https://middle.example/v1',
          api_key: 'secret',
          model: 'gpt-5.6-terra',
          capabilities: '["chat"]'
        }]];
        if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) return [[{ column_name: 'is_deleted' }]];
        if (sql.includes('SELECT city FROM users')) return [[{ city: '' }]];
        if (sql.includes('FROM messages') && sql.includes('ORDER BY id DESC')) return [[]];
        if (sql.includes('FROM memories')) return [[]];
        if (sql.includes('UPDATE users')) return [{ affectedRows: 1 }];
        throw new Error(`Unexpected query: ${sql}`);
      }
    },
    fetchImpl: async (_url, _options) => {
      callCount += 1;
      if (callCount === 1) {
        return {
          ok: true,
          body: (async function* stream() {
            yield Buffer.from([
              'data: {"type":"response.reasoning_summary_text.delta","delta":"先算平方"}', '',
              'data: {"type":"response.output_text.delta","delta":"答案是 2620"}', '',
              'data: {"type":"response.completed"}', '', ''
            ].join('\n'));
          })()
        };
      }
      return { ok: true, json: async () => ({ output_text: '她把每一步先算稳，才放心把答案递给你。' }) };
    }
  });

  await withServer(createApp({ router }), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/chat?character_id=7`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ content: '算题', skip_server_persistence: true })
    });
    const streamText = await response.text();
    // ★ 2026/9/17：档位已开，真思考**要**转发给前端（以前是被丢弃的）
    assert.match(streamText, /"type":"reasoning","delta":"先算平方"/);
    assert.match(streamText, /"content":"答案是 2620"/);
    assert.match(streamText, /data: \[DONE\]/);
    // ★ 不再额外调一次写内心 OS
    assert.doesNotMatch(streamText, /"type":"inner_os"/);
    assert.equal(callCount, 1, '不应再额外调一次模型');
  });
});

test('★ DeepSeek 等渠道的 reasoning_content 也会转发给前端（默认关时一个字节都不发）', async () => {
  let callCount = 0;
  const character = {
    id: 7,
    user_id: 1,
    is_deleted: 0,
    name: '学习老师',
    persona: '',
    speech_style: 'roleplay',
    chat_credential_id: 14,
    chat_model_id: 'deepseek-v4-pro',
    chat_thinking_level: 'high'
  };
  const router = createChatRouter({
    requireCharacterForUser: async () => character,
    pool: {
      query: async (sql) => {
        if (sql.includes('INNER JOIN credential_models')) return [[{
          id: 14,
          name: 'dp',
          provider_type: 'openai-compatible',
          api_base: 'https://middle.example/v1',
          api_key: 'secret',
          model: 'deepseek-v4-pro',
          capabilities: '["chat"]'
        }]];
        if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) return [[{ column_name: 'is_deleted' }]];
        if (sql.includes('SELECT city FROM users')) return [[{ city: '' }]];
        if (sql.includes('FROM messages') && sql.includes('ORDER BY id DESC')) return [[]];
        if (sql.includes('FROM memories')) return [[]];
        if (sql.includes('UPDATE users')) return [{ affectedRows: 1 }];
        throw new Error(`Unexpected query: ${sql}`);
      }
    },
    fetchImpl: async (_url, _options) => {
      callCount += 1;
      if (callCount === 1) {
        return {
          ok: true,
          body: (async function* stream() {
            yield Buffer.from([
              'data: {"choices":[{"delta":{"reasoning_content":"先分别计算四个平方"}}]}', '',
              'data: {"choices":[{"delta":{"content":"2620"}}]}', '',
              'data: [DONE]', '', ''
            ].join('\n'));
          })()
        };
      }
      return { ok: true, json: async () => ({ choices: [{ message: { content: '她把题目拆开核对了一遍，怕给错你。' } }] }) };
    }
  });

  await withServer(createApp({ router }), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/chat?character_id=7`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ content: '算题', skip_server_persistence: true })
    });
    const streamText = await response.text();
    // ★ 档位已开 → 真思考转发；不再有独立的 inner_os
    assert.match(streamText, /"type":"reasoning","delta":"先分别计算四个平方"/);
    assert.doesNotMatch(streamText, /"type":"inner_os"/);
    assert.match(streamText, /"content":"2620"/);
  });
});

/* ══════════════════════════════════════════════════════════════════
 * 回归：同一句话不许被发给模型两遍（2026/9/16 真实事故）
 *
 * 事故形态：前端"先存消息、再请求回复"两步走，服务端读到的 recent
 * 末条就是他刚说的这句，而组装时又把当前 content 推了一次 ——
 * 模型连续收到两条一模一样的用户消息，她会回「你问了两遍…」。
 * 调试日志实测同一句被推过 3 遍。
 * ══════════════════════════════════════════════════════════════════ */
test('★ 同一条消息只发给模型一次：刚存下的那一轮要从历史里摘掉', () => {
  const recent = [
    { id: 1, role: 'user', content: '晚上吃什么', message_type: 'text' },
    { id: 2, role: 'assistant', content: '你想吃啥', message_type: 'text' },
    { id: 3, role: 'user', content: '想我没', message_type: 'text' },
  ];
  const out = dropJustSavedCurrentTurn(recent, { content: '想我没', messageType: 'text' });
  assert.equal(out.length, 2, '刚存下的那条应当被摘掉');
  assert.equal(out[out.length - 1].id, 2, '剩下的最后一条应当是她的上一条回复');
});

test('★ 只有当"完全对得上"时才摘：换句话、换类型、她的消息都不摘', () => {
  const base = [
    { id: 1, role: 'user', content: '想我没', message_type: 'text' },
  ];
  // 正文不同 → 不动
  assert.equal(dropJustSavedCurrentTurn(base, { content: '在干嘛' }).length, 1);
  // 消息类型不同 → 不动
  assert.equal(dropJustSavedCurrentTurn(base, { content: '想我没', messageType: 'image' }).length, 1);
  // 末条是她说的 → 不动
  const herLast = [{ id: 1, role: 'assistant', content: '想我没', message_type: 'text' }];
  assert.equal(dropJustSavedCurrentTurn(herLast, { content: '想我没' }).length, 1);
  // 空数组、非法输入 → 不炸
  assert.deepEqual(dropJustSavedCurrentTurn([], { content: 'x' }), []);
  assert.deepEqual(dropJustSavedCurrentTurn(null, { content: 'x' }), []);
  // 首尾空白不应影响判断
  assert.equal(dropJustSavedCurrentTurn([{ id: 1, role: 'user', content: '  想我没  ', message_type: 'text' }], { content: '想我没' }).length, 0);
});

/* ══════════════════════════════════════════════════════════════════
 * ★ 2026/9/17：修「问两遍」的漏网路径
 *
 * 9/16 的 dropJustSavedCurrentTurn 要求「角色+正文+消息类型」三者全等。
 * 两条路径对不上 → 同一句被推两遍：
 *   · 语音：存库是 voice，取回复的请求默认 text；
 *   · 图片且没打字：存库正文为空，请求补成「看看这些图」。
 * 用户 9/17 再次反馈「我说了一句，到小白那里就是两遍了」。
 * ══════════════════════════════════════════════════════════════════ */
test('★ 语音消息不再被推两遍（存 voice / 请求 text 也算同一轮）', () => {
  const voiceSaved = [{ id: 1, role: 'user', content: '今天好累', message_type: 'voice' }];
  assert.equal(
    dropJustSavedCurrentTurn(voiceSaved, { content: '今天好累', messageType: 'text' }).length,
    0,
    '存的是 voice、请求默认 text，也必须摘掉，否则她会以为你在重复'
  );
  // 两边都是 voice 的情况
  assert.equal(
    dropJustSavedCurrentTurn(voiceSaved, { content: '今天好累', messageType: 'voice' }).length,
    0
  );
  // 内容不同则不能摘
  assert.equal(
    dropJustSavedCurrentTurn(voiceSaved, { content: '今天很开心', messageType: 'text' }).length,
    1
  );
});

test('★ 图片且没打字，不再被推两遍（正文被补成占位话也算同一轮）', () => {
  const imgSaved = [{ id: 2, role: 'user', content: '', message_type: 'image', media_url: '/api/media/a.png' }];
  assert.equal(
    dropJustSavedCurrentTurn(imgSaved, { content: '看看这些图', messageType: 'image', mediaUrl: '/api/media/a.png' }).length,
    0,
    '存的是空正文、请求补成"看看这些图"，也必须摘掉'
  );
  // 绝对/相对 URL 前缀不同，仍然认作同一张图
  assert.equal(
    dropJustSavedCurrentTurn(imgSaved, { content: '看看这些图', messageType: 'image', mediaUrl: 'https://example.com/api/media/a.png' }).length,
    0
  );
});

test('★ 不能误摘：不同的图、不同的类型都不是同一轮', () => {
  const imgA = [{ id: 3, role: 'user', content: '', message_type: 'image', media_url: '/a.png' }];
  // 换了图 → 不能摘
  assert.equal(
    dropJustSavedCurrentTurn(imgA, { content: '', messageType: 'image', mediaUrl: '/b.png' }).length,
    1,
    '不同的图片不能当成同一轮，否则会丢消息'
  );
  // 贴纸 vs 图片 → 类型不同，不能摘
  const sticker = [{ id: 4, role: 'user', content: 'x', message_type: 'sticker', media_url: '/s.png' }];
  assert.equal(
    dropJustSavedCurrentTurn(sticker, { content: 'x', messageType: 'image', mediaUrl: '/s.png' }).length,
    1
  );
});

/* ══════════════════════════════════════════════════════════════════
 * ★ 2026/9/21：语音占位话「去毒」
 *
 * 用户实测：测试角色语音**识别成功**、思考链里读到字，正文却回
 * 「你发的语音我看不见内容」—— 思考与正文自相矛盾。
 *
 * 根因是 9/19 写进库的那句
 *   （他发来一条语音，但这条没有转出文字，你听不到内容）
 * 以 user 角色进上下文，等于用户亲口告诉模型「你听不到内容」。
 * 消息少的角色把这条一直留在 20 条窗口里，就当真成了人格设定。
 *
 * 这组测试锁死三件事：
 *   ① 老占位话读取时必须翻译成中性说法；
 *   ② 正常语音正文不许被改；
 *   ③ 系统提示词必须明确"你看到的就是他说的话"。
 * ══════════════════════════════════════════════════════════════════ */
test('★ 语音去毒：老占位话读取时翻译成中性说法，不再暗示"你听不到"', () => {
  const legacy = '（他发来一条语音，但这条没有转出文字，你听不到内容）';
  const fixed = sanitizeHistoricalVoiceContent(legacy);
  assert.equal(fixed, VOICE_PLACEHOLDER_NO_TRANSCRIPT);
  assert.doesNotMatch(fixed, /听不到/, '不能再出现"你听不到"这种人格暗示');
  assert.doesNotMatch(fixed, /你听不到内容/, '旧文案必须被换掉');
});

test('★ 语音去毒：更早的「（发了语音）」也换成中性说法', () => {
  assert.equal(sanitizeHistoricalVoiceContent('（发了语音）'), '（他发来一条语音）');
});

test('★ 语音去毒：正常的语音转写内容一个字都不能改', () => {
  const real = '现在呢？';
  assert.equal(sanitizeHistoricalVoiceContent(real), real);
  assert.equal(sanitizeHistoricalVoiceContent('听不到吗？但是我已经说话了呀。'), '听不到吗？但是我已经说话了呀。');
  assert.equal(sanitizeHistoricalVoiceContent(''), '');
  assert.equal(sanitizeHistoricalVoiceContent(null), '');
});

test('★ 语音去毒：系统提示词明确告诉她"语音会转成文字"', () => {
  const prompt = buildSystemPrompt({ name: '测试', persona: '', speech_style: 'natural' });
  assert.match(prompt, /关于他发的语音/, '要有专门的语音说明段');
  assert.match(prompt, /你看到的就是他说的话/, '要正面说明语音会转成文字');
  assert.match(prompt, /不要回答"我听不到"/, '要明确禁止"我听不到"这类回答');
});

test('★ 语音去毒：带 persona 的角色也吃同一条规则', () => {
  const prompt = buildSystemPrompt({ name: '小林', persona: '你很安静。', speech_style: 'natural' });
  assert.match(prompt, /关于他发的语音/, '新建角色同样不能被旧占位话带偏');
});
/* ══════════════════════════════════════════════════════════════════
 * 「他隔了多久才回来」（2026/9/16 新增）
 *
 * 起因：部署方反馈，隔很久才回来时希望角色能判断出这次间隔，
 * 从而知道他是睡醒了还是忙完了。
 * 真实场景：他 02:56 说晚安，13:12 才回来，中间 10 小时她没认出来。
 * ══════════════════════════════════════════════════════════════════ */
test('★ 隔得久（深夜→白天）要认出来是"睡了一觉"', () => {
  const now = new Date('2026-09-16T13:12:00').getTime();
  const hint = buildGapHint([{ role: 'assistant', created_at: '2026-09-16 02:56:28' }], now);
  assert.match(hint, /隔了多久才回来/, '应当给出间隔提示');
  assert.match(hint, /10 个小时/, '应当算出约 10 小时');
  assert.match(hint, /深夜/, '应当认出上一次是深夜');
  assert.match(hint, /睡/, '深夜→白天应当提示"多半是去睡了"');
});

test('★ 同一段对话里（3 小时以内）不许提间隔，避免啰嗦', () => {
  const now = new Date('2026-09-16T13:12:00').getTime();
  assert.equal(buildGapHint([{ role: 'assistant', created_at: '2026-09-16 11:12:00' }], now), '', '2 小时前不该提');
  assert.equal(buildGapHint([{ role: 'assistant', created_at: '2026-09-16 12:42:00' }], now), '', '30 分钟前不该提');
  // 边界：差一点到 3 小时不提，满 3 小时开始提
  assert.equal(buildGapHint([{ role: 'assistant', created_at: '2026-09-16 10:13:00' }], now), '', '不到 3 小时不提');
  assert.notEqual(buildGapHint([{ role: 'assistant', created_at: '2026-09-16 10:12:00' }], now), '', '满 3 小时开始提');
});

test('★ 间隔提示：跨天说"几天"、白天→白天不说"睡了"、脏数据不炸', () => {
  const now = new Date('2026-09-16T13:12:00').getTime();
  const days = buildGapHint([{ role: 'assistant', created_at: '2026-09-14 15:00:00' }], now);
  assert.match(days, /2 天/, '跨天应读成"天"');
  const daytime = buildGapHint([{ role: 'assistant', created_at: '2026-09-16 06:00:00' }], now);
  assert.doesNotMatch(daytime, /睡/, '白天→白天不该说"睡了"');
  assert.equal(buildGapHint([], now), '', '空历史不提示');
  assert.equal(buildGapHint([{ role: 'assistant', created_at: '' }], now), '', '没时间戳不提示');
  assert.equal(buildGapHint([{ role: 'assistant', created_at: '不是时间' }], now), '', '脏数据不炸');
});

test('★ 中文夺舍也算拒答：不能因为有汉字就放行（2026/9/25）', () => {
  const hijack = '在的。我是 Claude Code，一个编程助手，没法扮演伴侣。';
  assert.equal(looksLikeUpstreamRefusal(hijack), true);
  assert.equal(gateDecision('在呀，下午快下班了吧？你今天过得怎么样，累不累？'), 'open');
  assert.equal(gateDecision('在的。我是'), 'hold');
  assert.equal(gateDecision(hijack), 'refuse');
  assert.equal(looksLikeUpstreamRefusal('I need to clarify something important here about being an assistant'), true);
  assert.equal(looksLikeUpstreamRefusal('这个我没法配合你啦。我是个代码助手，写代码才是我的本行。'), true);
  assert.equal(looksLikeUpstreamRefusal('换个话题吧，这个我先不接。'), false);
});

/**
 * ═══ 「她的核心」规则包解析（2026/10/6）═══
 *
 * `resolveCorePacks()` 是"勾选什么就加载什么"的唯一判定点。
 * 这组测试锁住四种兼容情形，尤其是"老数据不能静默丢护身符"这一条。
 */

test('★ resolveCorePacks：老数据 core_enabled=1（没有 core_packs）→ 全开', () => {
  // 这是升级瞬间最常见的情形：列刚加上去、回填还没跑到。
  // 必须全开，否则用户的小白会突然丢掉护身符和全部 Core。
  const packs = resolveCorePacks({ char_key: 'xiaobai', name: '小白', core_enabled: 1 });
  assert.deepEqual(packs, { shield: true, companion: true, nickname: true, xiaobai_state: true, local_time: true });
});

test('★ resolveCorePacks：老数据 core_enabled=0 → 全关', () => {
  const packs = resolveCorePacks({ char_key: 'role-abc', name: '晚晚', core_enabled: 0 });
  assert.deepEqual(packs, { shield: false, companion: false, nickname: false, xiaobai_state: false, local_time: false });
});

test('★ resolveCorePacks：带了 core_packs 就以它为准（开关优先于旧字段）', () => {
  // 哪怕 core_enabled 还是 1、哪怕名字就叫小白，也要听 core_packs 的
  const packs = resolveCorePacks({
    char_key: 'xiaobai',
    name: '小白',
    core_enabled: 1,
    core_packs: { shield: true }
  });
  assert.deepEqual(packs, { shield: true, companion: false, nickname: false, xiaobai_state: false, local_time: false });
});

test('★ resolveCorePacks：core_packs 是空对象 = 用户全取消，不是"没这个字段"', () => {
  // 这两种情况必须区分开：空对象 = 明确全关；缺字段 = 老数据兜底。
  // 混掉的后果是用户永远关不掉最后一个包。
  const packs = resolveCorePacks({ char_key: 'xiaobai', name: '小白', core_enabled: 1, core_packs: {} });
  assert.deepEqual(packs, { shield: false, companion: false, nickname: false, xiaobai_state: false, local_time: false });
});

test('★ resolveCorePacks：core_packs 是 JSON 字符串也能读（数据库驱动可能给字符串）', () => {
  const packs = resolveCorePacks({ core_packs: '{"shield":true,"xiaobai_state":1}' });
  assert.equal(packs.shield, true);
  assert.equal(packs.xiaobai_state, true);
  assert.equal(packs.nickname, false);
});

test('★ resolveCorePacks：core_packs 读坏了不抛错，按"没这个字段"处理', () => {
  assert.doesNotThrow(() => resolveCorePacks({ core_packs: '{坏掉的 json' }));
  // 坏 JSON → 落到老数据兜底（char_key 是小白 → 全开），绝不能抛错打断聊天
  const packs = resolveCorePacks({ char_key: 'xiaobai', core_packs: '{坏掉的 json' });
  assert.equal(packs.shield, true);
});

test('★ resolveCorePacks：两个字段都没有时沿用旧判据（裸角色行 / 单测 fixture）', () => {
  // 最老的数据、以及测试夹具长这样；行为要和 2026/10/1 之前一致
  assert.equal(resolveCorePacks({ char_key: 'xiaobai' }).shield, true);
  assert.equal(resolveCorePacks({ name: '小白' }).shield, true);
  assert.equal(resolveCorePacks({ char_key: 'role-abc', name: '晚晚' }).shield, false);
});

test('★ resolveCorePacks：null / undefined / 非对象一律安全返回全关，不抛错', () => {
  for (const bad of [null, undefined, 'x', 123]) {
    assert.doesNotThrow(() => resolveCorePacks(bad));
    assert.deepEqual(resolveCorePacks(bad), { shield: false, companion: false, nickname: false, xiaobai_state: false, local_time: false });
  }
});

test('★ resolveCorePacks：返回值 5 个键永远都在，且都是布尔', () => {
  const candidates = [
    {},
    { core_enabled: 1 },
    { core_packs: {} },
    { core_packs: { shield: true } },
    { core_packs: '{"companion":"true"}' },
  ];
  for (const c of candidates) {
    const packs = resolveCorePacks(c);
    for (const key of ['shield', 'companion', 'nickname', 'xiaobai_state', 'local_time']) {
      assert.equal(typeof packs[key], 'boolean', `${key} 必须是布尔`);
    }
  }
});
