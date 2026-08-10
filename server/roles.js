import express from 'express';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool as defaultPool, withTransaction as defaultWithTransaction } from './db.js';
import { asyncHandler, clamp, getActiveCharacter, parseInteger, toBoolean } from './helpers.js';
import { guessModelCapabilities } from './model-capabilities.js';
import { buildIdentityPack } from './identity-pack.js';
import { installLive2DArchive, readMultipartUpload } from './live2d-assets.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const defaultPortraitDir = path.join(projectRoot, 'user_assets', 'portraits');
const defaultLive2DAssetDir = path.join(projectRoot, 'user_assets', 'live2d');
const defaultLive2DTempDir = path.join(projectRoot, 'user_assets', '.live2d-tmp');

export function createRolesRouter({
  pool = defaultPool,
  withTransaction = defaultWithTransaction,
  fileStorage = fs,
  portraitDir = defaultPortraitDir,
  live2dAssetDir = defaultLive2DAssetDir,
  live2dTempDir = defaultLive2DTempDir,
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

const CHAT_THINKING_LEVELS = new Set(['off', 'low', 'mid', 'high', 'ultra']);
const VISUAL_MODES = new Set(['builtin', 'image', 'live2d']);
const VISUAL_FRAME_MODES = new Set(['knee', 'half', 'full']);
const FULLSCREEN_FRAME_MODES = new Set(['half', 'full']);
const DEFAULT_VISUAL_FRAME_CONFIG = {
  chatFrame: 'knee',
  fullscreenFrame: 'full',
  chatZoom: 1,
  chatOffsetX: 0,
  chatOffsetY: 0,
  fullscreenZoom: 1,
  fullscreenOffsetX: 0,
  fullscreenOffsetY: 0
};

function normalizeChatThinkingLevel(value, fallback = 'off') {
  const level = String(value ?? fallback).trim().toLowerCase();
  return CHAT_THINKING_LEVELS.has(level) ? level : fallback;
}

function modelSupportsChat(capabilities, modelId) {
  let values = [];
  try {
    values = Array.isArray(capabilities) ? capabilities : JSON.parse(capabilities || '[]');
  } catch {
    values = [];
  }
  return new Set([...values, ...guessModelCapabilities(modelId)]).has('chat');
}

function normalizeVisualMode(value, fallback = 'builtin') {
  const mode = String(value ?? fallback).trim().toLowerCase();
  return VISUAL_MODES.has(mode) ? mode : fallback;
}

function normalizeVisualFrameNumber(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? clamp(number, min, max) : fallback;
}

function sanitizeVisualFrameConfig(value) {
  const source = parseStructuredValue(value) || {};
  const chatFrame = VISUAL_FRAME_MODES.has(String(source.chatFrame || ''))
    ? String(source.chatFrame)
    : DEFAULT_VISUAL_FRAME_CONFIG.chatFrame;
  const fullscreenFrame = FULLSCREEN_FRAME_MODES.has(String(source.fullscreenFrame || ''))
    ? String(source.fullscreenFrame)
    : DEFAULT_VISUAL_FRAME_CONFIG.fullscreenFrame;

  return JSON.stringify({
    chatFrame,
    fullscreenFrame,
    chatZoom: normalizeVisualFrameNumber(source.chatZoom, DEFAULT_VISUAL_FRAME_CONFIG.chatZoom, 0.7, 2.4),
    chatOffsetX: normalizeVisualFrameNumber(source.chatOffsetX, DEFAULT_VISUAL_FRAME_CONFIG.chatOffsetX, -0.35, 0.35),
    chatOffsetY: normalizeVisualFrameNumber(source.chatOffsetY, DEFAULT_VISUAL_FRAME_CONFIG.chatOffsetY, -0.35, 0.35),
    fullscreenZoom: normalizeVisualFrameNumber(source.fullscreenZoom, DEFAULT_VISUAL_FRAME_CONFIG.fullscreenZoom, 0.7, 2.4),
    fullscreenOffsetX: normalizeVisualFrameNumber(source.fullscreenOffsetX, DEFAULT_VISUAL_FRAME_CONFIG.fullscreenOffsetX, -0.35, 0.35),
    fullscreenOffsetY: normalizeVisualFrameNumber(source.fullscreenOffsetY, DEFAULT_VISUAL_FRAME_CONFIG.fullscreenOffsetY, -0.35, 0.35)
  });
}

const AUTO_MOMENT_PROFILE_FIELDS = ['temperament', 'face', 'eyes', 'hair', 'skin', 'expression', 'other'];
const AUTO_MOMENT_TEMPLATE_FIELDS = ['categories', 'selfie_scenes', 'poses', 'moods', 'custom'];
const AUTO_MOMENT_RESOLUTIONS = new Set(['channel', '1k', '2k', '4k']);

function parseStructuredValue(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeChoiceList(value, maxItems = 16) {
  const values = Array.isArray(value) ? value : String(value || '').split(/[,，]/);
  return [...new Set(values
    .map(item => String(item || '').trim().slice(0, 60))
    .filter(Boolean))]
    .slice(0, maxItems);
}

function sanitizeAutoMomentImageProfile(value) {
  if (value === null || value === '') return null;
  const source = parseStructuredValue(value);
  if (!source) return null;

  const name = String(source.name || '').trim().slice(0, 60);
  const ageFeel = String(source.age_feel ?? source.ageFeel ?? '').trim().slice(0, 60);
  if (!name || !ageFeel) return null;

  const profile = { name, age_feel: ageFeel };
  for (const field of AUTO_MOMENT_PROFILE_FIELDS) {
    const choices = normalizeChoiceList(source[field]);
    if (choices.length) profile[field] = choices;
  }
  return JSON.stringify(profile);
}

function sanitizeAutoMomentTemplates(value) {
  if (value === null || value === '') return null;
  const source = parseStructuredValue(value);
  if (!source) return null;

  const templates = {};
  for (const field of AUTO_MOMENT_TEMPLATE_FIELDS) {
    templates[field] = normalizeChoiceList(source[field]);
  }
  return JSON.stringify(templates);
}

function normalizeAutoMomentImageResolution(value) {
  const normalized = String(value || 'channel').trim().toLowerCase();
  return AUTO_MOMENT_RESOLUTIONS.has(normalized) ? normalized : 'channel';
}

function serializeRole(row) {
  if (!row) return row;
  return {
    ...row,
    auto_moments_image_resolution: normalizeAutoMomentImageResolution(row.auto_moments_image_resolution),
    auto_moments_image_profile: parseStructuredValue(row.auto_moments_image_profile),
    auto_moments_templates: parseStructuredValue(row.auto_moments_templates),
    live2d_manifest: parseStructuredValue(row.live2d_manifest),
    visual_frame_config: parseStructuredValue(row.visual_frame_config)
  };
}

function hasIncompleteAutoMomentImageProfile(body, payload) {
  const raw = body?.auto_moments_image_profile ?? body?.autoMomentsImageProfile;
  return raw !== undefined && raw !== null && raw !== '' && !payload.auto_moments_image_profile;
}

function sanitizeCharacterPayload(body = {}) {
  const autoMomentsEnabled = Object.prototype.hasOwnProperty.call(body, 'auto_moments_enabled')
    ? toBoolean(body.auto_moments_enabled)
    : false;
  const momentResponseEnabled = Object.prototype.hasOwnProperty.call(body, 'moment_response_enabled')
    ? toBoolean(body.moment_response_enabled)
    : Object.prototype.hasOwnProperty.call(body, 'momentResponseEnabled')
      ? toBoolean(body.momentResponseEnabled)
      : false;
  const autoMomentsImagesEnabled = Object.prototype.hasOwnProperty.call(body, 'auto_moments_images_enabled')
    ? toBoolean(body.auto_moments_images_enabled)
    : false;
  const dailyMin = clamp(parseInteger(body.auto_moments_daily_min, autoMomentsEnabled ? 2 : 0), 0, 12);
  const dailyMax = clamp(parseInteger(body.auto_moments_daily_max, autoMomentsEnabled ? 6 : 0), 0, 12);
  const minIntervalHours = clamp(parseInteger(body.auto_moments_min_interval_hours, 4), 1, 24);
  const rawPortraitId = body.portrait_id === null || body.portraitId === null
    ? null
    : parseInteger(body.portrait_id ?? body.portraitId, null);
  const portraitId = rawPortraitId === null
    ? null
    : ([999, ...Array.from({ length: 18 }, (_item, index) => index)].includes(rawPortraitId) ? rawPortraitId : null);
  const portraitCustomUrl = String(body.portrait_custom_url || body.portraitCustomUrl || '').trim() || null;
  const visualMode = normalizeVisualMode(body.visual_mode ?? body.visualMode);
  const visualPreviewUrl = String(body.visual_preview_url || body.visualPreviewUrl || '').trim() || null;
  const visualFrameConfig = sanitizeVisualFrameConfig(body.visual_frame_config ?? body.visualFrame);

  return {
    char_key: buildCharacterKeyCandidate(body),
    name: String(body.name || '').trim(),
    tag: String(body.tag || '').trim(),
    persona: String(body.persona || '').trim(),
    avatar: String(body.avatar || '').trim(),
    portrait_id: portraitId,
    portrait_custom_url: portraitId === 999 ? portraitCustomUrl : null,
    visual_mode: visualMode,
    visual_preview_url: visualPreviewUrl,
    visual_frame_config: visualFrameConfig,
    mood: Math.min(100, Math.max(0, parseInteger(body.mood, 80))),
    intimacy: Math.min(100, Math.max(0, parseInteger(body.intimacy, 50))),
    speech_style: ['natural', 'compact', 'roleplay'].includes(body.speech_style) ? body.speech_style : 'natural',
    auto_moments_enabled: autoMomentsEnabled ? 1 : 0,
    auto_moments_images_enabled: autoMomentsImagesEnabled ? 1 : 0,
    auto_moments_image_resolution: normalizeAutoMomentImageResolution(body.auto_moments_image_resolution ?? body.autoMomentsImageResolution),
    auto_moments_image_profile: sanitizeAutoMomentImageProfile(body.auto_moments_image_profile ?? body.autoMomentsImageProfile),
    auto_moments_templates: sanitizeAutoMomentTemplates(body.auto_moments_templates ?? body.autoMomentsTemplates),
    auto_moments_daily_min: autoMomentsEnabled ? Math.min(dailyMin, dailyMax) : 0,
    auto_moments_daily_max: autoMomentsEnabled ? Math.max(dailyMin, dailyMax) : 0,
    auto_moments_min_interval_hours: minIntervalHours,
    moment_response_enabled: momentResponseEnabled ? 1 : 0
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

async function permanentlyDeleteCharacter(connection, userId, characterId) {
  const [result] = await connection.query(
    `
      DELETE FROM characters
      WHERE id = ? AND user_id = ?
    `,
    [characterId, userId]
  );

  if (!result.affectedRows) {
    return false;
  }

  await ensureActiveCharacter(userId, connection);
  return true;
}

async function loadRoles(userId, { includeDeleted = false } = {}, connection = pool) {
  await finalizeExpiredCharacterDeletes(userId, connection);
  await ensureActiveCharacter(userId, connection);

  const [rows] = await connection.query(
    `
      SELECT id, user_id, char_key, name, tag, persona, avatar, portrait_id, portrait_custom_url, visual_mode, visual_preview_url, live2d_asset_id, live2d_model_url, live2d_manifest, visual_frame_config, mood, intimacy, speech_style, chat_credential_id, chat_model_id, chat_thinking_level, first_chat_at,
             auto_moments_enabled, auto_moments_images_enabled, auto_moments_image_resolution, auto_moments_daily_min, auto_moments_daily_max,
             auto_moments_image_profile, auto_moments_templates,
             auto_moments_min_interval_hours, auto_moments_last_posted_at, moment_response_enabled,
             is_active, is_deleted, delete_after, created_at
      FROM characters
      WHERE user_id = ? ${includeDeleted ? '' : 'AND is_deleted = 0'}
      ORDER BY is_deleted ASC, is_active DESC, id ASC
    `,
    [userId]
  );

  return rows.map(serializeRole);
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
  if (hasIncompleteAutoMomentImageProfile(req.body, payload)) {
    return res.status(400).json({ success: false, error: '固定形象请至少填写姓名和年龄感' });
  }
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
            user_id, char_key, name, tag, persona, avatar, portrait_id, portrait_custom_url, visual_mode, visual_preview_url, visual_frame_config, mood, intimacy,
            speech_style,
            auto_moments_enabled, auto_moments_images_enabled, auto_moments_image_resolution, auto_moments_daily_min, auto_moments_daily_max,
            auto_moments_image_profile, auto_moments_templates,
            auto_moments_min_interval_hours,
            moment_response_enabled,
            is_active, is_deleted, delete_after, created_at
          )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NOW())
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
        payload.visual_mode,
        payload.visual_preview_url,
        payload.visual_frame_config,
        payload.mood,
        payload.intimacy,
        payload.speech_style,
        payload.auto_moments_enabled,
        payload.auto_moments_images_enabled,
        payload.auto_moments_image_resolution,
        payload.auto_moments_daily_min,
        payload.auto_moments_daily_max,
        payload.auto_moments_image_profile,
        payload.auto_moments_templates,
        payload.auto_moments_min_interval_hours,
        payload.moment_response_enabled,
        activeRows.length === 0 ? 1 : 0
      ]
    );

    const [rows] = await connection.query(
      `
        SELECT id, user_id, char_key, name, tag, persona, avatar, portrait_id, portrait_custom_url, visual_mode, visual_preview_url, live2d_asset_id, live2d_model_url, live2d_manifest, visual_frame_config, mood, intimacy, speech_style, chat_credential_id, chat_model_id, chat_thinking_level, first_chat_at,
               auto_moments_enabled, auto_moments_images_enabled, auto_moments_image_resolution, auto_moments_daily_min, auto_moments_daily_max,
               auto_moments_image_profile, auto_moments_templates,
               auto_moments_min_interval_hours, auto_moments_last_posted_at, moment_response_enabled,
               is_active, is_deleted, delete_after, created_at
        FROM characters
        WHERE id = ? AND user_id = ?
        LIMIT 1
      `,
      [result.insertId, req.userId]
    );

    return serializeRole(rows[0]);
  });

  return res.status(201).json({ success: true, item: created });
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const characterId = parseInteger(req.params.id);
  if (!characterId) {
    return res.status(400).json({ success: false, error: '角色 ID 非法' });
  }

  const payload = sanitizeCharacterPayload(req.body);
  if (hasIncompleteAutoMomentImageProfile(req.body, payload)) {
    return res.status(400).json({ success: false, error: '固定形象请至少填写姓名和年龄感' });
  }
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
        SELECT id, chat_credential_id, chat_model_id, chat_thinking_level
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

    const chatCredentialProvided = Object.prototype.hasOwnProperty.call(req.body || {}, 'chat_credential_id');
    const chatModelProvided = Object.prototype.hasOwnProperty.call(req.body || {}, 'chat_model_id');
    const chatThinkingProvided = Object.prototype.hasOwnProperty.call(req.body || {}, 'chat_thinking_level');
    const chatModelSelectionProvided = chatCredentialProvided || chatModelProvided;
    let nextChatCredentialId = rows[0].chat_credential_id ?? null;
    let nextChatModelId = rows[0].chat_model_id ?? null;
    let nextChatThinkingLevel = normalizeChatThinkingLevel(rows[0].chat_thinking_level, 'off');

    if (chatThinkingProvided) {
      const requestedLevel = String(req.body?.chat_thinking_level ?? '').trim().toLowerCase();
      if (!CHAT_THINKING_LEVELS.has(requestedLevel)) {
        throw new Error('心情展示设置无效');
      }
      nextChatThinkingLevel = requestedLevel;
    }

    if (chatModelSelectionProvided) {
      const requestedCredentialId = chatCredentialProvided
        ? parseInteger(req.body?.chat_credential_id, null)
        : nextChatCredentialId;
      const requestedModelId = chatModelProvided
        ? String(req.body?.chat_model_id || '').trim() || null
        : nextChatModelId;

      if (!requestedCredentialId && !requestedModelId) {
        nextChatCredentialId = null;
        nextChatModelId = null;
      } else {
        if (!requestedCredentialId || !requestedModelId) {
          throw new Error('请选择完整的聊天渠道和模型');
        }

        const [modelRows] = await connection.query(
          `
            SELECT c.id, cm.model_id, cm.capabilities
            FROM credentials c
            INNER JOIN credential_models cm ON cm.credential_id = c.id
            WHERE c.id = ? AND c.user_id = ? AND c.is_enabled = 1 AND cm.model_id = ?
            LIMIT 1
          `,
          [requestedCredentialId, req.userId, requestedModelId]
        );
        if (!modelRows[0] || !modelSupportsChat(modelRows[0].capabilities, modelRows[0].model_id)) {
          throw new Error('这个聊天模型不存在、已停用，或不属于当前用户');
        }

        nextChatCredentialId = requestedCredentialId;
        nextChatModelId = requestedModelId;
      }
    }

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
          visual_mode = CASE WHEN ? = 1 THEN ? ELSE visual_mode END,
          visual_preview_url = CASE WHEN ? = 1 THEN ? ELSE visual_preview_url END,
          visual_frame_config = CASE WHEN ? = 1 THEN ? ELSE visual_frame_config END,
          mood = COALESCE(?, mood),
          intimacy = COALESCE(?, intimacy),
          speech_style = COALESCE(?, speech_style),
          chat_credential_id = CASE WHEN ? = 1 THEN ? ELSE chat_credential_id END,
          chat_model_id = CASE WHEN ? = 1 THEN ? ELSE chat_model_id END,
          chat_thinking_level = CASE WHEN ? = 1 THEN ? ELSE chat_thinking_level END,
          auto_moments_enabled = COALESCE(?, auto_moments_enabled),
          auto_moments_images_enabled = COALESCE(?, auto_moments_images_enabled),
          auto_moments_image_resolution = COALESCE(?, auto_moments_image_resolution),
          auto_moments_image_profile = CASE WHEN ? = 1 THEN ? ELSE auto_moments_image_profile END,
          auto_moments_templates = CASE WHEN ? = 1 THEN ? ELSE auto_moments_templates END,
          auto_moments_daily_min = COALESCE(?, auto_moments_daily_min),
          auto_moments_daily_max = COALESCE(?, auto_moments_daily_max),
          auto_moments_min_interval_hours = COALESCE(?, auto_moments_min_interval_hours),
          moment_response_enabled = COALESCE(?, moment_response_enabled),
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
        (req.body?.visual_mode !== undefined || req.body?.visualMode !== undefined) ? 1 : 0,
        payload.visual_mode,
        (req.body?.visual_preview_url !== undefined || req.body?.visualPreviewUrl !== undefined) ? 1 : 0,
        payload.visual_preview_url,
        (req.body?.visual_frame_config !== undefined || req.body?.visualFrame !== undefined) ? 1 : 0,
        payload.visual_frame_config,
        req.body?.mood !== undefined ? payload.mood : null,
        req.body?.intimacy !== undefined ? payload.intimacy : null,
        req.body?.speech_style !== undefined ? payload.speech_style : null,
        chatModelSelectionProvided ? 1 : 0,
        nextChatCredentialId,
        chatModelSelectionProvided ? 1 : 0,
        nextChatModelId,
        chatThinkingProvided ? 1 : 0,
        nextChatThinkingLevel,
        req.body?.auto_moments_enabled !== undefined ? payload.auto_moments_enabled : null,
        req.body?.auto_moments_images_enabled !== undefined ? payload.auto_moments_images_enabled : null,
        req.body?.auto_moments_image_resolution !== undefined || req.body?.autoMomentsImageResolution !== undefined
          ? payload.auto_moments_image_resolution
          : null,
        (req.body?.auto_moments_image_profile !== undefined || req.body?.autoMomentsImageProfile !== undefined) ? 1 : 0,
        payload.auto_moments_image_profile,
        (req.body?.auto_moments_templates !== undefined || req.body?.autoMomentsTemplates !== undefined) ? 1 : 0,
        payload.auto_moments_templates,
        req.body?.auto_moments_daily_min !== undefined ? payload.auto_moments_daily_min : null,
        req.body?.auto_moments_daily_max !== undefined ? payload.auto_moments_daily_max : null,
        req.body?.auto_moments_min_interval_hours !== undefined ? payload.auto_moments_min_interval_hours : null,
        (req.body?.moment_response_enabled !== undefined || req.body?.momentResponseEnabled !== undefined)
          ? payload.moment_response_enabled
          : null,
        deleteAfterProvided ? 1 : 0,
        deleteAfter ? deleteAfter : null,
        characterId,
        req.userId
      ]
    );

    const [updatedRows] = await connection.query(
      `
        SELECT id, user_id, char_key, name, tag, persona, avatar, portrait_id, portrait_custom_url, visual_mode, visual_preview_url, live2d_asset_id, live2d_model_url, live2d_manifest, visual_frame_config, mood, intimacy, speech_style, chat_credential_id, chat_model_id, chat_thinking_level, first_chat_at,
               auto_moments_enabled, auto_moments_images_enabled, auto_moments_image_resolution, auto_moments_daily_min, auto_moments_daily_max,
               auto_moments_image_profile, auto_moments_templates,
               auto_moments_min_interval_hours, auto_moments_last_posted_at, moment_response_enabled,
               is_active, is_deleted, delete_after, created_at
        FROM characters
        WHERE id = ? AND user_id = ?
        LIMIT 1
      `,
      [characterId, req.userId]
    );

    return serializeRole(updatedRows[0]);
  });

  return res.json({ success: true, item: updated });
}));

