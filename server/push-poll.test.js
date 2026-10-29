import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { createPushPollRouter, createPushPollKeyRouter, generatePollKey } from './push-poll.js';

function createApp({ pool, userId = 7 }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (userId) req.userId = userId;
    next();
  });
  app.use('/api/push/poll', createPushPollRouter({ pool }));
  app.use('/api/push', createPushPollKeyRouter({ pool }));
  return app;
}

function createPool({ device = null, items = [], maxId = 42 } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('FROM push_poll_devices') && sql.includes('poll_key')) {
        return [device ? [device] : []];
      }
      if (sql.includes('COALESCE(MAX(id), 0)')) {
        return [[{ max_id: maxId }]];
      }
      if (sql.includes('FROM proactive_events e')) {
        return [items];
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

/**
 * ═══ 不依赖谷歌的通知通道（2026/9/21）═══
 *
 * 背景：FCM 必须走 Google 的长连接，用户网络下这条路是断的，
 * 服务器报成功但手机收不到。这组测试锁住备用通道的几条硬规则。
 */
test('★ 设备密钥无效时不能泄漏任何消息', async () => {
  const pool = createPool({ device: null });
  const app = createApp({ pool });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/push/poll/pending?since=0`, {
      headers: { 'x-device-key': 'a'.repeat(64) },
    });
    const payload = await response.json();

    assert.equal(response.status, 401);
    assert.equal(payload.success, false);
    assert.equal(payload.items, undefined);
  });
});

test('★ 第一次拉取只报进度、不补历史（避免糊用户一脸旧消息）', async () => {
  const pool = createPool({ device: { user_id: 19 }, maxId: 77 });
  const app = createApp({ pool });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/push/poll/pending`, {
      headers: { 'x-device-key': 'a'.repeat(64) },
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(payload.items, []);
    assert.equal(payload.cursor, 77);
    assert.ok(!pool.calls.some((call) => call.sql.includes('FROM proactive_events e')));
  });
});

test('★ 带 since 时才返回新消息，并把 cursor 推进到最后一条', async () => {
  const pool = createPool({
    device: { user_id: 19 },
    items: [
      { id: 10, character_id: 48, content: '在忙什么呀', character_name: '小白', created_at: '2026-09-21 10:00:00' },
      { id: 12, character_id: 48, content: '记得吃饭', character_name: '小白', created_at: '2026-09-21 11:00:00' },
    ],
  });
  const app = createApp({ pool });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/push/poll/pending?since=9`, {
      headers: { 'x-device-key': 'a'.repeat(64) },
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.items.length, 2);
    assert.equal(payload.items[0].body, '在忙什么呀');
    assert.equal(payload.cursor, 12);
    const query = pool.calls.find((call) => call.sql.includes('FROM proactive_events e'));
    assert.deepEqual(query.params.slice(0, 2), [19, 9]);
  });
});

test('★ 没有新消息时 cursor 不动，避免跳过消息', async () => {
  const pool = createPool({ device: { user_id: 19 }, items: [] });
  const app = createApp({ pool });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/push/poll/pending?since=33`, {
      headers: { 'x-device-key': 'a'.repeat(64) },
    });
    const payload = await response.json();

    assert.equal(payload.cursor, 33);
    assert.deepEqual(payload.items, []);
  });
});

test('★ 领钥匙要登录，未登录拿不到', async () => {
  const pool = createPool();
  const app = createApp({ pool, userId: null });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/push/poll-key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: 'android' }),
    });
    assert.equal(response.status, 401);
  });
});

test('★ 领钥匙下发 64 位随机串并落库（按用户唯一，换钥匙即旧钥匙失效）', async () => {
  const pool = createPool();
  const app = createApp({ pool });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/push/poll-key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: 'android' }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.match(payload.key, /^[0-9a-f]{64}$/);
    const insert = pool.calls.find((call) => call.sql.includes('INSERT INTO push_poll_devices'));
    assert.ok(insert, '必须把密钥写进 push_poll_devices');
    assert.match(insert.sql, /ON DUPLICATE KEY UPDATE/);
    assert.match(insert.sql, /poll_key = VALUES\(poll_key\)/);
    assert.deepEqual(insert.params, [7, payload.key, 'android']);
  });
});

test('★ 生成器每次都给不同的钥匙', () => {
  const keys = new Set(Array.from({ length: 20 }, () => generatePollKey()));
  assert.equal(keys.size, 20);
  for (const key of keys) assert.match(key, /^[0-9a-f]{64}$/);
});
