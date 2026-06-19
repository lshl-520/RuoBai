import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const source = await readFile(new URL('./init-db.js', import.meta.url), 'utf8');

test('database initialization runs the credentials migration used by Docker startup', () => {
  assert.match(source, /runCredentialMigration/);
  assert.match(
    source,
    /await runCredentialMigration\(\{\s*pool,\s*ensureDatabaseExists:\s*async \(\) => \{\}\s*\}\)/s,
  );
});
