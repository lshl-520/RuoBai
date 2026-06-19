import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');

test('runtime image includes mysqldump for scheduled database backups', () => {
  assert.match(dockerfile, /mariadb-client/);
});
