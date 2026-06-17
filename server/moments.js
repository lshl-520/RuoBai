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
import { buildChatCompletionsUrl } from './chat.js';

function normalizeOffset(value) {
  const parsed = parseInteger(value, 0);
  return parsed && parsed > 0 ? parsed : 0;
}

function serializeMoment(row, comments = [], liked = false) {
  return {
    id: row.id,
    user_id: row.user_id,
    character_id: row.character_id,
    content: row.content,
    images: normalizeImages(row.images),
    mood: row.mood || null,
    likes_count: Number(row.likes_count || 0),
    comments_count: comments.length,
    liked,
    comments,
    created_at: row.created_at,
    is_deleted: Number(row.is_deleted || 0)
  };
}

function buildInClause(values) {
  return values.map(() => '?').join(', ');
}

function extractDraftTextFromPayload(payload) {
  if (!payload || typeof payload !== 'object') return '';
  return String(
    payload?.choices?.[0]?.message?.content
    || payload?.choices?.[0]?.delta?.content
    || payload?.message?.content
    || payload?.content
    || ''
  );
}

function extractDraftTextFromSse(raw) {
  let content = '';
  for (const rawLine of String(raw || '').split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('data:')) continue;

    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') continue;

    try {
      content += extractDraftTextFromPayload(JSON.parse(data));
    } catch {
      content += data;
    }
  }
  return content;
}

async function readDraftContent(upstream) {
  const raw = await upstream.text().catch(() => '');
  if (!raw) return '';

  try {
    return stripDraftContent(extractDraftTextFromPayload(JSON.parse(raw)));
  } catch {
    return stripDraftContent(extractDraftTextFromSse(raw));
  }
}

function stripDraftContent(value) {
  return String(value || '')
    .replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, '')
    .trim()
    .slice(0, 500);
}

