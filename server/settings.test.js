import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createSettingsRouter } from './settings.js';

function createApp(router) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.userId = 7;
    next();
  });
  app.use('/api/settings', router);
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

function createSettingsPool(initialRow = {}) {
  const calls = [];
  const row = {
    id: 1,
    user_id: 7,
    theme: 'purple',
    tts_enabled: 0,
    tts_engine: 'browser',
    tts_voice_uri: '',
    qwen_voice_id: '',
    temperature: '0.80',
    max_tokens: 2048,
    auto_moments_enabled: 0,
    auto_moments_frequency_hours: 24,
    auto_moments_quiet_enabled: 1,
    auto_moments_quiet_start: '23:00',
    auto_moments_quiet_end: '08:00',
    created_at: '2026-05-25 10:00:00',
    updated_at: '2026-05-25 10:00:00',
    ...initialRow
  };

  return {
    calls,
    row,
    async query(sql, params = []) {
      calls.push({ sql, params });

      if (sql.includes('INSERT INTO user_settings')) {
        return [{ affectedRows: 1 }];
      }

      if (sql.includes('FROM user_settings') && sql.includes('WHERE user_id = ?')) {
        assert.deepEqual(params, [7]);
        return [[{ ...row }]];
      }

      if (sql.includes('UPDATE user_settings')) {
        [
          row.theme,
          row.tts_enabled,
          row.tts_engine,
          row.tts_voice_uri,
          row.qwen_voice_id,
          row.temperature,
          row.max_tokens,
          row.auto_moments_enabled,
          row.auto_moments_frequency_hours,
          row.auto_moments_quiet_enabled,
          row.auto_moments_quiet_start,
          row.auto_moments_quiet_end
        ] = params.slice(0, 12).map((value, index) => value ?? [
          row.theme,
          row.tts_enabled,
          row.tts_engine,
          row.tts_voice_uri,
          row.qwen_voice_id,
          row.temperature,
          row.max_tokens,
          row.auto_moments_enabled,
          row.auto_moments_frequency_hours,
          row.auto_moments_quiet_enabled,
          row.auto_moments_quiet_start,
          row.auto_moments_quiet_end
        ][index]);
        assert.equal(params[12], 7);
        return [{ affectedRows: 1 }];
      }

      throw new Error(`Unexpected query: ${sql}`);
    }
  };
}

test('GET /api/settings includes auto moment defaults', async () => {
  const fakePool = createSettingsPool();
  const router = createSettingsRouter({ pool: fakePool });

  await withServer(createApp(router), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/settings`);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.item.auto_moments_enabled, 0);
    assert.equal(payload.item.auto_moments_frequency_hours, 24);
    assert.equal(payload.item.auto_moments_quiet_enabled, 1);
    assert.equal(payload.item.auto_moments_quiet_start, '23:00');
    assert.equal(payload.item.auto_moments_quiet_end, '08:00');
  });
});

test('PATCH /api/settings saves auto moment frequency and quiet hours', async () => {
  const fakePool = createSettingsPool();
  const router = createSettingsRouter({ pool: fakePool });

  await withServer(createApp(router), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auto_moments_enabled: true,
        auto_moments_frequency_hours: 6,
        auto_moments_quiet_enabled: false,
        auto_moments_quiet_start: '22:30',
        auto_moments_quiet_end: '07:15'
      })
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.item.auto_moments_enabled, 1);
    assert.equal(payload.item.auto_moments_frequency_hours, 6);
    assert.equal(payload.item.auto_moments_quiet_enabled, 0);
    assert.equal(payload.item.auto_moments_quiet_start, '22:30');
    assert.equal(payload.item.auto_moments_quiet_end, '07:15');
  });
});
