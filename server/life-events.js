import express from 'express';
import { createHash } from 'node:crypto';
import { pool } from './db.js';
import { getRequestCharacterId } from './middleware.js';
import { normalizeLimit, requireCharacterForUser as defaultRequireCharacterForUser } from './helpers.js';

export const LIFE_EVENT_STATUSES = Object.freeze(['active', 'completed', 'postponed', 'cancelled', 'expired']);

const EVENT_KEY_STOP_PHRASES = [
  '你还记得', '想和你分享', '分享一下', '提醒我', '你还', '是不是', '是否',
  '记得', '约好', '约定', '一起', '我们', '我的', '刚刚', '刚才', '今天', '最近',
  '关于', '那条', '动态', '发的', '发了', '因为', '心情', '变好了', '变好',
  '亮起来了', '亮起来', '希望', '想要', '有点', '挺', '又', '一下', '真的',
  '我', '你', '让你', '让', '吗', '呢', '呀', '啊', '吧', '了', '的', '是'
].sort((left, right) => right.length - left.length);

function normalizeSourceType(value) {
  const type = String(value || '').trim().toLowerCase();
  return ['chat', 'moment', 'comment', 'memory'].includes(type) ? type : 'chat';
}

export function normalizeLifeEventStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  return LIFE_EVENT_STATUSES.includes(status) ? status : null;
}

function normalizeTitle(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 500);
}

function normalizeDatePart(value) {
  return String(value).padStart(2, '0');
}