export function createMomentsRouter({
  pool: db = pool,
  withTransaction: transaction = withTransaction,
  requireCharacter = requireCharacterForUser,
  fetchImpl = fetch
} = {}) {
  const router = express.Router();

  async function getActiveChatModel(userId) {
    const [capabilityRows] = await db.query(
      `
        SELECT
          ca.id,
          c.name,
          c.provider_type,
          c.api_base,
          c.api_key,
          ca.model_id AS model
        FROM capability_assignments ca
        INNER JOIN credentials c ON c.id = ca.credential_id
        WHERE ca.user_id = ? AND ca.capability = 'chat' AND ca.enabled = 1
        ORDER BY ca.id DESC
        LIMIT 1
      `,
      [userId]
    );

    if (capabilityRows[0]) {
      return capabilityRows[0];
    }

    const [rows] = await db.query(
      `
        SELECT id, name, provider_type, api_base, api_key, model, purpose, is_active
        FROM model_configs
        WHERE user_id = ? AND purpose = 'chat' AND is_active = 1
        ORDER BY id DESC
        LIMIT 1
      `,
      [userId]
    );

    return rows[0] || null;
  }

  async function loadRecentMomentContext(userId, characterId) {
    const [[messageRows], [memoryRows]] = await Promise.all([
      db.query(
        `
          SELECT role, content, created_at
          FROM messages
          WHERE user_id = ? AND character_id = ? AND is_active = 1
          ORDER BY id DESC
          LIMIT ?
        `,
        [userId, characterId, 6]
      ),
      db.query(
        `
          SELECT tag, category, content
          FROM memories
          WHERE user_id = ? AND character_id = ? AND is_deleted = 0
          ORDER BY is_important DESC, created_at DESC, id DESC
          LIMIT ?
        `,
        [userId, characterId, 4]
      )
    ]);

    return {
      messages: messageRows.reverse(),
      memories: memoryRows
    };
  }

  function buildMomentDraftMessages(character, context) {
    const name = String(character?.name || '她').trim() || '她';
    const persona = String(character?.persona || '').trim();
    const recentLines = context.messages
      .map(item => `${item.role}: ${String(item.content || '').trim()}`)
      .filter(line => line.length > 6)
      .join('\n');
    const memoryLines = context.memories
      .map(item => `- ${String(item.tag || item.category || '记忆').trim()}: ${String(item.content || '').trim()}`)
      .filter(line => line.length > 5)
      .join('\n');

    return [
      {
        role: 'system',
        content: [
          `你现在是 ${name}，请写一条适合发在个人动态里的短句。`,
          '要求：中文，1 到 2 句话，像真实生活感想，不要解释，不要加标题，不要说自己是 AI。',
          persona ? `人设参考：${persona}` : ''
        ].filter(Boolean).join('\n')
      },
      {
        role: 'user',
        content: [
          recentLines ? `最近聊天：\n${recentLines}` : '最近聊天：暂时没有可用内容。',
          memoryLines ? `长期记忆：\n${memoryLines}` : '长期记忆：暂时没有可用内容。',
          '请只输出动态正文。'
        ].join('\n\n')
      }
    ];
  }

  router.get('/', asyncHandler(async (req, res) => {
    const characterId = parseInteger(req.query?.character_id);
    const limit = normalizeLimit(req.query?.limit, 20, 100);
    const offset = normalizeOffset(req.query?.offset);

    const momentSql = characterId
      ? `
          SELECT id, user_id, character_id, content, images, mood, likes_count, created_at, is_deleted
          FROM moments
          WHERE user_id = ? AND is_deleted = 0 AND character_id = ?
          ORDER BY created_at DESC, id DESC
          LIMIT ? OFFSET ?
        `
      : `
          SELECT id, user_id, character_id, content, images, mood, likes_count, created_at, is_deleted
          FROM moments
          WHERE user_id = ? AND is_deleted = 0
          ORDER BY created_at DESC, id DESC
          LIMIT ? OFFSET ?
        `;
    const momentParams = characterId
      ? [req.userId, characterId, limit, offset]
      : [req.userId, limit, offset];

    const [momentRows] = await db.query(momentSql, momentParams);
    if (momentRows.length === 0) {
      return res.json({
        success: true,
        items: []
      });
    }

    const momentIds = momentRows.map(row => row.id);
    const placeholders = buildInClause(momentIds);

    const [commentRows] = await db.query(
      `
        SELECT id, moment_id, user_id, character_id, content, created_at
        FROM moment_comments
        WHERE user_id = ? AND moment_id IN (${placeholders})
        ORDER BY created_at ASC, id ASC
      `,
      [req.userId, ...momentIds]
    );

    const [likeRows] = await db.query(
      `
        SELECT moment_id
        FROM moment_likes
        WHERE user_id = ? AND moment_id IN (${placeholders})
      `,
      [req.userId, ...momentIds]
    );

    const commentsByMomentId = new Map();
    for (const row of commentRows) {
      const items = commentsByMomentId.get(row.moment_id) || [];
      items.push(row);
      commentsByMomentId.set(row.moment_id, items);
    }

    const likedMomentIds = new Set(likeRows.map(row => row.moment_id));

    return res.json({
      success: true,
      items: momentRows.map(row =>
        serializeMoment(
          row,
          commentsByMomentId.get(row.id) || [],
          likedMomentIds.has(row.id)
        )
      )
    });
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    const momentId = parseInteger(req.params.id);
    if (!momentId) {
      return res.status(400).json({ success: false, error: '鍔ㄦ€?ID 闈炴硶' });
    }

    const [momentRows] = await db.query(
      `
        SELECT id, user_id, character_id, content, images, mood, likes_count, created_at, is_deleted
        FROM moments
        WHERE id = ? AND user_id = ? AND is_deleted = 0
        LIMIT 1
      `,
      [momentId, req.userId]
    );

    if (momentRows.length === 0) {
      return res.status(404).json({ success: false, error: '鍔ㄦ€佷笉瀛樺湪' });
    }

    const [commentRows] = await db.query(
      `
        SELECT id, moment_id, user_id, character_id, content, created_at
        FROM moment_comments
        WHERE user_id = ? AND moment_id = ?
        ORDER BY created_at ASC, id ASC
      `,
      [req.userId, momentId]
    );

    const [likeRows] = await db.query(
      `
        SELECT moment_id
        FROM moment_likes
        WHERE user_id = ? AND moment_id = ?
        LIMIT 1
      `,
      [req.userId, momentId]
    );

    return res.json({
      success: true,
      item: serializeMoment(momentRows[0], commentRows, likeRows.length > 0)
    });
  }));

  router.post('/draft', asyncHandler(async (req, res) => {
    try {
      const characterId = getRequestCharacterId(req) || parseInteger(req.body?.character_id);
      if (!characterId) {
        return res.status(400).json({ success: false, error: '缺少角色' });
      }

      const character = await requireCharacter(req.userId, characterId);
      const modelConfig = await getActiveChatModel(req.userId);
      if (!modelConfig) {
        return res.status(400).json({ success: false, error: '请先在“我的”页面配置聊天模型' });
      }

      const context = await loadRecentMomentContext(req.userId, characterId);
      const upstream = await fetchImpl(buildChatCompletionsUrl(modelConfig.api_base), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${modelConfig.api_key}`
        },
        body: JSON.stringify({
          model: modelConfig.model,
          stream: false,
          temperature: 0.85,
          max_tokens: 160,
          messages: buildMomentDraftMessages(character, context)
        })
      });

      if (!upstream.ok) {
        const detail = await upstream.text().catch(() => '');
        return res.status(502).json({
          success: false,
          error: detail || '动态草稿生成失败'
        });
      }

      const content = await readDraftContent(upstream);
      if (!content) {
        return res.status(502).json({ success: false, error: '动态草稿为空' });
      }

      return res.json({
        success: true,
        item: {
          character_id: characterId,
          content
        }
      });
    } catch (error) {
      return res.status(400).json({ success: false, error: error.message });
    }
  }));

  router.post('/', asyncHandler(async (req, res) => {
    try {
      const characterId = getRequestCharacterId(req);
      if (characterId) {
        await requireCharacter(req.userId, characterId);
      }

      const content = String(req.body?.content || '').trim();
      if (!content) {
        return res.status(400).json({ success: false, error: '动态内容不能为空' });
      }

      const images = JSON.stringify(normalizeImages(req.body?.images));
      const mood = String(req.body?.mood || '').trim() || null;

      const [result] = await db.query(
        `
          INSERT INTO moments
            (user_id, character_id, content, images, mood, likes_count, created_at, is_deleted)
          VALUES (?, ?, ?, ?, ?, 0, NOW(), 0)
        `,
        [req.userId, characterId, content, images, mood]
      );

      const [rows] = await db.query(
        `
          SELECT id, user_id, character_id, content, images, mood, likes_count, created_at, is_deleted
          FROM moments
          WHERE id = ? AND user_id = ?
          LIMIT 1
        `,
        [result.insertId, req.userId]
      );

      return res.status(201).json({
        success: true,
        item: serializeMoment(rows[0], [], false)
      });
    } catch (error) {
      return res.status(400).json({ success: false, error: error.message });
    }
  }));

  router.post('/:id/like', asyncHandler(async (req, res) => {
    const momentId = parseInteger(req.params.id);
    if (!momentId) {
      return res.status(400).json({ success: false, error: '动态 ID 非法' });
    }

    try {
      const result = await transaction(async connection => {
        const [momentRows] = await connection.query(
          'SELECT id FROM moments WHERE id = ? AND user_id = ? LIMIT 1',
          [momentId, req.userId]
        );
        if (momentRows.length === 0) {
          throw new Error('动态不存在');
        }

        const [likeRows] = await connection.query(
          'SELECT id FROM moment_likes WHERE moment_id = ? AND user_id = ? LIMIT 1',
          [momentId, req.userId]
        );

        let liked = false;
        if (likeRows.length > 0) {
          await connection.query(
            'DELETE FROM moment_likes WHERE moment_id = ? AND user_id = ?',
            [momentId, req.userId]
          );
        } else {
          await connection.query(
            `
              INSERT INTO moment_likes (moment_id, user_id, created_at)
              VALUES (?, ?, NOW())
            `,
            [momentId, req.userId]
          );
          liked = true;
        }

        const [countRows] = await connection.query(
          'SELECT COUNT(*) AS count FROM moment_likes WHERE moment_id = ?',
          [momentId]
        );
        const likesCount = Number(countRows[0]?.count || 0);

        await connection.query(
          'UPDATE moments SET likes_count = ? WHERE id = ? AND user_id = ?',
          [likesCount, momentId, req.userId]
        );

        return {
          liked,
          likes_count: likesCount
        };
      });

      return res.json({
        success: true,
        ...result
      });
    } catch (error) {
      return res.status(400).json({ success: false, error: error.message });
    }
  }));

  router.post('/:id/comment', asyncHandler(async (req, res) => {
    const momentId = parseInteger(req.params.id);
    if (!momentId) {
      return res.status(400).json({ success: false, error: '动态 ID 非法' });
    }

    const content = String(req.body?.content || '').trim();
    if (!content) {
      return res.status(400).json({ success: false, error: '评论内容不能为空' });
    }

    try {
      const item = await transaction(async connection => {
        const [momentRows] = await connection.query(
          'SELECT id FROM moments WHERE id = ? AND user_id = ? LIMIT 1',
          [momentId, req.userId]
        );
        if (momentRows.length === 0) {
          throw new Error('动态不存在');
        }

        const characterId = getRequestCharacterId(req);
        if (characterId) {
          await requireCharacter(req.userId, characterId, connection);
        }

        const [result] = await connection.query(
          `
            INSERT INTO moment_comments
              (moment_id, user_id, character_id, content, created_at)
            VALUES (?, ?, ?, ?, NOW())
          `,
          [momentId, req.userId, characterId, content]
        );

        const [rows] = await connection.query(
          `
            SELECT id, moment_id, user_id, character_id, content, created_at
            FROM moment_comments
            WHERE id = ? AND user_id = ?
            LIMIT 1
          `,
          [result.insertId, req.userId]
        );

        return rows[0];
      });

      return res.status(201).json({
        success: true,
        item
      });
    } catch (error) {
      return res.status(400).json({ success: false, error: error.message });
    }
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    const momentId = parseInteger(req.params.id);
    if (!momentId) {
      return res.status(400).json({ success: false, error: '动态 ID 非法' });
    }

    try {
      const result = await transaction(async connection => {
        const [momentRows] = await connection.query(
          'SELECT id, character_id FROM moments WHERE id = ? AND user_id = ? LIMIT 1',
          [momentId, req.userId]
        );
        if (momentRows.length === 0) {
          throw new Error('动态不存在或无权删除');
        }

        const moment = momentRows[0];

        // 如果是角色发的动态，验证该角色属于当前用户
        if (moment.character_id !== null) {
          const [charRows] = await connection.query(
            'SELECT id FROM characters WHERE id = ? AND user_id = ? LIMIT 1',
            [moment.character_id, req.userId]
          );
          if (charRows.length === 0) {
            throw new Error('无权删除此角色的动态');
          }
        }

        // 删除相关的点赞和评论
        await connection.query('DELETE FROM moment_likes WHERE moment_id = ?', [momentId]);
        await connection.query('DELETE FROM moment_comments WHERE moment_id = ?', [momentId]);

        // 删除动态
        await connection.query('DELETE FROM moments WHERE id = ? AND user_id = ?', [momentId, req.userId]);

        return { id: momentId };
      });

      return res.json({ success: true, data: result });
    } catch (error) {
      return res.status(400).json({ success: false, error: error.message });
    }
  }));

  return router;
}

export default createMomentsRouter();
