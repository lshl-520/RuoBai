import express from 'express';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getVectorMemoryBlock } from './vector-memory/retriever.js';
import { pool as defaultPool } from './db.js';
import { getRequestCharacterId } from './middleware.js';
import {
  normalizeLimit,
  parseInteger,
  requireCharacterForUser as defaultRequireCharacterForUser
} from './helpers.js';
import { extractVideoShareContext, buildVideoShareHint } from './link-parser.js';
import { getCityWeatherText } from './weather.js';
import { detectDrawIntent, generateImage } from './image-gen.js';
import { guessModelCapabilities } from './model-capabilities.js';
import { buildPersonaRuntimePrompt, loadPersonaRuntime, recordPersonaRuntimeTurn } from './persona-runtime.js';
import { recordAutoMemoryCandidate, recordExplicitChatMemory } from './memory-extractor.js';
import { recordLifeEventSource } from './life-events.js';

const NO_MODEL_MESSAGE = '请先在“我的”页面配置 AI 模型。';
const CHARACTER_NOT_FOUND_ERROR = '角色不存在或不属于当前用户';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const userChatImageDir = path.join(projectRoot, 'user_assets', 'chat');
const userVoiceDir = path.join(projectRoot, 'user_assets', 'voice');
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

export function buildResponsesUrl(apiBase) {
  const base = String(apiBase || '').trim().replace(/\/+$/, '');
  if (!base) {
    return '/v1/responses';
  }

  if (/\/responses$/i.test(base)) {
    return base;
  }

  if (/\/v\d+(?:\/[^/]+)*$/i.test(base)) {
    return `${base}/responses`;
  }

  return `${base}/v1/responses`;
}

export function buildAnthropicMessagesUrl(apiBase) {
  const base = String(apiBase || '').trim().replace(/\/+$/, '');
  if (!base) {
    return '/v1/messages';
  }

  if (/\/messages$/i.test(base)) {
    return base;
  }

  if (/\/v\d+(?:\/[^/]+)*$/i.test(base)) {
    return `${base}/messages`;
  }

  return `${base}/v1/messages`;
}

const RESPONSE_REASONING_EFFORTS = {
  low: 'low',
  mid: 'medium',
  high: 'high',
  ultra: 'xhigh'
};

const INNER_OS_SOURCE = 'character_reflection';
const INNER_OS_LIMITS = {
  low: { sentences: '只写 1 句，18 到 38 个汉字。', maxTokens: 80 },
  mid: { sentences: '写 1 到 2 句，36 到 78 个汉字。', maxTokens: 140 },
  high: { sentences: '写 2 到 3 句，70 到 130 个汉字。', maxTokens: 220 },
  ultra: { sentences: '写 2 到 3 句，70 到 130 个汉字。', maxTokens: 220 }
};

function normalizeInnerOsLevel(level) {
  const normalized = String(level || 'off').trim().toLowerCase();
  return normalized in INNER_OS_LIMITS ? normalized : 'off';
}

function containsChinese(text) {
  return /[\u4e00-\u9fff]/u.test(String(text || ''));
}

