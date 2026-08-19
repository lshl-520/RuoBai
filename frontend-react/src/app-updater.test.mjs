import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('./lib/app-updater.js', import.meta.url), 'utf8');

test('legacy Android shell can discover version two and fall back to browser download', () => {
  assert.match(source, /versionCode: 1, versionName: "1\.0"/);
  assert.match(source, /window\.location\.assign\(update\.apkUrl\)/);
  assert.match(source, /not implemented\|unavailable\|not available/);
});
