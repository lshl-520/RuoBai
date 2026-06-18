import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createAdminRouter } from './admin.js';
import { requireAuth, requireOwner } from './middleware.js';
import { createUpdateService } from './admin-update.js';

function createApp({ updateService }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { userId: 1, username: 'owner', role: 'owner' };
    next();
  });
  app.use('/api/admin', requireAuth, requireOwner, createAdminRouter({
    pool: { query: async () => { throw new Error('pool should not be used'); } },
    updateService
  }));
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

test('update check compares local HEAD with origin/main and lists changed files', async () => {
  const calls = [];
  const service = createUpdateService({
    projectRoot: '/app',
    now: () => new Date('2026-05-27T01:00:00.000Z'),
    runCommand: async (command, args) => {
      calls.push([command, ...args].join(' '));
      const key = [command, ...args].join(' ');
      if (key === 'git fetch origin main') return { stdout: '' };
      if (key === 'git rev-parse HEAD') return { stdout: 'aaa111\n' };
      if (key === 'git rev-parse origin/main') return { stdout: 'bbb222\n' };
      if (key === 'git show -s --format=%cI HEAD') return { stdout: '2026-05-26T01:00:00+08:00\n' };
      if (key === 'git show -s --format=%cI origin/main') return { stdout: '2026-05-27T01:00:00+08:00\n' };
      if (key === 'git rev-list --count HEAD..origin/main') return { stdout: '2\n' };
      if (key === 'git diff --name-only HEAD..origin/main') return { stdout: 'server/admin.js\npublic/admin.html\n' };
      throw new Error(`Unexpected command: ${key}`);
    }
  });

  const result = await service.checkForUpdates();

  assert.deepEqual(calls.slice(0, 2), ['git fetch origin main', 'git rev-parse HEAD']);
  assert.equal(result.is_behind, true);
  assert.equal(result.current.hash, 'aaa111');
  assert.equal(result.remote.hash, 'bbb222');
  assert.equal(result.behind_count, 2);
  assert.deepEqual(result.changed_files, ['server/admin.js', 'public/admin.html']);
  assert.match(result.time_since_current, /1 天/);
});

test('docker deploy mode disables git based update flow with a clear message', async () => {
  const service = createUpdateService({
    deployMode: 'docker',
    runCommand: async () => {
      throw new Error('git commands should not run in docker deploy mode');
    }
  });

  const checkResult = await service.checkForUpdates();
  assert.equal(checkResult.disabled, true);
  assert.equal(checkResult.deploy_mode, 'docker');
  assert.equal(checkResult.is_behind, false);
  assert.match(checkResult.message, /Docker 部署模式/);

  await assert.rejects(
    () => service.applyUpdate(),
    /Docker 部署模式/
  );
});

test('update apply backs up database before pulling code and reloads pm2 after health check', async () => {
  const calls = [];
  const service = createUpdateService({
    projectRoot: '/app',
    backupDir: '/app/_manual_backups',
    appName: 'ruobai',
    dbConfig: {
      host: 'localhost',
      port: 3306,
      user: 'root',
      password: 'secret',
      database: 'ruobai'
    },
    now: () => new Date('2026-05-27T01:02:03.000Z'),
    fileSystem: {
      mkdir: async () => {},
      readdir: async () => [],
      stat: async () => ({ mtimeMs: Date.now() }),
      unlink: async () => {},
      readFile: async () => '[]',
      writeFile: async () => {}
    },
    healthCheck: async () => ({ ok: true }),
    runCommand: async (command, args) => {
      calls.push([command, ...args].join(' '));
      const key = [command, ...args].join(' ');
      if (command === 'mysqldump') return { stdout: '' };
      if (key === 'git rev-parse HEAD') return { stdout: 'old111\n' };
      if (key === 'git pull --ff-only origin main') return { stdout: 'updated\n' };
      if (key === 'git diff --name-only old111 HEAD') return { stdout: 'server/package.json\nfrontend-react/src/App.jsx\nfrontend-react/package.json\n' };
      if (key === 'npm install --production') return { stdout: '' };
      if (key === 'npm install') return { stdout: '' };
      if (key === 'npm run build') return { stdout: '' };
      if (key === 'node server/init-db.js') return { stdout: '' };
      if (key === 'pm2 reload ruobai') return { stdout: '' };
      if (key === 'git rev-parse HEAD') return { stdout: 'new222\n' };
      throw new Error(`Unexpected command: ${key}`);
    }
  });

  const result = await service.applyUpdate();

  assert.equal(result.success, true);
  assert.equal(result.previous_hash, 'old111');
  assert.equal(result.backup_file, '/app/_manual_backups/update-20260527-010203.sql');
  assert.equal(result.server_package_changed, true);
  assert.equal(result.frontend_package_changed, true);
  assert.equal(result.frontend_built, true);
  assert.ok(calls.indexOf('mysqldump --host localhost --port 3306 --user root --single-transaction --routines --triggers ruobai') < calls.indexOf('git pull --ff-only origin main'));
  assert.ok(calls.includes('npm install --production'));
  assert.ok(calls.includes('npm install'));
  assert.ok(calls.includes('npm run build'));
  assert.ok(calls.includes('node server/init-db.js'));
  assert.ok(calls.includes('pm2 reload ruobai'));
});

test('admin update routes delegate to update service', async () => {
  const updateService = {
    checkForUpdates: async () => ({ is_behind: false, current: { hash: 'aaa' }, remote: { hash: 'aaa' } }),
    applyUpdate: async () => ({ success: true, new_hash: 'bbb', duration_ms: 12 }),
    listHistory: async () => [{ status: 'success', new_hash: 'bbb' }]
  };

  await withServer(createApp({ updateService }), async baseUrl => {
    const checkResponse = await fetch(`${baseUrl}/api/admin/update-check`, { method: 'POST' });
    const checkPayload = await checkResponse.json();
    assert.equal(checkResponse.status, 200);
    assert.equal(checkPayload.success, true);
    assert.equal(checkPayload.data.is_behind, false);

    const applyResponse = await fetch(`${baseUrl}/api/admin/update-apply`, { method: 'POST' });
    const applyPayload = await applyResponse.json();
    assert.equal(applyResponse.status, 200);
    assert.equal(applyPayload.success, true);
    assert.equal(applyPayload.data.new_hash, 'bbb');

    const historyResponse = await fetch(`${baseUrl}/api/admin/update-history`);
    const historyPayload = await historyResponse.json();
    assert.equal(historyResponse.status, 200);
    assert.equal(historyPayload.items.length, 1);
  });
});
