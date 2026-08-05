import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { requireAuth } from './middleware.js';
import { createRolesRouter } from './roles.js';

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
  app.use('/api/roles', requireAuth, router);
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

test('GET /api/roles can include deleted roles for restore list', async () => {
  const calls = [];
  const router = createRolesRouter({
    pool: {
      query: async (sql, params) => {
        calls.push({ sql, params });

        if (sql.includes('delete_after <= NOW()')) {
          assert.deepEqual(params, [1]);
          return [[]];
        }

        if (sql.includes('SELECT id, is_active')) {
          return [[{ id: 5, is_active: 1 }]];
        }

        if (sql.includes('SELECT id, user_id, char_key')) {
          assert.deepEqual(params, [1]);
          assert.match(sql, /FROM characters/i);
          assert.match(sql, /auto_moments_enabled/i);
          assert.match(sql, /auto_moments_daily_min/i);
          assert.match(sql, /auto_moments_daily_max/i);
          assert.match(sql, /auto_moments_min_interval_hours/i);
          assert.match(sql, /portrait_id/i);
          assert.match(sql, /portrait_custom_url/i);
          assert.match(sql, /first_chat_at/i);
          assert.doesNotMatch(sql, /WHERE user_id = \? AND is_deleted = 0/i);
          return [[
            {
              id: 5,
              user_id: 1,
              char_key: 'active-role',
              name: 'Active role',
              tag: 'default',
              persona: 'active',
              avatar: '',
              mood: 80,
              intimacy: 50,
              auto_moments_enabled: 1,
              auto_moments_daily_min: 2,
              auto_moments_daily_max: 6,
              auto_moments_min_interval_hours: 4,
              auto_moments_last_posted_at: null,
              portrait_id: null,
              portrait_custom_url: null,
              first_chat_at: '2026-05-25 18:30:00',
              is_active: 1,
              is_deleted: 0,
              delete_after: null,
              created_at: '2026-05-25 18:00:00'
            },
            {
              id: 7,
              user_id: 1,
              char_key: 'deleted-role',
              name: 'Deleted role',
              tag: 'default',
              persona: 'deleted',
              avatar: '',
              mood: 70,
              intimacy: 40,
              auto_moments_enabled: 0,
              auto_moments_daily_min: 0,
              auto_moments_daily_max: 0,
              auto_moments_min_interval_hours: 4,
              auto_moments_last_posted_at: null,
              portrait_id: null,
              portrait_custom_url: null,
              first_chat_at: null,
              is_active: 0,
              is_deleted: 1,
              delete_after: null,
              created_at: '2026-05-25 17:00:00'
            }
          ]];
        }

        throw new Error(`Unexpected query: ${sql}`);
      }
    }
  });

  await withServer(createApp({ router }), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/roles?include_deleted=1`);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.items.length, 2);
    assert.equal(payload.items[0].auto_moments_enabled, 1);
    assert.equal(payload.items[0].auto_moments_daily_min, 2);
    assert.equal(payload.items[0].auto_moments_daily_max, 6);
    assert.equal(payload.items[0].auto_moments_min_interval_hours, 4);
    assert.equal(payload.items[0].portrait_id, null);
    assert.equal(payload.items[0].portrait_custom_url, null);
    assert.equal(payload.items[0].first_chat_at, '2026-05-25 18:30:00');
    assert.equal(payload.items[1].is_deleted, 1);
    assert.equal(payload.activeCharacterId, 5);
  });
});

test('GET /api/roles/:id/identity-pack exports role identity without credentials', async () => {
  const router = createRolesRouter({
    pool: {
      query: async (sql, params) => {
        if (sql.includes('SELECT id, user_id, name, tag, persona, avatar, speech_style')) {
          assert.deepEqual(params, [6, 1]);
          return [[{
            id: 6,
            user_id: 1,
            name: '小白',
            tag: '陪伴',
            persona: '温柔、清醒',
            speech_style: 'natural',
            avatar: '/api/media/avatar-x.png',
            portrait_id: 0,
            portrait_custom_url: null,
            mood: 76,
            intimacy: 88,
            auto_moments_enabled: 1,
            auto_moments_images_enabled: 0,
            auto_moments_image_profile: JSON.stringify({ age: '20岁', hair: '银白长发' }),
            auto_moments_templates: JSON.stringify([{ category: '日常', scene: '窗边' }]),
            auto_moments_daily_min: 2,
            auto_moments_daily_max: 4,
            auto_moments_min_interval_hours: 6
          }]];
        }
        if (sql.includes('FROM character_runtime_states')) {
          assert.deepEqual(params, [1, 6]);
          return [[{ state_json: '{}', relationship_json: '{"trust":1}' }]];
        }
        if (sql.includes('FROM memories')) {
          assert.deepEqual(params, [1, 6]);
          return [[{ id: 9, content: '喜欢安静', tag: '偏好', category: '生活', memory_type: 'life', source_type: 'chat', source_id: 33, review_status: 'active', confidence: 1, weight: 60, is_important: 0, appointment_at: null, appointment_status: null }]];
        }
        throw new Error(`Unexpected query: ${sql}`);
      }
    }
  });

  await withServer(createApp({ router }), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/roles/6/identity-pack`);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.item.identity.name, '小白');
    assert.equal(payload.item.version, '1.1.0');
    assert.equal(payload.item.identity.avatar, '/api/media/avatar-x.png');
    assert.deepEqual(payload.item.current, { mood: 76, intimacy: 88 });
    assert.equal(payload.item.dynamic_life.enabled, true);
    assert.equal(payload.item.dynamic_life.images_enabled, false);
    assert.deepEqual(payload.item.dynamic_life.image_profile, { age: '20岁', hair: '银白长发' });
    assert.deepEqual(payload.item.dynamic_life.templates, [{ category: '日常', scene: '窗边' }]);
    assert.equal(payload.item.dynamic_life.min_interval_hours, 6);
    assert.equal(payload.item.memories[0].source_id, 33);
    assert.equal(Object.prototype.hasOwnProperty.call(payload.item, 'api_key'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(payload.item, 'chat_credential_id'), false);
  });
});

