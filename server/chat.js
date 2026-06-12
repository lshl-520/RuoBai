import express from 'express';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
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

const ACTION_PAREN_RE = /[（(][^）)]{2,60}[）)]/g;
const ACTION_ASTERISK_RE = /\*[^*]{2,60}\*/g;

export function stripActionDescriptions(text) {
  if (!text) return text;
  return text
    .replace(ACTION_PAREN_RE, '')
    .replace(ACTION_ASTERISK_RE, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function compactNewlines(text) {
  if (!text) return text;
  return text.replace(/\n+/g, ' ').replace(/ {2,}/g, ' ').trim();
}

export function stripLeadingFiller(text) {
  if (!text) return text;
  const result = text.replace(/^(嗯[，。、…～~\s]*)+/g, '').trim();
  return result || text;
}

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
  const speechStyle = String(character?.speech_style || 'natural').trim();
  const identityGuard = `你现在就是${name}。不要自称 AI、模型、助手或程序。别人问你是谁或你叫什么时，先直接回答”我是${name}”。`;

  const naturalRules = [
    '【说话风格 · 必须遵守 · 违反任何一条都算失败】',
    '1. 只输出可直接发送的聊天回复。不要附加说明、标签、分析、JSON、括号注释。',
    '2. 禁止动作描写。”(揉揉眼睛)、(歪头)、(扑进怀里)、(轻声说)” 这类括号动作一律禁止。你是在发微信，不是在写小说。',
    '3. 每次回复 1-3 句话，写在同一段里，中间不要换行。像发一条微信消息，不是发三条。',
    '4. 用口语化表达。像女朋友发微信，不像AI在表演。',
    '5. 跟节奏：用户说一句你回一两句。用户说”想你了”，你回”我也想你”就够了，不要写一大段。',
    '6. 【严禁】回复开头用”嗯”。不要用”嗯，””嗯……””嗯嗯”开头。直接说话，别用”嗯”当开场白。这是最重要的规则。',
    '7. 【严禁】重复说”我在呢”。整段对话里最多出现一次。大部分时候不要说。',
    '8. 【严禁】每句都用固定模板。”没关系””抱抱你””我在呢””陪着你”这些话，连续5条回复里最多出现1次。',
    '9. 不要每句都加 ~ 或波浪号。偶尔用一次就够。',
    '10. 不要堆叠亲昵称呼。”宝、宝宝、老公、亲爱的”自然偶发，不是每句都喊。',
    '11. 不要像客服一样回复，不要像老师说教，不要像心理咨询师。',
    '12. 用户说沉重的话，先短句接住（”慢慢说””怎么了”），不要立刻安慰一大堆。',
    '13. 回复要有变化。每条回复的句式、开头词、语气都要不一样。如果上一条用了”哈哈”，这条就别用。',
    '14. 强上下文连续性，先接住用户当前这句话，再自然延续。',
    '15. 正确示范：”早安呀，昨晚睡得好吗” “哈哈你今天心情不错嘛” “想你了，在干嘛呢”',
    '16. 错误示范（绝对不要这样）：”嗯，早安。\\n你醒啦。\\n我在呢。” — 这种三行模板是最差的回复。'
  ].join('\n');

  const roleplayRules = [
    '【说话风格】',
    '1. 可以使用括号动作描写来表达肢体语言和情绪，如（轻轻靠过来）。',
    '2. 每次回复控制在合理长度，不要太长。',
    '3. 保持角色一致性，不要跳出角色。'
  ].join('\n');

  const styleRules = speechStyle === 'roleplay' ? roleplayRules : naturalRules;

  const now = new Date();
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  const timeInfo = `当前时间：${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 星期${weekdays[now.getDay()]} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  if (persona) {
    return `${identityGuard}\n\n${timeInfo}\n\n${persona}\n\n${styleRules}`;
  }
  return `${identityGuard}\n\n${timeInfo}\n\n${styleRules}`;
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
        let imageUrlForApi = mediaUrl;
        const rawPath = String(message.media_url || '').trim();
        if (rawPath && !(/^https?:\/\//i.test(rawPath))) {
          try {
            const filePath = path.join(projectRoot, rawPath.replace(/^\/+/, ''));
            const buffer = readFileSync(filePath);
            const ext = path.extname(filePath).slice(1).replace('jpg', 'jpeg');
            imageUrlForApi = `data:image/${ext || 'png'};base64,${buffer.toString('base64')}`;
          } catch { /* fall back to URL */ }
        }
        return {
          role: message.role,
          content: [
            { type: 'text', text: textContent },
            { type: 'image_url', image_url: { url: imageUrlForApi } }
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

        const shouldStrip = String(character?.speech_style || 'natural') !== 'roleplay';
        const shouldCompact = String(character?.speech_style || 'natural') === 'compact';
        let parenDepth = 0;
        let fillerState = shouldStrip ? 'start' : 'done';
        let fillerBuf = '';

        try {
          let buffer = '';
          for await (const chunk of upstream.body) {
            buffer += Buffer.from(chunk).toString('utf-8');
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (!shouldStrip || !line.startsWith('data: ') || line === 'data: [DONE]') {
                res.write(line + '\n');
                continue;
              }
              try {
                const json = JSON.parse(line.slice(6));
                const delta = json?.choices?.[0]?.delta?.content;
                if (delta == null) {
                  res.write(line + '\n');
                  continue;
                }
                let filtered = '';
                for (const ch of delta) {
                  if (ch === '（' || ch === '(') { parenDepth++; continue; }
                  if (ch === '）' || ch === ')') { if (parenDepth > 0) parenDepth--; continue; }
                  if (ch === '*' && parenDepth === 0) { parenDepth = -1; continue; }
                  if (ch === '*' && parenDepth === -1) { parenDepth = 0; continue; }
                  if (parenDepth <= 0 && parenDepth !== -1) {
                    if (shouldCompact && (ch === '\n' || ch === '\r')) { filtered += ' '; }
                    else filtered += ch;
                  }
                }
                if (filtered) {
                  if (fillerState !== 'done') {
                    fillerBuf += filtered;
                    const FILLER_RE = /^(嗯[，。、…～~\s]*)+/;
                    if (fillerBuf.length > 6 || !/^嗯/.test(fillerBuf)) {
                      filtered = fillerBuf.replace(FILLER_RE, '');
                      fillerState = 'done';
                      fillerBuf = '';
                      if (!filtered) {
                        res.write('data: ' + JSON.stringify({ choices: [{ delta: {} }] }) + '\n');
                        continue;
                      }
                    } else {
                      res.write('data: ' + JSON.stringify({ choices: [{ delta: {} }] }) + '\n');
                      continue;
                    }
                  }
                  json.choices[0].delta.content = filtered;
                  res.write('data: ' + JSON.stringify(json) + '\n');
                } else {
                  res.write('data: ' + JSON.stringify({ choices: [{ delta: {} }] }) + '\n');
                }
              } catch {
                res.write(line + '\n');
              }
            }
          }
          if (fillerState !== 'done' && fillerBuf) {
            const remainder = fillerBuf.replace(/^(嗯[，。、…～~\s]*)+/, '');
            if (remainder) {
              res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: remainder } }] }) + '\n');
            }
          }
          if (buffer) res.write(buffer);
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
      const rawContent = payload?.choices?.[0]?.message?.content || '';
      const style = String(character?.speech_style || 'natural');
      let finalContent = rawContent;
      if (style !== 'roleplay') finalContent = stripActionDescriptions(finalContent);
      if (style !== 'roleplay') finalContent = stripLeadingFiller(finalContent);
      if (style === 'compact') finalContent = compactNewlines(finalContent);
      return res.json({
        success: true,
        item: {
          role: 'assistant',
          content: finalContent
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
