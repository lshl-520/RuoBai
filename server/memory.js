import express from 'express';
import { pool } from './db.js';
import { getRequestCharacterId } from './middleware.js';
import { normalizeLimit, requireCharacterForUser, toBoolean } from './helpers.js';
import { memoryTypeLabel, normalizeMemoryFields } from './memory-fields.js';

const router = express.Router();

function getUserId(req) {
  return req.user?.id ?? req.userId ?? null;
}

function mapMemory(row) {
  if (!row) {
    return null;
  }

  return {
    ...row,
    memory_type: row.memory_type || 'life',
    memory_type_label: memoryTypeLabel(row.memory_type || 'life'),
    source_type: row.source_type || 'manual',
    review_status: row.review_status || 'active',
    detected_reason: row.detected_reason || '',
    confidence: Number(row.confidence ?? 1),
    weight: Number(row.weight ?? 50),
    is_important: Boolean(row.is_important),
    is_deleted: Boolean(row.is_deleted)
  };
}

async function getOwnedMemory(memoryId, userId) {
  const [rows] = await pool.query(
    `
      SELECT id, user_id, character_id, content, tag, category, memory_type, source_type, source_id,
             review_status, detected_reason,
             occurred_at, confidence, weight, appointment_at, appointment_status, is_important, is_deleted, created_at, updated_at
      FROM memories
      WHERE id = ? AND user_id = ?
      LIMIT 1
    `,
    [memoryId, userId]
  );

  return rows[0] || null;
}

