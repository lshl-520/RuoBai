import { ensureDatabaseExists, pool } from './db.js';
import bcrypt from 'bcryptjs';
import { DEFAULT_CHARACTERS, DEFAULT_MODEL_CONFIG } from './defaults.js';
import { runCredentialMigration } from './migrate-credentials-2026.js';

const DEFAULT_ADMIN_USERNAME = 'admin';
const DEFAULT_ADMIN_PASSWORD = '123456';

const statements = [
  `
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(50) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      role VARCHAR(20) DEFAULT 'user',
      status VARCHAR(20) DEFAULT 'active',
      is_enabled TINYINT(1) DEFAULT 1,
      daily_chat_used INT DEFAULT 0,
      daily_chat_reset_at DATETIME DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_login DATETIME DEFAULT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `,
  `
    CREATE TABLE IF NOT EXISTS characters (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      char_key VARCHAR(50) NOT NULL,
      name VARCHAR(100) NOT NULL,
      tag VARCHAR(50) DEFAULT '恋人',
      persona TEXT,
      avatar VARCHAR(500) DEFAULT '',
      portrait_id INT DEFAULT NULL,
      portrait_custom_url VARCHAR(255) DEFAULT NULL,
      mood INT DEFAULT 80,
      intimacy INT DEFAULT 50,
      first_chat_at DATETIME DEFAULT NULL,
      auto_moments_enabled TINYINT(1) DEFAULT 0,
      auto_moments_daily_min INT DEFAULT 0,
      auto_moments_daily_max INT DEFAULT 0,
      auto_moments_min_interval_hours INT DEFAULT 4,
      auto_moments_last_posted_at DATETIME DEFAULT NULL,
      is_active TINYINT(1) DEFAULT 0,
      is_deleted TINYINT(1) DEFAULT 0,
      delete_after DATETIME DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE KEY unique_user_char (user_id, char_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `,
  `
    CREATE TABLE IF NOT EXISTS messages (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      character_id INT NOT NULL,
      role ENUM('user', 'assistant', 'system') NOT NULL,
      content TEXT NOT NULL,
      message_type VARCHAR(20) DEFAULT 'text',
      media_url VARCHAR(500) DEFAULT NULL,
      is_active TINYINT(1) DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
      INDEX idx_user_char (user_id, character_id),
      INDEX idx_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `,
  `
    CREATE TABLE IF NOT EXISTS memories (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      character_id INT NOT NULL,
      content TEXT NOT NULL,
      tag VARCHAR(50) DEFAULT '普通记忆',
      category VARCHAR(50) DEFAULT '',
      is_important TINYINT(1) DEFAULT 0,
      is_deleted TINYINT(1) DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
      INDEX idx_user_char_mem (user_id, character_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `,
  // ⚠️ 旧版动态系统，新功能请用 moments 系列。
  // 保留是为了兼容前端旧调用，等前端切完再删。
  `
    CREATE TABLE IF NOT EXISTS posts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      character_id INT DEFAULT NULL,
      content TEXT NOT NULL,
      image_url VARCHAR(1000) DEFAULT NULL,
      likes INT DEFAULT 0,
      comments_count INT DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE SET NULL,
      INDEX idx_user_posts (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `,
  `
    CREATE TABLE IF NOT EXISTS post_comments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      post_id INT NOT NULL,
      user_id INT NOT NULL,
      character_id INT DEFAULT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `,
  `
    CREATE TABLE IF NOT EXISTS post_likes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      post_id INT NOT NULL,
      user_id INT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE KEY unique_like (post_id, user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `,
  `
    CREATE TABLE IF NOT EXISTS moments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      character_id INT DEFAULT NULL,
      content TEXT NOT NULL,
      images JSON,
      mood VARCHAR(50) DEFAULT NULL,
      likes_count INT DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_deleted TINYINT(1) DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE SET NULL,
      INDEX idx_user_moments (user_id),
      INDEX idx_user_character_moments (user_id, character_id),
      INDEX idx_user_deleted_moments (user_id, is_deleted)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `,
  `
    CREATE TABLE IF NOT EXISTS moment_comments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      moment_id INT NOT NULL,
      user_id INT NOT NULL,
      character_id INT DEFAULT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (moment_id) REFERENCES moments(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE SET NULL,
      INDEX idx_moment_comments (moment_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `,
  `
    CREATE TABLE IF NOT EXISTS moment_likes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      moment_id INT NOT NULL,
      user_id INT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (moment_id) REFERENCES moments(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE KEY unique_moment_like (moment_id, user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `,
  `
    CREATE TABLE IF NOT EXISTS model_configs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      name VARCHAR(100) NOT NULL,
      provider_type VARCHAR(50) DEFAULT 'openai-compatible',
      api_base VARCHAR(500) NOT NULL,
      api_key VARCHAR(500) NOT NULL,
      model VARCHAR(100) NOT NULL,
      purpose VARCHAR(20) DEFAULT 'chat',
      is_active TINYINT(1) DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_user_models (user_id),
      INDEX idx_user_purpose (user_id, purpose)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `,
  `
    CREATE TABLE IF NOT EXISTS user_settings (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT UNIQUE NOT NULL,
      theme VARCHAR(20) DEFAULT 'purple',
      tts_enabled TINYINT(1) DEFAULT 0,
      tts_engine VARCHAR(20) DEFAULT 'browser',
      tts_voice_uri VARCHAR(200) DEFAULT '',
      qwen_voice_id VARCHAR(200) DEFAULT '',
      temperature DECIMAL(3, 2) DEFAULT 0.80,
      max_tokens INT DEFAULT 2048,
      auto_moments_enabled TINYINT(1) DEFAULT 0,
      auto_moments_frequency_hours INT DEFAULT 24,
      auto_moments_quiet_enabled TINYINT(1) DEFAULT 1,
      auto_moments_quiet_start VARCHAR(5) DEFAULT '23:00',
      auto_moments_quiet_end VARCHAR(5) DEFAULT '08:00',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `,
  `
    CREATE TABLE IF NOT EXISTS sessions (
      session_id VARCHAR(128) PRIMARY KEY,
      expires INT UNSIGNED NOT NULL,
      data MEDIUMTEXT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `,
  `
    CREATE TABLE IF NOT EXISTS invites (
      code VARCHAR(50) PRIMARY KEY,
      note VARCHAR(200) DEFAULT '',
      status VARCHAR(20) DEFAULT 'unused',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      used_by INT DEFAULT NULL,
      used_at DATETIME DEFAULT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `,
  `
    CREATE TABLE IF NOT EXISTS invite_codes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      code VARCHAR(50) UNIQUE NOT NULL,
      created_by INT DEFAULT NULL,
      used_by INT DEFAULT NULL,
      max_uses INT DEFAULT 1,
      used_count INT DEFAULT 0,
      is_active TINYINT(1) DEFAULT 1,
      note VARCHAR(200) DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      used_at DATETIME DEFAULT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `
];