test('PATCH /api/roles/:id updates per-role auto moment settings with safe limits', async () => {
  const calls = [];
  const updatedRole = {
    id: 7,
    user_id: 1,
    char_key: 'xiaobai',
    name: 'Xiaobai',
    tag: 'companion',
    persona: 'warm',
    avatar: '',
    mood: 80,
    intimacy: 50,
    auto_moments_enabled: 1,
    auto_moments_daily_min: 2,
    auto_moments_image_resolution: '2k',
    auto_moments_daily_max: 8,
    auto_moments_min_interval_hours: 3,
    auto_moments_last_posted_at: null,
    is_active: 1,
    is_deleted: 0,
    delete_after: null,
    created_at: '2026-05-25 18:00:00'
  };

  const connection = {
    query: async (sql, params) => {
      calls.push({ sql, params });

      if (sql.includes('SELECT id') && sql.includes('is_deleted = 0') && !sql.includes('SELECT id, user_id')) {
        assert.deepEqual(params, [7, 1]);
        return [[{ id: 7 }]];
      }

      if (sql.includes('UPDATE characters') && sql.includes('auto_moments_enabled')) {
        assert.match(sql, /auto_moments_enabled = COALESCE/i);
        assert.match(sql, /auto_moments_daily_min = COALESCE/i);
        assert.match(sql, /auto_moments_daily_max = COALESCE/i);
        assert.match(sql, /auto_moments_min_interval_hours = COALESCE/i);
        assert.equal(params.includes(1), true);
        assert.equal(params.includes(2), true);
        assert.equal(params.includes(8), true);
        assert.equal(params.includes(3), true);
        assert.equal(params.includes('2k'), true);
        return [{ affectedRows: 1 }];
      }

      if (sql.includes('SELECT id, user_id, char_key')) {
        assert.match(sql, /auto_moments_enabled/i);
        assert.deepEqual(params, [7, 1]);
        return [[updatedRole]];
      }

      throw new Error(`Unexpected query: ${sql}`);
    }
  };

  const router = createRolesRouter({
    withTransaction: async work => work(connection)
  });

  await withServer(createApp({ router }), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/roles/7`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auto_moments_enabled: true,
        auto_moments_daily_min: 2,
        auto_moments_image_resolution: '2k',
        auto_moments_daily_max: 8,
        auto_moments_min_interval_hours: 3
      })
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.item.auto_moments_enabled, 1);
    assert.equal(payload.item.auto_moments_daily_min, 2);
    assert.equal(payload.item.auto_moments_image_resolution, '2k');
    assert.equal(payload.item.auto_moments_daily_max, 8);
    assert.equal(payload.item.auto_moments_min_interval_hours, 3);
  });
});

test('PATCH /api/roles/:id saves structured dynamic image settings and returns them as objects', async () => {
  const profile = { name: '小白', age_feel: '20岁左右', temperament: ['温柔', '安静'], hair: ['白银色'] };
  const templates = { categories: ['自拍'], selfie_scenes: ['镜子自拍'], poses: ['回眸'], moods: ['放松'], custom: ['雨天撑伞'] };
  const updatedRole = {
    id: 7, user_id: 1, char_key: 'xiaobai', name: '小白', tag: '恋人', persona: '温柔', avatar: '', mood: 80, intimacy: 50,
    auto_moments_enabled: 1, auto_moments_images_enabled: 1, auto_moments_image_profile: JSON.stringify(profile), auto_moments_templates: JSON.stringify(templates),
    auto_moments_daily_min: 2, auto_moments_daily_max: 6, auto_moments_min_interval_hours: 4, auto_moments_last_posted_at: null,
    is_active: 1, is_deleted: 0, delete_after: null, created_at: '2026-08-03 10:00:00'
  };
  const connection = {
    query: async (sql, params) => {
      if (sql.includes('SELECT id') && sql.includes('is_deleted = 0') && !sql.includes('SELECT id, user_id')) return [[{ id: 7 }]];
      if (sql.includes('UPDATE characters') && sql.includes('auto_moments_image_profile')) {
        assert.match(sql, /auto_moments_templates = CASE WHEN \? = 1/i);
        assert.ok(params.includes(JSON.stringify(profile)));
        assert.ok(params.includes(JSON.stringify(templates)));
        return [{ affectedRows: 1 }];
      }
      if (sql.includes('SELECT id, user_id, char_key')) return [[updatedRole]];
      throw new Error(`Unexpected query: ${sql}`);
    }
  };
  const router = createRolesRouter({ withTransaction: async work => work(connection) });

  await withServer(createApp({ router }), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/roles/7`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auto_moments_image_profile: profile, auto_moments_templates: templates })
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(payload.item.auto_moments_image_profile, profile);
    assert.deepEqual(payload.item.auto_moments_templates, templates);
  });
});

