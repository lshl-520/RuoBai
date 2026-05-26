import test from 'node:test';
import assert from 'node:assert/strict';
import { runCredentialMigration } from './migrate-credentials-2026.js';

function createFakeDatabase() {
  const state = {
    tables: new Set(['model_configs']),
    credentials: [],
    capabilityAssignments: [],
    sourceRows: [
      {
        id: 11,
        user_id: 7,
        name: '主聊天',
        provider_type: 'openai',
        api_base: 'https://api.example.com/v1',
        api_key: 'sk-same-user',
        model: 'gpt-5.4',
        created_at: '2026-05-24 10:00:00'
      },
      {
        id: 12,
        user_id: 7,
        name: '重复凭证',
        provider_type: 'openai',
        api_base: 'https://api.example.com/v1',
        api_key: 'sk-same-user',
        model: 'gpt-5.4',
        created_at: '2026-05-24 10:05:00'
      },
      {
        id: 13,
        user_id: 8,
        name: '另一个用户',
        provider_type: 'openai',
        api_base: 'https://api.example.com/v1',
        api_key: 'sk-another-user',
        model: 'gpt-5.5',
        created_at: '2026-05-24 10:10:00'
      }
    ],
    nextCredentialId: 1,
    nextAssignmentId: 1,
    executed: []
  };

  const pool = {
    query: async (sql, params = []) => {
      const normalizedSql = sql.replace(/\s+/g, ' ').trim();
      state.executed.push({ sql: normalizedSql, params });

      if (normalizedSql.startsWith('CREATE TABLE IF NOT EXISTS credentials')) {
        state.tables.add('credentials');
        return [{}];
      }

      if (normalizedSql.startsWith('CREATE TABLE IF NOT EXISTS credential_models')) {
        state.tables.add('credential_models');
        return [{}];
      }

      if (normalizedSql.startsWith('CREATE TABLE IF NOT EXISTS capability_assignments')) {
        state.tables.add('capability_assignments');
        return [{}];
      }

      if (normalizedSql.startsWith('SELECT id, user_id, name, provider_type, api_base, api_key, model, created_at FROM model_configs')) {
        return [[...state.sourceRows]];
      }

      if (normalizedSql.startsWith('SELECT id FROM credentials WHERE user_id = ? AND api_base = ? AND api_key = ? LIMIT 1')) {
        const match = state.credentials.find(item =>
          item.user_id === params[0] &&
          item.api_base === params[1] &&
          item.api_key === params[2]
        );
        return [[match ? { id: match.id } : undefined].filter(Boolean)];
      }

      if (normalizedSql.startsWith('INSERT INTO credentials')) {
        const row = {
          id: state.nextCredentialId++,
          user_id: params[0],
          name: params[1],
          provider_type: params[2],
          api_base: params[3],
          api_key: params[4],
          created_at: params[5]
        };
        state.credentials.push(row);
        return [{ insertId: row.id }];
      }

      if (normalizedSql.startsWith("SELECT id FROM capability_assignments WHERE user_id = ? AND capability = 'chat' LIMIT 1")) {
        const match = state.capabilityAssignments.find(item => item.user_id === params[0] && item.capability === 'chat');
        return [[match ? { id: match.id } : undefined].filter(Boolean)];
      }

      if (normalizedSql.startsWith('INSERT INTO capability_assignments')) {
        const row = {
          id: state.nextAssignmentId++,
          user_id: params[0],
          capability: params[1],
          credential_id: params[2],
          model_id: params[3],
          enabled: params[4],
          extras: params[5],
          updated_at: params[6]
        };
        state.capabilityAssignments.push(row);
        return [{ insertId: row.id }];
      }

      throw new Error(`Unexpected query: ${normalizedSql}`);
    }
  };

  return { pool, state };
}

test('runCredentialMigration creates tables, deduplicates credentials, and stays idempotent', async () => {
  const { pool, state } = createFakeDatabase();
  let ensured = 0;

  const first = await runCredentialMigration({
    pool,
    ensureDatabaseExists: async () => {
      ensured += 1;
    }
  });

  assert.equal(ensured, 1);
  assert.ok(state.tables.has('credentials'));
  assert.ok(state.tables.has('credential_models'));
  assert.ok(state.tables.has('capability_assignments'));
  assert.equal(first.createdCredentials, 2);
  assert.equal(first.createdAssignments, 2);
  assert.equal(first.skippedCredentials, 1);
  assert.equal(first.skippedAssignments, 1);
  assert.equal(state.credentials.length, 2);
  assert.equal(state.capabilityAssignments.length, 2);

  const second = await runCredentialMigration({
    pool,
    ensureDatabaseExists: async () => {
      ensured += 1;
    }
  });

  assert.equal(ensured, 2);
  assert.equal(second.createdCredentials, 0);
  assert.equal(second.createdAssignments, 0);
  assert.equal(second.skippedCredentials, 3);
  assert.equal(second.skippedAssignments, 3);
  assert.equal(state.credentials.length, 2);
  assert.equal(state.capabilityAssignments.length, 2);
});
