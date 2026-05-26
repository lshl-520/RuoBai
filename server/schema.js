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
    name: 'first_chat_at',
    definition: 'DATETIME DEFAULT NULL',
    after: 'intimacy'
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

export async function ensureRuntimeSchema(db) {
  await ensureCharacterRuntimeColumns(db);
}
