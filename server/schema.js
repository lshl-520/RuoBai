const CHARACTER_RUNTIME_COLUMNS = [
  {
    name: 'portrait_id',
    definition: 'INT DEFAULT NULL',
    after: 'avatar'
  },
  {
    name: 'portrait_custom_url',
    definition: 'VARCHAR(255) DEFAULT NULL',
    after: 'portrait_id'
  },
  {
    name: 'chat_credential_id',
    definition: 'INT DEFAULT NULL',
    after: 'intimacy'
  },
  {
    name: 'chat_model_id',
    definition: 'VARCHAR(100) DEFAULT NULL',
    after: 'chat_credential_id'
  },
  {
    name: 'chat_thinking_level',
    definition: "VARCHAR(20) DEFAULT 'off'",
    after: 'chat_model_id'
  },
  {
    name: 'first_chat_at',
    definition: 'DATETIME DEFAULT NULL',
    after: 'chat_thinking_level'
  },
  {
    name: 'auto_moments_enabled',
    definition: 'TINYINT(1) DEFAULT 0',
    after: 'first_chat_at'
  },
  {
    name: 'auto_moments_daily_min',
    definition: 'INT DEFAULT 0',
    after: 'auto_moments_enabled'
  },
  {
    name: 'auto_moments_daily_max',
    definition: 'INT DEFAULT 0',
    after: 'auto_moments_daily_min'
  },
  {
    name: 'auto_moments_min_interval_hours',
    definition: 'INT DEFAULT 4',
    after: 'auto_moments_daily_max'
  },
  {
    name: 'auto_moments_last_posted_at',
    definition: 'DATETIME DEFAULT NULL',
    after: 'auto_moments_min_interval_hours'
  },
  {
    name: 'delete_after',
    definition: 'DATETIME DEFAULT NULL',
    after: 'is_deleted'
  }
];

const CREDENTIAL_RUNTIME_COLUMNS = [
  {
    name: 'api_aux_base',
    definition: "VARCHAR(500) DEFAULT ''",
    after: 'api_base'
  },
  {
    name: 'is_enabled',
    definition: 'TINYINT(1) DEFAULT 1',
    after: 'api_key'
  }
];

const MEMORY_RUNTIME_COLUMNS = [
  { name: 'memory_type', definition: "VARCHAR(32) DEFAULT 'life'", after: 'category' },
  { name: 'source_type', definition: "VARCHAR(32) DEFAULT 'manual'", after: 'memory_type' },
  { name: 'source_id', definition: 'BIGINT DEFAULT NULL', after: 'source_type' },
  { name: 'occurred_at', definition: 'DATETIME DEFAULT NULL', after: 'source_id' },
  { name: 'confidence', definition: 'DECIMAL(4,3) DEFAULT 1.000', after: 'occurred_at' },
  { name: 'weight', definition: 'INT DEFAULT 50', after: 'confidence' },
  { name: 'appointment_at', definition: 'DATETIME DEFAULT NULL', after: 'weight' },
  { name: 'appointment_status', definition: 'VARCHAR(20) DEFAULT NULL', after: 'appointment_at' },
  { name: 'updated_at', definition: 'DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP', after: 'created_at' },
];

const PUSH_RUNTIME_TABLES = [
  `
    CREATE TABLE IF NOT EXISTS push_devices (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      fcm_token VARCHAR(768) NOT NULL,
      platform VARCHAR(20) DEFAULT 'android',
      app_version VARCHAR(50) DEFAULT '',
      enabled TINYINT(1) DEFAULT 1,
      last_seen_at DATETIME DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE KEY unique_fcm_token (fcm_token),
      INDEX idx_push_user_enabled (user_id, enabled),
      INDEX idx_push_seen (last_seen_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `,
  `
    CREATE TABLE IF NOT EXISTS push_preferences (
      user_id INT PRIMARY KEY,
      proactive_enabled TINYINT(1) DEFAULT 1,
      bedtime_enabled TINYINT(1) DEFAULT 1,
      quiet_night_enabled TINYINT(1) DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `,
  `
    CREATE TABLE IF NOT EXISTS proactive_events (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      character_id INT NOT NULL,
      message_id BIGINT DEFAULT NULL,
      event_type VARCHAR(30) NOT NULL,
      event_date VARCHAR(10) DEFAULT NULL,
      content TEXT NOT NULL,
      status VARCHAR(20) DEFAULT 'created',
      error_message VARCHAR(500) DEFAULT '',
      sent_at DATETIME DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE SET NULL,
      INDEX idx_proactive_user_char_type (user_id, character_id, event_type),
      INDEX idx_proactive_date (event_date),
      INDEX idx_proactive_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `
];

const PERSONA_RUNTIME_TABLES = [
  `
    CREATE TABLE IF NOT EXISTS character_runtime_states (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      character_id INT NOT NULL,
      state_json JSON NOT NULL,
      relationship_json JSON NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
      UNIQUE KEY unique_character_runtime_state (user_id, character_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `
];

async function columnExists(db, tableName, columnName) {
  const [rows] = await db.query(
    `
      SELECT COLUMN_NAME
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?
      LIMIT 1
    `,
    [tableName, columnName]
  );

  return rows.length > 0;
}

export async function ensureCharacterRuntimeColumns(db) {
  for (const column of CHARACTER_RUNTIME_COLUMNS) {
    if (await columnExists(db, 'characters', column.name)) {
      continue;
    }

    await db.query(
      `ALTER TABLE characters ADD COLUMN ${column.name} ${column.definition} AFTER ${column.after}`
    );
  }
}

export async function ensureCredentialRuntimeColumns(db) {
  for (const column of CREDENTIAL_RUNTIME_COLUMNS) {
    if (await columnExists(db, 'credentials', column.name)) continue;
    await db.query(
      `ALTER TABLE credentials ADD COLUMN ${column.name} ${column.definition} AFTER ${column.after}`
    );
  }
}

export async function ensureMemoryRuntimeColumns(db) {
  for (const column of MEMORY_RUNTIME_COLUMNS) {
    if (await columnExists(db, 'memories', column.name)) continue;
    await db.query(`ALTER TABLE memories ADD COLUMN ${column.name} ${column.definition} AFTER ${column.after}`);
  }
}

export async function ensurePushRuntimeTables(db) {
  for (const statement of PUSH_RUNTIME_TABLES) {
    await db.query(statement);
  }
}

export async function ensurePersonaRuntimeTables(db) {
  for (const statement of PERSONA_RUNTIME_TABLES) {
    await db.query(statement);
  }
}

export async function ensureRuntimeSchema(db) {
  await ensureCharacterRuntimeColumns(db);
  await ensureCredentialRuntimeColumns(db);
  await ensureMemoryRuntimeColumns(db);
  await ensurePushRuntimeTables(db);
  await ensurePersonaRuntimeTables(db);
}
