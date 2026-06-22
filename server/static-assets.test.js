import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '..');

test('static image responses are not gzip-compressed again', async () => {
  const server = await readFile(path.join(projectRoot, 'server', 'server.js'), 'utf8');

  assert.match(server, /SKIP_COMPRESSION_EXTENSIONS/);
  assert.match(server, /compression\.filter\(req,\s*res\)/);
  assert.match(server, /webp\|png\|jpe\?g/);
});
