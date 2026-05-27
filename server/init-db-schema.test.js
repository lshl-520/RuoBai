import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const initDbSource = await fs.readFile(new URL('./init-db.js', import.meta.url), 'utf8');

test('init-db schema avoids MySQL TEXT columns with DEFAULT values', () => {
  assert.doesNotMatch(initDbSource, /\bTEXT\s+DEFAULT\b/i);
});
