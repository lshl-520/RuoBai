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

test('authenticated app does not seed demo agents, moments, memories, or user profile into logged-in screens', async () => {
  const app = await readProjectFile('frontend-react', 'src', 'App.jsx');

  assert.doesNotMatch(app, /import\s*\{[^}]*\bAGENTS\b[^}]*\}\s*from\s*["']\.\/store\.jsx["']/);
  assert.doesNotMatch(app, /import\s*\{[^}]*\bMOMENTS\b[^}]*\}\s*from\s*["']\.\/store\.jsx["']/);
  assert.doesNotMatch(app, /import\s*\{[^}]*\bMEMORIES\b[^}]*\}\s*from\s*["']\.\/store\.jsx["']/);
  assert.doesNotMatch(app, /import\s*\{[^}]*\bUSER\b[^}]*\}\s*from\s*["']\.\/store\.jsx["']/);
  assert.doesNotMatch(app, /useState\(AGENTS\)/);
  assert.doesNotMatch(app, /useState\(MOMENTS\)/);
  assert.doesNotMatch(app, /useState\(MEMORIES\)/);
});

test('logged-in loading and empty role states do not fall back to demo characters', async () => {
  const chat = await readProjectFile('frontend-react', 'src', 'pages', 'chat.jsx');
  const moments = await readProjectFile('frontend-react', 'src', 'pages', 'moments.jsx');
  const memory = await readProjectFile('frontend-react', 'src', 'pages', 'memory.jsx');
  const profile = await readProjectFile('frontend-react', 'src', 'pages', 'profile.jsx');

  assert.match(chat, /const list = agents \?\? \[\];/);
  assert.doesNotMatch(chat, /agents\s*\?\?\s*fallbackAgents/);

  assert.match(moments, /const agents = realAgents \?\? \[\];/);
  assert.match(moments, /const moments = realMoments \?\? \[\];/);
  assert.doesNotMatch(moments, /realAgents \|\| agentsProp/);
  assert.doesNotMatch(moments, /realMoments \?\? momentsProp/);

  assert.match(memory, /const agents = realAgents \?\? \[\];/);
  assert.doesNotMatch(memory, /realAgents \|\| agentsProp/);

  assert.doesNotMatch(profile, /agentsProp/);
  assert.doesNotMatch(profile, /Array\.isArray\(agentsProp\)/);
});

test('user avatar fallback points to a public deployable asset instead of scattered placeholders', async () => {
  const defaults = await readProjectFile('frontend-react', 'src', 'lib', 'default-assets.js');
  const moments = await readProjectFile('frontend-react', 'src', 'pages', 'moments.jsx');
  const profile = await readProjectFile('frontend-react', 'src', 'pages', 'profile.jsx');

  assert.match(defaults, /DEFAULT_USER_AVATAR\s*=\s*["']\/assets\/default-user-avatar\.png["']/);
  assert.match(moments, /DEFAULT_USER_AVATAR/);
  assert.match(profile, /DEFAULT_USER_AVATAR/);
  assert.doesNotMatch(moments, /\/assets\/avatar\.png/);
  assert.doesNotMatch(profile, /\/assets\/portraits\/round\/3\.png/);
});