test('PATCH /api/roles/:id rejects an incomplete fixed image profile', async () => {
  const router = createRolesRouter({
    withTransaction: async () => { throw new Error('should not write incomplete profile'); }
  });
  await withServer(createApp({ router }), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/roles/7`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auto_moments_image_profile: { name: '小白' } })
    });
    const payload = await response.json();
    assert.equal(response.status, 400);
    assert.match(payload.error, /姓名和年龄感/);
  });
});

test('PATCH /api/roles/:id allows clearing relationship tag', async () => {
  const updatedRole = {
    id: 7,
    user_id: 1,
    char_key: 'xiaobai',
    name: 'Xiaobai',
    tag: '',
    persona: 'warm',
    avatar: '',
    mood: 80,
    intimacy: 50,
    auto_moments_enabled: 0,
    auto_moments_daily_min: 0,
    auto_moments_daily_max: 0,
    auto_moments_min_interval_hours: 4,
    auto_moments_last_posted_at: null,
    is_active: 1,
    is_deleted: 0,
    delete_after: null,
    created_at: '2026-05-25 18:00:00'
  };

  const connection = {
    query: async (sql, params) => {
      if (sql.includes('SELECT id') && sql.includes('is_deleted = 0') && !sql.includes('SELECT id, user_id')) {
        assert.deepEqual(params, [7, 1]);
        return [[{ id: 7 }]];
      }

      if (sql.includes('UPDATE characters') && sql.includes('tag = COALESCE')) {
        assert.equal(params[2], '');
        return [{ affectedRows: 1 }];
      }

      if (sql.includes('SELECT id, user_id, char_key')) {
        assert.deepEqual(params, [7, 1]);
        return [[updatedRole]];
      }

      throw new Error(`Unexpected query: ${sql}`);
    }
  };

  const router = createRolesRouter({
    withTransaction: async work => work(connection)
  });

  await withServer(createApp({ router }), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/roles/7`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag: '' })
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.item.tag, '');
  });
});

