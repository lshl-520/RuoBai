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

test('install script prints the current admin shortcut instead of a stale-only path', () => {
  assert.match(script, /\$SITE_URL\/admin/);
  assert.match(script, /\$SITE_URL\/admin\.html/);
});
