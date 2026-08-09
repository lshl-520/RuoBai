import test from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import express from 'express';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { requireAuth } from './middleware.js';
import { createRolesRouter } from './roles.js';
import { inspectLive2DEntries, inspectLive2DArchive } from './live2d-assets.js';

function fakeEntry(name, content) {
  const data = Buffer.from(content);
  return {
    entryName: name,
    isDirectory: false,
    header: { size: data.length, compressedSize: data.length },
    data
  };
}

function readFakeEntry(entry) {
  return entry.data;
}

function createMinimalArchive() {
  const zip = new AdmZip();
  zip.addFile('mouse/model.model3.json', Buffer.from(JSON.stringify({
    Version: 3,
    FileReferences: {
      Moc: 'model.moc3',
      Textures: ['texture.png']
    }
  })));
  zip.addFile('mouse/model.moc3', Buffer.from('moc3'));
  zip.addFile('mouse/texture.png', Buffer.from('png'));
  zip.addFile('mouse/preview.png', Buffer.from('preview'));
  return zip;
}

test('Live2D archive inspection accepts model references and finds a preview', () => {
  const model = fakeEntry('mouse/model.model3.json', JSON.stringify({
    Version: 3,
    FileReferences: { Moc: 'model.moc3', Textures: ['texture.png'] }
  }));
  const moc = fakeEntry('mouse/model.moc3', 'moc3');
  const texture = fakeEntry('mouse/texture.png', 'png');
  const preview = fakeEntry('mouse/preview.png', 'preview');
  const result = inspectLive2DEntries([model, moc, texture, preview], readFakeEntry);

  assert.equal(result.modelPath, 'mouse/model.model3.json');
  assert.equal(result.previewPath, 'mouse/preview.png');
  assert.equal(result.fileCount, 4);
});

test('Live2D archive inspection ignores Baidu Netdisk upload markers', () => {
  const model = fakeEntry('mouse/model.model3.json', JSON.stringify({
    Version: 3,
    FileReferences: { Moc: 'model.moc3', Textures: ['texture.png'] }
  }));
  const result = inspectLive2DEntries([
    model,
    fakeEntry('mouse/model.moc3', 'moc3'),
    fakeEntry('mouse/texture.png', 'png'),
    fakeEntry('mouse/preview.png', 'preview'),
    fakeEntry('mouse/model.moc3.baiduyun.uploading.cfg', 'progress')
  ], readFakeEntry);

  assert.equal(result.fileCount, 4);
});

test('Live2D archive inspection rejects traversal and executable files', () => {
  assert.throws(
    () => inspectLive2DEntries([fakeEntry('../escape.model3.json', '{}')], readFakeEntry),
    /不安全|越界/
  );
  assert.throws(
    () => inspectLive2DEntries([fakeEntry('mouse/model.model3.json', '{}'), fakeEntry('mouse/run.exe', 'x')], readFakeEntry),
    /不支持的文件/
  );
});

test('POST /api/roles/:id/live2d-asset validates and binds a user-owned model package', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ruobai-live2d-route-'));
  const archivePath = path.join(root, 'model.zip');
  const live2dAssetDir = path.join(root, 'assets');
  const live2dTempDir = path.join(root, 'tmp');
  createMinimalArchive().writeZip(archivePath);

  const updates = [];
  const router = createRolesRouter({
    pool: {
      query: async (sql, params) => {
        if (sql.includes('SELECT id, live2d_asset_id')) return [[{ id: 53, live2d_asset_id: null }]];
        if (sql.includes('UPDATE characters') && sql.includes('live2d_manifest')) {
          updates.push({ sql, params });
          return [{ affectedRows: 1 }];
        }
        throw new Error(`Unexpected query: ${sql}`);
      }
    },
    live2dAssetDir,
    live2dTempDir,
    now: () => 1770000000000
  });
  const app = express();
  app.use((req, _res, next) => {
    req.session = { userId: 19, username: 'tester', role: 'user' };
    next();
  });
  app.use('/api/roles', requireAuth, router);
  app.use((error, _req, res, _next) => res.status(500).json({ success: false, error: error.message }));

  const server = app.listen(0);
  try {
    const { port } = server.address();
    const body = new FormData();
    body.append('file', new Blob([await fs.readFile(archivePath)], { type: 'application/zip' }), 'model.zip');
    const response = await fetch(`http://127.0.0.1:${port}/api/roles/53/live2d-asset`, { method: 'POST', body });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.match(payload.asset.model_url, /model\.model3\.json/);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].params[1], payload.asset.asset_id);
    assert.equal(payload.asset.manifest.fileCount, 4);
    assert.equal(await fs.stat(path.join(live2dAssetDir, '19', '53', payload.asset.asset_id, 'mouse', 'model.model3.json')).then(() => true), true);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('inspectLive2DArchive reads a real temporary zip', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ruobai-live2d-inspect-'));
  const archivePath = path.join(root, 'model.zip');
  createMinimalArchive().writeZip(archivePath);
  const result = await inspectLive2DArchive(archivePath);
  assert.equal(result.modelPath, 'mouse/model.model3.json');
  await fs.rm(root, { recursive: true, force: true });
});
