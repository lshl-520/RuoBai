import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs/promises';
import { requireAuth } from './middleware.js';
import { createChatRouter } from './chat.js';

function createApp({ router, sessionUser = { userId: 21, username: 'user-21', role: 'user' } }) {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
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
  app.use('/api/chat', requireAuth, router);
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

test('POST /api/chat/upload-image stores uploaded image under user_assets/chat', async () => {
  const writes = [];
  const router = createChatRouter({
    fileStorage: {
      mkdir: async dir => {
        writes.push({ type: 'mkdir', dir });
      },
      writeFile: async (filePath, content) => {
        writes.push({ type: 'write', filePath, size: content.length });
      }
    }
  });

  await withServer(createApp({ router }), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/chat/upload-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // 2026/10/19：上传改成按真实文件头验格式，这里必须用真图（1x1 PNG）。
        image_data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
      })
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.match(payload.media_url, /^\/user_assets\/chat\/21-\d+\.png$/);
    assert.ok(writes.some(item => item.type === 'mkdir'));
    assert.ok(writes.some(item => item.type === 'write' && item.filePath.endsWith('.png')));
  });
});

test('POST /api/chat/upload-image rejects HEIC/HEIF even when the MIME claims PNG', async () => {
  const router = createChatRouter();
  const heicBytes = Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x1c]),
    Buffer.from('ftypheic', 'ascii'),
    Buffer.alloc(16)
  ]);

  await withServer(createApp({ router }), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/chat/upload-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_data: 'data:image/png;base64,' + heicBytes.toString('base64')
      })
    });
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.equal(payload.success, false);
    assert.match(payload.error, /HEIC|HEIF/);
  });
});

test('POST /api/chat/upload-voice keeps WAV audio as a WAV file', async () => {
  const writes = [];
  const router = createChatRouter({
    fileStorage: {
      mkdir: async () => {},
      writeFile: async (filePath, content) => {
        writes.push({ filePath, size: content.length });
      }
    }
  });

  await withServer(createApp({ router }), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/chat/upload-voice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audio_data: 'data:audio/wav;base64,UklGRg=='
      })
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.match(payload.audio_url, /^\/user_assets\/voice\/21-\d+\.wav$/);
    assert.ok(writes.some(item => item.filePath.endsWith('.wav') && item.size > 0));
  });
});
