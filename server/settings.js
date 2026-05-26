import express from 'express';
import { pool as defaultPool } from './db.js';
import { getRequestCharacterId } from './middleware.js';
import {
  asyncHandler,
  clamp,
  getActiveCharacter,
  parseInteger,
  requireCharacterForUser,
  toBoolean
} from './helpers.js';

function normalizeTime(value, fallback) {
  const raw = String(value ?? '').trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(raw) ? raw : fallback;
}

async function ensureSettingsRow(db, userId) {
  await db.query(
    `
      INSERT INTO user_settings
        (
          user_id,
          theme,
          tts_enabled,
          tts_engine,
          tts_voice_uri,
          qwen_voice_id,
          temperature,
          max_tokens,
          auto_moments_enabled,
          auto_moments_frequency_hours,
          auto_moments_quiet_enabled,
          auto_moments_quiet_start,
          auto_moments_quiet_end
        )
      VALUES (?, 'purple', 0, 'browser', '', '', 0.80, 2048, 0, 24, 1, '23:00', '08:00')
      ON DUPLICATE KEY UPDATE user_id = VALUES(user_id)
    `,
    [userId]
  );
}

async function readSettings(db, userId) {
  await ensureSettingsRow(db, userId);
  const [rows] = await db.query(
    `
      SELECT
        id,
        user_id,
        theme,
        tts_enabled,
        tts_engine,
        tts_voice_uri,
        qwen_voice_id,
        temperature,
        max_tokens,
        auto_moments_enabled,
        auto_moments_frequency_hours,
        auto_moments_quiet_enabled,
        auto_moments_quiet_start,
        auto_moments_quiet_end,
        created_at,
        updated_at
      FROM user_settings
      WHERE user_id = ?
      LIMIT 1
    `,
    [userId]
  );
  return rows[0];
}

async function refreshDailyUsage(db, userId) {
  await db.query(
    `
      UPDATE users
      SET
        daily_chat_used = IF(daily_chat_reset_at IS NULL OR DATE(daily_chat_reset_at) <> CURRENT_DATE(), 0, daily_chat_used),
        daily_chat_reset_at = IF(daily_chat_reset_at IS NULL OR DATE(daily_chat_reset_at) <> CURRENT_DATE(), NOW(), daily_chat_reset_at)
      WHERE id = ?
    `,
    [userId]
  );

  const [rows] = await db.query(
    `
      SELECT id, daily_chat_used, daily_chat_reset_at
      FROM users
      WHERE id = ?
      LIMIT 1
    `,
    [userId]
  );

  return rows[0];
}

async function readUsageStats(db, userId) {
  const usage = await refreshDailyUsage(db, userId);

  const [[userRows], [messageRows], [memoryRows], [roleRows], [postRows], [modelRows]] = await Promise.all([
    db.query(
      `
        SELECT id, username, created_at
        FROM users
        WHERE id = ?
        LIMIT 1
      `,
      [userId]
    ),
    db.query(
      `
        SELECT COUNT(*) AS total
        FROM messages
        WHERE user_id = ? AND is_active = 1
      `,
      [userId]
    ),
    db.query(
      `
        SELECT COUNT(*) AS total
        FROM memories
        WHERE user_id = ? AND is_deleted = 0
      `,
      [userId]
    ),
    db.query(
      `
        SELECT COUNT(*) AS total
        FROM characters
        WHERE user_id = ? AND is_deleted = 0
      `,
      [userId]
    ),
    db.query(
      `
        SELECT COUNT(*) AS total
        FROM posts
        WHERE user_id = ?
      `,
      [userId]
    ),
    db.query(
      `
        SELECT name
        FROM model_configs
        WHERE user_id = ? AND is_active = 1
        ORDER BY id DESC
        LIMIT 1
      `,
      [userId]
    )
  ]);

  return {
    daily_chat_used: Number(usage?.daily_chat_used || 0),
    daily_chat_reset_at: usage?.daily_chat_reset_at || null,
    daily_limit: 200,
    messages_total: Number(messageRows[0]?.total || 0),
    memories_total: Number(memoryRows[0]?.total || 0),
    roles_total: Number(roleRows[0]?.total || 0),
    posts_total: Number(postRows[0]?.total || 0),
    current_model_name: modelRows[0]?.name || '',
    username: userRows[0]?.username || '',
    registered_at: userRows[0]?.created_at || null
  };
}

