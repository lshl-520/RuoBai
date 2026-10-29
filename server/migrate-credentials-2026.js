import { ensureDatabaseExists, pool } from './db.js';

const createTableStatements = [
  `
    CREATE TABLE IF NOT EXISTS credentials (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      name VARCHAR(100) NOT NULL,
      provider_type VARCHAR(50) DEFAULT 'openai-compatible',
      api_base VARCHAR(500) NOT NULL,
      api_aux_base VARCHAR(500) DEFAULT '',
      api_key VARCHAR(500) NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE KEY unique_user_credential (user_id, api_base(255), api_key(255)),
      INDEX idx_credentials_user (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `,
  `
    CREATE TABLE IF NOT EXISTS credential_models (
      id INT AUTO_INCREMENT PRIMARY KEY,
      credential_id INT NOT NULL,
      model_id VARCHAR(100) NOT NULL,
      capabilities JSON DEFAULT NULL,
      discovered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (credential_id) REFERENCES credentials(id) ON DELETE CASCADE,
      UNIQUE KEY unique_credential_model (credential_id, model_id),
      INDEX idx_credential_models_credential (credential_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_assignments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      capability ENUM('chat', 'vision', 'image', 'dynamic', 'tts', 'realtime') NOT NULL,
      credential_id INT NOT NULL,
      model_id VARCHAR(100) NOT NULL,
      enabled TINYINT(1) DEFAULT 1,
      extras JSON DEFAULT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (credential_id) REFERENCES credentials(id) ON DELETE CASCADE,
      UNIQUE KEY unique_user_capability (user_id, capability),
      INDEX idx_capability_assignments_credential (credential_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `
];

const selectActiveChatConfigsSql = `
  SELECT id, user_id, name, provider_type, api_base, api_key, model, created_at
  FROM model_configs
  WHERE is_active = 1 AND purpose = 'chat'
  ORDER BY user_id ASC, id ASC
`;

const selectCredentialSql = `
  SELECT id
  FROM credentials
  WHERE user_id = ? AND api_base = ? AND api_key = ?
  LIMIT 1
`;

const insertCredentialSql = `
  INSERT INTO credentials (user_id, name, provider_type, api_base, api_key, created_at)
  VALUES (?, ?, ?, ?, ?, ?)
`;

const selectAssignmentSql = `
  SELECT id
  FROM capability_assignments
  WHERE user_id = ? AND capability = 'chat'
  LIMIT 1
`;

const insertAssignmentSql = `
  INSERT INTO capability_assignments
    (user_id, capability, credential_id, model_id, enabled, extras, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`;

function normalizeCreatedAt(value) {
  return value || new Date().toISOString().slice(0, 19).replace('T', ' ');
}

async function ensureTables(targetPool) {
  for (const statement of createTableStatements) {
    await targetPool.query(statement);
  }
}

async function findOrCreateCredential(targetPool, row) {
  const [existingRows] = await targetPool.query(selectCredentialSql, [
    row.user_id,
    row.api_base,
    row.api_key
  ]);

  if (existingRows.length > 0) {
    return {
      credentialId: existingRows[0].id,
      created: false
    };
  }

  const [result] = await targetPool.query(insertCredentialSql, [
    row.user_id,
    row.name,
    row.provider_type || 'openai-compatible',
    row.api_base,
    row.api_key,
    normalizeCreatedAt(row.created_at)
  ]);

  return {
    credentialId: result.insertId,
    created: true
  };
}

async function findOrCreateChatAssignment(targetPool, row, credentialId) {
  const [existingRows] = await targetPool.query(selectAssignmentSql, [row.user_id]);

  if (existingRows.length > 0) {
    return { created: false };
  }

  await targetPool.query(insertAssignmentSql, [
    row.user_id,
    'chat',
    credentialId,
    row.model,
    1,
    null,
    normalizeCreatedAt(row.created_at)
  ]);

  return { created: true };
}

export async function runCredentialMigration(deps = {}) {
  const targetPool = deps.pool || pool;
  const ensureDb = deps.ensureDatabaseExists || ensureDatabaseExists;

  await ensureDb();
  await ensureTables(targetPool);

  const [rows] = await targetPool.query(selectActiveChatConfigsSql);
  const summary = {
    scanned: rows.length,
    createdCredentials: 0,
    skippedCredentials: 0,
    createdAssignments: 0,
    skippedAssignments: 0
  };

  for (const row of rows) {
    const credentialResult = await findOrCreateCredential(targetPool, row);

    if (credentialResult.created) {
      summary.createdCredentials += 1;
    } else {
      summary.skippedCredentials += 1;
    }

    const assignmentResult = await findOrCreateChatAssignment(
      targetPool,
      row,
      credentialResult.credentialId
    );

    if (assignmentResult.created) {
      summary.createdAssignments += 1;
    } else {
      summary.skippedAssignments += 1;
    }
  }

  return summary;
}

async function main() {
  try {
    const summary = await runCredentialMigration();
    console.log('credentials 迁移完成');
    console.log(
      JSON.stringify(summary, null, 2)
    );
  } catch (error) {
    console.error(`credentials 迁移失败：${error.message}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

const isDirectRun = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href;

if (isDirectRun) {
  await main();
}
