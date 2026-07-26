import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { requireAuth, requireOwner } from './middleware.js';
import { createAdminRouter } from './admin.js';

function createApp({
  sessionUser = { userId: 1, username: 'owner', role: 'owner' },
  router
}) {
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
  app.use('/api/admin', requireAuth, requireOwner, router);
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

test('owner can list invites', async () => {
  const router = createAdminRouter({
    pool: {
      query: async (sql, params) => {
        if (sql.includes('FROM invites')) {
          assert.deepEqual(params, []);
          return [[{
            code: 'RB-2026-ABC123',
            note: 'seed',
            status: 'unused',
            created_at: '2026-05-22 10:00:00',
            used_by: null,
            used_at: null
          }]];
        }

        throw new Error(`Unexpected query: ${sql}`);
      }
    }
  });

  await withServer(createApp({ router }), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/admin/invites`);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.items.length, 1);
    assert.equal(payload.items[0].code, 'RB-2026-ABC123');
  });
});

test('non-owner gets 403 for admin routes', async () => {
  const router = createAdminRouter({
    pool: {
      query: async () => {
        throw new Error('pool should not be called');
      }
    }
  });

  await withServer(
    createApp({
      router,
      sessionUser: { userId: 9, username: 'user', role: 'user' }
    }),
    async baseUrl => {
      const response = await fetch(`${baseUrl}/api/admin/invites`);
      const payload = await response.json();

      assert.equal(response.status, 403);
      assert.equal(payload.success, false);
    }
  );
});

test('owner can generate invite', async () => {
  const router = createAdminRouter({
    pool: {
      query: async (sql, params) => {
        if (sql.includes('INSERT INTO invites')) {
          assert.match(params[0], /^RB-\d{4}-[A-Z0-9]{6}$/);
          assert.equal(params[1], 'beta');
          return [{ affectedRows: 1 }];
        }

        if (sql.includes('SELECT code, note, status, created_at, used_by, used_at')) {
          return [[{
            code: params[0],
            note: 'beta',
            status: 'unused',
            created_at: '2026-05-22 10:00:00',
            used_by: null,
            used_at: null
          }]];
        }

        throw new Error(`Unexpected query: ${sql}`);
      }
    }
  });

  await withServer(createApp({ router }), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/admin/invites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: 'beta' })
    });
    const payload = await response.json();

    assert.equal(response.status, 201);
    assert.equal(payload.success, true);
    assert.match(payload.item.code, /^RB-\d{4}-[A-Z0-9]{6}$/);
    assert.equal(payload.item.note, 'beta');
  });
});

test('owner can revoke invite', async () => {
  const router = createAdminRouter({
    pool: {
      query: async (sql, params) => {
        if (sql.includes('UPDATE invites SET status = \'revoked\'')) {
          assert.deepEqual(params, ['RB-2026-ABC123']);
          return [{ affectedRows: 1 }];
        }

        throw new Error(`Unexpected query: ${sql}`);
      }
    }
  });

  await withServer(createApp({ router }), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/admin/invites/RB-2026-ABC123`, {
      method: 'DELETE'
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
  });
});

test('owner system status includes an honest vector memory diagnostic', async () => {
  const router = createAdminRouter({
    pool: {
      query: async (sql) => {
        if (sql.includes('SELECT VERSION()')) return [[{ version: '8.0' }]];
        if (sql.includes('COUNT(*) as count FROM users')) return [[{ count: 2 }]];
        if (sql.includes('COUNT(*) as count FROM characters')) return [[{ count: 3 }]];
        throw new Error(`Unexpected query: ${sql}`);
      }
    },
    vectorMemoryStatus: async () => ({
      status: 'degraded',
      summary: '已降级，向量库没有启动，聊天不会使用旧回忆。',
      history: { status: 'unknown', chunks: null }
    })
  });

  await withServer(createApp({ router }), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/admin/system/status`);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.data.vector_memory.status, 'degraded');
    assert.match(payload.data.vector_memory.summary, /聊天不会使用旧回忆/);
  });
});