test('POST /api/roles/:id/portrait stores uploaded portrait image for current user', async () => {
  const writes = [];
  const router = createRolesRouter({
    pool: {
      query: async (sql, params) => {
        if (sql.includes('SELECT id FROM characters') && sql.includes('is_deleted = 0')) {
          assert.deepEqual(params, [7, 1]);
          return [[{ id: 7 }]];
        }
        throw new Error(`Unexpected query: ${sql}`);
      }
    },
    fileStorage: {
      mkdir: async dir => writes.push({ type: 'mkdir', dir }),
      writeFile: async (filePath, buffer) => writes.push({ type: 'writeFile', filePath, size: buffer.length })
    },
    now: () => 1234567890
  });

  await withServer(createApp({ router }), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/roles/7/portrait`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_data: 'data:image/png;base64,aGVsbG8='
      })
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.portrait_url, '/user_assets/portraits/1/7-1234567890.png');
    assert.equal(writes.length, 2);
    assert.match(writes[0].dir, /user_assets[\\/]portraits[\\/]1$/);
    assert.match(writes[1].filePath, /user_assets[\\/]portraits[\\/]1[\\/]7-1234567890\.png$/);
    assert.equal(writes[1].size, 5);
  });
});

test('POST /api/roles/:id/restore restores deleted role and its related chat data', async () => {
  const calls = [];
  const restoredRole = {
    id: 7,
    user_id: 1,
    char_key: 'ruobai',
    name: 'RuoBai',
    tag: 'default',
    persona: 'kind',
    avatar: '/avatar.png',
    mood: 80,
    intimacy: 50,
    is_active: 1,
    is_deleted: 0,
    delete_after: null,
    created_at: '2026-05-25 18:00:00'
  };

  const connection = {
    query: async (sql, params) => {
      calls.push({ sql, params });

      if (sql.includes('SELECT id') && sql.includes('is_deleted = 1')) {
        assert.deepEqual(params, [7, 1]);
        return [[{ id: 7 }]];
      }

      if (sql.includes('UPDATE characters') && sql.includes('is_deleted = 0') && sql.includes('delete_after = NULL')) {
        assert.deepEqual(params, [7, 1]);
        return [{ affectedRows: 1 }];
      }

      if (sql.includes('UPDATE characters SET is_active = 0')) {
        assert.deepEqual(params, [1, 7]);
        return [{ affectedRows: 2 }];
      }

      if (sql.includes('UPDATE memories SET is_deleted = 0')) {
        assert.deepEqual(params, [1, 7]);
        return [{ affectedRows: 3 }];
      }

      if (sql.includes('UPDATE messages SET is_active = 1')) {
        assert.deepEqual(params, [1, 7]);
        return [{ affectedRows: 4 }];
      }

      if (sql.includes('SELECT id, user_id, char_key')) {
        assert.deepEqual(params, [7, 1]);
        return [[restoredRole]];
      }

      throw new Error(`Unexpected query: ${sql}`);
    }
  };

  const router = createRolesRouter({
    withTransaction: async work => work(connection)
  });

  await withServer(createApp({ router }), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/roles/7/restore`, {
      method: 'POST'
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.deepEqual(payload.item, restoredRole);
    assert.equal(calls.length, 6);
    assert.match(calls[1].sql, /SET is_deleted = 0, is_active = 1, delete_after = NULL/i);
    assert.match(calls[2].sql, /id <> \?/i);
    assert.match(calls[3].sql, /UPDATE memories SET is_deleted = 0/i);
    assert.match(calls[4].sql, /UPDATE messages SET is_active = 1/i);
  });
});

test('POST /api/roles/:id/restore requires authentication', async () => {
  const router = createRolesRouter({
    withTransaction: async () => {
      throw new Error('withTransaction should not be called');
    }
  });

  await withServer(createApp({ router, sessionUser: null }), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/roles/7/restore`, {
      method: 'POST'
    });
    const payload = await response.json();

    assert.equal(response.status, 401);
    assert.equal(payload.success, false);
  });
});

test('DELETE /api/roles/:id?mode=hard permanently deletes role', async () => {
  const calls = [];
  const connection = {
    query: async (sql, params) => {
      calls.push({ sql, params });

      if (sql.includes('DELETE FROM characters')) {
        assert.deepEqual(params, [7, 1]);
        return [{ affectedRows: 1 }];
      }

      if (sql.includes('SELECT id, is_active')) {
        assert.deepEqual(params, [1]);
        return [[{ id: 9, is_active: 1 }]];
      }

      throw new Error(`Unexpected query: ${sql}`);
    }
  };

  const router = createRolesRouter({
    withTransaction: async work => work(connection)
  });

  await withServer(createApp({ router }), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/roles/7?mode=hard`, {
      method: 'DELETE'
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.message, '角色已立即删除');
    assert.match(calls[0].sql, /DELETE FROM characters/i);
    assert.match(calls[1].sql, /SELECT id, is_active/i);
  });
});

