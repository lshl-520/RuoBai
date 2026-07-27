import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('./pages/moments.jsx', import.meta.url), 'utf8');

test('moment images use cached thumbnails and lazy loading', () => {
  assert.match(source, /\/api\/media\/thumbnail\?path=/);
  assert.match(source, /loading="lazy"/);
  assert.match(source, /decoding="async"/);
});

test('moment images can open the original in a full-screen preview', () => {
  assert.match(source, /className="m-img-button"/);
  assert.match(source, /function MomentImagePreview/);
  assert.match(source, /className="chat-image-preview"/);
  assert.match(source, /\/api\/media\/preview\?path=/);
  assert.match(source, /打开原图/);
});
