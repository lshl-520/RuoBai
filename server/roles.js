import express from 'express';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool as defaultPool, withTransaction as defaultWithTransaction } from './db.js';
import { asyncHandler, clamp, getActiveCharacter, parseInteger, toBoolean } from './helpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const defaultPortraitDir = path.join(projectRoot, 'user_assets', 'portraits');

export function createRolesRouter({
  pool = defaultPool,
  withTransaction = defaultWithTransaction,
  fileStorage = fs,
  portraitDir = defaultPortraitDir,
  now = Date.now
} = {}) {
  const router = express.Router();

function normalizeCharacterKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function buildCharacterKeyCandidate(body = {}) {
  const explicitKey = normalizeCharacterKey(body.char_key);
  if (explicitKey) {
    return explicitKey;
  }

  const nameKey = normalizeCharacterKey(body.name);
  if (nameKey) {
    return nameKey;
  }

  return `role-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}

async function ensureUniqueCharacterKey(connection, userId, preferredKey, excludeCharacterId = null) {
  let candidate = String(preferredKey || '').trim();
  if (!candidate) {
    candidate = `role-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  }

  candidate = candidate.slice(0, 50);
  let attempt = 0;

  while (true) {
    const [rows] = await connection.query(
      excludeCharacterId == null
        ? 'SELECT id FROM characters WHERE user_id = ? AND char_key = ? LIMIT 1'
        : 'SELECT id FROM characters WHERE user_id = ? AND char_key = ? AND id <> ? LIMIT 1',
      excludeCharacterId == null
        ? [userId, candidate]
        : [userId, candidate, excludeCharacterId]
    );

    if (rows.length === 0) {
      return candidate;
    }

    attempt += 1;
    const suffix = `-${attempt}`;
    candidate = `${candidate.slice(0, 50 - suffix.length)}${suffix}`;
  }
}

function sanitizeCharacterPayload(body = {}) {
  const autoMomentsEnabled = Object.prototype.hasOwnProperty.call(body, 'auto_moments_enabled')
    ? toBoolean(body.auto_moments_enabled)
    : false;
  const dailyMin = clamp(parseInteger(body.auto_moments_daily_min, autoMomentsEnabled ? 2 : 0), 0, 6);
  const dailyMax = clamp(parseInteger(body.auto_moments_daily_max, autoMomentsEnabled ? 6 : 0), 0, 6);
  const minIntervalHours = clamp(parseInteger(body.auto_moments_min_interval_hours, 4), 4, 24);
  const rawPortraitId = body.portrait_id === null || body.portraitId === null
    ? null
    : parseInteger(body.portrait_id ?? body.portraitId, null);
  const portraitId = rawPortraitId === null
    ? null
    : ([999, ...Array.from({ length: 18 }, (_item, index) => index)].includes(rawPortraitId) ? rawPortraitId : null);
  const portraitCustomUrl = String(body.portrait_custom_url || body.portraitCustomUrl || '').trim() || null;

  return {
    char_key: buildCharacterKeyCandidate(body),
    name: String(body.name || '').trim(),
    tag: String(body.tag || '').trim(),
    persona: String(body.persona || '').trim(),
    avatar: String(body.avatar || '').trim(),
    portrait_id: portraitId,
    portrait_custom_url: portraitId === 999 ? portraitCustomUrl : null,
    mood: Math.min(100, Math.max(0, parseInteger(body.mood, 80))),
    intimacy: Math.min(100, Math.max(0, parseInteger(body.intimacy, 50))),
    speech_style: ['natural', 'compact', 'roleplay'].includes(body.speech_style) ? body.speech_style : 'natural',
    auto_moments_enabled: autoMomentsEnabled ? 1 : 0,
    auto_moments_daily_min: autoMomentsEnabled ? Math.min(dailyMin, dailyMax) : 0,
    auto_moments_daily_max: autoMomentsEnabled ? Math.max(dailyMin, dailyMax) : 0,
    auto_moments_min_interval_hours: minIntervalHours
  };
}

async function finalizeExpiredCharacterDeletes(userId, connection = pool) {
  const [rows] = await connection.query(
    `
      SELECT id
      FROM characters
      WHERE user_id = ?
        AND is_deleted = 0
        AND delete_after IS NOT NULL
        AND delete_after <= NOW()
    `,
    [userId]
  );

  for (const row of rows) {
    await markCharacterDeleted(connection, userId, row.id);
  }
}

async function ensureActiveCharacter(userId, connection = pool) {
  const [rows] = await connection.query(
    `
      SELECT id, is_active
      FROM characters
      WHERE user_id = ? AND is_deleted = 0
      ORDER BY is_active DESC, id ASC
    `,
    [userId]
  );

  if (!rows.length) {
    return null;
  }

  const hasActive = rows.some(row => Number(row.id) && row.is_active);
  if (!hasActive) {
    await connection.query(
      'UPDATE characters SET is_active = 1 WHERE id = ? AND user_id = ?',
      [rows[0].id, userId]
    );
  }

  return rows[0].id;
}

