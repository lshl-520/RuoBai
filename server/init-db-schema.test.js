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

test('init-db schema backfills moments images column for older deployments', () => {
  assert.match(
    initDbSource,
    /table:\s*'moments'[\s\S]*column:\s*'images'[\s\S]*definition:\s*'JSON'/
  );
  assert.match(
    initDbSource,
    /table:\s*'moments'[\s\S]*column:\s*'likes_count'[\s\S]*definition:\s*'INT DEFAULT 0'/
  );
  assert.match(
    initDbSource,
    /table:\s*'moments'[\s\S]*column:\s*'is_deleted'[\s\S]*definition:\s*'TINYINT\(1\) DEFAULT 0'/
  );
});

test('init-db schema allows personal moments without a character', () => {
  assert.match(initDbSource, /character_id INT DEFAULT NULL/);
  assert.match(
    initDbSource,
    /ALTER TABLE `?\$\{fixup\.table\}`? MODIFY COLUMN `?\$\{fixup\.column\}`? \$\{fixup\.definition\}/
  );
});


test('characters schema stores a dedicated chat model and thinking level per role', () => {
  assert.match(initDbSource, /chat_credential_id INT DEFAULT NULL/);
  assert.match(initDbSource, /chat_model_id VARCHAR\(100\) DEFAULT NULL/);
  assert.match(initDbSource, /chat_thinking_level VARCHAR\(20\) DEFAULT 'off'/);
});

test('characters schema keeps automatic moment responses disabled by default', () => {
  assert.match(initDbSource, /moment_response_enabled TINYINT\(1\) DEFAULT 0/);
});
