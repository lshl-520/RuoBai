import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LOCAL_DATA_SCHEMA_VERSION,
  LOCAL_DATA_TABLES,
  getMigrationPlan,
  isConfirmedLocalMemory,
} from './local-data-schema.mjs';

test('empty local database has one deterministic migration and all planned tables', async () => {
  const plan = getMigrationPlan(0, LOCAL_DATA_SCHEMA_VERSION);
  assert.equal(plan.length, LOCAL_DATA_TABLES.length);
  for (const table of LOCAL_DATA_TABLES) {
    assert.ok(plan.some(sql => sql.includes(`CREATE TABLE ${table} `)));
  }
  assert.deepEqual(getMigrationPlan(LOCAL_DATA_SCHEMA_VERSION), []);
});

test('migration plan rejects skipped, reversed, or unknown versions', () => {
  assert.throws(() => getMigrationPlan(2, 1), /不支持/);
  assert.throws(() => getMigrationPlan(0, 2), /不支持/);
  assert.throws(() => getMigrationPlan('x', 1), /不支持/);
});

test('local identity filtering keeps candidates out of the confirmed memory set', () => {
  assert.equal(isConfirmedLocalMemory({ review_status: 'active', source_type: 'chat' }), true);
  assert.equal(isConfirmedLocalMemory({ review_status: 'important', source_type: 'manual' }), true);
  assert.equal(isConfirmedLocalMemory({ review_status: 'active', source_type: 'chat_candidate' }), false);
  assert.equal(isConfirmedLocalMemory({ review_status: 'candidate', source_type: 'chat' }), false);
});
