import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createAutoMomentsRouter } from './auto-moments-routes.js';

function createApp(router) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.userId = 7;
    next();
  });
  app.use('/api/auto-moments', router);
  app.use((error, _req, res, _next) => {
    res.status(500).json({ success: false, error: error.message });
  });
  return app;
}

async function withServer(app, run) {
  const server = app.listen(0);
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('渠道试发只运行当前用户已开启的角色，不走聊天规划或频率冷却', async () => {
  const calls = [];
  const router = createAutoMomentsRouter({
    pool: {
      query: async (sql, params) => {
        calls.push({ sql, params });
        assert.match(sql, /FROM characters/);
        assert.deepEqual(params, [12, 7]);
        return [[{ id: 12, name: '小白', auto_moments_enabled: 1 }]];
      }
    },
    service: {
      runScan: async options => {
        assert.deepEqual(options, { characterId: 12, ignoreLimits: true, forceChannelTest: true });
        return [{ characterId: 12, status: 'posted', imageStatus: 'generated' }];
      }
    }
  });

  await withServer(createApp(router), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/auto-moments/characters/12/test`, { method: 'POST' });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.message, '动态发图渠道正常：已发出一条测试图文动态');
    assert.equal(calls.length, 1);
  });
});

test('手动试发拒绝未开启主动动态的角色', async () => {
  const router = createAutoMomentsRouter({
    pool: {
      query: async () => [[{ id: 12, name: '小白', auto_moments_enabled: 0 }]]
    },
    service: {
      runScan: async () => {
        throw new Error('不应调用');
      }
    }
  });

  await withServer(createApp(router), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/auto-moments/characters/12/test`, { method: 'POST' });
    const payload = await response.json();
    assert.equal(response.status, 400);
    assert.equal(payload.error, '请先保存并开启主动发动态');
  });
});
