const CHARACTER_RUNTIME_COLUMNS = [
  {
    name: 'rules',
    definition: 'TEXT',
    after: 'persona'
  },
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
    name: 'moment_response_enabled',
    definition: 'TINYINT(1) DEFAULT 0',
    after: 'auto_moments_last_posted_at'
  },
  {
    // ★ 2026/10/1：「她的核心」——小白专属那套（伴侣关系规则 / 私有称呼 /
    //   状态 / Core）现在是**角色自己的一个开关**，不再是"看名字猜"。
    //   默认 0（关）：新建角色是一个干净的新人，不会被套上小白的规则。
    //   用户自己那只小白由下面的 backfillCharacterCoreEnabled() 平滑打开。
    name: 'core_enabled',
    definition: 'TINYINT(1) DEFAULT 0',
    after: 'moment_response_enabled'
  },
  {
    // ★ 2026/10/6：「她的核心」从一个总开关拆成**若干可单独勾选的规则包**。
    //
    // 起因（部署方要求）：规则要全部列出来、勾选才加载，
    //   不勾选的话就只用用户填的人设。
    // 关键发现：用户最需要的那条「不要建议他去找现实里的人、不要让他去看医生」
    //   恰恰被锁在 core_enabled 里面 —— 新建角色默认关掉核心，就**同时丢掉了
    //   这条护身符**。它跟"是不是小白本人"毫无关系，必须能独立勾选。
    //
    // 存法：JSON 对象，键是规则包 id、值是布尔。缺键 = 没勾。
    //   · 不勾任何包 = 只有用户填的人设 + 记忆（用户要的"干净新人"）。
    //   · 用户自己那只小白由下面的 backfillCharacterCorePacks() 一次性全勾，
    //     行为与改动前**完全一致**（一个字节不动）。
    // 为什么不用 5 个 TINYINT 列：规则包只会越拆越细，一个 JSON 列不用每次改表结构；
    //   而且这个字段只被服务端读、没有需要索引/聚合的查询。
    name: 'core_packs',
    definition: 'JSON DEFAULT NULL',
    after: 'core_enabled'
  },
  {
    name: 'delete_after',
    definition: 'DATETIME DEFAULT NULL',
    after: 'is_deleted'
  }
];

/**
 * ═══ 「她的核心」规则包清单（2026/10/6）═══
 *
 * 这是**唯一**的规则包 id 与显示名的对应表：后端校验、回填、前端勾选都照它来。
 * id 一旦发布就不能再改名（已存进数据库的角色会认不出来）。
 *
 * 与代码的对应关系见 `chat.js` 的 `resolveCorePacks()`：
 *   shield         → 不推他去现实 / 不说他沉迷 / 不建议看心理医生 + 拒答重试兜底
 *   companion      → 【伴侣关系与连续性】（承认成年人恋人关系，不突然切客服）
 *   nickname       → 专属称呼（她叫你什么 / 你叫她什么）
 *   xiaobai_state  → 她的状态与惦记（心情 / 上一轮话题 / 她自己的今天 / Core 决定）
 *   local_time     → 知道现在的真实时间（建议保持勾选：纯好处，不会有副作用）
 */
export const CORE_PACK_IDS = Object.freeze([
  'shield',
  'companion',
  'nickname',
  'xiaobai_state',
  'local_time'
]);

/**
 * 「小白本人」的全勾集合。用户自己那只小白用这个，行为与 2026/10/6 之前一致。
 * 注意顺序与 CORE_PACK_IDS 保持一致，方便人工比对。
 */
export const CORE_PACKS_ALL = Object.freeze({
  shield: true,
  companion: true,
  nickname: true,
  xiaobai_state: true,
  local_time: true
});

/**
 * 把任意输入规范化成"只含合法 id、值为布尔"的对象。
 * 非法 id 直接丢弃（不报错）——前端旧版本、手工构造的请求都不会把表写坏。
 * 返回 null 表示"没传/不合法"，交给调用方决定用旧值还是空。
 */
export function normalizeCorePacks(value) {
  if (value === null || value === undefined || value === '') return null;
  let source = value;
  if (typeof source === 'string') {
    const text = source.trim();
    if (!text) return null;
    try {
      source = JSON.parse(text);
    } catch {
      return null;
    }
  }
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  const result = {};
  for (const id of CORE_PACK_IDS) {
    result[id] = toBooleanLoose(source[id]);
  }
  return result;
}