const schemaFixups = [
  { sql: "ALTER TABLE users MODIFY COLUMN role VARCHAR(20) DEFAULT 'user'" },
  { table: 'users', column: 'status', definition: "VARCHAR(20) DEFAULT 'active'", after: 'role' },
  { table: 'users', column: 'nickname', definition: "VARCHAR(50) DEFAULT ''", after: 'username' },
  { table: 'users', column: 'avatar', definition: "VARCHAR(500) DEFAULT ''", after: 'nickname' },
  {
    sql: `
      UPDATE users
      SET status = CASE WHEN is_enabled = 1 THEN 'active' ELSE 'banned' END
      WHERE status IS NULL OR status = ''
    `
  },
  { table: 'characters', column: 'char_key', definition: "VARCHAR(50) DEFAULT ''", after: 'user_id' },
  { table: 'characters', column: 'tag', definition: "VARCHAR(50) DEFAULT '恋人'", after: 'name' },
  { table: 'characters', column: 'persona', definition: 'TEXT', after: 'tag' },
  { table: 'characters', column: 'mood', definition: 'INT DEFAULT 80', after: 'portrait_custom_url' },
  { table: 'characters', column: 'intimacy', definition: 'INT DEFAULT 50', after: 'mood' },
  { table: 'characters', column: 'is_deleted', definition: 'TINYINT(1) DEFAULT 0', after: 'is_active' },
  { table: 'characters', column: 'delete_after', definition: 'DATETIME DEFAULT NULL', after: 'is_deleted' },
  { table: 'characters', column: 'auto_moments_enabled', definition: 'TINYINT(1) DEFAULT 0', after: 'intimacy' },
  { table: 'characters', column: 'first_chat_at', definition: 'DATETIME DEFAULT NULL', after: 'intimacy' },
  { table: 'characters', column: 'auto_moments_daily_min', definition: 'INT DEFAULT 0', after: 'auto_moments_enabled' },
  { table: 'characters', column: 'auto_moments_daily_max', definition: 'INT DEFAULT 0', after: 'auto_moments_daily_min' },
  { table: 'characters', column: 'auto_moments_min_interval_hours', definition: 'INT DEFAULT 4', after: 'auto_moments_daily_max' },
  { table: 'characters', column: 'auto_moments_last_posted_at', definition: 'DATETIME DEFAULT NULL', after: 'auto_moments_min_interval_hours' },
  { table: 'characters', column: 'portrait_id', definition: 'INT DEFAULT NULL', after: 'avatar' },
  { table: 'characters', column: 'portrait_custom_url', definition: 'VARCHAR(255) DEFAULT NULL', after: 'portrait_id' },
  { table: 'characters', column: 'speech_style', definition: "VARCHAR(20) DEFAULT 'natural'", after: 'mood' },
  { table: 'memories', column: 'category', definition: "VARCHAR(50) DEFAULT ''", after: 'tag' },
  { table: 'memories', column: 'is_important', definition: 'TINYINT(1) DEFAULT 0', after: 'category' },
  { table: 'memories', column: 'is_deleted', definition: 'TINYINT(1) DEFAULT 0', after: 'is_important' },
  { table: 'moments', column: 'character_id', definition: 'INT DEFAULT NULL', modify: true },
  { table: 'moments', column: 'images', definition: 'JSON', after: 'content' },
  { table: 'moments', column: 'likes_count', definition: 'INT DEFAULT 0', after: 'images' },
  { table: 'moments', column: 'is_deleted', definition: 'TINYINT(1) DEFAULT 0', after: 'created_at' },
  { table: 'model_configs', column: 'provider_type', definition: "VARCHAR(50) DEFAULT 'openai-compatible'", after: 'name' },
  { table: 'model_configs', column: 'api_base', definition: "VARCHAR(500) DEFAULT ''", after: 'provider_type' },
  { table: 'model_configs', column: 'model', definition: "VARCHAR(100) DEFAULT ''", after: 'api_key' },
  { table: 'model_configs', column: 'purpose', definition: "VARCHAR(20) DEFAULT 'chat'", after: 'model' },
  { table: 'model_configs', column: 'is_active', definition: 'TINYINT(1) DEFAULT 0', after: 'purpose' },
  { table: 'user_settings', column: 'auto_moments_enabled', definition: 'TINYINT(1) DEFAULT 0', after: 'max_tokens' },
  { table: 'user_settings', column: 'auto_moments_frequency_hours', definition: 'INT DEFAULT 24', after: 'auto_moments_enabled' },
  { table: 'user_settings', column: 'auto_moments_quiet_enabled', definition: 'TINYINT(1) DEFAULT 1', after: 'auto_moments_frequency_hours' },
  { table: 'user_settings', column: 'auto_moments_quiet_start', definition: "VARCHAR(5) DEFAULT '23:00'", after: 'auto_moments_quiet_enabled' },
  { table: 'user_settings', column: 'auto_moments_quiet_end', definition: "VARCHAR(5) DEFAULT '08:00'", after: 'auto_moments_quiet_start' },
  {
    requiredColumns: ['relationship', 'personality', 'profile_json', 'deleted_at'],
    sql: `
      UPDATE characters
      SET
        char_key = CASE
          WHEN char_key IS NULL OR char_key = '' THEN CONCAT('role-', id)
          ELSE char_key
        END,
        tag = CASE
          WHEN tag IS NULL OR tag = '' THEN COALESCE(NULLIF(relationship, ''), '恋人')
          ELSE tag
        END,
        persona = CASE
          WHEN persona IS NULL OR persona = '' THEN COALESCE(NULLIF(personality, ''), NULLIF(profile_json, ''), '')
          ELSE persona
        END,
        mood = CASE
          WHEN mood IS NULL THEN 80
          ELSE mood
        END,
        intimacy = CASE
          WHEN intimacy IS NULL THEN 50
          ELSE intimacy
        END,
        is_deleted = CASE
          WHEN deleted_at IS NULL THEN 0
          ELSE 1
        END
    `
  },
  {
    requiredColumns: ['type', 'base_url', 'model_name', 'is_enabled'],
    sql: `
      UPDATE model_configs
      SET
        provider_type = CASE
          WHEN provider_type IS NULL OR provider_type = '' THEN COALESCE(NULLIF(type, ''), 'openai-compatible')
          ELSE provider_type
        END,
        api_base = CASE
          WHEN api_base IS NULL OR api_base = '' THEN COALESCE(NULLIF(base_url, ''), '')
          ELSE api_base
        END,
        model = CASE
          WHEN model IS NULL OR model = '' THEN COALESCE(NULLIF(model_name, ''), '')
          ELSE model
        END,
        is_active = CASE
          WHEN is_active IS NULL THEN COALESCE(is_enabled, 0)
          ELSE is_active
        END
    `
  },
  {
    sql: `
      UPDATE model_configs
      SET purpose = 'chat'
      WHERE purpose IS NULL OR purpose = ''
    `
  },
  {
    sql: `
      INSERT INTO invites (code, note, status, created_at, used_by, used_at)
      SELECT
        code,
        COALESCE(note, ''),
        CASE
          WHEN COALESCE(is_active, 1) = 0 THEN 'revoked'
          WHEN COALESCE(used_count, 0) >= COALESCE(max_uses, 1) THEN 'used'
          ELSE 'unused'
        END,
        created_at,
        used_by,
        used_at
      FROM invite_codes
      WHERE code IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM invites WHERE invites.code = invite_codes.code
        )
    `
  }
];

