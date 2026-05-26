import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs/promises';
import { createAuthRouter } from './auth.js';

function createSessionState() {
  return {};
}

function createApp(router, sessionState) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = sessionState;
    req.session.destroy = callback => {
      for (const key of Object.keys(sessionState)) {
        delete sessionState[key];
      }
      callback?.();
    };
    next();
  });
  app.use('/api/auth', router);
  app.use('/api/users', router);
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

test('register requires a valid unused invite and promotes first user to owner', async () => {
  const calls = [];
  let inviteStatus = 'unused';
  let nextUserId = 1;

  const router = createAuthRouter({
    pool: {
      query: async (sql, params) => {
        calls.push({ sql, params });

        if (sql.includes('SELECT code, status FROM invites')) {
          return [inviteStatus === 'unused'
            ? [{ code: 'RB-2026-ABC123', status: 'unused' }]
            : []];
        }

        if (sql.includes('SELECT id FROM users WHERE username = ?')) {
          return [[]];
        }

        throw new Error(`Unexpected query: ${sql}`);
      }
    },
    withTransaction: async work => work({
      query: async (sql, params) => {
        calls.push({ sql, params, tx: true });

        if (sql.includes('SELECT COUNT(*) AS total FROM users')) {
          return [[{ total: 0 }]];
        }

        if (sql.includes('INSERT INTO users')) {
          assert.equal(params[0], 'first-user');
          assert.equal(params[2], 'owner');
          return [{ insertId: nextUserId++ }];
        }

        if (sql.includes('INSERT INTO characters')) {
          assert.equal(params[1], 'xiaobai');
          assert.equal(params[2], '小白');
          assert.notEqual(String(params[4] || '').trim(), '');
          return [{ affectedRows: 1 }];
        }

        if (sql.includes('INSERT INTO model_configs')) {
          return [{ affectedRows: 1 }];
        }

        if (sql.includes('INSERT INTO user_settings')) {
          return [{ affectedRows: 1 }];
        }

        if (sql.includes('UPDATE invites') && sql.includes("SET status = 'used'")) {
          inviteStatus = 'used';
          assert.equal(params[0], 1);
          assert.equal(params[1], 'RB-2026-ABC123');
          return [{ affectedRows: 1 }];
        }

        throw new Error(`Unexpected query: ${sql}`);
      }
    })
  });

  const sessionState = createSessionState();

  await withServer(createApp(router, sessionState), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inviteCode: 'RB-2026-ABC123',
        username: 'first-user',
        password: 'secret123'
      })
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.user.role, 'owner');
    assert.equal(sessionState.role, 'owner');
    assert.ok(
      calls.some(call => call.sql.includes('UPDATE invites') && call.sql.includes("SET status = 'used'"))
    );
  });
});

