import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const initDbSource = await fs.readFile(new URL('./init-db.js', import.meta.url), 'utf8');

test('init-db schema avoids MySQL TEXT columns with DEFAULT values', () => {
  assert.doesNotMatch(initDbSource, /\bTEXT\s+DEFAULT\b/i);
});

test('init-db schema avoids ADD COLUMN IF NOT EXISTS for older MariaDB', () => {
  assert.doesNotMatch(initDbSource, /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS/i);
});
