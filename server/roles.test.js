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
    auto_moments_daily_max: 6,
    auto_moments_min_interval_hours: 4,
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
        assert.equal(params.includes(6), true);
        assert.equal(params.includes(4), true);
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
        auto_moments_daily_max: 6,
        auto_moments_min_interval_hours: 4
      })
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.item.auto_moments_enabled, 1);
    assert.equal(payload.item.auto_moments_daily_min, 2);
    assert.equal(payload.item.auto_moments_daily_max, 6);
    assert.equal(payload.item.auto_moments_min_interval_hours, 4);
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