async function columnExists(tableName, columnName) {
  const [rows] = await pool.query(
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

async function tableColumns(tableName) {
  const [rows] = await pool.query(
    `
      SELECT COLUMN_NAME
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
    `,
    [tableName]
  );

  return new Set(rows.map(row => row.COLUMN_NAME));
}

async function applySchemaFixups() {
  for (const fixup of schemaFixups) {
    if (fixup.sql) {
      if (fixup.requiredColumns) {
        const existingColumns = await tableColumns(fixup.table);
        if (!fixup.requiredColumns.every(column => existingColumns.has(column))) {
          continue;
        }
      }

      await pool.query(fixup.sql);
      continue;
    }

    if (await columnExists(fixup.table, fixup.column)) {
      if (fixup.modify) {
        await pool.query(
          `ALTER TABLE ${fixup.table} MODIFY COLUMN ${fixup.column} ${fixup.definition}`
        );
      }
      continue;
    }

    const existingColumns = await tableColumns(fixup.table);
    const afterClause = fixup.after && existingColumns.has(fixup.after) ? ` AFTER ${fixup.after}` : '';

    await pool.query(
      `ALTER TABLE ${fixup.table} ADD COLUMN ${fixup.column} ${fixup.definition}${afterClause}`
    );
  }
}

async function init() {
  try {
    await ensureDatabaseExists();

    for (const statement of statements) {
      await pool.query(statement);
    }

    await applySchemaFixups();

    // 检查是否已有管理员，没有则创建默认管理员
    const [adminRows] = await pool.query(
      "SELECT id FROM users WHERE role = 'owner' LIMIT 1"
    );

    if (adminRows.length === 0) {
      const hash = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 12);
      const [result] = await pool.query(
        `INSERT INTO users (username, password_hash, role, is_enabled, daily_chat_used, created_at)
         VALUES (?, ?, 'owner', 1, 0, NOW())`,
        [DEFAULT_ADMIN_USERNAME, hash]
      );
      const adminId = result.insertId;

      // 创建默认角色
      for (const character of DEFAULT_CHARACTERS) {
        await pool.query(
          `INSERT INTO characters
            (user_id, char_key, name, tag, persona, avatar, mood, intimacy, is_active, is_deleted)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
          [adminId, character.char_key, character.name, character.tag,
           character.persona, character.avatar, character.mood, character.intimacy, character.is_active]
        );
      }

      // 创建默认模型配置
      await pool.query(
        `INSERT INTO model_configs (user_id, name, provider_type, api_base, api_key, model, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
        [adminId, DEFAULT_MODEL_CONFIG.name, DEFAULT_MODEL_CONFIG.provider_type,
         DEFAULT_MODEL_CONFIG.api_base, DEFAULT_MODEL_CONFIG.api_key, DEFAULT_MODEL_CONFIG.model, DEFAULT_MODEL_CONFIG.is_active]
      );

      // 创建用户设置
      await pool.query(
        `INSERT INTO user_settings (user_id, theme, tts_enabled, tts_engine, temperature, max_tokens)
         VALUES (?, 'purple', 0, 'browser', 0.80, 2048)`,
        [adminId]
      );

      console.log(`\n  默认管理员账号已创建：`);
      console.log(`  用户名：${DEFAULT_ADMIN_USERNAME}`);
      console.log(`  密码：${DEFAULT_ADMIN_PASSWORD}`);
      console.log(`  ⚠️  请尽快登录后台更改账号密码\n`);
    }

    await runCredentialMigration({
      pool,
      ensureDatabaseExists: async () => {}
    });

    console.log('Database initialized successfully.');
  } catch (error) {
    console.error(`Database initialization failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

await init();
