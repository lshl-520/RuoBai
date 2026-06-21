import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { createPushRouter } from './push.js';

function createApp({ pool, userId = 7 }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (userId) req.userId = userId;
    next();
  });
  app.use('/api/push', createPushRouter({ pool }));
  return app;
}

function createPool() {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('SELECT proactive_enabled')) {
        return [[{
          proactive_enabled: 1,
          bedtime_enabled: 1,
          quiet_night_enabled: 0,
        }]];
      }
      return [{ affectedRows: 1, insertId: 1 }];
    },
  };
}

async function withServer(app, run) {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('POST /api/push/devices rejects missing auth', async () => {
  const app = createApp({ pool: createPool(), userId: null });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/push/devices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'token-a', platform: 'android' }),
    });
    const payload = await response.json();

    assert.equal(response.status, 401);
    assert.equal(payload.success, false);
  });
});

test('POST /api/push/devices upserts token for current user', async () => {
  const pool = createPool();
  const app = createApp({ pool });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/push/devices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'token-a', platform: 'android', app_version: '1.0.0' }),
    });
    const payload = await response.json();

    assert.equal(response.status, 201);
    assert.equal(payload.success, true);
    assert.ok(pool.calls.some((call) => call.sql.includes('ON DUPLICATE KEY UPDATE')));
    assert.deepEqual(pool.calls[0].params.slice(0, 4), [7, 'token-a', 'android', '1.0.0']);
  });
});

test('PATCH /api/push/preferences stores boolean preferences', async () => {
  const pool = createPool();
  const app = createApp({ pool });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/push/preferences`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proactive_enabled: false, bedtime_enabled: true, quiet_night_enabled: true }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.ok(pool.calls.some((call) => call.sql.includes('INSERT INTO push_preferences')));
  });
});

test('POST /api/push/heartbeat updates current token activity', async () => {
  const pool = createPool();
  const app = createApp({ pool });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/push/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'token-a' }),
    });

    assert.equal(response.status, 200);
    assert.ok(pool.calls.some((call) => call.sql.includes('last_seen_at = NOW()')));
  });
});
