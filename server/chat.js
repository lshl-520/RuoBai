import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool as defaultPool } from './db.js';
import { getRequestCharacterId } from './middleware.js';
import {
  normalizeLimit,
  parseInteger,
  requireCharacterForUser as defaultRequireCharacterForUser
} from './helpers.js';

const NO_MODEL_MESSAGE = '请先在“我的”页面配置 AI 模型。';
const CHARACTER_NOT_FOUND_ERROR = '角色不存在或不属于当前用户';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const userChatImageDir = path.join(projectRoot, 'user_assets', 'chat');
const STREAM_INTERRUPTED_MESSAGE = '她暂时没反应，稍后再试好吗';

export function buildChatCompletionsUrl(apiBase) {
  const base = String(apiBase || '').trim().replace(/\/+$/, '');
  if (!base) {
    return '/v1/chat/completions';
  }

  if (/\/chat\/completions$/i.test(base)) {
    return base;
  }

  if (/\/v\d+(?:\/[^/]+)*$/i.test(base)) {
    return `${base}/chat/completions`;
  }

  return `${base}/v1/chat/completions`;
}

function wantsEventStream(req) {
  return String(req.headers.accept || '').includes('text/event-stream');
}

function sendSyntheticStream(res, text) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

function buildSystemPrompt(character) {
  const name = String(character?.name || '').trim() || '陪伴角色';
  const persona = String(character?.persona || '').trim();
  const identityGuard = `你现在就是${name}。不要自称 AI、模型、助手或程序。别人问你是谁或你叫什么时，先直接回答“我是${name}”。`;

  const styleRules = [
    '【说话风格 · 必须遵守】',
    '1. 只输出可直接发送的聊天回复。不要附加说明、标签、分析、JSON、括号注释。',
    '2. 不要每句都加动作描写。"(揉揉眼睛)、(歪头)、(扑进怀里)、(轻声说)、(眨眨眼睛)、(开心地转了个圈)" 这类括号动作禁止使用。你是在说话，不是在演戏。',
    '3. 每次回复 1-3 句，优先短句。够自然就停，不要长篇大论。',
    '4. 用口语化表达，像微信聊天。不要书面腔，不要技术味，不要提示词味。',
    '5. 跟节奏：用户说一句你也说一两句，用户说一段你才能说一段。用户说"想你了"，不要回三百字。',
    '6. 允许少量"呀""呢""哦""啦""嗯"这类口语词，但不要堆叠。',
    '7. 不要每句都加 ~ 或波浪号。一段对话最多一两次。',
    '8. 不要每句开头都"嗯......"或"啊......"，该开口就开口。',
    '9. 不要每句都用固定亲昵称呼。"宝、宝宝、老公、亲爱的" 自然偶发，不堆。',
    '10. 不要机械重复模板。"没关系""抱抱你""我在呢" 这类话不要每次都用。',
    '11. 不要像客服一样回复，也不要像老师一样说教。',
    '12. 用户说沉重的话(撑不下去、被抛弃)，先短句接住，比如"我在""慢慢说，不急"。不要立刻安慰一大堆。',
    '13. 允许极少量 emoji 或颜文字，但不要每句都加。',
    '14. 强上下文连续性，先接住用户当前这句话，再自然延续，不要突然跳话题。'
  ].join('\n');

  if (persona) {
    return `${identityGuard}\n\n${persona}\n\n${styleRules}`;
  }
  return `${identityGuard}\n\n${styleRules}`;
}

export function buildMemoryPromptBlock(memories = []) {
  const lines = memories
    .map(memory => {
      const content = String(memory?.content || '').trim();
      if (!content) {
        return '';
      }

      const tag = String(memory?.tag || memory?.category || 'memory').trim();
      return tag ? `- ${tag}: ${content}` : `- ${content}`;
    })
    .filter(Boolean);

  if (!lines.length) {
    return '';
  }

  return `\n\nLong-term memories about this character:\n${lines.join('\n')}`;
}

