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

test('init-db schema falls back when AFTER anchor columns are missing', () => {
  assert.match(initDbSource, /existingColumns\.has\(fixup\.after\)/);
  assert.match(initDbSource, /ALTER TABLE \$\{fixup\.table\} ADD COLUMN \$\{fixup\.column\}/);
});

test('init-db schema backfills legacy columns used by the previous deployment', () => {
  assert.match(initDbSource, /personality/);
  assert.match(initDbSource, /base_url/);
  assert.match(initDbSource, /model_name/);
});
