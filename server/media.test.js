import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import express from 'express';
import { createMediaRouter } from './media.js';

test('thumbnail endpoint rejects an unsafe source path', async () => {
  const app = express();
  app.use('/api/media', createMediaRouter());
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/media/thumbnail?path=${encodeURIComponent('/user_assets/chat/../../server/.env')}`);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /不合法/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('thumbnail endpoint serves a generated webp with private caching', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ruobai-media-'));
  const thumbnailPath = path.join(tempDir, 'thumb.webp');
  await fs.writeFile(thumbnailPath, Buffer.from('fake-webp'));
  const app = express();
  app.use('/api/media', createMediaRouter({ ensureThumbnail: async () => thumbnailPath }));
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/media/thumbnail?path=${encodeURIComponent('/user_assets/chat/photo.png')}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/webp');
    assert.match(response.headers.get('cache-control'), /max-age=86400/);
    assert.equal(Buffer.from(await response.arrayBuffer()).toString(), 'fake-webp');
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('preview endpoint serves the lightweight display image', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ruobai-preview-'));
  const previewPath = path.join(tempDir, 'preview.webp');
  await fs.writeFile(previewPath, Buffer.from('preview-webp'));
  const app = express();
  app.use('/api/media', createMediaRouter({ ensurePreview: async () => previewPath }));
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/media/preview?path=${encodeURIComponent('/user_assets/chat/old.png')}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/webp');
    assert.equal(Buffer.from(await response.arrayBuffer()).toString(), 'preview-webp');
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