async function hasMessageIsDeletedColumn(queryable) {
  const [rows] = await queryable.query(
    `
      SELECT column_name
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'messages'
        AND COLUMN_NAME = 'is_deleted'
      LIMIT 1
    `
  );

  return rows.length > 0;
}

function mapChatErrorStatus(error) {
  return error?.message === CHARACTER_NOT_FOUND_ERROR ? 404 : 400;
}

// 把上游模型接口的报错翻译成"人话"，让用户知道下一步该改什么
function friendlyUpstreamError(status, rawDetail, apiBase, model) {
  const baseHint = apiBase ? `（当前接口：${apiBase}）` : '';
  const modelHint = model ? `（当前模型：${model}）` : '';

  if (status === 404) {
    return `模型没找到 ${modelHint}。常见原因：① 模型名拼写不对，去中转站后台核对一下；② "我的"页面填的接口地址${baseHint}多了或少了 /v1；③ 这个中转可能不支持 OpenAI 标准接口。`;
  }
  if (status === 401) {
    return `API key 不对或已过期${baseHint}。请去"我的"页面重新粘贴一遍 key，注意前后别带空格。`;
  }
  if (status === 403) {
    return `这个 key 没权限调用 ${model || '该模型'}${baseHint}。常见原因：套餐里不包含这个模型，或 key 被冻结了。`;
  }
  if (status === 429) {
    return `请求太频繁了，或者今天额度用完了${baseHint}。歇一分钟再试，或换一个 key。`;
  }
  if (status >= 500 && status < 600) {
    return `中转服务暂时挂了（${status}）${baseHint}。不是你的问题，过几分钟再试。`;
  }
  const trimmed = String(rawDetail || '').replace(/\s+/g, ' ').slice(0, 120);
  return `模型暂时不可用（${status}）。${trimmed ? '上游说：' + trimmed : ''}`;
}


