import { pool } from './db.js';

export function asyncHandler(handler) {
  return function wrappedHandler(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export function parseInteger(value, fallback = null) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function toBoolean(value) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  if (typeof value === 'string') {
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
  }

  return false;
}

export async function getOwnedCharacter(userId, characterId, connection = pool) {
  const id = parseInteger(characterId);
  if (!id) {
    return null;
  }

  const [rows] = await connection.query(
    `
      SELECT id, user_id, char_key, name, tag, persona, avatar, portrait_id, portrait_custom_url, mood, intimacy, speech_style, is_active, is_deleted, created_at
      FROM characters
      WHERE id = ? AND user_id = ? AND is_deleted = 0
      LIMIT 1
    `,
    [id, userId]
  );

  return rows[0] || null;
}

export async function getActiveCharacter(userId, connection = pool) {
  const [rows] = await connection.query(
    `
      SELECT id, user_id, char_key, name, tag, persona, avatar, portrait_id, portrait_custom_url, mood, intimacy, is_active, is_deleted, created_at
      FROM characters
      WHERE user_id = ? AND is_deleted = 0
      ORDER BY is_active DESC, id ASC
      LIMIT 1
    `,
    [userId]
  );

  return rows[0] || null;
}

export async function requireCharacterForUser(userId, characterId, connection = pool) {
  const owned = await getOwnedCharacter(userId, characterId, connection);
  if (!owned) {
    throw new Error('角色不存在或不属于当前用户');
  }

  return owned;
}

export function normalizeLimit(value, fallback = 20, max = 100) {
  const parsed = parseInteger(value, fallback);
  return clamp(parsed ?? fallback, 1, max);
}

export function maskSecret(value) {
  if (!value) {
    return '';
  }

  if (value.length <= 8) {
    return `${value.slice(0, 2)}***${value.slice(-1)}`;
  }

  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

export function normalizeImages(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch {
      return value ? [value] : [];
    }
  }

  return [];
}
