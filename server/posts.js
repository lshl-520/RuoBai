// ⚠️ 旧版动态系统，新功能请用 moments 系列。
// 保留是为了兼容前端旧调用，等前端切完再删。
import express from 'express';
import { pool, withTransaction } from './db.js';
import { getRequestCharacterId } from './middleware.js';
import {
  asyncHandler,
  normalizeImages,
  normalizeLimit,
  parseInteger,
  requireCharacterForUser
} from './helpers.js';

const router = express.Router();

function serializePost(row) {
  return {
    ...row,
    images: normalizeImages(row.image_url)
  };
}

router.get('/', asyncHandler(async (req, res) => {
  const limit = normalizeLimit(req.query?.limit, 50, 200);
  const [rows] = await pool.query(
    `
      SELECT id, user_id, character_id, content, image_url, likes, comments_count, created_at
      FROM posts
      WHERE user_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `,
    [req.userId, limit]
  );

  return res.json({
    success: true,
    items: rows.map(serializePost)
  });
}));

router.post('/', asyncHandler(async (req, res) => {
  try {
    const characterId = getRequestCharacterId(req);
    if (characterId) {
      await requireCharacterForUser(req.userId, characterId);
    }

    const content = String(req.body?.content || '').trim();
    if (!content) {
      return res.status(400).json({ success: false, error: '帖子内容不能为空' });
    }

    const imageUrl = JSON.stringify(normalizeImages(req.body?.image_url ?? req.body?.images));

    const [result] = await pool.query(
      `
        INSERT INTO posts
          (user_id, character_id, content, image_url, likes, comments_count, created_at)
        VALUES (?, ?, ?, ?, 0, 0, NOW())
      `,
      [req.userId, characterId, content, imageUrl]
    );

    const [rows] = await pool.query(
      `
        SELECT id, user_id, character_id, content, image_url, likes, comments_count, created_at
        FROM posts
        WHERE id = ? AND user_id = ?
        LIMIT 1
      `,
      [result.insertId, req.userId]
    );

    return res.status(201).json({ success: true, item: serializePost(rows[0]) });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const postId = parseInteger(req.params.id);
  if (!postId) {
    return res.status(400).json({ success: false, error: '帖子 ID 非法' });
  }

  const content = req.body?.content !== undefined ? String(req.body.content).trim() : null;
  const imageUrl =
    req.body?.image_url !== undefined || req.body?.images !== undefined
      ? JSON.stringify(normalizeImages(req.body?.image_url ?? req.body?.images))
      : null;

  await pool.query(
    `
      UPDATE posts
      SET
        content = COALESCE(?, content),
        image_url = COALESCE(?, image_url)
      WHERE id = ? AND user_id = ?
    `,
    [content, imageUrl, postId, req.userId]
  );

  const [rows] = await pool.query(
    `
      SELECT id, user_id, character_id, content, image_url, likes, comments_count, created_at
      FROM posts
      WHERE id = ? AND user_id = ?
      LIMIT 1
    `,
    [postId, req.userId]
  );

  if (!rows[0]) {
    return res.status(404).json({ success: false, error: '帖子不存在' });
  }

  return res.json({ success: true, item: serializePost(rows[0]) });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const postId = parseInteger(req.params.id);
  if (!postId) {
    return res.status(400).json({ success: false, error: '帖子 ID 非法' });
  }

  const deleted = await withTransaction(async connection => {
    const [postRows] = await connection.query(
      'SELECT id FROM posts WHERE id = ? AND user_id = ? LIMIT 1',
      [postId, req.userId]
    );
    if (postRows.length === 0) {
      return false;
    }

    await connection.query('DELETE FROM post_likes WHERE post_id = ?', [postId]);
    await connection.query('DELETE FROM post_comments WHERE post_id = ?', [postId]);
    await connection.query('DELETE FROM posts WHERE id = ? AND user_id = ?', [postId, req.userId]);
    return true;
  });

  if (!deleted) {
    return res.status(404).json({ success: false, error: '帖子不存在' });
  }

  return res.json({ success: true, message: '帖子已删除' });
}));

router.get('/:id/comments', asyncHandler(async (req, res) => {
  const postId = parseInteger(req.params.id);
  if (!postId) {
    return res.status(400).json({ success: false, error: '帖子 ID 非法' });
  }

  const [postRows] = await pool.query(
    'SELECT id FROM posts WHERE id = ? AND user_id = ? LIMIT 1',
    [postId, req.userId]
  );
  if (postRows.length === 0) {
    return res.status(404).json({ success: false, error: '帖子不存在' });
  }

  const [rows] = await pool.query(
    `
      SELECT id, post_id, user_id, character_id, content, created_at
      FROM post_comments
      WHERE post_id = ? AND user_id = ?
      ORDER BY created_at ASC, id ASC
    `,
    [postId, req.userId]
  );

  return res.json({ success: true, items: rows });
}));

router.post('/:id/comments', asyncHandler(async (req, res) => {
  try {
    const postId = parseInteger(req.params.id);
    if (!postId) {
      return res.status(400).json({ success: false, error: '帖子 ID 非法' });
    }

    const [postRows] = await pool.query(
      'SELECT id FROM posts WHERE id = ? AND user_id = ? LIMIT 1',
      [postId, req.userId]
    );
    if (postRows.length === 0) {
      return res.status(404).json({ success: false, error: '帖子不存在' });
    }

    const characterId = getRequestCharacterId(req);
    if (characterId) {
      await requireCharacterForUser(req.userId, characterId);
    }

    const content = String(req.body?.content || '').trim();
    if (!content) {
      return res.status(400).json({ success: false, error: '评论内容不能为空' });
    }

    const item = await withTransaction(async connection => {
      const [result] = await connection.query(
        `
          INSERT INTO post_comments
            (post_id, user_id, character_id, content, created_at)
          VALUES (?, ?, ?, ?, NOW())
        `,
        [postId, req.userId, characterId, content]
      );

      await connection.query(
        'UPDATE posts SET comments_count = comments_count + 1 WHERE id = ? AND user_id = ?',
        [postId, req.userId]
      );

      const [rows] = await connection.query(
        `
          SELECT id, post_id, user_id, character_id, content, created_at
          FROM post_comments
          WHERE id = ? AND user_id = ?
          LIMIT 1
        `,
        [result.insertId, req.userId]
      );

      return rows[0];
    });

    return res.status(201).json({ success: true, item });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
}));

router.post('/:id/like', asyncHandler(async (req, res) => {
  const postId = parseInteger(req.params.id);
  if (!postId) {
    return res.status(400).json({ success: false, error: '帖子 ID 非法' });
  }

  await withTransaction(async connection => {
    const [postRows] = await connection.query(
      'SELECT id FROM posts WHERE id = ? AND user_id = ? LIMIT 1',
      [postId, req.userId]
    );
    if (postRows.length === 0) {
      throw new Error('帖子不存在');
    }

    await connection.query(
      `
        INSERT IGNORE INTO post_likes (post_id, user_id, created_at)
        VALUES (?, ?, NOW())
      `,
      [postId, req.userId]
    );

    const [countRows] = await connection.query(
      'SELECT COUNT(*) AS count FROM post_likes WHERE post_id = ?',
      [postId]
    );

    await connection.query(
      'UPDATE posts SET likes = ? WHERE id = ? AND user_id = ?',
      [countRows[0].count, postId, req.userId]
    );
  });

  return res.json({ success: true, message: '已点赞' });
}));

router.delete('/:id/like', asyncHandler(async (req, res) => {
  const postId = parseInteger(req.params.id);
  if (!postId) {
    return res.status(400).json({ success: false, error: '帖子 ID 非法' });
  }

  await withTransaction(async connection => {
    await connection.query(
      'DELETE FROM post_likes WHERE post_id = ? AND user_id = ?',
      [postId, req.userId]
    );

    const [countRows] = await connection.query(
      'SELECT COUNT(*) AS count FROM post_likes WHERE post_id = ?',
      [postId]
    );

    await connection.query(
      'UPDATE posts SET likes = ? WHERE id = ? AND user_id = ?',
      [countRows[0].count, postId, req.userId]
    );
  });

  return res.json({ success: true, message: '已取消点赞' });
}));

export default router;