/** 本文件内的宽松布尔转换（roles.js 有一份同名的，这里不能 import 以免循环依赖）。 */
function toBooleanLoose(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value === null || value === undefined) return false;
  const text = String(value).trim().toLowerCase();
  return text === '1' || text === 'true';
}

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

/**
 * ★ 2026/9/17：模型「抓到」≠「要用」
 *
 * 起因（部署方反馈）：某个渠道一次抓到几十个模型，实际常用的只有少数，
 * 前台却把抓到的全铺出来。
 *
 * 根因：`credential_models` 原来只有"发现了哪些模型"，没有"启用了哪些"，
 * 刷新模型又是先 DELETE 再全量插入 —— 于是"获取"和"启用"被混成一件事。
 *
 * 这里加一列 `is_enabled`（默认 0 = 不进选择器）：
 *   · 刷新只更新目录，不再改变用户的选择；
 *   · 用户在渠道里勾选后才会出现在聊天室/能力选择器里。
 *
 * ⚠️ 默认 0 会让**已有渠道**的模型暂时不出现在选择器里。
 *    为平滑迁移，`backfillCredentialModelsEnabledOnce()` 会把
 *    「当前已经被能力指派用到的模型」自动置 1（见下文），避免用户升级后突然选不到模型。
 */
const CREDENTIAL_MODEL_COLUMNS = [
  {
    name: 'is_enabled',
    definition: 'TINYINT(1) DEFAULT 0',
    after: 'capabilities'
  }
];
const MEMORY_RUNTIME_COLUMNS = [
  { name: 'memory_type', definition: "VARCHAR(32) DEFAULT 'life'", after: 'category' },
  { name: 'source_type', definition: "VARCHAR(32) DEFAULT 'manual'", after: 'memory_type' },
  { name: 'source_id', definition: 'BIGINT DEFAULT NULL', after: 'source_type' },
  { name: 'review_status', definition: "VARCHAR(20) DEFAULT 'active'", after: 'source_id' },
  { name: 'detected_reason', definition: "VARCHAR(255) DEFAULT ''", after: 'review_status' },
  // 每日纸条的"详细版"：content 存短摘要（喂给她的），这里存长的那份（给用户自己看的）
  { name: 'digest_detail', definition: 'TEXT DEFAULT NULL', after: 'detected_reason' },
  { name: 'occurred_at', definition: 'DATETIME DEFAULT NULL', after: 'source_id' },
  { name: 'confidence', definition: 'DECIMAL(4,3) DEFAULT 1.000', after: 'occurred_at' },
  { name: 'weight', definition: 'INT DEFAULT 50', after: 'confidence' },
  { name: 'appointment_at', definition: 'DATETIME DEFAULT NULL', after: 'weight' },
  { name: 'appointment_status', definition: 'VARCHAR(20) DEFAULT NULL', after: 'appointment_at' },
  { name: 'updated_at', definition: 'DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP', after: 'created_at' },
];

