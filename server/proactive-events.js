import express from 'express';
import { pool } from './db.js';
import { getRequestCharacterId } from './middleware.js';
import { normalizeLimit, requireCharacterForUser } from './helpers.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const characterId = getRequestCharacterId(req);
    if (characterId) await requireCharacterForUser(req.userId, characterId);
    const limit = normalizeLimit(req.query?.limit, 100, 200);
    const params = [req.userId];
    const filter = characterId ? 'AND character_id = ?' : '';
    if (characterId) params.push(characterId);
    params.push(limit);
    const [rows] = await pool.query(
      `
        SELECT id, character_id, message_id, event_type, content, status, error_message,
               created_at, sent_at, viewed_at
        FROM proactive_events
        WHERE user_id = ? ${filter}
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      `,
      params
    );
    return res.json({
      success: true,
      items: rows.map(row => ({ ...row, unread: !row.viewed_at }))
    });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

router.post('/:id/read', async (req, res) => {
  try {
    const eventId = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(eventId)) return res.status(400).json({ success: false, error: '主动消息 ID 非法' });
    const [result] = await pool.query(
      'UPDATE proactive_events SET viewed_at = COALESCE(viewed_at, NOW()) WHERE id = ? AND user_id = ?',
      [eventId, req.userId]
    );
    if (!result.affectedRows) return res.status(404).json({ success: false, error: '主动消息不存在' });
    return res.json({ success: true, id: eventId });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

export default router;
