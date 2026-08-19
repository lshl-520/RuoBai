import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createAppUpdatesRouter } from './app-updates.js';

async function withServer(router, run) {
  const app = express();
  app.use('/api/app-updates', router);
  const server = app.listen(0);
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('android update manifest exposes only configured HTTPS releases', async () => {
  const router = createAppUpdatesRouter({
    latestVersionCode: 2,
    latestVersionName: '1.1.0',
    apkUrl: 'https://lshl.fun/downloads/ruobai-1.1.0.apk',
    apkSha256: 'ABCD',
    releaseNotes: '更新说明',
    required: false
  });
  await withServer(router, async baseUrl => {
    const response = await fetch(`${baseUrl}/api/app-updates/android`);
    const payload = await response.json();
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(payload.update.versionCode, 2);
    assert.equal(payload.update.sha256, 'abcd');
    assert.equal(payload.update.required, false);
  });
});

test('android update manifest stays empty until an APK is configured', async () => {
  await withServer(createAppUpdatesRouter({}), async baseUrl => {
    const payload = await (await fetch(`${baseUrl}/api/app-updates/android`)).json();
    assert.equal(payload.update, null);
  });
});