async function markCharacterDeleted(connection, userId, characterId) {
  const [result] = await connection.query(
    `
      UPDATE characters
      SET is_deleted = 1, is_active = 0, delete_after = NULL
      WHERE id = ? AND user_id = ? AND is_deleted = 0
    `,
    [characterId, userId]
  );

  if (!result.affectedRows) {
    return false;
  }

  await connection.query(
    'UPDATE messages SET is_active = 0 WHERE user_id = ? AND character_id = ?',
    [userId, characterId]
  );
  await connection.query(
    'UPDATE memories SET is_deleted = 1 WHERE user_id = ? AND character_id = ?',
    [userId, characterId]
  );
  await connection.query(
    'UPDATE posts SET character_id = NULL WHERE user_id = ? AND character_id = ?',
    [userId, characterId]
  );
  await connection.query(
    'UPDATE post_comments SET character_id = NULL WHERE user_id = ? AND character_id = ?',
    [userId, characterId]
  );
  await connection.query(
    'UPDATE moments SET character_id = NULL WHERE user_id = ? AND character_id = ?',
    [userId, characterId]
  );
  await connection.query(
    'UPDATE moment_comments SET character_id = NULL WHERE user_id = ? AND character_id = ?',
    [userId, characterId]
  );

  await ensureActiveCharacter(userId, connection);
  return true;
}

async function loadRoles(userId, { includeDeleted = false } = {}, connection = pool) {
  await finalizeExpiredCharacterDeletes(userId, connection);
  await ensureActiveCharacter(userId, connection);

  const [rows] = await connection.query(
    `
      SELECT id, user_id, char_key, name, tag, persona, avatar, portrait_id, portrait_custom_url, mood, intimacy, speech_style, first_chat_at,
             auto_moments_enabled, auto_moments_daily_min, auto_moments_daily_max,
             auto_moments_min_interval_hours, auto_moments_last_posted_at,
             is_active, is_deleted, delete_after, created_at
      FROM characters
      WHERE user_id = ? ${includeDeleted ? '' : 'AND is_deleted = 0'}
      ORDER BY is_deleted ASC, is_active DESC, id ASC
    `,
    [userId]
  );

  return rows;
}

router.get('/', asyncHandler(async (req, res) => {
  const includeDeleted = toBoolean(req.query?.include_deleted);
  const rows = await loadRoles(req.userId, { includeDeleted });

  return res.json({
    success: true,
    items: rows,
    activeCharacterId: rows.find(item => item.is_active)?.id || null
  });
}));