async function handleSettingsUpdate(db, req, res) {
  await ensureSettingsRow(db, req.userId);

  const theme = req.body?.theme !== undefined ? String(req.body.theme).trim() : null;
  const ttsEnabled = req.body?.tts_enabled !== undefined ? (toBoolean(req.body.tts_enabled) ? 1 : 0) : null;
  const ttsEngine = req.body?.tts_engine !== undefined ? String(req.body.tts_engine).trim() : null;
  const ttsVoiceUri = req.body?.tts_voice_uri !== undefined ? String(req.body.tts_voice_uri).trim() : null;
  const qwenVoiceId = req.body?.qwen_voice_id !== undefined ? String(req.body.qwen_voice_id).trim() : null;
  const temperature = req.body?.temperature !== undefined ? Number(req.body.temperature) : null;
  const maxTokens = req.body?.max_tokens !== undefined ? Number.parseInt(req.body.max_tokens, 10) : null;
  const autoMomentsEnabled = req.body?.auto_moments_enabled !== undefined
    ? (toBoolean(req.body.auto_moments_enabled) ? 1 : 0)
    : null;
  const autoMomentsFrequencyHours = req.body?.auto_moments_frequency_hours !== undefined
    ? clamp(parseInteger(req.body.auto_moments_frequency_hours, 24), 1, 168)
    : null;
  const autoMomentsQuietEnabled = req.body?.auto_moments_quiet_enabled !== undefined
    ? (toBoolean(req.body.auto_moments_quiet_enabled) ? 1 : 0)
    : null;
  const autoMomentsQuietStart = req.body?.auto_moments_quiet_start !== undefined
    ? normalizeTime(req.body.auto_moments_quiet_start, '23:00')
    : null;
  const autoMomentsQuietEnd = req.body?.auto_moments_quiet_end !== undefined
    ? normalizeTime(req.body.auto_moments_quiet_end, '08:00')
    : null;

  await db.query(
    `
      UPDATE user_settings
      SET
        theme = COALESCE(?, theme),
        tts_enabled = COALESCE(?, tts_enabled),
        tts_engine = COALESCE(?, tts_engine),
        tts_voice_uri = COALESCE(?, tts_voice_uri),
        qwen_voice_id = COALESCE(?, qwen_voice_id),
        temperature = COALESCE(?, temperature),
        max_tokens = COALESCE(?, max_tokens),
        auto_moments_enabled = COALESCE(?, auto_moments_enabled),
        auto_moments_frequency_hours = COALESCE(?, auto_moments_frequency_hours),
        auto_moments_quiet_enabled = COALESCE(?, auto_moments_quiet_enabled),
        auto_moments_quiet_start = COALESCE(?, auto_moments_quiet_start),
        auto_moments_quiet_end = COALESCE(?, auto_moments_quiet_end)
      WHERE user_id = ?
    `,
    [
      theme,
      ttsEnabled,
      ttsEngine,
      ttsVoiceUri,
      qwenVoiceId,
      temperature,
      maxTokens,
      autoMomentsEnabled,
      autoMomentsFrequencyHours,
      autoMomentsQuietEnabled,
      autoMomentsQuietStart,
      autoMomentsQuietEnd,
      req.userId
    ]
  );

  const settings = await readSettings(db, req.userId);
  return res.json({ success: true, item: settings });
}

export function createSettingsRouter({ pool = defaultPool } = {}) {
  const router = express.Router();

  router.get('/', asyncHandler(async (req, res) => {
    if (req.baseUrl.endsWith('/relationship')) {
      try {
        const requestedCharacterId = getRequestCharacterId(req);
        const character = requestedCharacterId
          ? await requireCharacterForUser(req.userId, requestedCharacterId, pool)
          : await getActiveCharacter(req.userId, pool);

        if (!character) {
          return res.status(404).json({ success: false, error: '当前没有可用角色' });
        }

        return res.json({
          success: true,
          item: {
            character_id: character.id,
            char_key: character.char_key,
            name: character.name,
            tag: character.tag,
            mood: character.mood,
            intimacy: character.intimacy,
            is_active: character.is_active
          }
        });
      } catch (error) {
        return res.status(400).json({ success: false, error: error.message });
      }
    }

    if (req.baseUrl.endsWith('/usage')) {
      const usage = await refreshDailyUsage(pool, req.userId);
      return res.json({
        success: true,
        item: {
          daily_chat_used: usage.daily_chat_used,
          daily_chat_reset_at: usage.daily_chat_reset_at
        }
      });
    }

    const settings = await readSettings(pool, req.userId);
    return res.json({ success: true, item: settings });
  }));

  router.get('/stats', asyncHandler(async (req, res) => {
    if (!req.baseUrl.endsWith('/usage')) {
      return res.status(405).json({ success: false, error: '当前路由不支持统计查询' });
    }

    const stats = await readUsageStats(pool, req.userId);
    return res.json({
      success: true,
      item: stats
    });
  }));

  router.put('/', asyncHandler(async (req, res) => {
    if (!req.baseUrl.endsWith('/settings')) {
      return res.status(405).json({ success: false, error: '当前路由不支持修改' });
    }

    return handleSettingsUpdate(pool, req, res);
  }));

  router.patch('/', asyncHandler(async (req, res) => {
    if (!req.baseUrl.endsWith('/settings')) {
      return res.status(405).json({ success: false, error: '当前路由不支持修改' });
    }

    return handleSettingsUpdate(pool, req, res);
  }));

  router.post('/usage/increment', asyncHandler(async (req, res) => {
    const increment = Number.parseInt(req.body?.count, 10) || 1;
    await refreshDailyUsage(pool, req.userId);
    await pool.query(
      'UPDATE users SET daily_chat_used = daily_chat_used + ? WHERE id = ?',
      [increment, req.userId]
    );

    const usage = await refreshDailyUsage(pool, req.userId);
    return res.json({ success: true, item: usage });
  }));

  return router;
}

export default createSettingsRouter();
