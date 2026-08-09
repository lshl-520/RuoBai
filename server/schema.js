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
    name: 'visual_mode',
    definition: "VARCHAR(16) DEFAULT 'builtin'",
    after: 'portrait_custom_url'
  },
  {
    name: 'visual_preview_url',
    definition: 'VARCHAR(500) DEFAULT NULL',
    after: 'visual_mode'
  },
  {
    name: 'live2d_asset_id',
    definition: 'VARCHAR(80) DEFAULT NULL',
    after: 'visual_preview_url'
  },
  {
    name: 'live2d_model_url',
    definition: 'VARCHAR(500) DEFAULT NULL',
    after: 'live2d_asset_id'
  },
  {
    name: 'live2d_manifest',
    definition: 'JSON DEFAULT NULL',
    after: 'live2d_model_url'
  },
  {
    name: 'visual_frame_config',
    definition: 'JSON DEFAULT NULL',
    after: 'live2d_manifest'
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
    name: 'auto_moments_images_enabled',
    definition: 'TINYINT(1) DEFAULT 0',
    after: 'auto_moments_enabled'
  },
  {
    name: 'auto_moments_image_resolution',
    definition: "VARCHAR(16) DEFAULT 'channel'",
    after: 'auto_moments_images_enabled'
  },
  {
    name: 'auto_moments_image_profile',
    definition: 'JSON DEFAULT NULL',
    after: 'auto_moments_images_enabled'
  },
  {
    name: 'auto_moments_templates',
    definition: 'JSON DEFAULT NULL',
    after: 'auto_moments_image_profile'
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
  { name: 'review_status', definition: "VARCHAR(20) DEFAULT 'active'", after: 'source_id' },
  { name: 'detected_reason', definition: "VARCHAR(255) DEFAULT ''", after: 'review_status' },
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
      source_type VARCHAR(32) DEFAULT NULL,
      source_id BIGINT DEFAULT NULL,
      content TEXT NOT NULL,
      status VARCHAR(20) DEFAULT 'created',
      error_message VARCHAR(500) DEFAULT '',
      sent_at DATETIME DEFAULT NULL,
      viewed_at DATETIME DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE SET NULL,
      INDEX idx_proactive_user_char_type (user_id, character_id, event_type),
      UNIQUE KEY unique_proactive_source (user_id, character_id, event_type, source_type, source_id),
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

const MESSAGE_RUNTIME_COLUMNS = [
  {
    name: 'reasoning_summary',
    definition: 'TEXT',
    after: 'content'
  },
  {
    name: 'inner_os_content',
    definition: 'TEXT',
    after: 'reasoning_summary'
  },
  {
    name: 'inner_os_source',
    definition: 'VARCHAR(50) DEFAULT NULL',
    after: 'inner_os_content'
  }
];

const MOMENT_RUNTIME_COLUMNS = [
  { name: 'visibility_mode', definition: "VARCHAR(20) DEFAULT 'private'", after: 'character_id' },
  { name: 'image_generation_status', definition: "VARCHAR(32) DEFAULT 'manual'", after: 'images' },
  { name: 'image_generation_error', definition: 'VARCHAR(255) DEFAULT NULL', after: 'image_generation_status' },
  { name: 'image_mode', definition: "VARCHAR(20) DEFAULT 'single'", after: 'image_generation_error' },
  { name: 'image_generation_metadata', definition: 'JSON DEFAULT NULL', after: 'image_mode' },
];

const LIFE_EVENT_RUNTIME_COLUMNS = [
  { name: 'event_key', definition: 'VARCHAR(64) DEFAULT NULL', after: 'event_type' },
  { name: 'status_note', definition: 'VARCHAR(500) DEFAULT NULL', after: 'status' },
  { name: 'expires_at', definition: 'DATETIME DEFAULT NULL', after: 'occurred_at' },
  { name: 'corrected_at', definition: 'DATETIME DEFAULT NULL', after: 'updated_at' },
];

const PROACTIVE_EVENT_RUNTIME_COLUMNS = [
  { name: 'source_type', definition: 'VARCHAR(32) DEFAULT NULL', after: 'event_date' },
  { name: 'source_id', definition: 'BIGINT DEFAULT NULL', after: 'source_type' },
];

const FUNCTIONAL_RUNTIME_TABLES = [
  `
    CREATE TABLE IF NOT EXISTS moment_audiences (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      moment_id INT NOT NULL,
      user_id INT NOT NULL,
      character_id INT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (moment_id) REFERENCES moments(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
      UNIQUE KEY unique_moment_audience (moment_id, character_id),
      INDEX idx_moment_audience_character (user_id, character_id, moment_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `,
  `
    CREATE TABLE IF NOT EXISTS life_events (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      character_id INT NOT NULL,
      title VARCHAR(500) NOT NULL,
      event_type VARCHAR(32) DEFAULT 'life',
      event_key VARCHAR(64) DEFAULT NULL,
      status VARCHAR(20) DEFAULT 'active',
      status_note VARCHAR(500) DEFAULT NULL,
      occurred_at DATETIME DEFAULT NULL,
      expires_at DATETIME DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      corrected_at DATETIME DEFAULT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
      INDEX idx_life_event_character (user_id, character_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `,
  `
    CREATE TABLE IF NOT EXISTS life_event_sources (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      event_id BIGINT NOT NULL,
      user_id INT NOT NULL,
      source_type VARCHAR(32) NOT NULL,
      source_id BIGINT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (event_id) REFERENCES life_events(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE KEY unique_life_event_source (user_id, source_type, source_id),
      INDEX idx_life_event_source_event (event_id)
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

export async function ensureMessageRuntimeColumns(db) {
  for (const column of MESSAGE_RUNTIME_COLUMNS) {
    if (await columnExists(db, 'messages', column.name)) continue;
    await db.query(`ALTER TABLE messages ADD COLUMN ${column.name} ${column.definition} AFTER ${column.after}`);
  }
}

async function tableExists(db, tableName) {
  const [rows] = await db.query(
    `
      SELECT TABLE_NAME
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
      LIMIT 1
    `,
    [tableName]
  );

  return rows.length > 0;
}

async function indexExists(db, tableName, indexName) {
  const [rows] = await db.query(
    `
      SELECT INDEX_NAME
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND INDEX_NAME = ?
      LIMIT 1
    `,
    [tableName, indexName]
  );
  return rows.length > 0;
}

export async function ensureDynamicCapabilityAssignment(db) {
  if (!(await tableExists(db, 'capability_assignments'))) return;

  const [rows] = await db.query(
    `
      SELECT COLUMN_TYPE
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'capability_assignments'
        AND COLUMN_NAME = 'capability'
      LIMIT 1
    `
  );

  if (String(rows[0]?.COLUMN_TYPE || '').includes("'dynamic'")) return;

  await db.query(
    "ALTER TABLE capability_assignments MODIFY COLUMN capability ENUM('chat', 'vision', 'image', 'dynamic', 'tts', 'realtime') NOT NULL"
  );
}

export async function ensureMomentRuntimeColumns(db) {
  for (const column of MOMENT_RUNTIME_COLUMNS) {
    if (await columnExists(db, 'moments', column.name)) continue;
    await db.query(`ALTER TABLE moments ADD COLUMN ${column.name} ${column.definition} AFTER ${column.after}`);
  }
  if (await columnExists(db, 'moments', 'visibility_mode')) {
    await db.query(`
      UPDATE moments
      SET visibility_mode = CASE WHEN character_id IS NULL THEN 'private' ELSE 'publisher' END
      WHERE visibility_mode IS NULL OR visibility_mode = ''
    `);
  }
}

export async function ensureLifeEventRuntimeColumns(db) {
  for (const column of LIFE_EVENT_RUNTIME_COLUMNS) {
    if (await columnExists(db, 'life_events', column.name)) continue;
    await db.query(`ALTER TABLE life_events ADD COLUMN ${column.name} ${column.definition} AFTER ${column.after}`);
  }
}

export async function ensurePushRuntimeTables(db) {
  for (const statement of PUSH_RUNTIME_TABLES) {
    await db.query(statement);
  }
  try {
    const columns = [
      { name: 'viewed_at', definition: 'DATETIME DEFAULT NULL', after: 'sent_at' },
      ...PROACTIVE_EVENT_RUNTIME_COLUMNS,
    ];
    for (const column of columns) {
      if (!(await columnExists(db, 'proactive_events', column.name))) {
        await db.query(`ALTER TABLE proactive_events ADD COLUMN ${column.name} ${column.definition} AFTER ${column.after}`);
      }
    }
    if (!(await indexExists(db, 'proactive_events', 'unique_proactive_source'))) {
      await db.query(
        'ALTER TABLE proactive_events ADD UNIQUE KEY unique_proactive_source (user_id, character_id, event_type, source_type, source_id)'
      );
    }
  } catch {
    // Older test doubles and read-only deployments may not expose INFORMATION_SCHEMA.
  }
}

export async function ensurePersonaRuntimeTables(db) {
  for (const statement of PERSONA_RUNTIME_TABLES) {
    await db.query(statement);
  }
}

export async function ensureFunctionalRuntimeTables(db) {
  for (const statement of FUNCTIONAL_RUNTIME_TABLES) {
    await db.query(statement);
  }
}

export async function ensureRuntimeSchema(db) {
  await ensureDynamicCapabilityAssignment(db);
  await ensureCharacterRuntimeColumns(db);
  await ensureCredentialRuntimeColumns(db);
  await ensureMessageRuntimeColumns(db);
  await ensureMemoryRuntimeColumns(db);
  await ensureMomentRuntimeColumns(db);
  await ensurePushRuntimeTables(db);
  await ensurePersonaRuntimeTables(db);
  await ensureFunctionalRuntimeTables(db);
  await ensureLifeEventRuntimeColumns(db);
}
