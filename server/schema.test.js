import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureCharacterRuntimeColumns } from './schema.js';

test('ensureCharacterRuntimeColumns adds missing role-page columns once', async () => {
  const calls = [];
  const db = {
    query: async (sql, params = []) => {
      calls.push({ sql, params });

      if (sql.includes('information_schema.COLUMNS')) {
        return [params[1] === 'portrait_id' ? [] : [{ COLUMN_NAME: params[1] }]];
      }

      return [{ affectedRows: 0 }];
    }
  };

  await ensureCharacterRuntimeColumns(db);

  const alterCalls = calls.filter(call => /^ALTER TABLE characters/i.test(call.sql));
  assert.equal(alterCalls.length, 1);
  assert.match(alterCalls[0].sql, /ADD COLUMN portrait_id INT DEFAULT NULL AFTER avatar/i);
});
