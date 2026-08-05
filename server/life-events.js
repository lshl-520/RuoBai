import express from 'express';
import { pool } from './db.js';
import { getRequestCharacterId } from './middleware.js';
import { normalizeLimit, requireCharacterForUser as defaultRequireCharacterForUser } from './helpers.js';

function normalizeSourceType(value) {
  const type = String(value || '').trim().toLowerCase();
  return ['chat', 'moment', 'comment', 'memory'].includes(type) ? type : 'chat';
}

export function parseLifeEventSourceRef(value) {
  const match = String(value || '').trim().match(/^(chat|moment|comment|memory):(\d+)$/i);
  if (!match) return null;
  return { sourceType: match[1].toLowerCase(), sourceId: match[2] };
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || ''));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function sourceVisibilitySql(alias = 'm') {
  return `(
    ${alias}.character_id = ?
    OR EXISTS (
      SELECT 1 FROM moment_audiences ma
      WHERE ma.moment_id = ${alias}.id
        AND ma.user_id = ${alias}.user_id
        AND ma.character_id = ?
    )
  )`;
}

function shouldTrackTitle(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length >= 4 && text.length <= 500 && /(?:我|我的|我们|一起|喜欢|不喜欢|希望|想要|记得|约好|下次|今天|明天)/u.test(text);
}

export async function recordLifeEventSource(db = pool, {
  userId, characterId, sourceType, sourceId, title, eventType = 'life', occurredAt = null
} = {}) {
  const normalizedTitle = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  const normalizedSourceType = normalizeSourceType(sourceType);
  if (!userId || !characterId || !sourceId || !shouldTrackTitle(normalizedTitle)) return null;

  try {
    const [existing] = await db.query(
      `SELECT event_id FROM life_event_sources WHERE user_id = ? AND source_type = ? AND source_id = ? LIMIT 1`,
      [userId, normalizedSourceType, sourceId]
    );
    if (existing[0]) return { id: existing[0].event_id, reused: true };

    const [eventResult] = await db.query(
      `
        INSERT INTO life_events
          (user_id, character_id, title, event_type, status, occurred_at, created_at)
        VALUES (?, ?, ?, ?, 'active', ?, NOW())
      `,
      [userId, characterId, normalizedTitle, String(eventType || 'life').slice(0, 32), occurredAt]
    );
    await db.query(
      `
        INSERT INTO life_event_sources (event_id, user_id, source_type, source_id, created_at)
        VALUES (?, ?, ?, ?, NOW())
      `,
      [eventResult.insertId, userId, normalizedSourceType, sourceId]
    );
    return { id: eventResult.insertId, reused: false };
  } catch {
    // 生活事件是辅助索引，旧数据库未迁移或写入失败不能阻断聊天/动态。
    return null;
  }
}

