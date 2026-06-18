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

test('auth failures surface a global toast in addition to inline copy', async () => {
  const auth = await readProjectFile('frontend-react', 'src', 'pages', 'auth.jsx');
  const app = await readProjectFile('frontend-react', 'src', 'App.jsx');
  const css = await readProjectFile('frontend-react', 'src', 'styles', 'components2.css');

  assert.match(auth, /function AuthScreen\(\{\s*onEnter,\s*notify\s*\}\)/);
  assert.match(auth, /notify\?\.\(\{\s*type:\s*"error"/);
  assert.match(app, /function AppToast/);
  assert.match(app, /<AppToast toast=\{toast\} onClose=\{\(\) => setToast\(null\)\} \/>/);
  assert.match(css, /\.app-toast-stack/);
  assert.match(css, /\.app-toast-progress/);
});

test('admin shortcut route sends new users to the real admin gate instead of React fallback', async () => {
  const server = await readProjectFile('server', 'server.js');

  assert.match(server, /app\.get\(\['\/admin', '\/admin\/'\]/);
  assert.ok(
    server.indexOf("app.get(['/admin', '/admin/']") < server.indexOf("app.get('*'"),
    'admin shortcut must be registered before the React catch-all route',
  );
});