test('DELETE /api/roles/:id returns 404 when role is already missing', async () => {
  const connection = {
    query: async (sql, params) => {
      if (sql.includes('DELETE FROM characters')) {
        assert.deepEqual(params, [7, 1]);
        return [{ affectedRows: 0 }];
      }

      if (sql.includes('SELECT id, is_active')) {
        assert.deepEqual(params, [1]);
        return [[]];
      }

      throw new Error(`Unexpected query: ${sql}`);
    }
  };

  const router = createRolesRouter({
    withTransaction: async work => work(connection)
  });

  await withServer(createApp({ router }), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/roles/7?mode=hard`, {
      method: 'DELETE'
    });
    const payload = await response.json();

    assert.equal(response.status, 404);
    assert.equal(payload.success, false);
    assert.equal(payload.error, '角色不存在');
  });
});


test('PATCH /api/roles/:id saves a chat model only on the selected role', async () => {
  const connection = {
    query: async (sql, params) => {
      if (sql.includes('SELECT id, chat_credential_id')) {
        assert.deepEqual(params, [7, 1]);
        return [[{ id: 7, chat_credential_id: null, chat_model_id: null, chat_thinking_level: 'off' }]];
      }
      if (sql.includes('INNER JOIN credential_models')) {
        assert.deepEqual(params, [12, 1, 'companion-model']);
        return [[{ id: 12, model_id: 'companion-model', capabilities: '["chat"]' }]];
      }
      if (sql.includes('UPDATE characters') && sql.includes('chat_credential_id')) {
        assert.match(sql, /chat_model_id = CASE WHEN \? = 1/);
        assert.ok(params.includes(12));
        assert.ok(params.includes('companion-model'));
        assert.ok(params.includes('low'));
        return [{ affectedRows: 1 }];
      }
      if (sql.includes('SELECT id, user_id, char_key')) {
        return [[{
          id: 7,
          user_id: 1,
          char_key: 'xiaobai',
          name: '小白',
          tag: '恋人',
          persona: '成年伴侣',
          chat_credential_id: 12,
          chat_model_id: 'companion-model',
          chat_thinking_level: 'low',
          is_active: 1,
          is_deleted: 0
        }]];
      }
      throw new Error(`Unexpected query: ${sql}`);
    }
  };

  const router = createRolesRouter({ withTransaction: async work => work(connection) });
  await withServer(createApp({ router }), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/roles/7`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_credential_id: 12,
        chat_model_id: 'companion-model',
        chat_thinking_level: 'low'
      })
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.item.chat_credential_id, 12);
    assert.equal(payload.item.chat_model_id, 'companion-model');
    assert.equal(payload.item.chat_thinking_level, 'low');
  });
});

test('PATCH /api/roles/:id clears the role model and returns to the global default', async () => {
  let updateParams;
  const connection = {
    query: async (sql, params) => {
      if (sql.includes('SELECT id, chat_credential_id')) {
        return [[{ id: 7, chat_credential_id: 12, chat_model_id: 'companion-model', chat_thinking_level: 'low' }]];
      }
      if (sql.includes('UPDATE characters') && sql.includes('chat_credential_id')) {
        updateParams = params;
        return [{ affectedRows: 1 }];
      }
      if (sql.includes('SELECT id, user_id, char_key')) {
        return [[{ id: 7, user_id: 1, name: '小白', chat_credential_id: null, chat_model_id: null, chat_thinking_level: 'off' }]];
      }
      throw new Error(`Unexpected query: ${sql}`);
    }
  };

  const router = createRolesRouter({ withTransaction: async work => work(connection) });
  await withServer(createApp({ router }), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/roles/7`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_credential_id: null, chat_model_id: null, chat_thinking_level: 'off' })
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.item.chat_credential_id, null);
    assert.equal(payload.item.chat_model_id, null);
    assert.ok(updateParams.includes(null));
  });
});
