import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const script = await readFile(new URL('./install-docker.sh', import.meta.url), 'utf8');

test('install script allows an isolated compose project for smoke tests', () => {
  assert.match(
    script,
    /COMPOSE_PROJECT_NAME="\$\{COMPOSE_PROJECT_NAME:-ruobai\}"/,
  );
  assert.match(script, /COMPOSE_PROJECT_NAME=\$COMPOSE_PROJECT_NAME/);
});

test('install script generates a random admin password instead of a hardcoded 123456', () => {
  // 2026/10/30：仓库公开后，写死的初始密码等于把后台公开。
  assert.doesNotMatch(script, /DEFAULT_ADMIN_PASSWORD/);
  assert.doesNotMatch(script, /123456/);
  assert.match(script, /ADMIN_INITIAL_PASSWORD=/);
});

test('install script prints the current admin shortcut instead of a stale-only path', () => {
  assert.match(script, /\$SITE_URL\/admin/);
  assert.match(script, /\$SITE_URL\/admin\.html/);
});