router.post('/', asyncHandler(async (req, res) => {
  const payload = sanitizeCharacterPayload(req.body);
  if (!payload.name) {
    return res.status(400).json({ success: false, error: '角色名称不能为空' });
  }
  if (!payload.persona) {
    return res.status(400).json({ success: false, error: '角色人设不能为空' });
  }

  const created = await withTransaction(async connection => {
    const charKey = await ensureUniqueCharacterKey(connection, req.userId, payload.char_key);
    const [activeRows] = await connection.query(
      'SELECT id FROM characters WHERE user_id = ? AND is_deleted = 0 AND is_active = 1 LIMIT 1',
      [req.userId]
    );

    const [result] = await connection.query(
      `
        INSERT INTO characters
          (
            user_id, char_key, name, tag, persona, avatar, portrait_id, portrait_custom_url, mood, intimacy,
            speech_style,
            auto_moments_enabled, auto_moments_daily_min, auto_moments_daily_max,
            auto_moments_min_interval_hours,
            is_active, is_deleted, delete_after, created_at
          )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NOW())
      `,
      [
        req.userId,
        charKey,
        payload.name,
        payload.tag,
        payload.persona,
        payload.avatar,
        payload.portrait_id,
        payload.portrait_custom_url,
        payload.mood,
        payload.intimacy,
        payload.speech_style,
        payload.auto_moments_enabled,
        payload.auto_moments_daily_min,
        payload.auto_moments_daily_max,
        payload.auto_moments_min_interval_hours,
        activeRows.length === 0 ? 1 : 0
      ]
    );

    const [rows] = await connection.query(
      `
        SELECT id, user_id, char_key, name, tag, persona, avatar, portrait_id, portrait_custom_url, mood, intimacy, speech_style, first_chat_at,
               auto_moments_enabled, auto_moments_daily_min, auto_moments_daily_max,
               auto_moments_min_interval_hours, auto_moments_last_posted_at,
               is_active, is_deleted, delete_after, created_at
        FROM characters
        WHERE id = ? AND user_id = ?
        LIMIT 1
      `,
      [result.insertId, req.userId]
    );

    return rows[0];
  });

  return res.status(201).json({ success: true, item: created });
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const characterId = parseInteger(req.params.id);
  if (!characterId) {
    return res.status(400).json({ success: false, error: '角色 ID 非法' });
  }

  const payload = sanitizeCharacterPayload(req.body);
  if (req.body?.name !== undefined && !payload.name) {
    return res.status(400).json({ success: false, error: '角色名称不能为空' });
  }
  if (req.body?.persona !== undefined && !payload.persona) {
    return res.status(400).json({ success: false, error: '角色人设不能为空' });
  }

  const deleteAfterProvided = Object.prototype.hasOwnProperty.call(req.body || {}, 'delete_after');
  const deleteAfter =
    !deleteAfterProvided
      ? undefined
      : req.body?.delete_after
        ? new Date(req.body.delete_after)
        : null;

  if (deleteAfterProvided && deleteAfter !== null && Number.isNaN(deleteAfter?.getTime?.())) {
    return res.status(400).json({ success: false, error: 'delete_after 非法' });
  }

  const updated = await withTransaction(async connection => {
    const [rows] = await connection.query(
      `
        SELECT id
        FROM characters
        WHERE id = ? AND user_id = ? AND is_deleted = 0
        LIMIT 1
      `,
      [characterId, req.userId]
    );

    if (rows.length === 0) {
      throw new Error('角色不存在');
    }

    const nextCharKey =
      req.body?.char_key !== undefined
        ? await ensureUniqueCharacterKey(connection, req.userId, payload.char_key, characterId)
        : null;

    await connection.query(
      `
        UPDATE characters
        SET
          char_key = COALESCE(?, char_key),
          name = COALESCE(?, name),
          tag = COALESCE(?, tag),
          persona = COALESCE(?, persona),
          avatar = COALESCE(?, avatar),
          portrait_id = CASE WHEN ? = 1 THEN ? ELSE portrait_id END,
          portrait_custom_url = CASE WHEN ? = 1 THEN ? ELSE portrait_custom_url END,
          mood = COALESCE(?, mood),
          intimacy = COALESCE(?, intimacy),
          speech_style = COALESCE(?, speech_style),
          auto_moments_enabled = COALESCE(?, auto_moments_enabled),
          auto_moments_daily_min = COALESCE(?, auto_moments_daily_min),
          auto_moments_daily_max = COALESCE(?, auto_moments_daily_max),
          auto_moments_min_interval_hours = COALESCE(?, auto_moments_min_interval_hours),
          delete_after = CASE WHEN ? = 1 THEN ? ELSE delete_after END
        WHERE id = ? AND user_id = ? AND is_deleted = 0
      `,
      [
        nextCharKey,
        req.body?.name !== undefined ? payload.name : null,
        req.body?.tag !== undefined ? payload.tag : null,
        req.body?.persona !== undefined ? payload.persona : null,
        req.body?.avatar !== undefined ? payload.avatar : null,
        (req.body?.portrait_id !== undefined || req.body?.portraitId !== undefined) ? 1 : 0,
        payload.portrait_id,
        (req.body?.portrait_custom_url !== undefined || req.body?.portraitCustomUrl !== undefined || req.body?.portrait_id !== undefined || req.body?.portraitId !== undefined) ? 1 : 0,
        payload.portrait_custom_url,
        req.body?.mood !== undefined ? payload.mood : null,
        req.body?.intimacy !== undefined ? payload.intimacy : null,
        req.body?.speech_style !== undefined ? payload.speech_style : null,
        req.body?.auto_moments_enabled !== undefined ? payload.auto_moments_enabled : null,
        req.body?.auto_moments_daily_min !== undefined ? payload.auto_moments_daily_min : null,
        req.body?.auto_moments_daily_max !== undefined ? payload.auto_moments_daily_max : null,
        req.body?.auto_moments_min_interval_hours !== undefined ? payload.auto_moments_min_interval_hours : null,
        deleteAfterProvided ? 1 : 0,
        deleteAfter ? deleteAfter : null,
        characterId,
        req.userId
      ]
    );

    const [updatedRows] = await connection.query(
      `
        SELECT id, user_id, char_key, name, tag, persona, avatar, portrait_id, portrait_custom_url, mood, intimacy, speech_style, first_chat_at,
               auto_moments_enabled, auto_moments_daily_min, auto_moments_daily_max,
               auto_moments_min_interval_hours, auto_moments_last_posted_at,
               is_active, is_deleted, delete_after, created_at
        FROM characters
        WHERE id = ? AND user_id = ?
        LIMIT 1
      `,
      [characterId, req.userId]
    );

    return updatedRows[0];
  });

  return res.json({ success: true, item: updated });
}));

