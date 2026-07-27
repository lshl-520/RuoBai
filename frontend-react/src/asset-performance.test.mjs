import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');

async function readProjectFile(...segments) {
  return readFile(path.join(projectRoot, ...segments), 'utf8');
}

test('common empty and avatar assets prefer optimized WebP files', async () => {
  const defaults = await readProjectFile('frontend-react', 'src', 'lib', 'default-assets.js');
  const chat = await readProjectFile('frontend-react', 'src', 'pages', 'chat.jsx');

  assert.match(defaults, /DEFAULT_USER_AVATAR\s*=\s*["']\/assets\/default-user-avatar\.webp["']/);
  assert.match(chat, /src=["']\/assets\/empty-chat\.webp["']/);
  assert.doesNotMatch(chat, /src=["']\/assets\/empty-chat\.png["']/);
  assert.match(chat, /loading="lazy" decoding="async"/);
});