router.get('/', async (req, res) => {
  try {
    const userId = getUserId(req);
    const characterId = getRequestCharacterId(req);

    if (!userId) {
      return res.status(401).json({ success: false, error: '未登录' });
    }

    if (!characterId) {
      return res.status(400).json({ success: false, error: '缺少 character_id' });
    }

    await requireCharacterForUser(userId, characterId);

    const includeDeleted = toBoolean(req.query?.include_deleted);
    const limit = normalizeLimit(req.query?.limit, 100, 500);
    const whereDeletedClause = includeDeleted ? '' : 'AND is_deleted = 0';

    const [rows] = await pool.query(
      `
        SELECT id, user_id, character_id, content, tag, category, memory_type, source_type, source_id,
               review_status, detected_reason,
               occurred_at, confidence, weight, appointment_at, appointment_status, is_important, is_deleted, created_at, updated_at
        FROM memories
        WHERE user_id = ? AND character_id = ? ${whereDeletedClause}
        ORDER BY is_important DESC, weight DESC, created_at DESC, id DESC
        LIMIT ?
      `,
      [userId, characterId, limit]
    );

    return res.json({ success: true, data: rows.map(mapMemory) });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const userId = getUserId(req);
    const characterId = getRequestCharacterId(req);

    if (!userId) {
      return res.status(401).json({ success: false, error: '未登录' });
    }

    if (!characterId) {
      return res.status(400).json({ success: false, error: '缺少 character_id' });
    }

    await requireCharacterForUser(userId, characterId);

    const content = String(req.body?.content || '').trim();
    const tag = String(req.body?.tag || '普通记忆').trim() || '普通记忆';
    const category = String(req.body?.category || '').trim();
    const fields = normalizeMemoryFields(req.body, {});

    if (!content) {
      return res.status(400).json({ success: false, error: '记忆内容不能为空' });
    }

    const [result] = await pool.query(
      `
        INSERT INTO memories
          (user_id, character_id, content, tag, category, memory_type, source_type, source_id, occurred_at,
           confidence, weight, appointment_at, appointment_status, is_important, is_deleted, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NOW())
      `,
      [userId, characterId, content, tag, category, fields.memory_type, fields.source_type, fields.source_id,
        fields.occurred_at, fields.confidence, fields.weight, fields.appointment_at, fields.appointment_status, fields.is_important]
    );

    const memory = await getOwnedMemory(result.insertId, userId);
    return res.status(201).json({ success: true, data: mapMemory(memory) });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const userId = getUserId(req);
    const memoryId = Number.parseInt(req.params.id, 10);

    if (!userId) {
      return res.status(401).json({ success: false, error: '未登录' });
    }

    if (Number.isNaN(memoryId)) {
      return res.status(400).json({ success: false, error: '记忆 ID 非法' });
    }

    const memory = await getOwnedMemory(memoryId, userId);
    if (!memory || memory.is_deleted) {
      return res.status(404).json({ success: false, error: '记忆不存在' });
    }

    const nextCharacterId = getRequestCharacterId(req) || memory.character_id;
    await requireCharacterForUser(userId, nextCharacterId);

    const hasContent = Object.prototype.hasOwnProperty.call(req.body || {}, 'content');
    const hasTag = Object.prototype.hasOwnProperty.call(req.body || {}, 'tag');
    const hasCategory = Object.prototype.hasOwnProperty.call(req.body || {}, 'category');
    const content = hasContent ? String(req.body.content || '').trim() : memory.content;
    const tag = hasTag ? String(req.body.tag || '').trim() : memory.tag;
    const category = hasCategory ? String(req.body.category || '').trim() : memory.category;
    const fields = normalizeMemoryFields(req.body, memory);
    const reviewStatus = Object.prototype.hasOwnProperty.call(req.body || {}, 'review_status')
      ? (['candidate', 'active', 'important'].includes(String(req.body.review_status)) ? String(req.body.review_status) : memory.review_status)
      : (fields.is_important ? 'important' : memory.review_status);
    const detectedReason = Object.prototype.hasOwnProperty.call(req.body || {}, 'detected_reason')
      ? String(req.body.detected_reason || '').trim().slice(0, 255)
      : memory.detected_reason;

    if (hasContent && !content) {
      return res.status(400).json({ success: false, error: '记忆内容不能为空' });
    }

    await pool.query(
      `
        UPDATE memories
        SET character_id = ?, content = ?, tag = ?, category = ?, memory_type = ?, occurred_at = ?, weight = ?,
            appointment_at = ?, appointment_status = ?, is_important = ?, review_status = ?, detected_reason = ?
        WHERE id = ? AND user_id = ? AND is_deleted = 0
      `,
      [nextCharacterId, content, tag, category, fields.memory_type, fields.occurred_at, fields.weight,
        fields.appointment_at, fields.appointment_status, fields.is_important, reviewStatus, detectedReason, memoryId, userId]
    );

    const updated = await getOwnedMemory(memoryId, userId);
    return res.json({ success: true, data: mapMemory(updated) });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const userId = getUserId(req);
    const memoryId = Number.parseInt(req.params.id, 10);

    if (!userId) {
      return res.status(401).json({ success: false, error: '未登录' });
    }

    if (Number.isNaN(memoryId)) {
      return res.status(400).json({ success: false, error: '记忆 ID 非法' });
    }

    const memory = await getOwnedMemory(memoryId, userId);
    if (!memory || memory.is_deleted) {
      return res.status(404).json({ success: false, error: '记忆不存在' });
    }

    await pool.query(
      `
        UPDATE memories
        SET is_deleted = 1
        WHERE id = ? AND user_id = ? AND is_deleted = 0
      `,
      [memoryId, userId]
    );

    const deleted = await getOwnedMemory(memoryId, userId);
    return res.json({ success: true, data: mapMemory(deleted) });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

router.post('/:id/restore', async (req, res) => {
  try {
    const userId = getUserId(req);
    const memoryId = Number.parseInt(req.params.id, 10);

    if (!userId) {
      return res.status(401).json({ success: false, error: '未登录' });
    }

    if (Number.isNaN(memoryId)) {
      return res.status(400).json({ success: false, error: '记忆 ID 非法' });
    }

    const memory = await getOwnedMemory(memoryId, userId);
    if (!memory) {
      return res.status(404).json({ success: false, error: '记忆不存在' });
    }

    await requireCharacterForUser(userId, memory.character_id);

    await pool.query(
      `
        UPDATE memories
        SET is_deleted = 0
        WHERE id = ? AND user_id = ?
      `,
      [memoryId, userId]
    );

    const restored = await getOwnedMemory(memoryId, userId);
    return res.json({ success: true, data: mapMemory(restored) });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

export default router;