router.post('/:id/portrait', asyncHandler(async (req, res) => {
  const characterId = parseInteger(req.params.id);
  if (!characterId) {
    return res.status(400).json({ success: false, error: '角色 ID 无效' });
  }

  const [rows] = await pool.query(
    'SELECT id FROM characters WHERE id = ? AND user_id = ? AND is_deleted = 0 LIMIT 1',
    [characterId, req.userId]
  );
  if (!rows.length) {
    return res.status(404).json({ success: false, error: '角色不存在' });
  }

  const imageData = String(req.body?.image_data || '').trim();
  const match = imageData.match(/^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    return res.status(400).json({ success: false, error: '只支持 PNG、JPG、JPEG、WEBP 图片上传' });
  }

  const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length) {
    return res.status(400).json({ success: false, error: '图片内容是空的' });
  }

  const userDir = path.join(portraitDir, String(req.userId));
  await fileStorage.mkdir(userDir, { recursive: true });
  const filename = `${characterId}-${now()}.${ext}`;
  const filePath = path.join(userDir, filename);
  await fileStorage.writeFile(filePath, buffer);

  return res.json({
    success: true,
    portrait_url: `/user_assets/portraits/${req.userId}/${filename}`
  });
}));

router.post('/:id/switch', asyncHandler(async (req, res) => {
  const characterId = parseInteger(req.params.id);
  if (!characterId) {
    return res.status(400).json({ success: false, error: '角色 ID 非法' });
  }

  try {
    const active = await withTransaction(async connection => {
      await finalizeExpiredCharacterDeletes(req.userId, connection);

      const [ownedRows] = await connection.query(
        `
          SELECT id
          FROM characters
          WHERE id = ? AND user_id = ? AND is_deleted = 0
          LIMIT 1
        `,
        [characterId, req.userId]
      );

      if (ownedRows.length === 0) {
        throw new Error('角色不存在');
      }

      await connection.query(
        'UPDATE characters SET is_active = 0 WHERE user_id = ?',
        [req.userId]
      );
      await connection.query(
        'UPDATE characters SET is_active = 1 WHERE id = ? AND user_id = ?',
        [characterId, req.userId]
      );

      return getActiveCharacter(req.userId, connection);
    });

    return res.json({ success: true, item: active });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const characterId = parseInteger(req.params.id);
  if (!characterId) {
    return res.status(400).json({ success: false, error: '角色 ID 非法' });
  }

  await withTransaction(async connection => {
    const deleted = await markCharacterDeleted(connection, req.userId, characterId);
    if (!deleted) {
      throw new Error('角色不存在');
    }
  });

  return res.json({ success: true, message: '角色已删除' });
}));

router.post('/:id/restore', asyncHandler(async (req, res) => {
  const characterId = parseInteger(req.params.id);
  if (!characterId) {
    return res.status(400).json({ success: false, error: 'Invalid role id' });
  }

  const restored = await withTransaction(async connection => {
    const [rows] = await connection.query(
      `
        SELECT id
        FROM characters
        WHERE id = ? AND user_id = ? AND is_deleted = 1
        LIMIT 1
      `,
      [characterId, req.userId]
    );

    if (!rows.length) {
      throw new Error('Role not found');
    }

    await connection.query(
      `
        UPDATE characters
        SET is_deleted = 0, is_active = 1, delete_after = NULL
        WHERE id = ? AND user_id = ?
      `,
      [characterId, req.userId]
    );

    await connection.query(
      'UPDATE characters SET is_active = 0 WHERE user_id = ? AND id <> ?',
      [req.userId, characterId]
    );
    await connection.query(
      'UPDATE memories SET is_deleted = 0 WHERE user_id = ? AND character_id = ?',
      [req.userId, characterId]
    );
    await connection.query(
      'UPDATE messages SET is_active = 1 WHERE user_id = ? AND character_id = ?',
      [req.userId, characterId]
    );

    const [updatedRows] = await connection.query(
      `
        SELECT id, user_id, char_key, name, tag, persona, avatar, portrait_id, portrait_custom_url, mood, intimacy, speech_style, first_chat_at,
               auto_moments_enabled, auto_moments_daily_min, auto_moments_daily_max,
               auto_moments_min_interval_hours, auto_moments_last_posted_at,
               is_active, is_deleted, delete_after, created_at
        FROM characters
        WHERE id = ? AND user_id = ?
        LIMIT 1
      `,
      [characterId, req.userId]
    );

    return updatedRows[0];
  });

  return res.json({ success: true, item: restored });
}));

  return router;
}

export default createRolesRouter();
