import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sniffImageFormat,
  isSupportedVisionImageFormat,
  extensionForImageFormat,
  SUPPORTED_VISION_IMAGE_FORMATS
} from './image-format.js';

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const gif = Buffer.concat([Buffer.from('GIF89a', 'ascii'), Buffer.alloc(8)]);
const webp = Buffer.concat([Buffer.from('RIFF', 'ascii'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP', 'ascii'), Buffer.alloc(4)]);
const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x1c]), Buffer.from('ftypheic', 'ascii'), Buffer.alloc(16)]);
const heifMif1 = Buffer.concat([Buffer.from([0, 0, 0, 0x1c]), Buffer.from('ftypmif1', 'ascii'), Buffer.alloc(16)]);
const avif = Buffer.concat([Buffer.from([0, 0, 0, 0x1c]), Buffer.from('ftypavif', 'ascii'), Buffer.alloc(16)]);

test('sniffImageFormat identifies real image formats by magic bytes', () => {
  assert.equal(sniffImageFormat(png), 'png');
  assert.equal(sniffImageFormat(jpeg), 'jpeg');
  assert.equal(sniffImageFormat(gif), 'gif');
  assert.equal(sniffImageFormat(webp), 'webp');
  assert.equal(sniffImageFormat(heic), 'heif');
  assert.equal(sniffImageFormat(heifMif1), 'heif');
  assert.equal(sniffImageFormat(avif), 'avif');
});

test('sniffImageFormat returns null for unknown or empty buffers', () => {
  assert.equal(sniffImageFormat(null), null);
  assert.equal(sniffImageFormat(Buffer.alloc(0)), null);
  assert.equal(sniffImageFormat(Buffer.from('not an image at all', 'ascii')), null);
});

test('only png/jpeg/webp/gif are accepted for vision models', () => {
  assert.deepEqual([...SUPPORTED_VISION_IMAGE_FORMATS], ['png', 'jpeg', 'webp', 'gif']);
  assert.equal(isSupportedVisionImageFormat('png'), true);
  assert.equal(isSupportedVisionImageFormat('jpeg'), true);
  assert.equal(isSupportedVisionImageFormat('webp'), true);
  assert.equal(isSupportedVisionImageFormat('gif'), true);
  assert.equal(isSupportedVisionImageFormat('heif'), false);
  assert.equal(isSupportedVisionImageFormat('avif'), false);
  assert.equal(isSupportedVisionImageFormat(null), false);
});

test('extensionForImageFormat maps to a safe stored extension', () => {
  assert.equal(extensionForImageFormat('png'), 'png');
  assert.equal(extensionForImageFormat('jpeg'), 'jpg');
  assert.equal(extensionForImageFormat('webp'), 'webp');
  assert.equal(extensionForImageFormat('gif'), 'gif');
  assert.equal(extensionForImageFormat('heif'), null);
  assert.equal(extensionForImageFormat('nope'), null);
});
