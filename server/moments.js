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
import { recordLifeEventSource } from './life-events.js';

const ROLE_MOMENT_AUTH_TTL_MS = 2 * 60 * 1000;

function normalizeOffset(value) {
  const parsed = parseInteger(value, 0);
  return parsed && parsed > 0 ? parsed : 0;
}

function hasCharacterSelector(req) {
  const body = req.body || {};
  const query = req.query || {};
  const headers = req.headers || {};

  return Object.prototype.hasOwnProperty.call(body, 'character_id')
    || Object.prototype.hasOwnProperty.call(query, 'character_id')
    || Object.prototype.hasOwnProperty.call(headers, 'x-character-id');
}

function normalizeRoleMomentMedia(value) {
  const mediaUrl = String(value || '').trim();
  return /^\/user_assets\/chat\//.test(mediaUrl) ? mediaUrl : '';
}

function issueRoleMomentAuthorization(req, characterId, mediaUrl) {
  if (!req.session || typeof req.session !== 'object') return;
  const normalizedMediaUrl = normalizeRoleMomentMedia(mediaUrl);
  if (!normalizedMediaUrl) return;

  req.session.ruobaiRoleMomentAuthorization = {
    characterId: Number(characterId),
    mediaUrl: normalizedMediaUrl,
    issuedAt: Date.now()
  };
}

function consumeRoleMomentAuthorization(req, characterId, images) {
  const pending = req.session?.ruobaiRoleMomentAuthorization;
  if (!pending) return false;

  const issuedAt = Number(pending.issuedAt);
  const pendingCharacterId = Number(pending.characterId);
  if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > ROLE_MOMENT_AUTH_TTL_MS) {
    delete req.session.ruobaiRoleMomentAuthorization;
    return false;
  }

  if (pendingCharacterId !== Number(characterId)) return false;

  const postedImages = normalizeImages(images);
  if (!pending.mediaUrl || !postedImages.includes(pending.mediaUrl)) return false;

  delete req.session.ruobaiRoleMomentAuthorization;
  return true;
}

function normalizeVisibilityMode(value, characterId = null) {
  const mode = String(value || '').trim().toLowerCase();
  if (mode === 'shared') return 'shared';
  if (mode === 'publisher') return 'publisher';
  return characterId ? 'publisher' : 'private';
}