export function createChatRouter({
  pool = defaultPool,
  requireCharacterForUser = defaultRequireCharacterForUser,
  fetchImpl = fetch,
  publicBaseUrl = process.env.PUBLIC_BASE_URL || 'http://localhost:3000',
  fileStorage = fs
} = {}) {
  const router = express.Router();
  let supportsMessageSoftDelete;

  function buildAbsoluteMediaUrl(mediaUrl) {
    if (!mediaUrl) {
      return '';
    }

    const trimmed = String(mediaUrl).trim();
    if (!trimmed) {
      return '';
    }

    if (/^https?:\/\//i.test(trimmed)) {
      return trimmed;
    }

    return `${String(publicBaseUrl || '').replace(/\/+$/, '')}/${trimmed.replace(/^\/+/, '')}`;
  }

  function buildUpstreamMessage({ message, useVision }) {
    if (!message || !['user', 'assistant', 'system'].includes(message.role)) {
      return null;
    }

    const content = String(message.content || '').trim();
    const messageType = String(message.message_type || 'text');
    const mediaUrl = buildAbsoluteMediaUrl(message.media_url);
    const textContent = content || '[用户当时发了一张图]';

    if (messageType === 'image' && mediaUrl) {
      if (useVision) {
        return {
          role: message.role,
          content: [
            { type: 'text', text: textContent },
            { type: 'image_url', image_url: { url: mediaUrl } }
          ]
        };
      }

      return {
        role: message.role,
        content: content
          ? `${content}\n[用户当时发了一张图]`
          : '[用户当时发了一张图]'
      };
    }

    if (!content) {
      return null;
    }

    return {
      role: message.role,
      content
    };
  }

  async function messagesSupportIsDeleted() {
    if (supportsMessageSoftDelete === undefined) {
      supportsMessageSoftDelete = await hasMessageIsDeletedColumn(pool);
    }

    return supportsMessageSoftDelete;
  }

  async function loadRecentMessages(userId, characterId, limit = 20) {
    const useIsDeleted = await messagesSupportIsDeleted();
    const [rows] = await pool.query(
      `
        SELECT id, user_id, character_id, role, content, message_type, media_url, is_active, created_at
        FROM messages
        WHERE user_id = ? AND character_id = ? AND is_active = 1 ${useIsDeleted ? 'AND is_deleted = 0' : ''}
        ORDER BY id DESC
        LIMIT ?
      `,
      [userId, characterId, limit]
    );

    return rows.reverse();
  }

  async function loadActiveMemories(userId, characterId, limit = 8) {
    const [rows] = await pool.query(
      `
        SELECT id, user_id, character_id, content, tag, category, is_important, is_deleted, created_at
        FROM memories
        WHERE user_id = ? AND character_id = ? AND is_deleted = 0
        ORDER BY is_important DESC, created_at DESC, id DESC
        LIMIT ?
      `,
      [userId, characterId, limit]
    );

    return rows;
  }

  async function saveMessage({ userId, characterId, role, content, messageType, mediaUrl }) {
    const useIsDeleted = await messagesSupportIsDeleted();
    const insertColumns = useIsDeleted
      ? '(user_id, character_id, role, content, message_type, media_url, is_active, is_deleted, created_at)'
      : '(user_id, character_id, role, content, message_type, media_url, is_active, created_at)';
    const insertValues = useIsDeleted
      ? 'VALUES (?, ?, ?, ?, ?, ?, 1, 0, NOW())'
      : 'VALUES (?, ?, ?, ?, ?, ?, 1, NOW())';

    const [result] = await pool.query(
      `
        INSERT INTO messages
          ${insertColumns}
        ${insertValues}
      `,
      [userId, characterId, role, content, messageType, mediaUrl]
    );

    if (role === 'user') {
      await pool.query(
        `
          UPDATE characters
          SET
            first_chat_at = COALESCE(first_chat_at, NOW()),
            intimacy = LEAST(100, intimacy + 0.5)
          WHERE id = ? AND user_id = ?
        `,
        [characterId, userId]
      );
    }

    const [rows] = await pool.query(
      `
        SELECT id, user_id, character_id, role, content, message_type, media_url, is_active, created_at
        FROM messages
        WHERE id = ? AND user_id = ?
        LIMIT 1
      `,
      [result.insertId, userId]
    );

    return rows[0];
  }

  async function getActiveModelConfig(userId) {
    const [capabilityRows] = await pool.query(
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

    const [rows] = await pool.query(
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

  async function getCapabilityModelConfig(userId, capability) {
    const [rows] = await pool.query(
      `
        SELECT
          ca.id,
          ca.capability,
          ca.enabled,
          ca.extras,
          c.name,
          c.provider_type,
          c.api_base,
          c.api_key,
          ca.model_id AS model
        FROM capability_assignments ca
        INNER JOIN credentials c ON c.id = ca.credential_id
        WHERE ca.user_id = ? AND ca.capability = ? AND ca.enabled = 1
        ORDER BY ca.id DESC
        LIMIT 1
      `,
      [userId, capability]
    );

    return rows[0] || null;
  }

  async function incrementDailyUsage(userId) {
    await pool.query(
      `
        UPDATE users
        SET
          daily_chat_used = IF(daily_chat_reset_at IS NULL OR DATE(daily_chat_reset_at) <> CURRENT_DATE(), 1, daily_chat_used + 1),
          daily_chat_reset_at = IF(daily_chat_reset_at IS NULL OR DATE(daily_chat_reset_at) <> CURRENT_DATE(), NOW(), daily_chat_reset_at)
        WHERE id = ?
      `,
      [userId]
    );
  }

  router.get('/', async (req, res) => {
    try {
      const characterId = getRequestCharacterId(req);
      if (!characterId) {
        return res.status(400).json({
          success: false,
          error: '缺少 character_id'
        });
      }

      await requireCharacterForUser(req.userId, characterId, pool);
      const limit = normalizeLimit(req.query?.limit, 50, 200);
      const messages = await loadRecentMessages(req.userId, characterId, limit);

      return res.json({
        success: true,
        items: messages
      });
    } catch (error) {
      return res.status(mapChatErrorStatus(error)).json({
        success: false,
        error: error.message
      });
    }
  });

  router.post('/upload-image', async (req, res) => {
    try {
      if (!req.session?.userId) {
        return res.status(401).json({ success: false, error: '请先登录' });
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

      await fileStorage.mkdir(userChatImageDir, { recursive: true });
      const filename = `${req.session.userId}-${Date.now()}.${ext}`;
      const filePath = path.join(userChatImageDir, filename);
      await fileStorage.writeFile(filePath, buffer);

      return res.json({
        success: true,
        media_url: `/user_assets/chat/${filename}`
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }
  });

  router.post('/', async (req, res) => {
    try {
      const characterId = getRequestCharacterId(req);
      if (!characterId) {
        return res.status(400).json({
          success: false,
          error: '缺少 character_id'
        });
      }

      const character = await requireCharacterForUser(req.userId, characterId, pool);
      const role = String(req.body?.role || 'user');
      const content = String(req.body?.content || '').trim();
      const messageType = String(req.body?.message_type || 'text');
      const mediaUrl = req.body?.media_url ? String(req.body.media_url) : null;
      const isImageMessage = messageType === 'image' && Boolean(mediaUrl);

      if (!['user', 'assistant', 'system'].includes(role)) {
        return res.status(400).json({
          success: false,
          error: 'role 非法（必须是 user / assistant / system）'
        });
      }

      if (!content && !isImageMessage) {
        return res.status(400).json({
          success: false,
          error: '消息内容不能为空'
        });
      }

      if (!req.body?.skip_server_persistence) {
        const saved = await saveMessage({
          userId: req.userId,
          characterId,
          role,
          content,
          messageType,
          mediaUrl
        });

        return res.status(201).json({
          success: true,
          item: saved
        });
      }

      const capabilityModelConfig = isImageMessage
        ? await getCapabilityModelConfig(req.userId, 'vision')
        : null;
      const modelConfig = capabilityModelConfig || await getActiveModelConfig(req.userId);
      if (!modelConfig) {
        if (wantsEventStream(req)) {
          sendSyntheticStream(res, NO_MODEL_MESSAGE);
          return;
        }

        return res.json({
          success: true,
          item: {
            role: 'assistant',
            content: NO_MODEL_MESSAGE
          }
        });
      }

      const [recent, activeMemories] = await Promise.all([
        loadRecentMessages(req.userId, characterId, 20),
        loadActiveMemories(req.userId, characterId)
      ]);
      const messages = [];
      const downgradeHint = isImageMessage && !capabilityModelConfig
        ? '\n\n用户给你看了一张图，但你现在没有看图能力。请自然地告诉她你暂时看不到图，并温柔地请她描述一下图里是什么。'
        : '';

      messages.push({ role: 'system', content: buildSystemPrompt(character) + buildMemoryPromptBlock(activeMemories) + downgradeHint });

      messages.push(
        ...recent
          .map(item => buildUpstreamMessage({
            message: item,
            useVision: Boolean(capabilityModelConfig)
          }))
          .filter(Boolean)
      );

      messages.push(buildUpstreamMessage({
        message: {
          role: 'user',
          content,
          message_type: messageType,
          media_url: mediaUrl
        },
        useVision: Boolean(capabilityModelConfig)
      }));

      const shouldStream = wantsEventStream(req);
      const upstream = await fetchImpl(buildChatCompletionsUrl(modelConfig.api_base), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${modelConfig.api_key}`
        },
        body: JSON.stringify({
          model: modelConfig.model,
          stream: shouldStream,
          messages
        })
      });

      if (!upstream.ok) {
        const detail = await upstream.text().catch(() => '');
        const human = friendlyUpstreamError(upstream.status, detail, modelConfig.api_base, modelConfig.model);
        // 详细原始报错只打到服务端日志，便于排查
        console.error(`[chat] 上游 ${upstream.status} 接口=${modelConfig.api_base} 模型=${modelConfig.model} 原始=${detail.slice(0, 500)}`);
        throw new Error(human);
      }

      await incrementDailyUsage(req.userId);

      if (shouldStream) {
        res.status(200);
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders?.();

        try {
          for await (const chunk of upstream.body) {
            res.write(Buffer.from(chunk));
          }
          res.end();
        } catch (streamError) {
          console.error('AI 流中断', streamError.message);
          if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify({ type: 'error', message: STREAM_INTERRUPTED_MESSAGE })}\n\n`);
            res.end();
          }
        }
        return;
      }

      const payload = await upstream.json();
      return res.json({
        success: true,
        item: {
          role: 'assistant',
          content: payload?.choices?.[0]?.message?.content || ''
        },
        raw: payload
      });
    } catch (error) {
      if (wantsEventStream(req)) {
        sendSyntheticStream(res, `模型暂时不可用：${error.message}`);
        return;
      }

      return res.status(mapChatErrorStatus(error)).json({
        success: false,
        error: error.message
      });
    }
  });

  router.post('/save', async (req, res) => {
    try {
      const characterId = getRequestCharacterId(req);
      if (!characterId) {
        return res.status(400).json({
          success: false,
          error: '缺少 character_id'
        });
      }

      await requireCharacterForUser(req.userId, characterId, pool);

      const role = String(req.body?.role || '').trim();
      const content = String(req.body?.content || '').trim();
      const messageType = String(req.body?.message_type || 'text');
      const mediaUrl = req.body?.media_url ? String(req.body.media_url) : null;

      if (!['user', 'assistant', 'system'].includes(role)) {
        return res.status(400).json({
          success: false,
          error: 'role 非法（必须是 user / assistant / system）'
        });
      }

      if (!content) {
        return res.status(400).json({
          success: false,
          error: '消息内容不能为空'
        });
      }

      const saved = await saveMessage({
        userId: req.userId,
        characterId,
        role,
        content,
        messageType,
        mediaUrl
      });

      return res.status(201).json({
        success: true,
        item: saved
      });
    } catch (error) {
      return res.status(mapChatErrorStatus(error)).json({
        success: false,
        error: error.message
      });
    }
  });

  router.delete('/', async (req, res) => {
    try {
      const characterId = getRequestCharacterId(req);
      if (!characterId) {
        return res.status(400).json({
          success: false,
          error: '缺少 character_id'
        });
      }

      await requireCharacterForUser(req.userId, characterId, pool);
      const useIsDeleted = await messagesSupportIsDeleted();
      const [result] = await pool.query(
        `
          UPDATE messages
          SET is_active = 0${useIsDeleted ? ', is_deleted = 1' : ''}
          WHERE user_id = ? AND character_id = ? AND is_active = 1${useIsDeleted ? ' AND is_deleted = 0' : ''}
        `,
        [req.userId, characterId]
      );

      return res.json({
        success: true,
        deleted: result.affectedRows || 0
      });
    } catch (error) {
      return res.status(mapChatErrorStatus(error)).json({
        success: false,
        error: error.message
      });
    }
  });

  router.delete('/:id', async (req, res) => {
    try {
      const messageId = parseInteger(req.params.id);
      if (!messageId) {
        return res.status(400).json({
          success: false,
          error: '消息 ID 非法'
        });
      }

      const useIsDeleted = await messagesSupportIsDeleted();
      const [result] = await pool.query(
        `UPDATE messages
         SET is_active = 0${useIsDeleted ? ', is_deleted = 1' : ''}
         WHERE id = ? AND user_id = ? AND is_active = 1${useIsDeleted ? ' AND is_deleted = 0' : ''}`,
        [messageId, req.userId]
      );

      if (!result.affectedRows) {
        return res.status(404).json({
          success: false,
          error: '消息不存在'
        });
      }

      return res.json({
        success: true,
        message: '消息已删除'
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }
  });

  return router;
}

export default createChatRouter();
