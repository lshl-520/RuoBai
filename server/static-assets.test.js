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

test('frontend fallback does not require the moved legacy archive', async () => {
  const server = await readFile(path.join(projectRoot, 'server', 'server.js'), 'utf8');

  assert.match(server, /const legacyIndexFile = path\.join\(legacyPublicDir, 'index\.html'\)/);
  assert.match(server, /const hasLegacyBuild = fs\.existsSync\(legacyIndexFile\)/);
  assert.match(server, /const serveLegacyFrontend = hasLegacyBuild &&/);
  assert.match(server, /const activeFrontendIndex = serveLegacyFrontend \? legacyIndexFile : reactIndexFile/);
  assert.match(server, /前端构建不存在，请先运行 frontend-react 的 npm run build/);
});