function normalizeImageGenerationMetadata(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function serializeMoment(row, comments = [], liked = false, audienceCharacterIds = []) {
  return {
    id: row.id,
    user_id: row.user_id,
    character_id: row.character_id,
    visibility_mode: normalizeVisibilityMode(row.visibility_mode, row.character_id),
    audience_character_ids: Array.isArray(audienceCharacterIds)
      ? audienceCharacterIds.map(Number)
      : [],
    content: row.content,
    images: normalizeImages(row.images),
    image_generation_status: String(row.image_generation_status || 'manual'),
    image_generation_error: String(row.image_generation_error || ''),
    image_mode: String(row.image_mode || 'single'),
    image_generation_metadata: normalizeImageGenerationMetadata(row.image_generation_metadata),
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

  async function loadAudienceMap(userId, momentIds) {
    const map = new Map();
    if (!momentIds.length) return map;

    try {
      const placeholders = buildInClause(momentIds);
      const [rows] = await db.query(
        `
          SELECT moment_id, character_id
          FROM moment_audiences
          WHERE user_id = ? AND moment_id IN (${placeholders})
          ORDER BY character_id ASC
        `,
        [userId, ...momentIds]
      );
      for (const row of rows || []) {
        const values = map.get(row.moment_id) || [];
        values.push(Number(row.character_id));
        map.set(row.moment_id, values);
      }
    } catch (error) {
      // Runtime schema creates this table. Keep old read-only deployments and
      // unit doubles usable until the schema fixup has run.
      if (!/moment_audiences/i.test(String(error?.message || error))) throw error;
    }
    return map;
  }

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
        WHERE ca.user_id = ? AND ca.capability = 'chat' AND ca.enabled = 1 AND c.is_enabled = 1
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
    const viewerCharacterId = parseInteger(req.query?.viewer_character_id);
    const scope = String(req.query?.scope || 'all').trim().toLowerCase();
    const limit = normalizeLimit(req.query?.limit, 20, 100);
    const offset = normalizeOffset(req.query?.offset);

    const conditions = ['m.user_id = ?', 'm.is_deleted = 0'];
    const momentParams = [req.userId];
    if (scope === 'mine') {
      conditions.push('m.character_id IS NULL');
    } else if (characterId) {
      conditions.push('m.character_id = ?');
      momentParams.push(characterId);
    }

    if (viewerCharacterId) {
      await requireCharacter(req.userId, viewerCharacterId);
      conditions.push(`
        (
          m.character_id = ?
          OR EXISTS (
            SELECT 1 FROM moment_audiences ma
            WHERE ma.moment_id = m.id
              AND ma.user_id = m.user_id
              AND ma.character_id = ?
          )
        )
      `);
      momentParams.push(viewerCharacterId, viewerCharacterId);
    }

    const momentSql = `
      SELECT
        m.id, m.user_id, m.character_id, m.visibility_mode,
        m.content, m.images, m.image_generation_status, m.image_generation_error, m.image_mode, m.image_generation_metadata, m.mood, m.likes_count, m.created_at, m.is_deleted
      FROM moments m
      WHERE ${conditions.join(' AND ')}
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT ? OFFSET ?
    `;
    momentParams.push(limit, offset);

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

    const audienceMap = await loadAudienceMap(req.userId, momentIds);

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
          likedMomentIds.has(row.id),
          audienceMap.get(row.id) || []
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
        SELECT id, user_id, character_id, visibility_mode, content, images, image_generation_status, image_generation_error, image_mode, image_generation_metadata, mood, likes_count, created_at, is_deleted
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

    const audienceMap = await loadAudienceMap(req.userId, [momentId]);

    return res.json({
      success: true,
      item: serializeMoment(
        momentRows[0],
        commentRows,
        likeRows.length > 0,
        audienceMap.get(momentId) || []
      )
    });
  }));

  router.post('/draft', asyncHandler(async (req, res) => {
    try {
      const characterId = getRequestCharacterId(req) || parseInteger(req.body?.character_id);
      if (!characterId) {
        return res.status(400).json({ success: false, error: '缺少角色' });
      }

      const character = await requireCharacter(req.userId, characterId);
      const mediaUrl = normalizeRoleMomentMedia(req.body?.media_url);
      // 角色自拍流程会紧接着调用 POST /api/moments。用短时会话授权区分它，
      // 避免普通用户直接借 character_id 冒充角色发动态。
      issueRoleMomentAuthorization(req, characterId, mediaUrl);
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
      if (hasCharacterSelector(req)) {
        if (!characterId || !consumeRoleMomentAuthorization(req, characterId, req.body?.images)) {
          return res.status(403).json({
            success: false,
            error: '普通动态只能由你发布；角色动态请从角色自拍流程发布'
          });
        }
        await requireCharacter(req.userId, characterId);
      }

      const content = String(req.body?.content || '').trim();
      if (!content) {
        return res.status(400).json({ success: false, error: '动态内容不能为空' });
      }

      const images = JSON.stringify(normalizeImages(req.body?.images));
      const mood = String(req.body?.mood || '').trim() || null;
      const visibilityMode = normalizeVisibilityMode(null, characterId);

      const [result] = await db.query(
        `
          INSERT INTO moments
            (user_id, character_id, visibility_mode, content, images, image_generation_status, image_generation_error, mood, likes_count, created_at, is_deleted)
          VALUES (?, ?, ?, ?, ?, 'manual', NULL, ?, 0, NOW(), 0)
        `,
        [req.userId, characterId, visibilityMode, content, images, mood]
      );

      const [rows] = await db.query(
        `
          SELECT id, user_id, character_id, visibility_mode, content, images, image_generation_status, image_generation_error, image_mode, image_generation_metadata, mood, likes_count, created_at, is_deleted
          FROM moments
          WHERE id = ? AND user_id = ?
          LIMIT 1
        `,
        [result.insertId, req.userId]
      );

      void recordLifeEventSource(db, {
        userId: req.userId,
        characterId,
        sourceType: 'moment',
        sourceId: result.insertId,
        title: content,
        eventType: 'life'
      });

      return res.status(201).json({
        success: true,
        item: serializeMoment(rows[0], [], false, [])
      });
    } catch (error) {
      return res.status(400).json({ success: false, error: error.message });
    }
  }));

  router.post('/:id/share', asyncHandler(async (req, res) => {
    const momentId = parseInteger(req.params.id);
    if (!momentId) {
      return res.status(400).json({ success: false, error: '动态 ID 非法' });
    }

    const requestedIds = Array.isArray(req.body?.character_ids)
      ? [...new Set(req.body.character_ids.map(value => parseInteger(value)).filter(Boolean))]
      : [];

    try {
      await transaction(async connection => {
        const [momentRows] = await connection.query(
          'SELECT id, character_id FROM moments WHERE id = ? AND user_id = ? AND is_deleted = 0 LIMIT 1',
          [momentId, req.userId]
        );
        if (momentRows.length === 0) throw new Error('动态不存在');
        if (momentRows[0].character_id != null) throw new Error('角色动态不能由用户重新分享');

        await connection.query(
          'DELETE FROM moment_audiences WHERE moment_id = ? AND user_id = ?',
          [momentId, req.userId]
        );
        for (const characterId of requestedIds) {
          await requireCharacter(req.userId, characterId);
          await connection.query(
            `
              INSERT IGNORE INTO moment_audiences (moment_id, user_id, character_id, created_at)
              VALUES (?, ?, ?, NOW())
            `,
            [momentId, req.userId, characterId]
          );
        }

        await connection.query(
          'UPDATE moments SET visibility_mode = ? WHERE id = ? AND user_id = ?',
          [requestedIds.length ? 'shared' : normalizeVisibilityMode(null, momentRows[0].character_id), momentId, req.userId]
        );
      });

      // 用户动态只有在明确分享给角色后，才进入对应角色的生活事件索引。
      // 同一条动态可以分别属于多个角色；取消分享不删除历史来源，读取时再按当前权限过滤。
      if (requestedIds.length > 0) {
        void (async () => {
          try {
            const [rows] = await db.query(
              'SELECT content FROM moments WHERE id = ? AND user_id = ? AND is_deleted = 0 LIMIT 1',
              [momentId, req.userId]
            );
            for (const characterId of requestedIds) {
              await recordLifeEventSource(db, {
                userId: req.userId,
                characterId,
                sourceType: 'moment',
                sourceId: momentId,
                title: rows[0]?.content || '',
                eventType: 'life'
              });
            }
          } catch {
            // 事件索引是辅助能力，不能影响分享结果。
          }
        })();
      }

      return res.json({
        success: true,
        moment_id: momentId,
        character_ids: requestedIds
      });
    } catch (error) {
      return res.status(400).json({ success: false, error: error.message });
    }
  }));

  router.delete('/:id/share/:characterId', asyncHandler(async (req, res) => {
    const momentId = parseInteger(req.params.id);
    const characterId = parseInteger(req.params.characterId);
    if (!momentId || !characterId) {
      return res.status(400).json({ success: false, error: '动态或角色 ID 非法' });
    }

    try {
      await transaction(async connection => {
        const [momentRows] = await connection.query(
          'SELECT id, character_id FROM moments WHERE id = ? AND user_id = ? AND is_deleted = 0 LIMIT 1',
          [momentId, req.userId]
        );
        if (momentRows.length === 0) throw new Error('动态不存在');
        if (momentRows[0].character_id != null) throw new Error('角色动态不能由用户重新分享');

        await connection.query(
          'DELETE FROM moment_audiences WHERE moment_id = ? AND user_id = ? AND character_id = ?',
          [momentId, req.userId, characterId]
        );
        const [audienceRows] = await connection.query(
          'SELECT id FROM moment_audiences WHERE moment_id = ? AND user_id = ? LIMIT 1',
          [momentId, req.userId]
        );
        await connection.query(
          'UPDATE moments SET visibility_mode = ? WHERE id = ? AND user_id = ?',
          [audienceRows.length ? 'shared' : normalizeVisibilityMode(null, momentRows[0].character_id), momentId, req.userId]
        );
      });

      return res.json({ success: true, moment_id: momentId, character_id: characterId });
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

    if (hasCharacterSelector(req)) {
      return res.status(403).json({
        success: false,
        error: '评论只能由你发布，不能借角色身份评论'
      });
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

        const [result] = await connection.query(
          `
            INSERT INTO moment_comments
              (moment_id, user_id, character_id, content, created_at)
            VALUES (?, ?, ?, ?, NOW())
          `,
          [momentId, req.userId, null, content]
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

      // 评论本身是生活事件的来源，但点赞仍然只保留为弱互动信号。
      void (async () => {
        try {
          const [momentRows] = await db.query(
            'SELECT character_id, content FROM moments WHERE id = ? AND user_id = ? LIMIT 1',
            [momentId, req.userId]
          );
          const ownerCharacterId = Number(momentRows[0]?.character_id || 0);
          const characterIds = ownerCharacterId
            ? [ownerCharacterId]
            : (await db.query(
              `
                SELECT character_id
                FROM moment_audiences
                WHERE moment_id = ? AND user_id = ?
                ORDER BY character_id ASC
              `,
              [momentId, req.userId]
            ))[0].map(row => Number(row.character_id)).filter(Boolean);
          for (const characterId of characterIds) {
            await recordLifeEventSource(db, {
              userId: req.userId,
              characterId,
              sourceType: 'comment',
              sourceId: item.id,
              title: `${momentRows[0]?.content || ''} ${content}`,
              eventType: 'life',
              relatedSourceType: 'moment',
              relatedSourceId: momentId
            });
          }
        } catch {
          // 事件索引是辅助能力，不能影响评论发送结果。
        }
      })();

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
