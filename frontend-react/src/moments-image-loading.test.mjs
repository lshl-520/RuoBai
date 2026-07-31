import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('./pages/moments.jsx', import.meta.url), 'utf8');

test('stored moment images use cached thumbnails while local data images stay local', () => {
  assert.match(source, /function getMomentImageSource/);
  assert.match(source, /startsWith\("\/user_assets\/chat\/"\)/);
  assert.match(source, /return `\/api\/media\/\$\{variant\}\?path=\$\{encodeURIComponent\(value\)\}`/);
  assert.match(source, /src=\{getMomentImageSource\(src, "thumbnail"\)\}/);
  assert.match(source, /loading="lazy"/);
  assert.match(source, /decoding="async"/);
});

test('moment images can open the original in a full-screen preview', () => {
  assert.match(source, /className="m-img-button"/);
  assert.match(source, /function MomentImagePreview/);
  assert.match(source, /className="chat-image-preview"/);
  assert.match(source, /src=\{getMomentImageSource\(src, "preview"\)\}/);
  assert.match(source, /打开原图/);
});
