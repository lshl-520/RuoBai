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

test('native push boot registers notification action listener before settings sheet is opened', async () => {
  const push = await readProjectFile('frontend-react', 'src', 'lib', 'push.js');
  const app = await readProjectFile('frontend-react', 'src', 'App.jsx');

  assert.match(push, /async function ensurePushListeners\(\)/);
  assert.match(push, /pushNotificationActionPerformed/);
  assert.match(push, /ensurePushListeners\(\)\.catch/);
  assert.match(app, /bootNativePushIfPossible\(\);/);
});
