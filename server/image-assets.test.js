import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {
  ensureThumbnail,
  resolveChatImagePath,
  saveOptimizedImage,
  thumbnailFilename
} from './image-assets.js';

test('chat image paths only accept safe image filenames', () => {
  assert.equal(resolveChatImagePath('/user_assets/chat/../../server/.env'), null);
  assert.equal(resolveChatImagePath('/user_assets/avatar/photo.png'), null);
  assert.equal(resolveChatImagePath('/user_assets/chat/not-an-image.txt'), null);
  assert.equal(thumbnailFilename('old-photo.PNG'), 'old-photo.thumb.webp');

  const resolved = resolveChatImagePath('/user_assets/chat/old-photo.PNG?cache=1');
  assert.equal(resolved?.filename, 'old-photo.PNG');
  assert.equal(resolved?.thumbnailName, 'old-photo.thumb.webp');
});

test('new generated images are stored as a bounded webp and a smaller thumbnail', async () => {
  const source = await sharp({
    create: { width: 1800, height: 1200, channels: 3, background: '#d8a5ba' }
  }).png().toBuffer();
  const writes = [];

  const publicPath = await saveOptimizedImage(source, 'draw-test', {
    fileStorage: {
      mkdir: async () => {},
      writeFile: async (filePath, buffer) => writes.push({ filePath, buffer })
    }
  });

  assert.equal(publicPath, '/user_assets/chat/draw-test.webp');
  assert.equal(writes.length, 2);
  const high = writes.find(item => item.filePath.endsWith('draw-test.webp'));
  const thumb = writes.find(item => item.filePath.endsWith('draw-test.thumb.webp'));
  const highMeta = await sharp(high.buffer).metadata();
  const thumbMeta = await sharp(thumb.buffer).metadata();
  assert.equal(highMeta.format, 'webp');
  assert.ok(Math.max(highMeta.width, highMeta.height) <= 1600);
  assert.ok(Math.max(thumbMeta.width, thumbMeta.height) <= 640);
  assert.ok(thumb.buffer.length < high.buffer.length);
});

test('old image thumbnails are created once and then reused', async () => {
  let thumbnailExists = false;
  let conversions = 0;
  const fileStorage = {
    access: async filePath => {
      if (filePath.endsWith('.thumb.webp') && !thumbnailExists) {
        const error = new Error('missing');
        error.code = 'ENOENT';
        throw error;
      }
    }
  };
  const sharpImpl = () => ({
    rotate() { return this; },
    resize() { return this; },
    webp() { return this; },
    async toFile() {
      conversions += 1;
      thumbnailExists = true;
    }
  });

  const first = await ensureThumbnail('/user_assets/chat/legacy.png', { fileStorage, sharpImpl });
  const second = await ensureThumbnail('/user_assets/chat/legacy.png', { fileStorage, sharpImpl });
  assert.equal(first, second);
  assert.equal(conversions, 1);
});