router.get('/:id/identity-pack', asyncHandler(async (req, res) => {
  const characterId = parseInteger(req.params.id);
  if (!characterId) return res.status(400).json({ success: false, error: '角色 ID 非法' });

  const [characterRows] = await pool.query(
    `
      SELECT id, user_id, name, tag, persona, avatar, speech_style, portrait_id, portrait_custom_url, visual_mode, visual_preview_url, live2d_model_url, live2d_manifest, visual_frame_config,
             mood, intimacy, auto_moments_enabled, auto_moments_images_enabled, auto_moments_image_resolution,
             auto_moments_image_profile, auto_moments_templates,
             auto_moments_daily_min, auto_moments_daily_max, auto_moments_min_interval_hours, moment_response_enabled
      FROM characters
      WHERE id = ? AND user_id = ? AND is_deleted = 0
      LIMIT 1
    `,
    [characterId, req.userId]
  );
  if (!characterRows[0]) return res.status(404).json({ success: false, error: '角色不存在' });

  const [[runtimeRows], [memoryRows]] = await Promise.all([
    pool.query(
      `SELECT state_json, relationship_json FROM character_runtime_states WHERE user_id = ? AND character_id = ? LIMIT 1`,
      [req.userId, characterId]
    ),
    pool.query(
      `
        SELECT id, content, tag, category, memory_type, source_type, source_id,
               review_status, confidence, weight, is_important, appointment_at, appointment_status
        FROM memories
        WHERE user_id = ? AND character_id = ? AND is_deleted = 0
        ORDER BY is_important DESC, weight DESC, created_at DESC, id DESC
      `,
      [req.userId, characterId]
    )
  ]);

  return res.json({
    success: true,
    item: buildIdentityPack({ character: characterRows[0], runtime: runtimeRows[0], memories: memoryRows })
  });
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

router.post('/:id/live2d-asset', asyncHandler(async (req, res) => {
  const characterId = parseInteger(req.params.id);
  if (!characterId) {
    return res.status(400).json({ success: false, error: '角色 ID 无效' });
  }

  const [rows] = await pool.query(
    'SELECT id, live2d_asset_id FROM characters WHERE id = ? AND user_id = ? AND is_deleted = 0 LIMIT 1',
    [characterId, req.userId]
  );
  if (!rows.length) {
    return res.status(404).json({ success: false, error: '角色不存在' });
  }

  let upload;
  try {
    upload = await readMultipartUpload(req, { tempDir: live2dTempDir });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message || 'Live2D 压缩包上传失败' });
  }

  const assetId = randomUUID();
  const assetDir = path.join(live2dAssetDir, String(req.userId), String(characterId), assetId);
  const publicBaseUrl = `/user_assets/live2d/${req.userId}/${characterId}/${assetId}`;

  try {
    const manifest = await installLive2DArchive({
      archivePath: upload.path,
      targetDir: assetDir,
      publicBaseUrl,
      sourceName: upload.filename,
      fileStorage,
      now
    });

    await pool.query(
      `
        UPDATE characters
        SET visual_mode = 'live2d',
            visual_preview_url = ?,
            live2d_asset_id = ?,
            live2d_model_url = ?,
            live2d_manifest = ?
        WHERE id = ? AND user_id = ? AND is_deleted = 0
      `,
      [manifest.previewUrl, assetId, manifest.modelUrl, JSON.stringify(manifest), characterId, req.userId]
    );

    const previousAssetId = String(rows[0].live2d_asset_id || '');
    if (previousAssetId && previousAssetId !== assetId && /^[0-9a-f-]{20,80}$/i.test(previousAssetId)) {
      await fileStorage.rm?.(path.join(live2dAssetDir, String(req.userId), String(characterId), previousAssetId), { recursive: true, force: true });
    }

    return res.json({
      success: true,
      asset: {
        asset_id: assetId,
        visual_mode: 'live2d',
        model_url: manifest.modelUrl,
        preview_url: manifest.previewUrl,
        manifest
      }
    });
  } catch (error) {
    await fileStorage.rm?.(assetDir, { recursive: true, force: true });
    return res.status(400).json({ success: false, error: error.message || 'Live2D 压缩包无效' });
  } finally {
    await fs.rm(upload.path, { force: true }).catch(() => {});
  }
}));

router.delete('/:id/live2d-asset', asyncHandler(async (req, res) => {
  const characterId = parseInteger(req.params.id);
  if (!characterId) {
    return res.status(400).json({ success: false, error: '角色 ID 无效' });
  }

  const [rows] = await pool.query(
    'SELECT id, live2d_asset_id FROM characters WHERE id = ? AND user_id = ? AND is_deleted = 0 LIMIT 1',
    [characterId, req.userId]
  );
  if (!rows.length) {
    return res.status(404).json({ success: false, error: '角色不存在' });
  }

  await pool.query(
    `
      UPDATE characters
      SET visual_mode = 'builtin',
          visual_preview_url = NULL,
          live2d_asset_id = NULL,
          live2d_model_url = NULL,
          live2d_manifest = NULL
      WHERE id = ? AND user_id = ? AND is_deleted = 0
    `,
    [characterId, req.userId]
  );

  const assetId = String(rows[0].live2d_asset_id || '');
  if (assetId && /^[0-9a-f-]{20,80}$/i.test(assetId)) {
    await fileStorage.rm?.(path.join(live2dAssetDir, String(req.userId), String(characterId), assetId), { recursive: true, force: true });
  }

  return res.json({ success: true });
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

  const immediate = String(req.query?.mode || '').trim().toLowerCase() === 'hard';
  let deleted = false;

  await withTransaction(async connection => {
    deleted = immediate
      ? await permanentlyDeleteCharacter(connection, req.userId, characterId)
      : await markCharacterDeleted(connection, req.userId, characterId);
  });

  if (!deleted) {
    return res.status(404).json({ success: false, error: '角色不存在' });
  }

  return res.json({
    success: true,
    message: immediate ? '角色已立即删除' : '角色已删除'
  });
}));

router.post('/:id/restore', asyncHandler(async (req, res) => {
  const characterId = parseInteger(req.params.id);
  if (!characterId) {
    return res.status(400).json({ success: false, error: 'Invalid role id' });
  }

  let restored = null;

  await withTransaction(async connection => {
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
      return;
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
        SELECT id, user_id, char_key, name, tag, persona, avatar, portrait_id, portrait_custom_url, visual_mode, visual_preview_url, live2d_asset_id, live2d_model_url, live2d_manifest, visual_frame_config, mood, intimacy, speech_style, chat_credential_id, chat_model_id, chat_thinking_level, first_chat_at,
               auto_moments_enabled, auto_moments_images_enabled, auto_moments_image_resolution, auto_moments_daily_min, auto_moments_daily_max,
               auto_moments_min_interval_hours, auto_moments_last_posted_at, moment_response_enabled,
               is_active, is_deleted, delete_after, created_at
        FROM characters
        WHERE id = ? AND user_id = ?
        LIMIT 1
      `,
      [characterId, req.userId]
    );

    restored = updatedRows[0];
  });

  if (!restored) {
    return res.status(404).json({ success: false, error: '角色不存在' });
  }

  return res.json({ success: true, item: restored });
}));

  return router;
}

export default createRolesRouter();
