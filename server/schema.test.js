import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureCharacterRuntimeColumns, ensureCredentialRuntimeColumns, ensureMessageRuntimeColumns, ensureMemoryRuntimeColumns, ensurePersonaRuntimeTables, ensurePushRuntimeTables, ensureDynamicCapabilityAssignment } from './schema.js';

test('ensureDynamicCapabilityAssignment upgrades the legacy capability enum', async () => {
  const calls = [];
  const db = {
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      if (sql.includes('information_schema.TABLES')) return [[{ TABLE_NAME: 'capability_assignments' }]];
      if (sql.includes('COLUMN_TYPE')) return [[{ COLUMN_TYPE: "enum('chat','vision','image','tts','realtime')" }]];
      return [{ affectedRows: 0 }];
    }
  };

  await ensureDynamicCapabilityAssignment(db);

  assert.ok(calls.some(call => /ALTER TABLE capability_assignments MODIFY COLUMN capability ENUM\('chat', 'vision', 'image', 'dynamic', 'tts', 'realtime'\)/.test(call.sql)));
});

test('ensureDynamicCapabilityAssignment leaves an upgraded enum alone', async () => {
  const calls = [];
  const db = {
    query: async (sql) => {
      calls.push(sql);
      if (sql.includes('information_schema.TABLES')) return [[{ TABLE_NAME: 'capability_assignments' }]];
      if (sql.includes('COLUMN_TYPE')) return [[{ COLUMN_TYPE: "enum('chat','vision','image','dynamic','tts','realtime')" }]];
      return [{ affectedRows: 0 }];
    }
  };

  await ensureDynamicCapabilityAssignment(db);

  assert.equal(calls.filter(sql => /^ALTER TABLE capability_assignments/i.test(sql)).length, 0);
});

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

test('ensureCredentialRuntimeColumns adds channel runtime columns once', async () => {
  const calls = [];
  const db = {
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      if (sql.includes('information_schema.COLUMNS')) return [[]];
      return [{ affectedRows: 0 }];
    }
  };

  await ensureCredentialRuntimeColumns(db);

  const alterCalls = calls.filter(call => /^ALTER TABLE credentials/i.test(call.sql));
  assert.equal(alterCalls.length, 2);
  assert.match(alterCalls[0].sql, /ADD COLUMN api_aux_base VARCHAR\(500\) DEFAULT '' AFTER api_base/i);
  assert.match(alterCalls[1].sql, /ADD COLUMN is_enabled TINYINT\(1\) DEFAULT 1 AFTER api_key/i);
});

test('ensureMemoryRuntimeColumns adds layered memory and appointment fields', async () => {
  const calls = [];
  const db = {
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      if (sql.includes('information_schema.COLUMNS')) return [params[1] === 'memory_type' ? [] : [{ COLUMN_NAME: params[1] }]];
      return [{ affectedRows: 0 }];
    }
  };

  await ensureMemoryRuntimeColumns(db);

  const alterCalls = calls.filter(call => /^ALTER TABLE memories/i.test(call.sql));
  assert.equal(alterCalls.length, 1);
  assert.match(alterCalls[0].sql, /ADD COLUMN memory_type VARCHAR\(32\) DEFAULT 'life' AFTER category/i);
});

test('ensurePushRuntimeTables creates FCM and proactive-message tables', async () => {
  const calls = [];
  const db = {
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      return [{ affectedRows: 0 }];
    }
  };

  await ensurePushRuntimeTables(db);

  const joined = calls.map(call => call.sql).join('\n');
  assert.match(joined, /CREATE TABLE IF NOT EXISTS push_devices/i);
  assert.match(joined, /CREATE TABLE IF NOT EXISTS push_preferences/i);
  assert.match(joined, /CREATE TABLE IF NOT EXISTS proactive_events/i);
  assert.match(joined, /UNIQUE KEY unique_fcm_token/i);
});

test('ensurePersonaRuntimeTables creates one persistent state per user character', async () => {
  const calls = [];
  const db = { query: async (sql) => { calls.push(sql); return [{ affectedRows: 0 }]; } };

  await ensurePersonaRuntimeTables(db);

  const joined = calls.join('\n');
  assert.match(joined, /CREATE TABLE IF NOT EXISTS character_runtime_states/i);
  assert.match(joined, /state_json JSON NOT NULL/i);
  assert.match(joined, /UNIQUE KEY unique_character_runtime_state \(user_id, character_id\)/i);
});


test('ensureCharacterRuntimeColumns adds role dedicated chat model columns on startup', async () => {
  const calls = [];
  const missing = new Set(['chat_credential_id', 'chat_model_id', 'chat_thinking_level']);
  const db = {
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      if (sql.includes('information_schema.COLUMNS')) {
        return [missing.has(params[1]) ? [] : [{ COLUMN_NAME: params[1] }]];
      }
      return [{ affectedRows: 0 }];
    }
  };

  await ensureCharacterRuntimeColumns(db);

  const joined = calls.filter(call => /^ALTER TABLE characters/i.test(call.sql)).map(call => call.sql).join('\n');
  assert.match(joined, /ADD COLUMN chat_credential_id INT DEFAULT NULL AFTER intimacy/i);
  assert.match(joined, /ADD COLUMN chat_model_id VARCHAR\(100\) DEFAULT NULL AFTER chat_credential_id/i);
  assert.match(joined, /ADD COLUMN chat_thinking_level VARCHAR\(20\) DEFAULT 'off' AFTER chat_model_id/i);
});

test('ensureMessageRuntimeColumns adds separate inner OS fields once', async () => {
  const calls = [];
  const db = {
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      if (sql.includes('information_schema.COLUMNS')) return [[]];
      return [{ affectedRows: 0 }];
    }
  };

  await ensureMessageRuntimeColumns(db);

  const alterCalls = calls.filter(call => /^ALTER TABLE messages/i.test(call.sql));
  assert.equal(alterCalls.length, 3);
  const joined = alterCalls.map(call => call.sql).join('\n');
  assert.match(joined, /ADD COLUMN reasoning_summary TEXT AFTER content/i);
  assert.match(joined, /ADD COLUMN inner_os_content TEXT AFTER reasoning_summary/i);
  assert.match(joined, /ADD COLUMN inner_os_source VARCHAR\(50\) DEFAULT NULL AFTER inner_os_content/i);
});

test('ensureCharacterRuntimeColumns adds dynamic profile and template fields on startup', async () => {
  const calls = [];
  const missing = new Set(['auto_moments_image_profile', 'auto_moments_templates']);
  const db = {
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      if (sql.includes('information_schema.COLUMNS')) return [missing.has(params[1]) ? [] : [{ COLUMN_NAME: params[1] }]];
      return [{ affectedRows: 0 }];
    }
  };
  await ensureCharacterRuntimeColumns(db);
  const joined = calls.filter(call => /^ALTER TABLE characters/i.test(call.sql)).map(call => call.sql).join('\n');
  assert.match(joined, /ADD COLUMN auto_moments_image_profile JSON DEFAULT NULL AFTER auto_moments_images_enabled/i);
  assert.match(joined, /ADD COLUMN auto_moments_templates JSON DEFAULT NULL AFTER auto_moments_image_profile/i);
});