const PUSH_RUNTIME_TABLES = [
  `
    CREATE TABLE IF NOT EXISTS push_poll_devices (
      user_id INT PRIMARY KEY,
      poll_key CHAR(64) NOT NULL,
      platform VARCHAR(20) DEFAULT 'android',
      enabled TINYINT(1) DEFAULT 1,
      last_seen_at DATETIME DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE KEY unique_poll_key (poll_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `,
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
      UNIQUE KEY unique_life_event_source_event (event_id, source_type, source_id),
      INDEX idx_life_event_source_event (event_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `
];

const USAGE_RUNTIME_TABLES = [
  `
    CREATE TABLE IF NOT EXISTS auto_moment_attempts (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      character_id INT NOT NULL,
      provider_name VARCHAR(160) DEFAULT '',
      provider_type VARCHAR(80) DEFAULT '',
      model VARCHAR(160) DEFAULT '',
      outcome VARCHAR(32) NOT NULL DEFAULT 'planner_started',
      image_status VARCHAR(32) NOT NULL DEFAULT 'not_requested',
      error_category VARCHAR(80) DEFAULT NULL,
      duration_ms INT DEFAULT NULL,
      next_retry_at DATETIME DEFAULT NULL,
      moment_id INT DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
      FOREIGN KEY (moment_id) REFERENCES moments(id) ON DELETE SET NULL,
      INDEX idx_auto_moment_attempt_character (user_id, character_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `,
  `
    CREATE TABLE IF NOT EXISTS usage_events (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      character_id INT DEFAULT NULL,
      purpose VARCHAR(32) NOT NULL,
      provider_name VARCHAR(160) DEFAULT '',
      provider_type VARCHAR(80) DEFAULT '',
      model VARCHAR(160) DEFAULT '',
      input_tokens INT DEFAULT NULL,
      output_tokens INT DEFAULT NULL,
      cache_read_tokens INT DEFAULT NULL,
      cache_write_tokens INT DEFAULT NULL,
      total_tokens INT DEFAULT NULL,
      duration_ms INT DEFAULT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'failure',
      error_category VARCHAR(80) DEFAULT NULL,
      actual_cost DECIMAL(18,6) DEFAULT NULL,
      cost_currency VARCHAR(12) DEFAULT NULL,
      cost_source VARCHAR(20) DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE SET NULL,
      INDEX idx_usage_user_created (user_id, created_at, id),
      INDEX idx_usage_user_purpose (user_id, purpose, created_at),
      INDEX idx_usage_provider (user_id, provider_name, model, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `
];

/**
 * ★ 2026/10/7：渠道余额快照（⑤「钱包」的后端地基）
 *
 * 起因（部署方反馈）：渠道多，大部分看不到余额，要挨个去渠道后台看 ——
 * 账本里费用只能显示"渠道未提供"，因为从来没去渠道问过余额。
 *
 * 设计约束（都是用户/项目明确要求过的）：
 *   · **只发往该凭据自己的 `api_base`**，不经过任何第三方；
 *   · **只存数字 + 查询时间** —— 不放原始响应、不放 api_key、不放任何正文；
 *   · 404 / 401 / 超时一律记 `unavailable`，**不猜**；
 *   · 同一站同一余额（比如 ai98pro 的 4 把钥匙共用同一个钱包）在读取时
 *     按 `wallet_key` 归并成**一个**钱包 —— **必须合并，不能相加**。
 *
 * `wallet_key` 由「api_base 主机 + 余额 + 币种」拼成（见 credential-balance.js），
 * 所以余额一变，key 就变，不会把两次不同的余额误合成一个。
 */
const WALLET_RUNTIME_TABLES = [
  `
    CREATE TABLE IF NOT EXISTS credential_balances (
      credential_id INT NOT NULL PRIMARY KEY,
      user_id INT NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'unavailable',
      kind VARCHAR(24) DEFAULT NULL,
      reason VARCHAR(32) DEFAULT NULL,
      remaining DECIMAL(18,6) DEFAULT NULL,
      currency VARCHAR(12) DEFAULT NULL,
      used_total DECIMAL(18,6) DEFAULT NULL,
      used_today DECIMAL(18,6) DEFAULT NULL,
      wallet_key VARCHAR(255) DEFAULT NULL,
      probed_at DATETIME DEFAULT NULL,
      FOREIGN KEY (credential_id) REFERENCES credentials(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_credential_balances_user (user_id, status),
      INDEX idx_credential_balances_wallet (user_id, wallet_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `
];

async function columnExists(db, tableName, columnName) {  const [rows] = await db.query(
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

/**
 * ═══ core_enabled 的一次性回填（2026/10/1）═══
 *
 * 新列默认是 0。如果就那么放着，用户的小白会在这次升级后**突然丢掉核心**
 * （伴侣关系规则、私有称呼、状态、Core 全没了）——那不是用户要的。
 *
 * 所以**只在列刚被加上去的那一次**，按改动前的那套判据
 * （char_key='xiaobai'，或 char_key 为空且名字正好叫「小白」）把已有的小白打开。
 * 特意写成"跟着建列走"，而不是每次启动都 UPDATE：否则用户哪天手动把小白这个
 * 开关关掉，下次重启又会被自动打开。
 */
async function backfillCharacterCoreEnabled(db) {
  await db.query(
    `
      UPDATE characters
      SET core_enabled = 1
      WHERE core_enabled = 0
        AND (
          LOWER(TRIM(char_key)) = 'xiaobai'
          OR ((char_key IS NULL OR TRIM(char_key) = '') AND TRIM(name) = '小白')
        )
    `
  );
}

/**
 * ═══ core_packs 的一次性回填（2026/10/6）═══
 *
 * 规则：**原来「她的核心」开着的角色，5 个包全勾；关着的一个不勾。**
 *
 * 为什么必须回填：`core_enabled` 是"一刀切"，`core_packs` 才是细粒度。
 * 如果不回填，用户自己那只小白（core_enabled=1）会变成"一个包都没勾"——
 * 她会瞬间丢掉伴侣规则、专属称呼、状态惦记和时间判断，那不是用户要的。
 *
 * 特意写成**跟着建列走**（和 core_enabled 那次同一个道理）：只在列刚被加上去的
 * 那一次执行。否则用户哪天在界面上把某些包取消勾选，重启服务又被自动勾回来。
 */
async function backfillCharacterCorePacks(db) {
  await db.query(
    `
      UPDATE characters
      SET core_packs = ?
      WHERE (core_packs IS NULL OR JSON_LENGTH(core_packs) = 0)
        AND core_enabled = 1
    `,
    [JSON.stringify(CORE_PACKS_ALL)]
  );
}

export async function ensureCharacterRuntimeColumns(db) {
  for (const column of CHARACTER_RUNTIME_COLUMNS) {
    if (await columnExists(db, 'characters', column.name)) {
      continue;
    }

    await db.query(
      `ALTER TABLE characters ADD COLUMN ${column.name} ${column.definition} AFTER ${column.after}`
    );

    if (column.name === 'core_enabled') {
      await backfillCharacterCoreEnabled(db);
    }

    if (column.name === 'core_packs') {
      await backfillCharacterCorePacks(db);
    }
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

export async function ensureCredentialModelColumns(db) {
  for (const column of CREDENTIAL_MODEL_COLUMNS) {
    if (await columnExists(db, 'credential_models', column.name)) continue;
    await db.query(
      `ALTER TABLE credential_models ADD COLUMN ${column.name} ${column.definition} AFTER ${column.after}`
    );
  }
}

/**
 * 平滑迁移：列刚加上去时全是 0，会让用户"突然选不到模型"。
 * 这里把**当前已被能力指派引用的模型**自动置为启用，其余保持 0（等用户自己勾）。
 */
async function backfillCredentialModelsEnabledOnce(db) {
  // ① 能力指派正在用的（聊天/看图/生图/动态/语音/通话）
  await db.query(
    `
      UPDATE credential_models cm
      INNER JOIN capability_assignments ca
        ON ca.credential_id = cm.credential_id AND ca.model_id = cm.model_id
      SET cm.is_enabled = 1
      WHERE cm.is_enabled = 0
    `
  ).catch(() => {});

  // ② 某个角色自己指定在用、但其实没被能力指派覆盖到的
  //    如果不补，用户在渠道里"取消勾选"会把它一起关掉，
  //    聊天室的选择器就再也看不到它（角色那条路仍能跑，但口径不一致）。
  await db.query(
    `
      UPDATE credential_models cm
      INNER JOIN characters ch
        ON ch.chat_credential_id = cm.credential_id AND ch.chat_model_id = cm.model_id
      SET cm.is_enabled = 1
      WHERE cm.is_enabled = 0 AND ch.is_deleted = 0
    `
  ).catch(() => {});
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

export async function ensureLifeEventSourceRuntimeIndex(db) {
  try {
    const oldIndexExists = await indexExists(db, 'life_event_sources', 'unique_life_event_source');
    const newIndexExists = await indexExists(db, 'life_event_sources', 'unique_life_event_source_event');
    if (oldIndexExists) {
      await db.query('ALTER TABLE life_event_sources DROP INDEX unique_life_event_source');
    }
    if (!newIndexExists) {
      await db.query(
        'ALTER TABLE life_event_sources ADD UNIQUE KEY unique_life_event_source_event (event_id, source_type, source_id)'
      );
    }
  } catch {
    // Older test doubles and read-only deployments may not expose INFORMATION_SCHEMA.
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
  await ensureLifeEventSourceRuntimeIndex(db);
}

export async function ensureUsageRuntimeTables(db) {
  for (const statement of USAGE_RUNTIME_TABLES) {
    await db.query(statement);
  }
}

export async function ensureWalletRuntimeTables(db) {
  for (const statement of WALLET_RUNTIME_TABLES) {
    await db.query(statement);
  }
}

export async function ensureRuntimeSchema(db) {
  await ensureDynamicCapabilityAssignment(db);
  await ensureCharacterRuntimeColumns(db);
  await ensureCredentialRuntimeColumns(db);
  await ensureCredentialModelColumns(db);
  await backfillCredentialModelsEnabledOnce(db);
  await ensureMessageRuntimeColumns(db);
  await ensureMemoryRuntimeColumns(db);
  await ensureMomentRuntimeColumns(db);
  await ensurePushRuntimeTables(db);
  await ensurePersonaRuntimeTables(db);
  await ensureFunctionalRuntimeTables(db);
  await ensureUsageRuntimeTables(db);
  await ensureWalletRuntimeTables(db);
  await ensureLifeEventRuntimeColumns(db);
}