export function createLifeEventsRouter({ db = pool, requireCharacter = defaultRequireCharacterForUser } = {}) {
  const router = express.Router();

  router.get('/', async (req, res) => {
  try {
    const characterId = getRequestCharacterId(req);
    if (!characterId) return res.status(400).json({ success: false, error: '缺少 character_id' });
    await requireCharacter(req.userId, characterId);
    const limit = normalizeLimit(req.query?.limit, 50, 200);
    const [rows] = await db.query(
      `
        SELECT e.id, e.user_id, e.character_id, e.title, e.event_type, e.status,
               e.occurred_at, e.created_at, e.updated_at,
               GROUP_CONCAT(CONCAT(s.source_type, ':', s.source_id) ORDER BY s.id SEPARATOR ',') AS source_refs
        FROM life_events e
        LEFT JOIN life_event_sources s ON s.event_id = e.id AND s.user_id = e.user_id
        WHERE e.user_id = ? AND e.character_id = ?
        GROUP BY e.id
        ORDER BY e.occurred_at DESC, e.created_at DESC, e.id DESC
        LIMIT ?
      `,
      [req.userId, characterId, limit]
    );
    return res.json({
      success: true,
      items: rows.map(row => ({
        ...row,
        sources: String(row.source_refs || '').split(',').filter(Boolean)
      }))
    });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

  router.get('/:id/source/:sourceType/:sourceId', async (req, res) => {
  try {
    const eventId = Number.parseInt(req.params.id, 10);
    const parsedRef = parseLifeEventSourceRef(`${req.params.sourceType}:${req.params.sourceId}`);
    if (!Number.isFinite(eventId) || !parsedRef) {
      return res.status(400).json({ success: false, error: '来源编号非法' });
    }
    const { sourceType, sourceId } = parsedRef;

    const [eventRows] = await db.query(
      `SELECT id, character_id FROM life_events WHERE id = ? AND user_id = ? LIMIT 1`,
      [eventId, req.userId]
    );
    const event = eventRows[0];
    if (!event) return res.status(404).json({ success: false, error: '生活事件不存在' });
    await requireCharacter(req.userId, event.character_id);

    const [sourceRows] = await db.query(
      `
        SELECT source_type, source_id
        FROM life_event_sources
        WHERE event_id = ? AND user_id = ? AND source_type = ? AND source_id = ?
        LIMIT 1
      `,
      [eventId, req.userId, sourceType, sourceId]
    );
    if (!sourceRows[0]) return res.status(404).json({ success: false, error: '来源不存在或不属于这个角色' });

    let source = null;
    if (sourceType === 'chat') {
      const [rows] = await db.query(
        `
          SELECT id, character_id, role, content, message_type, media_url, created_at, is_active
          FROM messages
          WHERE id = ? AND user_id = ? AND character_id = ?
          LIMIT 1
        `,
        [sourceId, req.userId, event.character_id]
      );
      const row = rows[0];
      if (row) source = { ...row, deleted: !Boolean(row.is_active) };
    } else if (sourceType === 'moment') {
      const [rows] = await db.query(
        `
          SELECT m.id, m.character_id, m.content, m.images, m.mood, m.created_at, m.is_deleted
          FROM moments m
          WHERE m.id = ? AND m.user_id = ? AND ${sourceVisibilitySql('m')}
          LIMIT 1
        `,
        [sourceId, req.userId, event.character_id, event.character_id]
      );
      const row = rows[0];
      if (row) source = { ...row, images: parseJsonArray(row.images), deleted: Boolean(row.is_deleted) };
    } else if (sourceType === 'comment') {
      const [rows] = await db.query(
        `
          SELECT c.id, c.moment_id, c.character_id, c.content, c.created_at,
                 m.character_id AS moment_character_id, m.content AS moment_content, m.images AS moment_images,
                 m.is_deleted AS moment_deleted
          FROM moment_comments c
          JOIN moments m ON m.id = c.moment_id AND m.user_id = c.user_id
          WHERE c.id = ? AND c.user_id = ? AND ${sourceVisibilitySql('m')}
          LIMIT 1
        `,
        [sourceId, req.userId, event.character_id, event.character_id]
      );
      const row = rows[0];
      if (row) {
        source = {
          id: row.id,
          moment_id: row.moment_id,
          character_id: row.character_id,
          content: row.content,
          created_at: row.created_at,
          moment_character_id: row.moment_character_id,
          moment_content: row.moment_content,
          moment_images: parseJsonArray(row.moment_images),
          deleted: Boolean(row.moment_deleted),
        };
      }
    } else {
      const [rows] = await db.query(
        `
          SELECT id, character_id, content, tag, category, memory_type, source_type, source_id,
                 occurred_at, created_at, is_deleted
          FROM memories
          WHERE id = ? AND user_id = ? AND character_id = ?
          LIMIT 1
        `,
        [sourceId, req.userId, event.character_id]
      );
      const row = rows[0];
      if (row) source = { ...row, deleted: Boolean(row.is_deleted) };
    }

    if (!source) return res.status(404).json({ success: false, error: '来源内容不存在或已不可见' });
    return res.json({ success: true, source: { type: sourceType, ...source } });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

  router.patch('/:id', async (req, res) => {
  try {
    const eventId = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(eventId)) return res.status(400).json({ success: false, error: '事件 ID 非法' });
    const status = ['active', 'completed', 'postponed', 'cancelled'].includes(String(req.body?.status))
      ? String(req.body.status)
      : null;
    const title = req.body?.title === undefined ? null : String(req.body.title || '').trim().slice(0, 500);
    const [result] = await db.query(
      `
        UPDATE life_events
        SET title = COALESCE(?, title), status = COALESCE(?, status)
        WHERE id = ? AND user_id = ?
      `,
      [title || null, status, eventId, req.userId]
    );
    if (!result.affectedRows) return res.status(404).json({ success: false, error: '生活事件不存在' });
    return res.json({ success: true, id: eventId });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
  });

  router.delete('/:id', async (req, res) => {
  try {
    const eventId = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(eventId)) return res.status(400).json({ success: false, error: '事件 ID 非法' });
    const [result] = await db.query(
      `DELETE FROM life_events WHERE id = ? AND user_id = ?`,
      [eventId, req.userId]
    );
    if (!result.affectedRows) return res.status(404).json({ success: false, error: '生活事件不存在' });
    return res.json({ success: true, id: eventId });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
  });

  return router;
}

export default createLifeEventsRouter();