export function canonicalizeLifeEventTitle(value) {
  let text = normalizeTitle(value).toLowerCase();
  text = text
    .replace(/(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/gu, (_all, year, month, day) => `${year}${normalizeDatePart(month)}${normalizeDatePart(day)}`)
    .replace(/(20\d{2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})/gu, (_all, year, month, day) => `${year}${normalizeDatePart(month)}${normalizeDatePart(day)}`);
  for (const phrase of EVENT_KEY_STOP_PHRASES) {
    text = text.replaceAll(phrase, ' ');
  }
  return text
    .replace(/[“”"'‘’、，。！？!?；;：:（）()【】［］[\]《》<>「」,/\\|~～…·]+/gu, ' ')
    .replace(/\s+/g, '')
    .slice(0, 160);
}

export function buildLifeEventKey(value) {
  const canonical = canonicalizeLifeEventTitle(value);
  if ([...canonical].length < 4) return null;
  return createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 64);
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

const CHAT_LIFE_EVENT_PATTERN = /(?:约好|约定|预约|约了|提醒我|周末一起|下周一起|明天一起|后天一起|完成了|做完了|修好了|终于把.+(?:做好|完成|跑通)|毕业了|搬家了|旅行回来|住院|手术|离职了|入职了|生日|纪念日)/u;
const TECHNICAL_EVENT_NOISE_PATTERN = /(?:项目|代码|前端|后端|React|Vue|Node|JavaScript|TypeScript|数据库|服务器|部署|Docker|Qdrant|API|接口|模型|提示词|测试|编译|构建|Git|SSH|端口|网页|浏览器|应用|App|安卓|Android|npm|Vite|bug|报错|日志|上线|仓库)/iu;

export function isTechnicalEventNoise(value) {
  return TECHNICAL_EVENT_NOISE_PATTERN.test(normalizeTitle(value));
}

function shouldTrackTitle(value, sourceType = 'chat', eventType = 'life') {
  const text = normalizeTitle(value);
  if (text.length < 4 || text.length > 500) return false;
  if (sourceType === 'memory') return true;
  if (sourceType === 'moment' || sourceType === 'comment') return false;
  if (isTechnicalEventNoise(text)) return false;
  return CHAT_LIFE_EVENT_PATTERN.test(text);
}

function isMergeableEvent(row = {}) {
  const status = String(row.status || '').toLowerCase();
  if (!['active', 'postponed'].includes(status)) return false;
  if (!row.expires_at) return true;
  const expiresAt = new Date(String(row.expires_at).replace(' ', 'T'));
  return Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() > Date.now();
}

async function findEventBySource(db, { userId, characterId, sourceType, sourceId } = {}) {
  if (!userId || !characterId || !sourceType || !sourceId) return null;
  const [rows] = await db.query(
    `
      SELECT e.id, e.character_id, e.title, e.event_type, e.status, e.expires_at, e.event_key
      FROM life_event_sources s
      INNER JOIN life_events e ON e.id = s.event_id AND e.user_id = s.user_id
      WHERE s.user_id = ? AND e.character_id = ? AND s.source_type = ? AND s.source_id = ?
      LIMIT 1
    `,
    [userId, characterId, sourceType, sourceId]
  );
  return rows[0] || null;
}

async function findMergeableEvent(db, {
  userId, characterId, eventKey, eventType, relatedSourceType, relatedSourceId
} = {}) {
  if (relatedSourceType && relatedSourceId) {
    const relatedEvent = await findEventBySource(db, {
      userId,
      characterId,
      sourceType: relatedSourceType,
      sourceId: relatedSourceId
    });
    if (relatedEvent && Number(relatedEvent.character_id) === Number(characterId) && isMergeableEvent(relatedEvent)) {
      return relatedEvent;
    }
  }

  if (!eventKey) return null;
  const [rows] = await db.query(
    `
      SELECT id, character_id, title, event_type, status, expires_at, event_key
      FROM life_events
      WHERE user_id = ? AND character_id = ?
        AND status IN ('active', 'postponed')
        AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY COALESCE(occurred_at, created_at) DESC, id DESC
      LIMIT 100
    `,
    [userId, characterId]
  );
  return rows.find(row => (
    isMergeableEvent(row)
    && (row.event_key === eventKey || (!row.event_key && buildLifeEventKey(row.title) === eventKey))
    && (!eventType || !row.event_type || row.event_type === eventType || row.event_type === 'life' || eventType === 'life')
  )) || null;
}

export async function recordLifeEventSource(db = pool, {
  userId,
  characterId,
  sourceType,
  sourceId,
  title,
  eventType = 'life',
  occurredAt = null,
  expiresAt = null,
  relatedSourceType = null,
  relatedSourceId = null
} = {}) {
  const normalizedTitle = normalizeTitle(title);
  const normalizedSourceType = normalizeSourceType(sourceType);
  const normalizedRelatedType = relatedSourceType ? normalizeSourceType(relatedSourceType) : null;
  const eventKey = buildLifeEventKey(normalizedTitle);
  const normalizedEventType = String(eventType || 'life').slice(0, 32);
  const trackSignal = shouldTrackTitle(normalizedTitle, normalizedSourceType, normalizedEventType);
  if (!userId || !characterId || !sourceId || (!trackSignal && normalizedSourceType !== 'comment')) return null;

  try {
    const existing = await findEventBySource(db, {
      userId,
      characterId,
      sourceType: normalizedSourceType,
      sourceId
    });
    if (existing) return { id: existing.id, reused: true, merged: false };

    const mergeable = await findMergeableEvent(db, {
      userId,
      characterId,
      eventKey,
      eventType: normalizedEventType,
      relatedSourceType: normalizedRelatedType,
      relatedSourceId
    });
    if (!trackSignal && !mergeable) return null;
    if (normalizedSourceType === 'comment' && !mergeable) return null;

    if (mergeable) {
      await db.query(
        `
          INSERT IGNORE INTO life_event_sources (event_id, user_id, source_type, source_id, created_at)
          VALUES (?, ?, ?, ?, NOW())
        `,
        [mergeable.id, userId, normalizedSourceType, sourceId]
      );
      return { id: mergeable.id, reused: false, merged: true };
    }

    const [eventResult] = await db.query(
      `
        INSERT INTO life_events
          (user_id, character_id, title, event_type, event_key, status, occurred_at, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, 'active', ?, ?, NOW())
      `,
      [userId, characterId, normalizedTitle, normalizedEventType, eventKey, occurredAt, expiresAt]
    );
    await db.query(
      `
        INSERT INTO life_event_sources (event_id, user_id, source_type, source_id, created_at)
        VALUES (?, ?, ?, ?, NOW())
      `,
      [eventResult.insertId, userId, normalizedSourceType, sourceId]
    );
    return { id: eventResult.insertId, reused: false, merged: false };
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
               e.status_note, e.occurred_at, e.expires_at, e.corrected_at, e.created_at, e.updated_at,
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
        status: row.status === 'active' && row.expires_at && new Date(String(row.expires_at).replace(' ', 'T')).getTime() <= Date.now()
          ? 'expired'
          : row.status,
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
    const [eventRows] = await db.query(
      `SELECT id, character_id, title FROM life_events WHERE id = ? AND user_id = ? LIMIT 1`,
      [eventId, req.userId]
    );
    const event = eventRows[0];
    if (!event) return res.status(404).json({ success: false, error: '生活事件不存在' });
    await requireCharacter(req.userId, event.character_id);

    const body = req.body || {};
    const hasTitle = Object.prototype.hasOwnProperty.call(body, 'title');
    const hasStatus = Object.prototype.hasOwnProperty.call(body, 'status');
    const hasStatusNote = Object.prototype.hasOwnProperty.call(body, 'status_note');
    const hasExpiresAt = Object.prototype.hasOwnProperty.call(body, 'expires_at');
    const title = hasTitle ? normalizeTitle(body.title) : null;
    if (hasTitle && !title) return res.status(400).json({ success: false, error: '纠正内容不能为空' });
    const status = hasStatus ? normalizeLifeEventStatus(body.status) : null;
    if (hasStatus && !status) return res.status(400).json({ success: false, error: '事件状态不支持' });
    const statusNote = hasStatusNote ? normalizeTitle(body.status_note).slice(0, 500) : null;
    let expiresAt = null;
    if (hasExpiresAt && body.expires_at) {
      const parsed = new Date(String(body.expires_at).replace(' ', 'T'));
      if (Number.isNaN(parsed.getTime())) return res.status(400).json({ success: false, error: '过期时间格式不正确' });
      expiresAt = String(body.expires_at).replace('T', ' ').slice(0, 19);
    }
    if (!hasTitle && !hasStatus && !hasStatusNote && !hasExpiresAt) {
      return res.status(400).json({ success: false, error: '没有需要修改的内容' });
    }

    const updates = [];
    const params = [];
    if (hasTitle) {
      updates.push('title = ?', 'event_key = ?', 'corrected_at = NOW()');
      params.push(title, buildLifeEventKey(title));
      if (!hasStatusNote) {
        updates.push('status_note = ?');
        params.push('已纠正事件内容');
      }
    }
    if (hasStatus) {
      updates.push('status = ?');
      params.push(status);
    }
    if (hasStatusNote) {
      updates.push('status_note = ?');
      params.push(statusNote || null);
    }
    if (hasExpiresAt) {
      updates.push('expires_at = ?');
      params.push(expiresAt);
    }
    params.push(eventId, req.userId);
    const [result] = await db.query(
      `
        UPDATE life_events
        SET ${updates.join(', ')}
        WHERE id = ? AND user_id = ?
      `,
      params
    );
    if (!result.affectedRows) return res.status(404).json({ success: false, error: '生活事件不存在' });
    return res.json({ success: true, id: eventId, corrected: hasTitle, status: status || undefined });
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