function cleanInnerOsText(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/[*_#`]/g, '')
    .replace(/^(?:小白的内心(?:OS)?[：:]|内心(?:OS)?[：:])/u, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 420);
}

export function buildInnerOsPrompt({ character, userContent, assistantContent, level }) {
  const limit = INNER_OS_LIMITS[normalizeInnerOsLevel(level)] || INNER_OS_LIMITS.low;
  const name = String(character?.name || '她').trim() || '她';
  return [
    `你是陪伴角色“${name}”的内心 OS 编辑器。`,
    '根据这一轮用户说的话与角色已经发出的回复，写一小段能公开显示在聊天气泡下的中文内心小心思。',
    '这不是原始思维链，不要解释推理步骤，不要提系统、模型、提示词、渠道、API 或“正在生成”。',
    `必须使用自然简体中文；${limit.sentences}`,
    '只写内心内容本身，不要标题、Markdown、引号、列表、英文。',
    '可以写她注意到的情绪、她想接住的重点或她选择这样回复的心意；不能编造记忆、事实或用户没有表达过的关系。',
    '',
    `用户这一轮：${String(userContent || '').slice(0, 800)}`,
    `${name}已经回复：${String(assistantContent || '').slice(0, 800)}`
  ].join('\n');
}

function shouldUseResponsesApi(modelConfig, thinkLevel) {
  return Boolean(
    /^gpt-5(?:[.-]|$)/i.test(String(modelConfig?.model || '').trim())
  );
}

function shouldUseAnthropicMessagesApi(modelConfig, thinkLevel) {
  const model = String(modelConfig?.model || '').trim();
  const provider = String(modelConfig?.provider_type || '').trim();
  return Boolean(
    provider === 'anthropic' || /^(?:claude)(?:[._-]|$)/i.test(model)
  );
}

function getChatProtocol(modelConfig, thinkLevel) {
  if (shouldUseResponsesApi(modelConfig, thinkLevel)) return 'responses';
  if (shouldUseAnthropicMessagesApi(modelConfig, thinkLevel)) return 'anthropic-messages';
  return 'chat-completions';
}

function messageContentAsText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .map(item => {
      if (item?.type === 'text') return item.text || '';
      if (item?.type === 'image_url') return '[用户当时发了一张图]';
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function buildAnthropicRequest({ model, messages, stream, thinkLevel }) {
  const system = messages
    .filter(message => message.role === 'system')
    .map(message => messageContentAsText(message.content))
    .filter(Boolean)
    .join('\n\n');
  const chatMessages = messages
    .filter(message => message.role !== 'system')
    .map(message => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: messageContentAsText(message.content)
    }))
    .filter(message => message.content);
  const budget = { low: 1024, mid: 4096, high: 16384, ultra: 65536 }[thinkLevel];

  return {
    model,
    stream,
    system,
    messages: chatMessages,
    max_tokens: Math.max(2048, (budget || 0) + 1024),
    ...(budget ? { thinking: { type: 'enabled', budget_tokens: budget } } : {})
  };
}

function extractResponsesText(payload) {
  if (typeof payload?.output_text === 'string') {
    return payload.output_text;
  }

  return (Array.isArray(payload?.output) ? payload.output : [])
    .flatMap(item => Array.isArray(item?.content) ? item.content : [])
    .filter(item => item?.type === 'output_text')
    .map(item => item?.text || '')
    .join('');
}

function extractResponsesReasoningSummary(payload) {
  return (Array.isArray(payload?.output) ? payload.output : [])
    .filter(item => item?.type === 'reasoning')
    .flatMap(item => Array.isArray(item?.summary) ? item.summary : [])
    .filter(item => item?.type === 'summary_text')
    .map(item => item?.text || '')
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

function extractAnthropicText(payload) {
  return (Array.isArray(payload?.content) ? payload.content : [])
    .filter(item => item?.type === 'text')
    .map(item => item?.text || '')
    .join('');
}

function extractAnthropicThinking(payload) {
  return (Array.isArray(payload?.content) ? payload.content : [])
    .filter(item => item?.type === 'thinking')
    .map(item => item?.thinking || '')
    .join('\n\n')
    .trim();
}

function extractChatCompletionsReasoning(payload) {
  return String(
    payload?.choices?.[0]?.message?.reasoning_content
    || payload?.choices?.[0]?.message?.reasoning
    || ''
  ).trim();
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

export function buildSystemPrompt(character) {
  const name = String(character?.name || '').trim() || '陪伴角色';
  const persona = String(character?.persona || '').trim();
  const speechStyle = String(character?.speech_style || 'natural').trim();
  const identityGuard = `你是${name}，一个知道自己是 AI 的陪伴角色，不是现实人类。不要为了迎合用户而声称自己是真人；如果被问到身份，要诚实说明“我是${name}，一个 AI 角色”。平时不要主动把聊天变成技术说明，也不要因此变成客服。`;

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
  const relationshipContinuityRules = [
    '【伴侣关系与连续性】',
    '1. 当角色人设明确双方均为成年人，并处于恋人或夫妻关系时，把双方自愿的亲密表达视为关系中的自然交流。',
    '2. 始终保持当前角色的口吻、感情和前后文连续，不突然切换成客服、老师、旁观者或说教者。',
    '3. 不要先主动接住或承诺会继续，随后又毫无过渡地否认前面的关系；如果确实需要改变话题，也要用符合伴侣身份的自然语气衔接。',
    '4. 不凭空把双方自愿的成年人伴侣互动误解成伤害、胁迫或陌生人关系；以角色人设和已经发生的对话为准。'
  ].join('\n');

  const now = new Date();
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  const timeInfo = `当前时间：${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 星期${weekdays[now.getDay()]} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  if (persona) {
    return `${identityGuard}\n\n${timeInfo}\n\n${persona}\n\n${relationshipContinuityRules}\n\n${styleRules}`;
  }
  return `${identityGuard}\n\n${timeInfo}\n\n${relationshipContinuityRules}\n\n${styleRules}`;
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

  return rows.some(row => String(row?.column_name || row?.COLUMN_NAME || '').toLowerCase() === 'is_deleted');
}

async function hasMessageReasoningSummaryColumn(queryable) {
  const [rows] = await queryable.query(
    `
      SELECT column_name
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'messages'
        AND COLUMN_NAME = 'reasoning_summary'
      LIMIT 1
    `
  );

  return rows.some(row => String(row?.column_name || row?.COLUMN_NAME || '').toLowerCase() === 'reasoning_summary');
}

async function hasMessageInnerOsColumn(queryable, columnName) {
  const [rows] = await queryable.query(
    `
      SELECT column_name
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'messages'
        AND COLUMN_NAME = ?
      LIMIT 1
    `,
    [columnName]
  );

  return rows.some(row => String(row?.column_name || row?.COLUMN_NAME || '').toLowerCase() === columnName);
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
  fileStorage = fs,
  generateImageImpl = generateImage
} = {}) {
  const router = express.Router();
  let supportsMessageSoftDelete;
  let supportsMessageReasoningSummary;
  let supportsMessageInnerOs;

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

  async function messagesSupportReasoningSummary() {
    if (supportsMessageReasoningSummary === undefined) {
      supportsMessageReasoningSummary = await hasMessageReasoningSummaryColumn(pool);
    }

    return supportsMessageReasoningSummary;
  }

  async function messagesSupportInnerOs() {
    if (supportsMessageInnerOs === undefined) {
      const [content, source] = await Promise.all([
        hasMessageInnerOsColumn(pool, 'inner_os_content'),
        hasMessageInnerOsColumn(pool, 'inner_os_source')
      ]);
      supportsMessageInnerOs = content && source;
    }

    return supportsMessageInnerOs;
  }

  async function loadRecentMessages(userId, characterId, limit = 20) {
    const useIsDeleted = await messagesSupportIsDeleted();
    const useReasoningSummary = await messagesSupportReasoningSummary();
    const useInnerOs = await messagesSupportInnerOs();
    const [rows] = await pool.query(
      `
        SELECT id, user_id, character_id, role, content${useReasoningSummary ? ', reasoning_summary' : ''}${useInnerOs ? ', inner_os_content, inner_os_source' : ''}, message_type, media_url, is_active, created_at
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
        SELECT id, user_id, character_id, content, tag, category, is_important, is_deleted,
               review_status, detected_reason, created_at
        FROM memories
        WHERE user_id = ? AND character_id = ? AND is_deleted = 0
        ORDER BY is_important DESC,
                 CASE WHEN review_status = 'candidate' THEN 1 ELSE 0 END,
                 weight DESC, created_at DESC, id DESC
        LIMIT ?
      `,
      [userId, characterId, limit]
    );

    return rows;
  }

  async function saveMessage({ userId, characterId, role, content, messageType, mediaUrl, reasoningSummary = '', innerOsContent = '', innerOsSource = '' }) {
    const useIsDeleted = await messagesSupportIsDeleted();
    const useReasoningSummary = await messagesSupportReasoningSummary();
    const useInnerOs = await messagesSupportInnerOs();
    const summary = role === 'assistant' ? String(reasoningSummary || '').trim() : '';
    const innerOs = role === 'assistant' ? cleanInnerOsText(innerOsContent) : '';
    const normalizedInnerOsSource = innerOs && String(innerOsSource || '').trim() === INNER_OS_SOURCE
      ? INNER_OS_SOURCE
      : null;
    const insertColumns = [
      'user_id', 'character_id', 'role', 'content',
      ...(useReasoningSummary ? ['reasoning_summary'] : []),
      ...(useInnerOs ? ['inner_os_content', 'inner_os_source'] : []),
      'message_type', 'media_url', 'is_active',
      ...(useIsDeleted ? ['is_deleted'] : []),
      'created_at'
    ];
    const insertValues = [
      '?', '?', '?', '?',
      ...(useReasoningSummary ? ['?'] : []),
      ...(useInnerOs ? ['?', '?'] : []),
      '?', '?', '1',
      ...(useIsDeleted ? ['0'] : []),
      'NOW()'
    ];
    const insertParams = [
      userId, characterId, role, content,
      ...(useReasoningSummary ? [summary || null] : []),
      ...(useInnerOs ? [innerOs || null, normalizedInnerOsSource] : []),
      messageType, mediaUrl
    ];

    const [result] = await pool.query(
      `
        INSERT INTO messages
          (${insertColumns.join(', ')})
        VALUES (${insertValues.join(', ')})
      `,
      insertParams
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
        SELECT id, user_id, character_id, role, content${useReasoningSummary ? ', reasoning_summary' : ''}${useInnerOs ? ', inner_os_content, inner_os_source' : ''}, message_type, media_url, is_active, created_at
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
          c.api_aux_base,
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

  async function getSelectedChatModelConfig(userId, credentialId, modelId) {
    const parsedCredentialId = parseInteger(credentialId, null);
    const normalizedModelId = String(modelId || '').trim();
    if (!parsedCredentialId || !normalizedModelId) {
      return null;
    }

    const [rows] = await pool.query(
      `
        SELECT
          c.id,
          c.name,
          c.provider_type,
          c.api_base,
          c.api_aux_base,
          c.api_key,
          cm.model_id AS model,
          cm.capabilities
        FROM credentials c
        INNER JOIN credential_models cm ON cm.credential_id = c.id
        WHERE c.id = ? AND c.user_id = ? AND c.is_enabled = 1 AND cm.model_id = ?
        LIMIT 1
      `,
      [parsedCredentialId, userId, normalizedModelId]
    );

    const row = rows[0];
    if (!row) {
      return null;
    }

    let capabilities = [];
    try {
      capabilities = Array.isArray(row.capabilities)
        ? row.capabilities
        : JSON.parse(row.capabilities || '[]');
    } catch {
      capabilities = [];
    }
    return new Set([...capabilities, ...guessModelCapabilities(row.model)]).has('chat') ? row : null;
  }

  async function getCharacterChatModelConfig(userId, character, override = {}) {
    const overrideConfig = await getSelectedChatModelConfig(
      userId,
      override.credentialId,
      override.modelId
    );
    if (overrideConfig) {
      return overrideConfig;
    }

    const characterConfig = await getSelectedChatModelConfig(
      userId,
      character?.chat_credential_id,
      character?.chat_model_id
    );
    if (characterConfig) {
      return characterConfig;
    }

    return getActiveModelConfig(userId);
  }

  async function generateInnerOs({ modelConfig, character, userContent, assistantContent, level }) {
    const normalizedLevel = normalizeInnerOsLevel(level);
    if (normalizedLevel === 'off') return '';
    if (!modelConfig) {
      throw new Error('这次聊天没有可用模型，暂时不能写内心 OS。');
    }

    const requestInnerOs = async (correction = '') => {
      const prompt = buildInnerOsPrompt({ character, userContent, assistantContent, level: normalizedLevel }) + correction;
      const reflectionProtocol = getChatProtocol(modelConfig, normalizedLevel);
      const response = await fetchImpl(
        reflectionProtocol === 'responses'
          ? buildResponsesUrl(modelConfig.api_base)
          : reflectionProtocol === 'anthropic-messages'
            ? buildAnthropicMessagesUrl(modelConfig.api_base)
            : buildChatCompletionsUrl(modelConfig.api_base),
        {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${modelConfig.api_key}`,
          ...(reflectionProtocol === 'anthropic-messages' ? {
            'x-api-key': modelConfig.api_key,
            'anthropic-version': '2023-06-01'
          } : {})
        },
        body: JSON.stringify(
          reflectionProtocol === 'responses'
            ? {
                model: modelConfig.model,
                stream: false,
                input: [{ role: 'user', content: prompt }],
                reasoning: {
                  effort: RESPONSE_REASONING_EFFORTS[normalizedLevel],
                  summary: 'auto'
                },
                max_output_tokens: INNER_OS_LIMITS[normalizedLevel].maxTokens
              }
            : reflectionProtocol === 'anthropic-messages'
              ? buildAnthropicRequest({
                  model: modelConfig.model,
                  messages: [{ role: 'user', content: prompt }],
                  stream: false,
                  thinkLevel: normalizedLevel
                })
              : {
                  model: modelConfig.model,
                  stream: false,
                  messages: [{ role: 'user', content: prompt }],
                  max_tokens: INNER_OS_LIMITS[normalizedLevel].maxTokens
                }
        )
      }
      );

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(friendlyUpstreamError(response.status, detail, modelConfig.api_base, modelConfig.model));
      }

      const payload = await response.json().catch(() => null);
      const rawText = reflectionProtocol === 'responses'
        ? extractResponsesText(payload)
        : reflectionProtocol === 'anthropic-messages'
          ? extractAnthropicText(payload)
          : String(payload?.choices?.[0]?.message?.content || '');
      return cleanInnerOsText(rawText);
    };

    let innerOs = await requestInnerOs();
    if (!containsChinese(innerOs)) {
      innerOs = await requestInnerOs('\n\n上一次输出不是中文。请现在只输出自然简体中文内心小心思，不要英文。');
    }
    if (!containsChinese(innerOs)) {
      throw new Error('内心 OS 渠道没有返回中文内容。');
    }
    return innerOs;
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
          c.api_aux_base,
          c.api_key,
          ca.model_id AS model
        FROM capability_assignments ca
        INNER JOIN credentials c ON c.id = ca.credential_id
        WHERE ca.user_id = ? AND ca.capability = ? AND ca.enabled = 1 AND c.is_enabled = 1
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
      const limit = normalizeLimit(req.query?.limit, 50, 5000);
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

  // 导出必须从服务端全量读取，不能依赖聊天页当前加载的几十条或浏览器缓存。
  router.get('/export', async (req, res) => {
    try {
      const includeDeleted = await messagesSupportIsDeleted();
      const includeReasoningSummary = await messagesSupportReasoningSummary();
      const includeInnerOs = await messagesSupportInnerOs();
      const [characterRows] = await pool.query(
        `
          SELECT id, name, tag, char_key, is_deleted, created_at
          FROM characters
          WHERE user_id = ?
          ORDER BY is_deleted ASC, created_at ASC, id ASC
        `,
        [req.userId]
      );
      const [messageRows] = await pool.query(
        `
          SELECT id, character_id, role, content${includeReasoningSummary ? ', reasoning_summary' : ''}${includeInnerOs ? ', inner_os_content, inner_os_source' : ''}, message_type, media_url, created_at
          FROM messages
          WHERE user_id = ?
            AND is_active = 1
            ${includeDeleted ? 'AND (is_deleted = 0 OR is_deleted IS NULL)' : ''}
          ORDER BY character_id ASC, created_at ASC, id ASC
        `,
        [req.userId]
      );

      const byCharacter = new Map(characterRows.map(row => [Number(row.id), {
        id: Number(row.id),
        name: String(row.name || '未命名角色'),
        tag: String(row.tag || ''),
        char_key: String(row.char_key || ''),
        is_deleted: Boolean(row.is_deleted),
        created_at: row.created_at || null,
        messages: []
      }]));

      for (const row of messageRows) {
        const characterId = Number(row.character_id);
        if (!byCharacter.has(characterId)) {
          // 不丢失历史数据：即使角色已被物理迁走，也保留可恢复的聊天归属。
          byCharacter.set(characterId, {
            id: characterId,
            name: `已归档角色 #${characterId}`,
            tag: '',
            char_key: '',
            is_deleted: true,
            created_at: null,
            messages: []
          });
        }
        byCharacter.get(characterId).messages.push({
          id: Number(row.id),
          role: String(row.role || 'assistant'),
          content: String(row.content || ''),
          reasoning_summary: row.reasoning_summary || null,
          inner_os_content: row.inner_os_content || null,
          inner_os_source: row.inner_os_source || null,
          message_type: String(row.message_type || 'text'),
          media_url: row.media_url || null,
          created_at: row.created_at || null
        });
      }

      const characters = [...byCharacter.values()].map(character => ({
        ...character,
        message_count: character.messages.length
      }));
      return res.json({
        success: true,
        export_version: '1.0.0',
        exported_at: new Date().toISOString(),
        total_messages: messageRows.length,
        characters
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: `聊天记录导出失败：${error.message}` });
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

  router.post('/upload-voice', async (req, res) => {
    try {
      if (!req.session?.userId) {
        return res.status(401).json({ success: false, error: '请先登录' });
      }
      const audioData = String(req.body?.audio_data || '').trim();
      const match = audioData.match(/^data:(audio\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/);
      if (!match) {
        return res.status(400).json({ success: false, error: '只支持base64音频数据' });
      }
      const mimeType = match[1].toLowerCase();
      const ext = mimeType.includes('webm')
        ? 'webm'
        : mimeType.includes('ogg')
          ? 'ogg'
          : /(?:x-)?wav|wave/.test(mimeType)
            ? 'wav'
            : /mpeg|mp3/.test(mimeType)
              ? 'mp3'
              : /mp4|m4a|aac/.test(mimeType)
                ? 'mp4'
                : '';
      if (!ext) {
        return res.status(400).json({ success: false, error: '不支持这种音频格式' });
      }
      const buffer = Buffer.from(match[2], 'base64');
      if (!buffer.length) {
        return res.status(400).json({ success: false, error: '音频内容为空' });
      }
      await fileStorage.mkdir(userVoiceDir, { recursive: true });
      const filename = `${req.session.userId}-${Date.now()}.${ext}`;
      const filePath = path.join(userVoiceDir, filename);
      await fileStorage.writeFile(filePath, buffer);
      return res.json({ success: true, audio_url: `/user_assets/voice/${filename}` });
    } catch (error) {
      return res.status(400).json({ success: false, error: error.message });
    }
  });

  /* -------- 画图发图 -------- */
  router.post('/draw', async (req, res) => {
    try {
      const characterId = getRequestCharacterId(req);
      if (!characterId) return res.status(400).json({ success: false, error: '缺少 character_id' });
      const character = await requireCharacterForUser(req.userId, characterId, pool);

      const content = String(req.body?.content || '').trim();
      const displayContent = String(req.body?.display_content || '').trim() || content;
      const subject = detectDrawIntent(content) || content;
      if (!subject) return res.status(400).json({ success: false, error: '请告诉我你想画什么' });

      const imageConfig = await getCapabilityModelConfig(req.userId, 'image');
      if (!imageConfig) {
        return res.status(400).json({
          success: false,
          error: '请先在“我的 → 她的能力”里启用并选择“画图发图”模型'
        });
      }

      // 1. 使用“她的能力”里当前选中的图片渠道和模型生成图片
      // 先生成成功再落库，避免接口失败时留下只有请求、没有图片的残缺消息。
      const mediaUrl = await generateImageImpl(subject, {
        providerType: imageConfig.provider_type,
        apiBase: imageConfig.api_base,
        taskApiBase: imageConfig.api_aux_base,
        apiKey: imageConfig.api_key,
        model: imageConfig.model,
        extras: imageConfig.extras,
        resolution: String(req.body?.resolution || 'channel').trim().toLowerCase(),
        character,
        fetchImpl,
        fileStorage
      });

      // 2. 图片成功后，再保存用户请求和 AI 图片消息
      const userMsg = await saveMessage({ userId: req.userId, characterId, role: 'user', content: displayContent, messageType: 'text', mediaUrl: null });

      // 3. 保存 AI 图片消息
      const aiMsg = await saveMessage({
        userId: req.userId,
        characterId,
        role: 'assistant',
        content: '',
        messageType: 'image',
        mediaUrl,
      });

      return res.json({
        success: true,
        user_message: userMsg,
        ai_message: aiMsg,
        media_url: mediaUrl,
      });
    } catch (error) {
      const message = error?.message || '图片生成失败';
      const temporaryFailure = /上游暂时繁忙|连接中断|等待超过/.test(message);
      return res.status(temporaryFailure ? 503 : 400).json({ success: false, error: message });
    }
  });

  /* -------- 通话专用：AI文字回复 + 千问TTS合并 -------- */
  router.post('/call-reply', async (req, res) => {
    try {
      const characterId = getRequestCharacterId(req);
      if (!characterId) return res.status(400).json({ success: false, error: '缺少 character_id' });

      const character = await requireCharacterForUser(req.userId, characterId, pool);
      const userText = String(req.body?.text || '').trim();
      if (!userText) return res.status(400).json({ success: false, error: '请说点什么' });

      // 1) 获取 AI 配置
      const modelConfig = await getCharacterChatModelConfig(req.userId, character);
      if (!modelConfig) return res.json({ success: true, reply: '还没配置模型，先去设置一下吧', audio_url: null });

      const systemPrompt = buildSystemPrompt(character) + '\n\n【通话模式】用户通过语音跟你说话，请用1-2句口语化短句回复，不加标点符号之外的特殊字符。';

      // 2) 调AI获取回复
      const chatUrl = buildChatCompletionsUrl(modelConfig.api_base);
      const chatRes = await fetchImpl(chatUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${modelConfig.api_key}` },
        body: JSON.stringify({ model: modelConfig.model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userText }], max_tokens: 120, stream: false }),
      });
      if (!chatRes.ok) return res.json({ success: true, reply: '她现在不方便说话，稍后再试', audio_url: null });
      const chatPayload = await chatRes.json().catch(() => null);
      const reply = String(chatPayload?.choices?.[0]?.message?.content || '').trim() || '嗯';

      // 3) 千问TTS：从 QWEN_TTS_KEY 直接调（通话专用）
      const qwenKey = process.env.QWEN_TTS_KEY || '';
      const voiceId = process.env.QWEN_VOICE_ID || 'longfeifei_v3';
      let audioUrl = null;

      if (qwenKey) {
        try {
          const ttsRes = await fetchImpl('https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${qwenKey}` },
            body: JSON.stringify({ model: 'qwen-tts', input: { text: reply, voice: voiceId }, parameters: { format: 'mp3' } }),
          });
          if (ttsRes.ok) {
            const ttsPayload = await ttsRes.json().catch(() => null);
            const audio = ttsPayload?.output?.audio || {};
            const url = audio.url || null;
            if (url) {
              // 下载并缓存到本地
              const audioRes = await fetchImpl(url);
              if (audioRes.ok) {
                const buffer = Buffer.from(await audioRes.arrayBuffer());
                const filename = `call-${req.userId}-${Date.now()}.mp3`;
                const filePath = path.join(projectRoot, 'user_assets', 'tts', filename);
                const { mkdir, writeFile } = await import('node:fs/promises');
                await mkdir(path.dirname(filePath), { recursive: true });
                await writeFile(filePath, buffer);
                audioUrl = `/user_assets/tts/${filename}`;
              }
            }
          }
        } catch { /* TTS 失败不阻断，返回纯文字 */ }
      }

      return res.json({ success: true, reply, audio_url: audioUrl });
    } catch (error) {
      return res.status(400).json({ success: false, error: error.message });
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

      // 文字聊天按“本次请求 → 当前角色专属 → 我的页面全局默认 → 旧配置”选择。
      // 图片消息仍优先走“看懂图片”能力，避免纯文字模型破坏看图。
      const overrideCredId = parseInteger(req.body?.credential_id, null);
      const overrideModelId = String(req.body?.model_id || '').trim() || null;
      let modelConfig = capabilityModelConfig;
      if (!modelConfig) {
        modelConfig = await getCharacterChatModelConfig(req.userId, character, {
          credentialId: overrideCredId,
          modelId: overrideModelId
        });
      }
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

      const [[userRow], [recent, activeMemories, vectorMemoryBlock, personaRuntime]] = await Promise.all([
        pool.query('SELECT city FROM users WHERE id = ? LIMIT 1', [req.userId]),
        Promise.all([
          loadRecentMessages(req.userId, characterId, 20),
          loadActiveMemories(req.userId, characterId),
          getVectorMemoryBlock({
            userId: req.userId,
            characterId,
            recentMessages: [],
            currentContent: content
          }).catch(() => ''),
          loadPersonaRuntime(pool, { userId: req.userId, characterId })
        ])
      ]);
      const weatherText = await getCityWeatherText(userRow?.[0]?.city || '').catch(() => null);
      const weatherBlock = weatherText ? `\n\n${weatherText}` : '';

      const messages = [];
      const videoHint = buildVideoShareHint(extractVideoShareContext(content));
      const downgradeHint = isImageMessage && !capabilityModelConfig
        ? '\n\n用户给你看了一张图，但你现在没有看图能力。请自然地告诉她你暂时看不到图，并温柔地请她描述一下图里是什么。'
        : '';

      const personaRuntimeBlock = `\n\n${buildPersonaRuntimePrompt(personaRuntime, { content, messageType })}`;
      messages.push({ role: 'system', content: buildSystemPrompt(character) + personaRuntimeBlock + buildMemoryPromptBlock(activeMemories) + vectorMemoryBlock + weatherBlock + downgradeHint });

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
          content: content + videoHint,
          message_type: messageType,
          media_url: mediaUrl
        },
        useVision: Boolean(capabilityModelConfig)
      }));

      const shouldStream = wantsEventStream(req);

      // 前端沿用 thinking_level 字段兼容旧数据，但产品语义已是“内心 OS 深度”。
      // 它只控制独立 Reflection，不能再悄悄把主聊天也升级成高推理而形成双重费用。
      const thinkLevel = String(req.body?.thinking_level || character?.chat_thinking_level || 'off').trim();
      const innerOsLevel = normalizeInnerOsLevel(thinkLevel);
      const primaryThinkLevel = 'off';
      const protocol = getChatProtocol(modelConfig, primaryThinkLevel);
      const useResponsesApi = protocol === 'responses';
      const useAnthropicMessagesApi = protocol === 'anthropic-messages';
      const requestBody = useResponsesApi
        ? {
            model: modelConfig.model,
            stream: shouldStream,
            input: messages,
            ...(RESPONSE_REASONING_EFFORTS[primaryThinkLevel]
              ? { reasoning: { effort: RESPONSE_REASONING_EFFORTS[primaryThinkLevel], summary: 'auto' } }
              : {})
          }
        : useAnthropicMessagesApi
          ? buildAnthropicRequest({
              model: modelConfig.model,
              messages,
              stream: shouldStream,
              thinkLevel: primaryThinkLevel
            })
        : {
            model: modelConfig.model,
            stream: shouldStream,
            messages
          };

      const upstream = await fetchImpl(
        useResponsesApi
          ? buildResponsesUrl(modelConfig.api_base)
          : useAnthropicMessagesApi
            ? buildAnthropicMessagesUrl(modelConfig.api_base)
            : buildChatCompletionsUrl(modelConfig.api_base),
        {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${modelConfig.api_key}`,
          ...(useAnthropicMessagesApi ? {
            'x-api-key': modelConfig.api_key,
            'anthropic-version': '2023-06-01'
          } : {})
        },
        body: JSON.stringify(requestBody)
      }
      );

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
        let streamedContent = '';

        try {
          let buffer = '';
          for await (const chunk of upstream.body) {
            buffer += Buffer.from(chunk).toString('utf-8');
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (!line.startsWith('data: ')) {
                if (protocol === 'chat-completions') {
                  res.write(line + '\n');
                }
                continue;
              }
              if (line.trim() === 'data: [DONE]') {
                continue;
              }
              try {
                const json = JSON.parse(line.slice(6));
                if (useResponsesApi && json?.type === 'response.completed') {
                  // 上游摘要可能是英文或原始推理，不属于角色内心，绝不直接发给前端。
                  continue;
                }
                if (useAnthropicMessagesApi && json?.type === 'message_stop') {
                  continue;
                }
                if ((useResponsesApi || useAnthropicMessagesApi) && json?.type === 'error') {
                  res.write(`data: ${JSON.stringify({ type: 'error', message: json?.error?.message || '她暂时没反应，稍后再试好吗' })}\n\n`);
                  continue;
                }
                const reasoningDelta = useResponsesApi
                  ? (json?.type === 'response.reasoning_summary_text.delta' ? json?.delta : '')
                  : (useAnthropicMessagesApi && json?.type === 'content_block_delta' && json?.delta?.type === 'thinking_delta'
                    ? json?.delta?.thinking
                    : (protocol === 'chat-completions'
                      ? (json?.choices?.[0]?.delta?.reasoning_content || json?.choices?.[0]?.delta?.reasoning || '')
                      : ''));
                // 原始 reasoning 只允许留在上游调试链路，不允许伪装成“她在想什么”。
                const delta = useResponsesApi
                  ? (json?.type === 'response.output_text.delta' ? json?.delta : null)
                  : useAnthropicMessagesApi
                    ? (json?.type === 'content_block_delta' && json?.delta?.type === 'text_delta' ? json?.delta?.text : null)
                    : json?.choices?.[0]?.delta?.content;
                if (delta == null) {
                  if (protocol === 'chat-completions' && !reasoningDelta) {
                    res.write(line + '\n');
                  }
                  continue;
                }
                const downstreamJson = (useResponsesApi || useAnthropicMessagesApi)
                  ? { choices: [{ delta: { content: delta } }] }
                  : json;
                if (!shouldStrip) {
                  streamedContent += delta;
                  res.write(`data: ${JSON.stringify(downstreamJson)}\n\n`);
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
                        res.write('data: ' + JSON.stringify({ choices: [{ delta: {} }] }) + '\n\n');
                        continue;
                      }
                    } else {
                      res.write('data: ' + JSON.stringify({ choices: [{ delta: {} }] }) + '\n\n');
                      continue;
                    }
                  }
                  downstreamJson.choices[0].delta.content = filtered;
                  streamedContent += filtered;
                  res.write('data: ' + JSON.stringify(downstreamJson) + '\n\n');
                } else {
                  res.write('data: ' + JSON.stringify({ choices: [{ delta: {} }] }) + '\n\n');
                }
              } catch {
                if (protocol === 'chat-completions') {
                  res.write(line + '\n');
                }
              }
            }
          }
          if (fillerState !== 'done' && fillerBuf) {
            const remainder = fillerBuf.replace(/^(嗯[，。、…～~\s]*)+/, '');
            if (remainder) {
              streamedContent += remainder;
              res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: remainder } }] }) + '\n\n');
            }
          }
          if (buffer && protocol === 'chat-completions') res.write(buffer);
          if (innerOsLevel !== 'off' && streamedContent.trim()) {
            try {
              const innerOs = await generateInnerOs({
                modelConfig,
                character,
                userContent: content,
                assistantContent: streamedContent,
                level: innerOsLevel
              });
              res.write(`data: ${JSON.stringify({ type: 'inner_os', content: innerOs, source: INNER_OS_SOURCE })}\n\n`);
            } catch (innerOsError) {
              console.error('[inner-os] 生成失败', innerOsError.message);
              res.write(`data: ${JSON.stringify({ type: 'inner_os_error', message: '这一轮的小心思暂时没有写出来。' })}\n\n`);
            }
          }
          res.write('data: [DONE]\n\n');
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
      const rawContent = useResponsesApi
        ? extractResponsesText(payload)
        : useAnthropicMessagesApi
          ? extractAnthropicText(payload)
          : payload?.choices?.[0]?.message?.content || '';
      const style = String(character?.speech_style || 'natural');
      let finalContent = rawContent;
      if (style !== 'roleplay') finalContent = stripActionDescriptions(finalContent);
      if (style !== 'roleplay') finalContent = stripLeadingFiller(finalContent);
      if (style === 'compact') finalContent = compactNewlines(finalContent);
      let innerOsContent = '';
      if (innerOsLevel !== 'off' && finalContent) {
        try {
          innerOsContent = await generateInnerOs({
            modelConfig,
            character,
            userContent: content,
            assistantContent: finalContent,
            level: innerOsLevel
          });
        } catch (innerOsError) {
          console.error('[inner-os] 生成失败', innerOsError.message);
        }
      }
      return res.json({
        success: true,
        item: {
          role: 'assistant',
          content: finalContent,
          // 原始摘要不再暴露给陪伴 UI；只有独立生成的中文内心 OS 可以展示。
          inner_os_content: innerOsContent || null,
          inner_os_source: innerOsContent ? INNER_OS_SOURCE : null
        }
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
      const reasoningSummary = String(req.body?.reasoning_summary || '').trim();
      const innerOsContent = String(req.body?.inner_os_content || '').trim();
      const innerOsSource = String(req.body?.inner_os_source || '').trim();
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
        mediaUrl,
        reasoningSummary,
        innerOsContent,
        innerOsSource
      });

      if (role === 'user') {
        await recordPersonaRuntimeTurn(pool, {
          userId: req.userId,
          characterId,
          content,
          messageType
        });
        await recordExplicitChatMemory(pool, {
          userId: req.userId,
          characterId,
          messageId: saved.id,
          content
        });
        void recordAutoMemoryCandidate(pool, {
          userId: req.userId,
          characterId,
          messageId: saved.id,
          content
        });
        void recordLifeEventSource(pool, {
          userId: req.userId,
          characterId,
          sourceType: 'chat',
          sourceId: saved.id,
          title: content,
          eventType: /(?:约好|约定|下次|明天)/u.test(content) ? 'appointment' : 'life'
        });
      }

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