test('GET /api/auth/session returns profile and stats for logged-in user', async () => {
  const router = createAuthRouter({
    pool: {
      query: async (sql, params) => {
        if (sql.includes('FROM users u') && sql.includes('WHERE u.id = ?')) {
          assert.deepEqual(params, [7]);
          return [[{
            id: 7,
            username: 'jianghu_xiaobai',
            nickname: '江湖小白',
            avatar: '/assets/avatar-squares/3.png',
            role: 'user',
            is_enabled: 1,
            created_at: '2026-05-01 08:00:00',
            last_login: '2026-05-24 11:00:00',
            character_count: 5,
            longest_companionship_days: 23,
            memory_count: 28
          }]];
        }

        throw new Error(`Unexpected query: ${sql}`);
      }
    }
  });

  const sessionState = createSessionState();
  sessionState.userId = 7;
  sessionState.username = 'jianghu_xiaobai';
  sessionState.role = 'user';

  await withServer(createApp(router, sessionState), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/auth/session`);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.loggedIn, true);
    assert.deepEqual(payload.user, {
      id: 7,
      username: 'jianghu_xiaobai',
      nickname: '江湖小白',
      avatar: '/assets/avatar-squares/3.png',
      role: 'user',
      status: 'active',
      created_at: '2026-05-01 08:00:00',
      last_login: '2026-05-24 11:00:00',
      character_count: 5,
      longest_companionship_days: 23,
      memory_count: 28
    });
  });
});

test('POST /api/auth/change-password rejects wrong old password and mismatched confirmation', async () => {
  const router = createAuthRouter({
    pool: {
      query: async (sql, params) => {
        if (sql.includes('SELECT id, username, password_hash FROM users WHERE id = ?')) {
          assert.deepEqual(params, [9]);
          return [[{
            id: 9,
            username: 'jianghu_xiaobai',
            password_hash: 'hashed-old'
          }]];
        }

        throw new Error(`Unexpected query: ${sql}`);
      }
    },
    bcryptLib: {
      compare: async () => false,
      hash: async () => 'unused'
    }
  });

  const sessionState = createSessionState();
  sessionState.userId = 9;
  sessionState.username = 'jianghu_xiaobai';
  sessionState.role = 'user';

  await withServer(createApp(router, sessionState), async baseUrl => {
    const mismatchResponse = await fetch(`${baseUrl}/api/auth/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        old_password: 'old-pass',
        new_password: 'new-pass-1',
        confirm_password: 'new-pass-2'
      })
    });
    const mismatchPayload = await mismatchResponse.json();
    assert.equal(mismatchResponse.status, 400);
    assert.equal(mismatchPayload.error, '两次新密码不一致');

    const wrongOldResponse = await fetch(`${baseUrl}/api/auth/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        old_password: 'wrong-old',
        new_password: 'new-pass-1',
        confirm_password: 'new-pass-1'
      })
    });
    const wrongOldPayload = await wrongOldResponse.json();
    assert.equal(wrongOldResponse.status, 400);
    assert.equal(wrongOldPayload.error, '旧密码不对');
  });
});

test('POST /api/auth/change-password updates password hash and clears sessions on success', async () => {
  const calls = [];
  const router = createAuthRouter({
    pool: {
      query: async (sql, params) => {
        calls.push({ sql, params });

        if (sql.includes('SELECT id, username, password_hash FROM users WHERE id = ?')) {
          return [[{
            id: 11,
            username: 'jianghu_xiaobai',
            password_hash: 'hashed-old'
          }]];
        }

        if (sql.startsWith('UPDATE users SET password_hash = ? WHERE id = ?')) {
          assert.equal(params[0], 'hashed-new');
          assert.equal(params[1], 11);
          return [{ affectedRows: 1 }];
        }

        if (sql.startsWith('DELETE FROM sessions WHERE data LIKE ?')) {
          assert.equal(params[0], '%"userId":11%');
          return [{ affectedRows: 1 }];
        }

        throw new Error(`Unexpected query: ${sql}`);
      }
    },
    bcryptLib: {
      compare: async () => true,
      hash: async () => 'hashed-new'
    }
  });

  const sessionState = createSessionState();
  sessionState.userId = 11;
  sessionState.username = 'jianghu_xiaobai';
  sessionState.role = 'user';

  await withServer(createApp(router, sessionState), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/auth/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        old_password: 'old-pass',
        new_password: 'new-pass-1',
        confirm_password: 'new-pass-1'
      })
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.message, '密码已更新');
    assert.ok(calls.some(call => call.sql.startsWith('UPDATE users SET password_hash = ? WHERE id = ?')));
    assert.ok(calls.some(call => call.sql.startsWith('DELETE FROM sessions WHERE data LIKE ?')));
  });
});

test('PATCH /api/users/me updates nickname and avatar for logged-in user', async () => {
  const calls = [];
  const router = createAuthRouter({
    pool: {
      query: async (sql, params) => {
        calls.push({ sql, params });

        if (sql.startsWith('UPDATE users SET nickname = ?, avatar = ? WHERE id = ?')) {
          assert.deepEqual(params, ['新昵称', '/assets/avatar-squares/5.png', 13]);
          return [{ affectedRows: 1 }];
        }

        if (sql.includes('SELECT id, username, nickname, avatar FROM users WHERE id = ?')) {
          assert.deepEqual(params, [13]);
          return [[{
            id: 13,
            username: 'jianghu_xiaobai',
            nickname: '新昵称',
            avatar: '/assets/avatar-squares/5.png'
          }]];
        }

        throw new Error(`Unexpected query: ${sql}`);
      }
    }
  });

  const sessionState = createSessionState();
  sessionState.userId = 13;
  sessionState.username = 'jianghu_xiaobai';
  sessionState.role = 'user';

  await withServer(createApp(router, sessionState), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/users/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nickname: '新昵称',
        avatar_url: '/assets/avatar-squares/5.png'
      })
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.deepEqual(payload.user, {
      id: 13,
      username: 'jianghu_xiaobai',
      nickname: '新昵称',
      avatar: '/assets/avatar-squares/5.png'
    });
  });
});

test('PATCH /api/users/me allows updating only nickname', async () => {
  const router = createAuthRouter({
    pool: {
      query: async (sql, params) => {
        if (sql.startsWith('SELECT id, username, nickname, avatar FROM users WHERE id = ?')) {
          if (params[0] === 15) {
            return [[{
              id: 15,
              username: 'jianghu_xiaobai',
              nickname: '旧昵称',
              avatar: '/assets/avatar-squares/2.png'
            }]];
          }
        }

        if (sql.startsWith('UPDATE users SET nickname = ? WHERE id = ?')) {
          assert.deepEqual(params, ['新昵称', 15]);
          return [{ affectedRows: 1 }];
        }

        throw new Error(`Unexpected query: ${sql}`);
      }
    }
  });

  const sessionState = createSessionState();
  sessionState.userId = 15;
  sessionState.username = 'jianghu_xiaobai';
  sessionState.role = 'user';

  await withServer(createApp(router, sessionState), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/users/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nickname: '新昵称'
      })
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.user.nickname, '旧昵称');
  });
});

test('PATCH /api/users/me allows updating only avatar', async () => {
  const router = createAuthRouter({
    pool: {
      query: async (sql, params) => {
        if (sql.startsWith('SELECT id, username, nickname, avatar FROM users WHERE id = ?')) {
          if (params[0] === 17) {
            return [[{
              id: 17,
              username: 'jianghu_xiaobai',
              nickname: '原昵称',
              avatar: '/assets/avatar-squares/2.png'
            }]];
          }
        }

        if (sql.startsWith('UPDATE users SET avatar = ? WHERE id = ?')) {
          assert.deepEqual(params, ['/assets/avatar-squares/7.png', 17]);
          return [{ affectedRows: 1 }];
        }

        throw new Error(`Unexpected query: ${sql}`);
      }
    }
  });

  const sessionState = createSessionState();
  sessionState.userId = 17;
  sessionState.username = 'jianghu_xiaobai';
  sessionState.role = 'user';

  await withServer(createApp(router, sessionState), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/users/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        avatar_url: '/assets/avatar-squares/7.png'
      })
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.user.avatar, '/assets/avatar-squares/2.png');
  });
});

test('PATCH /api/users/me accepts uploaded avatar paths under user_assets', async () => {
  const router = createAuthRouter({
    pool: {
      query: async (sql, params) => {
        if (sql.startsWith('UPDATE users SET avatar = ? WHERE id = ?')) {
          assert.deepEqual(params, ['/user_assets/avatars/17-1234567890.png', 19]);
          return [{ affectedRows: 1 }];
        }

        if (sql.startsWith('SELECT id, username, nickname, avatar FROM users WHERE id = ?')) {
          assert.deepEqual(params, [19]);
          return [[{
            id: 19,
            username: 'jianghu_xiaobai',
            nickname: '原昵称',
            avatar: '/user_assets/avatars/17-1234567890.png'
          }]];
        }

        throw new Error(`Unexpected query: ${sql}`);
      }
    }
  });

  const sessionState = createSessionState();
  sessionState.userId = 19;
  sessionState.username = 'jianghu_xiaobai';
  sessionState.role = 'user';

  await withServer(createApp(router, sessionState), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/users/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        avatar_url: '/user_assets/avatars/17-1234567890.png'
      })
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.user.avatar, '/user_assets/avatars/17-1234567890.png');
  });
});

test('POST /api/users/avatar stores uploaded image and returns a user asset path', async () => {
  const writes = [];
  const router = createAuthRouter({
    fileStorage: {
      mkdir: async dir => {
        writes.push({ type: 'mkdir', dir });
      },
      writeFile: async (filePath, content) => {
        writes.push({ type: 'write', filePath, size: content.length });
      }
    }
  });

  const sessionState = createSessionState();
  sessionState.userId = 21;
  sessionState.username = 'jianghu_xiaobai';
  sessionState.role = 'user';

  await withServer(createApp(router, sessionState), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/users/avatar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_data: 'data:image/png;base64,aGVsbG8='
      })
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.match(payload.avatar_url, /^\/user_assets\/avatars\/21-\d+\.png$/);
    assert.ok(writes.some(item => item.type === 'mkdir'));
    assert.ok(writes.some(item => item.type === 'write' && item.filePath.endsWith('.png')));
  });
});

test('PATCH /api/users/me accepts uploaded jpg and webp avatar paths under user_assets', async () => {
  const router = createAuthRouter({
    pool: {
      query: async (sql, params) => {
        if (sql.startsWith('UPDATE users SET avatar = ? WHERE id = ?')) {
          assert.ok(
            params[0] === '/user_assets/avatars/31-1234567890.jpg' ||
            params[0] === '/user_assets/avatars/31-1234567890.webp'
          );
          return [{ affectedRows: 1 }];
        }

        if (sql.startsWith('SELECT id, username, nickname, avatar FROM users WHERE id = ?')) {
          return [[{
            id: 31,
            username: 'jianghu_xiaobai',
            nickname: '原昵称',
            avatar: params[0] === 31 ? '/user_assets/avatars/31-1234567890.webp' : ''
          }]];
        }

        throw new Error(`Unexpected query: ${sql}`);
      }
    }
  });

  const sessionState = createSessionState();
  sessionState.userId = 31;
  sessionState.username = 'jianghu_xiaobai';
  sessionState.role = 'user';

  await withServer(createApp(router, sessionState), async baseUrl => {
    const jpgResponse = await fetch(`${baseUrl}/api/users/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        avatar_url: '/user_assets/avatars/31-1234567890.jpg'
      })
    });
    assert.equal(jpgResponse.status, 200);

    const webpResponse = await fetch(`${baseUrl}/api/users/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        avatar_url: '/user_assets/avatars/31-1234567890.webp'
      })
    });
    assert.equal(webpResponse.status, 200);
  });
});

test('POST /api/users/avatar stores uploaded jpg and webp images with original extensions', async () => {
  const writes = [];
  const router = createAuthRouter({
    fileStorage: {
      mkdir: async dir => {
        writes.push({ type: 'mkdir', dir });
      },
      writeFile: async (filePath, content) => {
        writes.push({ type: 'write', filePath, size: content.length });
      }
    }
  });

  const sessionState = createSessionState();
  sessionState.userId = 33;
  sessionState.username = 'jianghu_xiaobai';
  sessionState.role = 'user';

  await withServer(createApp(router, sessionState), async baseUrl => {
    const jpgResponse = await fetch(`${baseUrl}/api/users/avatar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_data: 'data:image/jpeg;base64,aGVsbG8='
      })
    });
    const jpgPayload = await jpgResponse.json();
    assert.equal(jpgResponse.status, 200);
    assert.match(jpgPayload.avatar_url, /^\/user_assets\/avatars\/33-\d+\.jpg$/);

    const webpResponse = await fetch(`${baseUrl}/api/users/avatar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_data: 'data:image/webp;base64,aGVsbG8='
      })
    });
    const webpPayload = await webpResponse.json();
    assert.equal(webpResponse.status, 200);
    assert.match(webpPayload.avatar_url, /^\/user_assets\/avatars\/33-\d+\.webp$/);

    assert.ok(writes.some(item => item.type === 'write' && item.filePath.endsWith('.jpg')));
    assert.ok(writes.some(item => item.type === 'write' && item.filePath.endsWith('.webp')));
  });
});

test('DELETE /api/users/avatar removes uploaded avatar file and clears avatar when current avatar matches', async () => {
  const calls = [];
  const router = createAuthRouter({
    pool: {
      query: async (sql, params) => {
        calls.push({ sql, params });

        if (sql.startsWith('SELECT id, username, nickname, avatar FROM users WHERE id = ?')) {
          return [[{
            id: 35,
            username: 'jianghu_xiaobai',
            nickname: '原昵称',
            avatar: '/user_assets/avatars/35-1234567890.png'
          }]];
        }

        if (sql.startsWith("UPDATE users SET avatar = '' WHERE id = ?")) {
          assert.deepEqual(params, [35]);
          return [{ affectedRows: 1 }];
        }

        throw new Error(`Unexpected query: ${sql}`);
      }
    },
    fileStorage: {
      mkdir: async () => {},
      writeFile: async () => {},
      unlink: async filePath => {
        calls.push({ unlink: filePath });
      }
    }
  });

  const sessionState = createSessionState();
  sessionState.userId = 35;
  sessionState.username = 'jianghu_xiaobai';
  sessionState.role = 'user';

  await withServer(createApp(router, sessionState), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/users/avatar`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        avatar_url: '/user_assets/avatars/35-1234567890.png'
      })
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.avatar, '');
    assert.ok(calls.some(call => call.unlink?.endsWith('35-1234567890.png')));
    assert.ok(calls.some(call => call.sql?.startsWith("UPDATE users SET avatar = '' WHERE id = ?")));
  });
});
