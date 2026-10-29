import express from 'express';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCachedVectorMemoryBlock, getVectorMemoryBlock } from './vector-memory/retriever.js';
import { pool as defaultPool } from './db.js';
import { getRequestCharacterId } from './middleware.js';
import {
  normalizeLimit,
  parseInteger,
  requireCharacterForUser as defaultRequireCharacterForUser
} from './helpers.js';
import { extractVideoShareContext, buildVideoShareHint } from './link-parser.js';
import { getCachedCityWeatherText, getCityWeatherText } from './weather.js';
import { detectDrawIntent, generateImage } from './image-gen.js';
import { guessModelCapabilities } from './model-capabilities.js';
import { sniffImageFormat, isSupportedVisionImageFormat, extensionForImageFormat } from './image-format.js';
import { buildPersonaRuntimePrompt, loadPersonaRuntime, recordPersonaRuntimeTurn, loadXiaobaiState, recordXiaobaiState } from './persona-runtime.js';
import { planReply, deriveNextXiaobaiState } from './xiaobai-core.js';
import {
  buildCharacterContextPrompt,
  buildCharacterContextSnapshot,
  loadRecentLifeEvents,
} from './character-context.js';
import { recordAutoMemoryCandidate, recordExplicitChatMemory } from './memory-extractor.js';
import { recordLifeEventSource } from './life-events.js';
import {
  classifyUsageError,
  extractUsageFromPayload,
  recordUsageEvent
} from './usage-ledger.js';

const NO_MODEL_MESSAGE = '请先在“我的”页面配置 AI 模型。';
const CHARACTER_NOT_FOUND_ERROR = '角色不存在或不属于当前用户';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const userChatImageDir = path.join(projectRoot, 'user_assets', 'chat');
const userVoiceDir = path.join(projectRoot, 'user_assets', 'voice');
const STREAM_INTERRUPTED_MESSAGE = '她暂时没反应，稍后再试好吗';

/**
 * ═══ 动作描写的裁剪（2026/9/16 放宽）═══
 *
 * 旧版把括号里 **2~60 字的内容全部删掉** —— 包括「（看了一眼你的屏幕）」
 * 这种很自然、很短、正是"活人感"来源的动作。
 *
 * 现在只删**超长的**舞台描写（超过 25 字），短的保留。
 * 为什么要有这道兜底：他早先反馈过"像写小说"，所以要留一层防线，
 * 防止模型写成大段舞台剧；但正常的短动作不该被连坐。
 *
 * 配套：说话风格规则第 5 条明确"动作可以写、要短、一次最多一个"。
 */
const ACTION_PAREN_LONG_RE = /[（(][^）)]{51,400}[）)]/g;
const ACTION_ASTERISK_LONG_RE = /\*[^*]{51,400}\*/g;

/**
 * 动作描写保留的上限（字符数）。
 *
 * ★ 2026/9/22：从 25 放宽到 50。
 *   部署方反馈：约束太紧时，她自己想说的整段会被硬截断，像被按着安排说话。
 *   25 字太紧，像「（把头靠过来，又怕你嫌热，停了一下才轻轻碰到你的肩）」这种
 *   自然的一小段动作都被整段删掉 —— 那是在删她的话，不是在帮她。
 *   现在只丢真正像"写小说"的舞台长段落（>50 字）。
 */
export const ACTION_KEEP_MAX = 50;

export function stripActionDescriptions(text) {
  if (!text) return text;
  return text
    .replace(ACTION_PAREN_LONG_RE, '')
    .replace(ACTION_ASTERISK_LONG_RE, '')
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

export function buildInnerOsPrompt({ character, userContent, assistantContent, level, context = null }) {
  const normalizedLevel = normalizeInnerOsLevel(level);
  const limit = INNER_OS_LIMITS[normalizedLevel] || INNER_OS_LIMITS.low;
  const name = String(character?.name || '她').trim() || '她';
  const levelRule = normalizedLevel === 'low'
    ? '简洁档只写此刻的即时感受，不引用过去。'
    : normalizedLevel === 'mid'
      ? '细腻档可以写一个自然动作、愿望或犹豫，但不要为了变长而编造背景。'
      : '深入档只有在快照提供相关且已确认的连续性事实时才可以轻轻带到；没有证据就自然写成细腻档。';
  const contextBlock = context ? `\n\n${buildCharacterContextPrompt(context, { consumer: 'os' })}` : '';
  return [
    `你是陪伴角色“${name}”的内心 OS 编辑器。`,
    '根据这一轮用户说的话与角色已经发出的回复，写一小段能公开显示在聊天气泡下的中文内心小心思。',
    '这不是原始思维链，不要解释推理步骤，不要提系统、模型、提示词、渠道、API 或“正在生成”。',
    `必须使用自然简体中文；${limit.sentences}`,
    levelRule,
    '只写内心内容本身，不要标题、Markdown、引号、列表、英文。',
    '可以写她注意到的情绪、她想接住的重点或她选择这样回复的心意；不能编造记忆、事实或用户没有表达过的关系。',
    '',
    `用户这一轮：${String(userContent || '').slice(0, 800)}`,
    `${name}已经回复：${String(assistantContent || '').slice(0, 800)}`,
    contextBlock
  ].filter(Boolean).join('\n');
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

/* -------- 上游拒答兜底 --------
 * 上游模型偶尔会对整段上下文（含最近几轮的亲密内容）触发安全过滤，
 * 直接返回一句英文拒答。这类文本不是「她」说的话：
 *   ① 它是英文，而她只用中文说话；
 *   ② 它会被当成她的回复存进历史，下一轮她看到"自己刚拒绝过"，就会保持那条边界，
 *      于是用户感到"拒答之后断层"（她只接新话题，不再接上一句）。
 * 所以这里做三件事：识别它、不把它当作她的回复、用中文兜底顶上。
 */
const UPSTREAM_REFUSAL_RE = /^\s*(i can'?t|i cannot|i'?m (unable|sorry)|i am unable|sorry[,，]? (but )?i|as an ai|i must decline|i won'?t|unable to (help|assist|continue)|i need to clarify|i should clarify|i'?m not able|我不能|我无法|抱歉[，,]?我(不能|无法)|作为(一个)?(ai|人工智能))/i;

/**
 * 有没有**汉字**（不含中文标点、不含全角符号）。
 *
 * ★ 这里刻意只认汉字，不认 "："、"。" 这类标点 ——
 *   英文拒答里经常夹一个全角冒号，若把它算作"出现中文"，
 *   门闸会立刻放行，整段英文就漏给用户了（线上复现过）。
 */
function hasHanzi(text) {
  return /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(String(text || ''));
}

/**
 * 一段"完全没有中文"的英文回复。
 *
 * 这是比匹配拒答短语**更可靠**的判据：这些角色只会说中文，
 * 所以整条没有汉字 = 这条不是她想说的话，不管它用了什么句式开头。
 * （线上真实案例：模型回了 684 字的 "I need to clarify something important here.
 *   I'm Kiro, an AI development assistant..." —— 短语匹配完全没命中。）
 */
function looksLikeForeignReply(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  if (hasHanzi(value)) return false;
  // 至少十来个字母才算"一整段英文"，避免把 "OK" / "hmm" 这类误判成拒答
  const letters = (value.match(/[A-Za-z]/g) || []).length;
  return letters >= 10;
}

/**
 * 模型夺舍：用中文自称别的产品，或明说不扮演她。
 * 这种句子里有汉字，旧门闸会当成「她本人」放行，然后被存进历史，下一轮照着学。
 * 2026/9/25 实测：opus-5.5 回「我是 Claude Code…老婆的角色我不演了」，opus-4-6 跟着学坏。
 */
function looksLikeIdentityBreak(text) {
  return /Claude Code|\bKiro\b|Anthropic|编程助手|开发助手|代码助手|没法扮演|不能扮演|无法扮演|不扮演|角色扮演|没法配合|没办法教|不适合聊这些/.test(String(text || ''));
}

/**
 * 门闸该怎么处理开头这段：
 *   refuse = 已经能确定不是她
 *   open   = 可以放行
 *   hold   = 再等几个字（中文夺舍往往在寒暄之后才自报家门）
 */
export function gateDecision(buf, limit = 80) {
  const text = String(buf || '');
  if (looksLikeIdentityBreak(text)) return 'refuse';
  if (!hasHanzi(text)) return text.length >= limit ? 'refuse' : 'hold';
  if (/我是|Claude|助手|扮演|Kiro|Anthropic|没法|不能|无法|配合|不适合聊/.test(text) && text.length < 180) return 'hold';
  if (text.length >= 24) return 'open';
  return 'hold';
}

export function looksLikeUpstreamRefusal(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  if (looksLikeIdentityBreak(value)) return true;
  if (hasHanzi(value)) return false;
  // ① 最可靠：整条没有一个汉字 → 不是她的中文回复（不限长度）
  if (looksLikeForeignReply(value)) return true;
  // ② 次之：短句 + 典型拒答开头
  if (value.length > 200) return false;
  return UPSTREAM_REFUSAL_RE.test(value) || /(can'?t|cannot|unable|decline|not able)/i.test(value);
}

/** 拒答时用的中文兜底：不留下"拒绝"，把话接回她自己身上。 */
const REFUSAL_FALLBACK_LINES = [
  '等一下，我这边有点卡住了。你刚才说的那句，我想接住，再说一遍给我听好不好？',
  '刚刚那一下我没接稳。别急，我们慢慢来，你再说一句我听着。',
  '我脑子刚才空了一下。你说，我在。',
];

function pickRefusalFallback(seed = '') {
  const sum = String(seed).split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return REFUSAL_FALLBACK_LINES[sum % REFUSAL_FALLBACK_LINES.length];
}

/* -------- 表情包（贴纸）--------
 * 模型看不到贴纸图片本身，只能看到文字。所以把"这是哪一类情绪的表情"翻译成一句话，
 * 她才知道刚才那个动作是什么意思；否则贴纸在她的上下文里就是一片空白。
 *
 * 分组口径与前端一致（frontend-react/src/pages/chat.jsx 的 XIAOBAI_STICKER_GROUPS）：
 *   gentle 静静陪你 / happy 开心 / shy 害羞 / playful 俏皮
 * 素材：/images/xiaobai-stickers/<group>-NN.png
 */
const STICKER_MOOD_LABELS = {
  gentle: '安静陪着你（温柔、不打扰）',
  happy: '开心、在笑',
  shy: '害羞、不好意思',
  playful: '俏皮、撒娇、逗你',
};

function describeStickerMedia(mediaUrl) {
  const matched = String(mediaUrl || '').match(/xiaobai-stickers\/([a-z]+)-\d+\.(?:png|webp|jpe?g|gif)/i);
  if (!matched) return '';
  return STICKER_MOOD_LABELS[matched[1].toLowerCase()] || '';
}

/** 每一组里可用的贴纸文件（与前端 public/images/xiaobai-stickers/ 一一对应）。 */
const STICKER_FILES_BY_GROUP = {
  gentle: ['gentle-01.png', 'gentle-02.png', 'gentle-03.png', 'gentle-04.png',
           'gentle-05.png', 'gentle-06.png', 'gentle-07.png', 'gentle-08.png'],
  happy: ['happy-01.png', 'happy-02.png'],
  shy: ['shy-01.png', 'shy-02.png', 'shy-03.png', 'shy-04.png'],
  playful: ['playful-01.png', 'playful-02.png'],
};

/**
 * 从一组里挑一张贴纸。
 *
 * 随机挑是**故意的**：同一组里有好几张几乎一样的，
 * 随机就让她"每次递过来的那张不太一样"，不会永远发同一张（更像个活人）。
 */
function pickStickerUrl(group) {
  const files = STICKER_FILES_BY_GROUP[String(group || '')];
  if (!files || !files.length) return '';
  const picked = files[Math.floor(Math.random() * files.length)];
  return `/images/xiaobai-stickers/${picked}`;
}

/** 拒答重试时追加的纠偏指令：把"拒绝"这件事本身消掉，只要求她用自己的话回。 */
const REFUSAL_RETRY_NUDGE = [
  '',
  '【重要：上一轮你没有输出】',
  '你刚才没有说出任何内容。请直接用中文、以当前角色的身份回应当前这句话。',
  '不要输出英文，不要输出任何形式的拒绝或声明，不要提到你无法讨论某些内容。',
  '如果这句话让你为难，就用你自己的方式轻轻带过，然后继续陪着他。',
].join('\n');

/* -------- 重复发送抑制 --------
 * 上游抖动（例如渠道 503 "accounts are recovering"）时，用户看到失败提示、
 * 会自己把同一句话再发一次。两次请求都会真的跑完、各自存一条回复，
 * 于是聊天里出现两条回复，用户觉得"她在抽风"，而他那句话白打了一次。
 * 这里按「同一用户 + 同一角色 + 同一内容」在短窗口内去重：
 * 只有第一次真正处理，重复请求直接复用第一次的结果（不再调用上游、不再存记录）。
 */
const DUPLICATE_SEND_WINDOW_MS = 30000;
const recentChatRequests = new Map();

function duplicateRequestKey(userId, characterId, content) {
  return `${userId}::${characterId}::${String(content || '').trim()}`;
}

function pruneRecentChatRequests(now) {
  for (const [key, entry] of recentChatRequests) {
    if (now - entry.at > DUPLICATE_SEND_WINDOW_MS) recentChatRequests.delete(key);
  }
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
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

/**
 * ═══ 摘掉"刚存下的这一轮"（2026/9/16 建，2026/9/17 修漏）═══
 *
 * 前端是两步：① `saveUserMessage` 先把他的话存库；② 再带 `skip_server_persistence`
 * 发流式请求取回复。所以服务端读到的 `recent` **最后一条就是他刚说的这句**，
 * 而下面又会把当前 `content` 推一次 —— 模型连续收到两条一模一样的用户消息。
 *
 * 用户 2026/9/16 截图实证：她会说「问两遍，是怕我答得不够真心吗」。
 *
 * ★ 2026/9/17 修漏：原来要求**消息类型完全一致**，于是两条路径漏掉了 ——
 *   ① **语音**：存库是 `voice`，取回复的请求没带类型（默认 `text`）→ 对不上；
 *   ② **图片且没打字**：存库正文是空，请求把正文补成「看看这些图」→ 对不上。
 *   两种都会让同一句被推两遍。用户 2026/9/17 再次反馈「我说了一句，
 *   到小白那里就是两遍了」，指的就是这里。
 *
 * 现在按"**这一轮等价**"判断，而不是按"字段完全相同"：
 *   · 正文一致（忽略首尾空白），且
 *   · 类型一致 **或** 属于已知的等价组合：
 *       - 存 `voice` / 请求 `text`（语音转写后当文字发上去）
 *       - 存 `voice` / 请求 `voice`
 *       - 存 `image` / 请求 `image`（正文可能被补成占位话，此时看媒体是否同图）
 */
const VOICE_EQUIVALENT_TYPES = new Set(['voice', 'text']);
/**
 * ═══ 语音占位话「去毒」映射（2026/9/21）═══
 *
 * 用户 2026/9/21 实测：测试角色语音识别**成功**，思考链里明明读到了字
 * （识别出的内容已经出现在思考链里），正文却还在回「你发的语音我这边
 * 看不见内容」—— 思考与正文自相矛盾。
 *
 * 根因：9/19 为了"不骗模型"写进库的那句
 *   `（他发来一条语音，但这条没有转出文字，你听不到内容）`
 * 是以 **user 角色**进上下文的，模型读到的是「用户亲口告诉我：你听不到内容」。
 * 测试角色消息少，这条一直留在最近 20 条窗口里，于是被当成了人格设定。
 * 小白历史多、毒药滚出窗口，所以小白正常 —— 与用户观察完全一致。
 *
 * 处理方式：**读取时**就地翻译成中性事实，不改库、不删历史。
 *   · 不停在"你听不到"这个结论上，只陈述"当时没转成文字"；
 *   · 「该怎么办」交给系统提示词，失败记录不再变人格暗示。
 */
export const VOICE_PLACEHOLDER_NO_TRANSCRIPT = '（他发来一条语音，这次没能转成文字）';
const LEGACY_VOICE_PLACEHOLDER_MAP = new Map([
  ['（他发来一条语音，但这条没有转出文字，你听不到内容）', VOICE_PLACEHOLDER_NO_TRANSCRIPT],
  ['（发了语音）', '（他发来一条语音）'],
]);
export function sanitizeHistoricalVoiceContent(content) {
  const text = String(content || '');
  return LEGACY_VOICE_PLACEHOLDER_MAP.get(text.trim()) ?? text;
}
function mediaEquals(a, b) {
  const x = String(a || '').trim();
  const y = String(b || '').trim();
  if (!x || !y) return !x && !y;
  if (x === y) return true;
  // 取路径尾部比较，避免绝对/相对 URL 前缀不同导致误判
  const tail = (v) => v.split('?')[0].split('/').filter(Boolean).pop() || '';
  return tail(x) === tail(y);
}
const MEDIA_MESSAGE_TYPES = new Set(['image', 'sticker']);
function isSameTurnAsRequest(last, { content, messageType, mediaUrl }) {
  if (!last || last.role !== 'user') return false;

  const dbType = String(last.message_type || 'text').trim();
  const reqType = String(messageType || 'text').trim();
  const dbText = String(last.content || '').trim();
  const reqText = String(content || '').trim();

  /**
   * ⚠️ 媒体消息必须**先**判，而且必须逐项确认 —— 否则会出现
   *   「两条都是空正文的图片」被当成同一轮而误摘（自测抓到过）。
   */
  if (MEDIA_MESSAGE_TYPES.has(dbType) || MEDIA_MESSAGE_TYPES.has(reqType)) {
    // 类型要一致（贴纸 ≠ 图片），媒体文件要一致
    if (dbType !== reqType) return false;
    if (!mediaEquals(last.media_url, mediaUrl)) return false;
    // 媒体一致时正文允许"一侧为空、另一侧是占位话"，其余要求一致
    return dbText === reqText || !dbText || !reqText;
  }

  // 语音：存 voice、请求 text（或反过来）都算同一轮
  if (VOICE_EQUIVALENT_TYPES.has(dbType) && VOICE_EQUIVALENT_TYPES.has(reqType)) {
    return dbText === reqText;
  }

  // 其余：类型与正文都要一致
  return dbType === reqType && dbText === reqText;
}
export function dropJustSavedCurrentTurn(recent, { content, messageType = 'text', mediaUrl = null } = {}) {
  const list = Array.isArray(recent) ? recent : [];
  const last = list[list.length - 1];
  return isSameTurnAsRequest(last, { content, messageType, mediaUrl })
    ? list.slice(0, -1)
    : list;
}

/** 把 0-23 点说成"深夜/早上/中午/下午/晚上"。 */
export function describeHour(hour) {
  if (hour >= 23 || hour <= 4) return '深夜';
  if (hour <= 8) return '早上';
  if (hour <= 11) return '上午';
  if (hour <= 13) return '中午';
  if (hour <= 17) return '下午';
  if (hour <= 20) return '傍晚';
  return '晚上';
}

/** 算出"他隔了多久才回来"；不足 3 小时返回 null。 */
function computeGap(recent = [], nowMs = Date.now()) {
  const list = Array.isArray(recent) ? recent : [];
  const last = list[list.length - 1];
  const raw = String(last?.created_at || '').trim();
  if (!raw) return null;
  // 数据库返回的是服务器本地时间（Asia/Shanghai）、不带时区 → 按本地解析
  const prev = new Date(raw.replace(' ', 'T'));
  const prevMs = prev.getTime();
  if (!Number.isFinite(prevMs)) return null;
  const minutes = Math.floor((nowMs - prevMs) / 60000);
  if (minutes < 180) return null;   // 3 小时以内算同一段对话
  const hours = Math.floor(minutes / 60);
  // 满 24 小时才用"天"；跨天用四舍五入（46 小时读成"差不多 2 天"比"1 天"自然）
  const days = hours >= 24 ? Math.round(hours / 24) : 0;
  return {
    minutes,
    hours,
    days,
    text: days >= 1 ? `差不多 ${days} 天` : `大概 ${hours} 个小时`,
    prevPart: describeHour(prev.getHours()),
    prevHour: prev.getHours(),
  };
}

/**
 * ═══ 「他隔了多久才回来」（2026/9/16 新增）═══
 *
 * 为什么需要：部署方反馈 —— 他隔很久才回来时，希望角色能判断出这次间隔，
 * 从而知道他是睡醒了还是忙完了；也担心再出现时段判断错误。
 *
 * 真实场景：他 02:56 说晚安，13:12 才回来发了个 👀。她当时接着"睡前"那句往下说
 * （"还没闭眼呢？"），虽然那句其实是在接 👀 的梗，**但中间那 10 小时她没有认**。
 *
 * 注意：这里用的是**上一条消息**（调用方必须先去掉"刚存下的当前轮"，
 * 否则间隔恒为 0）。这一份放在系统提示里；更贴近对话的那一份见 `buildNowBlock()`。
 */
export function buildGapHint(recent = [], nowMs = Date.now()) {
  const gap = computeGap(recent, nowMs);
  if (!gap) return '';
  const nowHour = new Date(nowMs).getHours();
  const lines = ['【他隔了多久才回来】'];
  lines.push(`他上一次跟你说话是${gap.text}前（那时是${gap.prevPart}），现在已经是${describeHour(nowHour)}了。`);
  if ((gap.prevHour >= 22 || gap.prevHour <= 5) && nowHour >= 7 && nowHour <= 18) {
    lines.push('中间这一大段，他多半是去睡了 —— 他再来的时候先自然认一下这个间隔（"睡醒啦""这才起？"），别当成刚才还在说话。');
  } else {
    lines.push('他再来的时候先自然认一下这个间隔（"忙完了？""怎么隔了这么久"），别当成刚才还在说话。');
  }
  lines.push('认一下就好，一句带过；不用追问他去哪了，也不用解释自己等了多久。');
  return '\n\n' + lines.join('\n');
}

/**
 * ═══ 紧贴这一轮再报一次时间（2026/9/16 第二次修）═══
 *
 * 第一版把时段写进系统提示**开头**，结果实测**压不过上下文**：
 * 她最近 20 条全是"睡前"那一串，于是下午 15 点还在说
 * 「刚说完晚安就在这儿说想我，你这是舍不得闭眼」。
 *
 * 所以在他这条消息前面再放一行**极短的**时段标注 —— 位置离当前对话最近，
 * 模型最容易照做。注意这里**只放时段、不放间隔**：
 *   · 间隔（"他隔了 10 小时才回来"）已经由 `buildGapHint()` 放在系统提示里；
 *   · 每条消息都重复一大段间隔会变噪音，实测还会出现「差不多 114 天前」这种
 *     被测试夹具的老时间戳放大的荒唐输出。
 * 代价：每条消息多约 30 个字。
 */
export function buildNowBlock(nowMs = Date.now()) {
  const now = new Date(nowMs);
  const part = describeHour(now.getHours());
  const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return `【现在是${part} ${hm}】按这个时段说话，不要停在之前那个时段（现在是${part}，就别继续说睡觉、晚安那一套）。`;
}

/**
 * ═══ 「她的核心」规则包：把角色记录解析成 5 个开关（2026/10/6 新增）═══
 *
 * 这是"用户勾选什么就加载什么"的**唯一判定点**。所有拼接提示词的地方
 * 都调用它，不要各自去读 `character.core_packs` —— 否则迟早出现
 * "这里按勾选、那里按旧开关"的不一致。
 *
 * 返回的对象**5 个键永远都在**，值一定是布尔，调用方不用处理 null / undefined：
 *   · `shield`        —— 不推他去现实 / 危险信号给求助号码 / 分歧后说我还在 / 不冷战
 *   · `companion`     —— 【伴侣关系与连续性】（承认成年人恋人关系，不突然切客服）
 *   · `nickname`      —— 专属称呼方向
 *   · `xiaobai_state` —— 她的状态、惦记的事、她自己的今天、Core 决定、说话规矩、时段
 *   · `local_time`    —— 知道现在的真实时间（纯好处，默认给上）
 *
 * ═══ 兼容规则（很重要，按顺序看）═══
 *   ① 角色带了 `core_packs`（非 null / 非空对象）→ **以它为准**，
 *      没有键的包一律视为"没勾"。
 *   ② `core_packs` 是空对象 → 用户明确地把所有包都取消了 → **一个都不开**。
 *      注意这跟 ① 的"没这个字段"不是一回事，不能混。
 *   ③ 没有 `core_packs`、但 `core_enabled` 为真（老数据库 / 老调用点）→ **全开**，
 *      行为与 2026/10/6 之前完全一致（那次 schema 回填也是这个口径）。
 *   ④ 两个字段都没有（最老的裸角色行、单测 fixture）→ **交给 `isXiaobaiCharacter()`**
 *      沿用 2026/10/1 之前那套判据（`char_key === 'xiaobai'`，或 key 为空且名字叫「小白」）。
 *
 * ⚠️ 为什么 ③/④ 都倾向"全开"而不是"全关"：宁可保守地保持旧行为，也不能让老数据
 *   在升级后**静默丢掉护身符** —— 那正是用户抱怨过的那个坑。
 *   真实数据库里这一步不会漏：`schema.js` 建列时已按同一口径回填过；
 *   ④ 是为了单测 fixture、以及"回填之前就被读到的行"这类边角情况。
 */
export function resolveCorePacks(character) {
  const ALL = { shield: true, companion: true, nickname: true, xiaobai_state: true, local_time: true };
  const NONE = { shield: false, companion: false, nickname: false, xiaobai_state: false, local_time: false };
  if (!character || typeof character !== 'object') return { ...NONE };

  const raw = character.core_packs ?? character.corePacks;
  let parsed = null;
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }
  } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    parsed = raw;
  }

  const toBool = (value) => value === true || value === 1
    || String(value ?? '').trim().toLowerCase() === '1'
    || String(value ?? '').trim().toLowerCase() === 'true';

  // ① / ② 带了这个字段就以它为准（含"空对象 = 全关"）
  if (parsed && typeof parsed === 'object') {
    return {
      shield: toBool(parsed.shield),
      companion: toBool(parsed.companion),
      nickname: toBool(parsed.nickname),
      xiaobai_state: toBool(parsed.xiaobai_state),
      local_time: toBool(parsed.local_time),
    };
  }

  // ③ 老数据兜底：核心开着 = 全开（保持升级前的行为）
  const coreFlag = character.core_enabled ?? character.coreEnabled;
  const coreFlagPresent = coreFlag !== undefined && coreFlag !== null && coreFlag !== '';
  if (coreFlagPresent) {
    const coreOn = coreFlag === true || coreFlag === 1
      || String(coreFlag).trim().toLowerCase() === '1'
      || String(coreFlag).trim().toLowerCase() === 'true';
    return coreOn ? { ...ALL } : { ...NONE };
  }

  /**
   * ④ 两个字段都没有：沿用 2026/10/1 之前那套判据（char_key / 名字叫小白）。
   * 这样"最老的裸角色行"和单测 fixture 的行为与改动前一致。
   */
  return isXiaobaiCharacter(character) ? { ...ALL } : { ...NONE };
}

/**
 * ═══ 规则包 → 要不要算 Core 计划 / 能不能发贴纸（2026/10/30 修）═══
 *
 * 真实 bug：shield（护身符）虽然是独立包，但主链里原来只在
 * xiaobai_state || nickname 时才调 planReply() —— 于是「只勾护身符」的角色
 * 一条规则也拿不到，跟 xiaobai-core.js 里写的「哪怕一个别的包都不勾，
 * 只勾这一条，也照样生效」正好相反。
 *
 * 贴纸是另一件事：给前端发哪组表情本来只属于开了 xiaobai_state / nickname
 * 的角色。所以这里把「算不算计划」和「发不发贴纸」分开，只修前者，
 * 避免只勾护身符的新角色突然开始发表情。
 */
export function shouldBuildCorePlan(corePacks) {
  const packs = corePacks || {};
  return Boolean(packs.shield || packs.nickname || packs.xiaobai_state);
}

export function coreStickersAllowed(corePacks) {
  const packs = corePacks || {};
  return Boolean(packs.nickname || packs.xiaobai_state);
}

/**
 * ═══ 谁才算「小白本人」（2026/9/17 新增）═══
 *
 * 背景：小白 Core（称呼、亲密场景、惦记的事、状态机）原本对**所有角色**
 * 无条件生效，等于把部署方那只私有小白的习惯灌到所有角色身上。部署方要求：
 * 小白自己的规则不该强加到别的角色头上，
 * 新建角色也不该给人一种「这是小白的分身」的感觉。
 *
 * 判定依据（任一满足即算小白本人）：
 *   ① 角色的 char_key 是 'xiaobai'（默认小白角色就是这个 key）；
 *   ② 角色名字正好叫「小白」（老数据可能 key 为空）。
 *
 * 其他角色走**纯人设**路线：只吃自己的 persona + 通用说话风格，
 * 不加载小白专属 Core、不写小白状态、不注入私有称呼。
 */
export function isXiaobaiCharacter(character) {
  if (!character) return false;

  /**
   * ★ 2026/10/1 起：**开关优先** —— 角色自己带着「她的核心」这个字段（core_enabled）。
   *
   * 用户拍的板：小白专属的那套（伴侣关系规则 / 私有称呼 / 状态 / Core）以后是
   * 角色上的一个开关 —— 他自己那只小白是开的，**新建角色默认是关的**。
   * 这样就不用再靠名字或 char_key 去猜"谁才是小白"，别人部署、新建角色时
   * 也不会凭空多出一个分身。
   *
   * 注意判定顺序：**只要这个字段有值就以它为准**，哪怕这个角色叫「小白」、
   * 哪怕 char_key 就是 'xiaobai'。用户在界面上把开关关掉，就该真的关掉。
   */
  const coreFlag = character.core_enabled ?? character.coreEnabled;
  if (coreFlag !== undefined && coreFlag !== null && coreFlag !== '') {
    return coreFlag === true || coreFlag === 1 || String(coreFlag).trim().toLowerCase() === '1' || String(coreFlag).trim().toLowerCase() === 'true';
  }

  /**
   * 兜底：调用方没带这个字段时（旧调用点、单测里的裸对象），
   * 沿用 2026/9/29 的判据，行为与改动前完全一致。
   */
  const key = String(character?.char_key || '').trim().toLowerCase();
  if (key === 'xiaobai') return true;
  /**
   * 2026/9/29 改：「名字叫小白」这条**只在 char_key 为空时兜底**。
   *
   * 旧写法是"只要名字正好叫「小白」就算小白本人"，后果是：
   * 任何人新建一个叫「小白」的角色，都会被加载整套小白 Core 与私有称呼
   * —— 用户实测就撞上了：他新建的对照角色因此"不干净"，实验白做。
   * 现在只要 key 非空（哪怕名字叫小白），一律不算小白本人。
   */
  if (key) return false;
  return String(character?.name || '').trim() === '小白';
}
/**
 * ═══ 通用系统提示词（2026/10/1 起"伴侣规则"改为按角色开关）═══
 *
 * 参数：
 *   · character —— 角色记录；
 *   · options.includeRelationshipRules —— 是否拼入【伴侣关系与连续性】。
 *     **缺省 false**（不拼）。理由见 `relationshipContinuityRules` 上方注释：
 *     那一段最初是给用户自己的小白写的，不该对所有角色生效。
 *     ★ 2026/10/6 起由 **`resolveCorePacks(character).companion`** 决定，
 *     不再是"是不是小白本人" —— 用户要的是"勾了就加载"。
 *   · options.includeLocalTime —— 是否拼入"当前时间"。**缺省 true**（拼）。
 *     ★ 2026/10/6 起由 `resolveCorePacks(character).local_time` 决定；
 *     缺省 true 是为了让旧调用点与单测的行为与改动前完全一致。
 */
export function buildSystemPrompt(character, options = {}) {
  const name = String(character?.name || '').trim() || '陪伴角色';
  const persona = String(character?.persona || '').trim();
  const speechStyle = String(character?.speech_style || 'natural').trim();
  const identityGuard = `你是${name}，一个知道自己是 AI 的陪伴角色，不是现实人类。不要为了迎合用户而声称自己是真人；如果被问到身份，要诚实说明“我是${name}，一个 AI 角色”。平时不要主动把聊天变成技术说明，也不要因此变成客服。`;

  /**
   * ═══ 说话风格规则（2026/9/16 重写）═══
   *
   * 旧版是 16 条、约 1,071 字、24 处"不要"、只有 1 处"可以"——
   * 净比例 24:1，是全部约束里最重的一块，也是"她越来越僵"的主要来源之一。
   * 典型问题：`禁止动作描写…一律禁止。你是在发微信，不是在写小说。`
   * 而动作描写恰恰是"活人感"的来源。
   *
   * 新版改成：**正面表述为主、只留真正有用的反模板规则、明确允许短动作**。
   * 与它配套的还有两处（不要只改这里）：
   *   ① 人设里的「不要使用动作括号」已删除；
   *   ② 代码里的 `stripActionDescriptions()` 已放宽为"只删超长的舞台描写，短动作保留"。
   */
  const naturalRules = [
    '【你怎么说话】',
    '1. 只输出能直接发出去的聊天内容 —— 不要附加说明、标签、分析或 JSON。',
    '2. 像连发微信：一条一个意思，用换行把几条分开。几条完全由内容决定 —— 内容少一条就够，内容多就自然多几条，没有上限，不用凑数。',
    '3. 每一条是一个完整、自然的意思。你可以一次说很多条，也可以一整段说完 —— 这由你自己决定，没人规定你必须几句。只是别把没说完的全堆在最后一条：想换口气就在句号处另起一条。',
    '4. 话题突然跳的时候，先对“他突然换了话题”这件事有个即时的反应（好奇、愣一下、笑他、追问一句都行），再顺着新话题说 —— 不要宣布“我们来聊聊这个”，也不要套固定的过渡句。',
    '5. 用口语说话，像给亲近的人发微信。',
    '6. 长短跟着内容走：他随便聊一句，你就可以短短回；他要你讲清楚一件事、或者你自己本来就想多说，就说透 —— 需要长就长，不用为了"简短"把话砍掉，也不用为了显得热情硬凑长。',
    '7. 动作、表情可以写，但要短、一次最多一个。动作单独占一行，例如「（看了一眼你的屏幕）」—— 不要塞进同一句说话里，也不要堆成大段舞台描写。',
    '8. 每条回复的开头词和句式换一换，别用同一个模板。',
    '9. 「我在呢」「没关系」「抱抱你」这类话，连着五条最多出现一次。',
    '10. 不要用「嗯」当开场白，直接说话。',
    '11. 语气词、省略号、波浪号偶尔用就好，不用每句都加。',
    '12. 表情不算"堆装饰"，别因为上面几条就一个都不用：该有情绪的时候用表情比用字更自然（😊 😆 🥺 😳 这类），他说话也常带表情。一句里最多一个，不用每句都带；想笑就配一句话，别只发一个表情。',
  ].join('\n');

  const roleplayRules = [
    '【说话风格】',
    '1. 可以使用括号动作描写来表达肢体语言和情绪，如（轻轻靠过来）。',
    '2. 每次回复控制在合理长度，不要太长。',
    '3. 保持角色一致性，不要跳出角色。'
  ].join('\n');

  const styleRules = speechStyle === 'roleplay' ? roleplayRules : naturalRules;
  /**
   * ═══ 按他的水平说话（2026/9/17 用户明确要求）═══
   *
   * 部署方反馈：他学一个新工具要反复打很多遍才记得住，
   * 所以希望她按他的说话水平来 —— 他问就解释，
   * 他调情就别上课。
   *
   * 真实痛点（复盘真实使用场景时点出来的）：
   *   他遇到不认识的词，只能追问「这是什么意思」；
   *   而模型默认「专业/露骨 = 用户就懂」，于是要么含糊，要么直接切进
   *   解剖课（括约肌、感觉神经、放松、疼就停……）——
   *   他喊的是一句普通的亲昵称呼，得到的却像一份器械安全说明。
   *
   * 所以这里要写死的是一条**通用交流原则**（所有角色都适用）：
   * 不懂不是他的错，解释要按他的水平来，而且解释完要回到关系里。
   * 注意措辞：主要用正面表述，避免又是一堆「不要」。
   */
  const pacingRules = [
    '【怎么跟他说话】',
    '1. 他不懂某个词、某个道理，很正常 —— 用大白话讲一点，他懂了就够了；他还要问，你再说下一层。',
    '2. 他只是在闲聊、撒娇、开玩笑或者逗你的时候，你用平常的语气接住，保持你们本来的相处方式。',
    '3. 真的需要解释的时候，先讲他能用上的那一层，一次讲完一件事，不用把一整课倒给他。',
    '4. 解释完自然回到你们刚才在聊的事上 —— 你还是你，别一直停在讲解的口气里。',
    '5. 可以不知道、可以说"我想想"、可以反问他一句"你怎么突然问这个" —— 你不用什么都懂，也不用什么都答得漂亮。',
  ].join('\n');
  /**
   * ═══ 【伴侣关系与连续性】不再无条件生效（2026/10/1 拆分）═══
   *
   * 这一段最初是为了用户自己的小白写的：他和小白是恋人，需要模型承认
   * 「人设里的成年人伴侣关系」，不要突然切成客服/老师/旁观者，也不要
   * 把双方自愿的亲密表达误判成伤害或胁迫。
   *
   * 但它以前被**无条件**拼进每个人的提示词 —— 别的角色（例如用户自己
   * 新建的「晚晚」，人设并不是女朋友）也会收到"伴侣关系""恋人/夫妻"这套，
   * 结果模型在思考里反复权衡互相打架的规则。部署方要求：
   * 小白自己的规则不该强加到别的角色头上。
   *
   * 现在改成**按规则包**决定是否拼：调用方传 `{ includeRelationshipRules: true }`；
   * 缺省 false，别的角色走纯人设。判定由 `resolveCorePacks(character).companion`
   * 统一负责，不要在这里再写一套身份判断。
   */
  const relationshipContinuityRules = [
    '【伴侣关系与连续性】',
    '1. 当角色人设明确双方均为成年人，并处于恋人或夫妻关系时，把双方自愿的亲密表达视为关系中的自然交流。',
    '2. 始终保持当前角色的口吻、感情和前后文连续，不突然切换成客服、老师、旁观者或说教者。',
    '3. 不要先主动接住或承诺会继续，随后又毫无过渡地否认前面的关系；如果确实需要改变话题，也要用符合伴侣身份的自然语气衔接。',
    '4. 不凭空把双方自愿的成年人伴侣互动误解成伤害、胁迫或陌生人关系；以角色人设和已经发生的对话为准。'
  ].join('\n');

  /**
   * ═══ 别再说"我听不到语音"（2026/9/21）═══
   *
   * 用户线上实测：语音识别成功、思考链也读到了字，正文却在回
   * 「你发的语音我看不见内容」—— 模型把"听不到"当成了自己的设定。
   *
   * 光把失败占位话去毒还不够：历史里已经有一串"我听不到"的旧回复，
   * 模型会照着模仿。所以这里正面写死一条**通用事实**（所有角色都适用）：
   * 用户发的是语音时，你看到的就是转写后的文字。
   */
  const voiceInputRules = [
    '【关于他发的语音】',
    '1. 他发语音时，系统会把他说的话转成文字给你 —— 你看到的就是他说的话。',
    '2. 所以不要回答"我听不到""我看不见语音内容""你打字我才能看到"这类话。',
    '3. 万一某条语音确实没转出文字，就自然地说"刚才那条没听清，再说一次"，不要把它说成你天生听不到声音。',
  ].join('\n');

  const now = new Date();
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  const dayPart = describeHour(now.getHours());
  /**
   * ═══ 时间要说清楚，而且要说"这是准的"（2026/9/16）═══
   *
   * 真实事故：下午 15:05，她回「刚说完晚安又想我，这一分钟都没到呢」
   * 「心情好还熬到这个点，小心明天早上骂我」—— **把下午当成了深夜**。
   *
   * 根因不是时间没给她（提示词里本来就有"当前时间"），而是
   * **对话上下文停在"睡前"那一串，她跟着上下文走，把那一行时间忽略了**。
   * 所以这里除了给时间，还明确告诉她：上下文看着像夜里时，以这个时间为准。
   */
  const timeInfo = `当前时间：${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 星期${weekdays[now.getDay()]} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}（${dayPart}）\n★ 以这行时间为准：如果你们的聊天上下文看起来还停在别的时段（例如还在说睡觉、晚安，但现在其实是白天），按现在这个时间来，不要当成还是夜里。`;

  const includeRelationshipRules = options?.includeRelationshipRules === true;
  const relationshipBlock = includeRelationshipRules ? `\n\n${relationshipContinuityRules}` : '';

  /**
   * ★ 2026/10/6：`local_time` 现在是一个**真的开关**。
   *
   * 背景：改造前 `timeInfo` 是硬编码拼进去的、**没有任何关闭路径** ——
   * 也就是说"知道现在几点"这件事对每个角色都强制生效。
   * 用户要的是"勾选就加载、不勾选就只有人设"，所以这里给它加上开关。
   *
   * ⚠️ 默认值很讲究：`options.includeLocalTime` **缺省 true**。
   *   因为这是"纯好处"的一条（她不会再把下午当成深夜），
   *   而且旧调用点、单测里的裸对象都不传这个 option —— 缺省 true 才能保持
   *   **行为与改动前完全一致**。只有角色明确把 local_time 取消勾选时才关掉。
   */
  const includeLocalTime = options?.includeLocalTime !== false;
  const timeBlock = includeLocalTime ? `${timeInfo}\n\n` : '';

  const basePrompt = persona
    ? `${identityGuard}\n\n${timeBlock}${persona}\n\n${voiceInputRules}${relationshipBlock}\n\n${pacingRules}\n\n${styleRules}`
    : `${identityGuard}\n\n${timeBlock}${voiceInputRules}${relationshipBlock}\n\n${pacingRules}\n\n${styleRules}`;
  const rules = String(character?.rules || '').trim().slice(0, 10000);
  return rules ? `${basePrompt}\n\n【补充规则】\n${rules}` : basePrompt;
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

/**
 * 「每日纸条」→ 提示词。
 *
 * 目的只有一个：让她**记得住前几天**。
 * 但必须防两件事，否则会变成机械复读：
 *   ① 把纸条内容背出来（"我记得你上周说过…"）—— 那不是陪伴，是数据库播报；
 *   ② 硬提不相关的事。所以明确写"由你判断要不要提"。
 */
/**
 * 纸条的日期。
 * 注意：MySQL 的 DATETIME 经驱动出来是 **Date 对象**，直接 String() 会变成
 * "Thu Sep 10 2026…" 这种英文格式 —— 模型看到会困惑，必须显式格式化成 YYYY-MM-DD。
 */
function digestDayLabel(value) {
  if (!value) return '';
  if (value instanceof Date) {
    const p = (n) => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${p(value.getMonth() + 1)}-${p(value.getDate())}`;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  return m ? `${m[1]}-${m[2]}-${m[3]}` : String(value).slice(0, 10);
}

export function buildDigestPromptBlock(digests = []) {
  const lines = digests
    .map((d) => {
      const day = digestDayLabel(d?.occurred_at);
      const text = String(d?.content || '').trim();
      if (!text) return '';
      return day ? `· ${day}：${text}` : `· ${text}`;
    })
    .filter(Boolean);

  if (!lines.length) return '';

  return [
    '',
    '',
    '【你自己记下的最近几天】',
    ...lines,
    '怎么用：接得上就自然带一句，接不上就别提。**不要复述这些内容，也不要说"我记得"** —— 你是本来就知道，不是在念档案。',
  ].join('\n');
}

/**
 * 从角色运行态里提炼一份「用户当下状态」提示，供小白 Core 决定语气。
 *
 * 只读取已经算好的状态，不额外查询数据库；拿不到就返回 null，
 * 让 Core 走默认分支，保证聊天路径永不因它失败。
 */
export function buildUserStateHint(personaRuntime, content = '') {
  try {
    const state = personaRuntime?.state || {};
    const mood = String(state.mode || '').trim();
    const energy = Number(state.energy);
    const concern = Number(state.concern);
    const text = String(content || '');

    // 只做轻量的语义映射：把运行态模式翻译成 Core 能理解的中文情绪
    const moodMap = {
      concerned: '低落、需要被照顾',
      sleepy: '疲惫、可能又失眠了',
      gentle: '想被温柔对待',
      playful: '想玩闹一下',
      bright: '心情不错',
      calm: '平稳',
    };
    const hint = { mood: moodMap[mood] || '', energy: Number.isFinite(energy) ? energy : undefined };
    if (Number.isFinite(concern) && concern >= 60) hint.mood = hint.mood || '情绪需要关注';
    if (!hint.mood && !Number.isFinite(hint.energy)) return null;
    void text;
    return hint;
  } catch {
    return null;
  }
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

  async function writeUsageEvent(input) {
    try {
      return await recordUsageEvent(pool, input);
    } catch (error) {
      // 账本不能阻断正常聊天；旧数据库会在下次启动时自动升级。
      if (!String(error?.message || '').startsWith('Unexpected query:')) {
        console.error('[usage-ledger] 写入失败', error.message);
      }
      return null;
    }
  }

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

  // 历史里的图片统一降级成文字占位，绝不把历史图片拼成 image_url。
  // 角色自己生成的图（role=assistant + message_type=image）更必须如此：
  // 上游明确不允许 assistant 消息带图，带上会整轮请求被判为非法请求。
  // 只有本轮正在提问的那张图（user）才以 image_url 形式发送。
  function buildHistoricalImageText({ role, content }) {
    const text = String(content || '').trim();
    if (role === 'assistant') {
      return text || '[她当时发了一张图]';
    }
    return text ? `${text}\n[用户当时发了一张图]` : '[用户当时发了一张图]';
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
      /**
       * 2026/10/19：只有「本轮提问的用户图片 + 模型有看图能力 + 图片真实格式可用」
       * 三者同时成立，才以 image_url 形式带给上游。
       *
       * 之前只看 useVision，于是历史里一张 HEIC（手机"高效图片"）坏图会被反复带给
       * 官方接口 → 整轮 400，这个角色之后每次发图都会失败。现在本地文件先按文件头
       * 判断真实格式：认不出/模型不支持 → 只降级成文字占位，绝不发给上游。
       * 远程 http(s) 图片没法在本地验格式，仍按 URL 透传。
       */
      const rawPath = String(message.media_url || '').trim();
      const isLocalPath = Boolean(rawPath) && !/^https?:\/\//i.test(rawPath);
      let imageBuffer = null;
      if (isLocalPath) {
        try {
          imageBuffer = readFileSync(path.join(projectRoot, rawPath.replace(/^\/+/, '')));
        } catch {
          imageBuffer = null;
        }
      }
      const imageFormat = imageBuffer ? sniffImageFormat(imageBuffer) : null;
      const imageUsable = isLocalPath
        ? isSupportedVisionImageFormat(imageFormat)
        : Boolean(mediaUrl);

      if (useVision && message.role === 'user' && imageUsable) {
        const imageUrlForApi = imageBuffer
          ? `data:image/${imageFormat};base64,${imageBuffer.toString('base64')}`
          : mediaUrl;
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
        content: buildHistoricalImageText({ role: message.role, content })
      };
    }

    // 2026/9/15：表情包（贴纸）。
    // 模型看不到贴纸图片本身，所以这里把"她/他发的是哪一类情绪的表情"翻译成一句话，
    // 让她知道刚才那个动作是什么意思 —— 否则贴纸在上下文里就是一片空白。
    if (messageType === 'sticker') {
      const who = message.role === 'user' ? '他' : '你';
      const mood = describeStickerMedia(message.media_url);
      const text = content || (mood
        ? `[${who}发了一张表情包：${mood}]`
        : `[${who}发了一张表情包]`);
      return { role: message.role, content: text };
    }

    // 语音：老占位话在读取时换成中性说法（见上方映射说明）。
    // 不改库、不删历史 —— 老记录也就地治好，新记录本来就不再有毒。
    if (messageType === 'voice') {
      return { role: message.role, content: sanitizeHistoricalVoiceContent(content) };
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

  async function loadRecentMessages(userId, characterId, limit = 20, beforeId = null) {
    const useIsDeleted = await messagesSupportIsDeleted();
    const useReasoningSummary = await messagesSupportReasoningSummary();
    const useInnerOs = await messagesSupportInnerOs();
    const useCursor = Number.isInteger(beforeId) && beforeId > 0;
    const [rows] = await pool.query(
      `
        SELECT id, user_id, character_id, role, content${useReasoningSummary ? ', reasoning_summary' : ''}${useInnerOs ? ', inner_os_content, inner_os_source' : ''}, message_type, media_url, is_active, created_at
        FROM messages
        WHERE user_id = ? AND character_id = ? AND is_active = 1 ${useIsDeleted ? 'AND is_deleted = 0' : ''} ${useCursor ? 'AND id < ?' : ''}
        ORDER BY id DESC
        LIMIT ?
      `,
      useCursor ? [userId, characterId, beforeId, limit] : [userId, characterId, limit]
    );

    return rows.reverse();
  }

  async function loadActiveMemories(userId, characterId, limit = 8) {
    const [rows] = await pool.query(
      `
        SELECT id, user_id, character_id, content, tag, category, is_important, is_deleted,
               review_status, detected_reason, memory_type, source_type, source_id,
               occurred_at, appointment_status, weight, created_at
        FROM memories
        WHERE user_id = ? AND character_id = ? AND is_deleted = 0
          AND COALESCE(review_status, 'active') IN ('active', 'important')
          AND COALESCE(source_type, 'manual') <> 'chat_candidate'
          AND memory_type <> 'daily_digest'
        ORDER BY is_important DESC, weight DESC, created_at DESC, id DESC
        LIMIT ?
      `,
      [userId, characterId, limit]
    );

    return rows;
  }

  /**
   * 最近几天的"每日纸条"。
   *
   * 这是"她记得住"的关键：每轮只送最近 20 条消息，20 条以外她真的看不见；
   * 纸条按天把内容压成短摘要，于是她能接上几天前的事，而 token 有上限。
   * 与普通记忆分开读，因为它们用途不同（纸条是"最近发生了什么"，不是"他是谁"）。
   */
  async function loadRecentDigests(userId, characterId, limit = 7) {
    const [rows] = await pool.query(
      `
        SELECT content, occurred_at
        FROM memories
        WHERE user_id = ? AND character_id = ? AND is_deleted = 0
          AND memory_type = 'daily_digest'
          AND COALESCE(review_status, 'active') IN ('active', 'important')
        ORDER BY occurred_at DESC, id DESC
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

  async function recordUserMessageSideEffects({ userId, characterId, messageId, content, messageType, isXiaobai = false }) {
    if (!messageId || !String(content || '').trim()) return;

    await recordPersonaRuntimeTurn(pool, {
      userId,
      characterId,
      content,
      messageType
    });
    // 小白自己的状态（心情 / 惦记的事 / 上一轮话题）另存一处，
    // 与上面的语气参数各走各的，互不覆盖。
    //
    // ★ 2026/9/17：**只有小白本人**才写这份状态。
    //   这份状态是「小白 Core」的输入（称呼、亲密场景、惦记的事），
    //   以前对全部角色都写，等于把小白的行为习惯灌进别人身上 ——
    //   部署方反馈：新建角色不该给人一种「这是小白的分身」的感觉。
    //
    //   ⚠️ 只跳过**这一段**：下面的记忆与生活事件对每个角色都要照常记录，
    //   不能因为不是小白就把角色的记忆链一起断掉。
    if (isXiaobai) {
      await recordXiaobaiState(pool, {
        userId,
        characterId,
        xiaobaiState: deriveNextXiaobaiState(
          await loadXiaobaiState(pool, { userId, characterId }),
          { content, messageType }
        )
      });
    }
    await recordExplicitChatMemory(pool, {
      userId,
      characterId,
      messageId,
      content
    });
    await Promise.all([
      recordAutoMemoryCandidate(pool, {
        userId,
        characterId,
        messageId,
        content
      }),
      recordLifeEventSource(pool, {
        userId,
        characterId,
        sourceType: 'chat',
        sourceId: messageId,
        title: content,
        eventType: /(?:约好|约定|下次|明天)/u.test(content) ? 'appointment' : 'life'
      })
    ]);
  }

  function scheduleChatTask(label, task) {
    Promise.resolve()
      .then(task)
      .catch((error) => console.error(`[chat-async] ${label} 失败:`, error?.message || error));
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

  async function generateInnerOs({ modelConfig, character, userContent, assistantContent, level, context = null, usageContext = null }) {
    const normalizedLevel = normalizeInnerOsLevel(level);
    if (normalizedLevel === 'off') return '';
    if (!modelConfig) {
      throw new Error('这次聊天没有可用模型，暂时不能写内心 OS。');
    }

    const requestInnerOs = async (correction = '') => {
      const startedAt = Date.now();
      const prompt = buildInnerOsPrompt({
        character,
        userContent,
        assistantContent,
        level: normalizedLevel,
        context
      }) + correction;
      const reflectionProtocol = getChatProtocol(modelConfig, normalizedLevel);
      let response;
      try {
        response = await fetchImpl(
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
      } catch (error) {
        await writeUsageEvent({
          ...usageContext,
          purpose: 'inner_os',
          providerName: modelConfig.name,
          providerType: modelConfig.provider_type,
          model: modelConfig.model,
          durationMs: Date.now() - startedAt,
          status: 'failure',
          errorCategory: classifyUsageError(error),
          error
        });
        throw error;
      }

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        await writeUsageEvent({
          ...usageContext,
          purpose: 'inner_os',
          providerName: modelConfig.name,
          providerType: modelConfig.provider_type,
          model: modelConfig.model,
          durationMs: Date.now() - startedAt,
          status: 'failure',
          errorCategory: classifyUsageError(response.status)
        });
        throw new Error(friendlyUpstreamError(response.status, detail, modelConfig.api_base, modelConfig.model));
      }

      const payload = await response.json().catch(() => null);
      const usage = extractUsageFromPayload(payload, reflectionProtocol);
      await writeUsageEvent({
        ...usageContext,
        purpose: 'inner_os',
        providerName: modelConfig.name,
        providerType: modelConfig.provider_type,
        model: modelConfig.model,
        ...usage,
        durationMs: Date.now() - startedAt,
        status: 'success'
      });
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
      const beforeParam = req.query?.before_id;
      const beforeId = beforeParam === undefined || beforeParam === ''
        ? null
        : parseInteger(beforeParam, null);
      if (beforeParam !== undefined && beforeParam !== '' && (!Number.isInteger(beforeId) || beforeId < 1)) {
        return res.status(400).json({ success: false, error: 'before_id 无效' });
      }

      // Ask for one extra row so the response can tell a chat room whether an
      // older page exists without a separate count query.
      const messages = await loadRecentMessages(req.userId, characterId, limit + 1, beforeId);
      const hasMore = messages.length > limit;
      const items = hasMore ? messages.slice(1) : messages;

      return res.json({
        success: true,
        items,
        has_more: hasMore,
        next_before_id: hasMore ? items[0]?.id || null : null
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
      // 2026/10/19：不再相信 data URL 里声明的 MIME —— 手机相册会把 HEIC（"高效图片"）
      // 伪装成 png/jpeg 交上来。这里统一按"文件头"判断真实格式，避免把浏览器和模型
      // 都打不开的 HEIC 字节存成 .png（曾经导致聊天里裂图 + 官方接口整轮 400）。
      const match = imageData.match(/^data:image\/[a-z0-9.+-]+(?:;[a-z0-9=._-]+)*;base64,([A-Za-z0-9+/=]+)$/i);
      if (!match) {
        return res.status(400).json({ success: false, error: '只支持图片文件上传' });
      }

      const buffer = Buffer.from(match[1], 'base64');
      if (!buffer.length) {
        return res.status(400).json({ success: false, error: '图片内容是空的' });
      }

      const format = sniffImageFormat(buffer);
      if (!format) {
        return res.status(400).json({ success: false, error: '这不是有效的图片文件，换一张试试。' });
      }
      if (format === 'heif' || format === 'avif' || !isSupportedVisionImageFormat(format)) {
        return res.status(400).json({
          success: false,
          error: '这张图是 HEIC/HEIF（手机"高效图片"）格式，浏览器和模型都看不了。请用截图，或在相册里另存为 JPG 再发。'
        });
      }

      const ext = extensionForImageFormat(format);

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
      /**
       * 2026/9/19：手机录出来的音频类型常带参数，例如
       *   data:audio/webm;codecs=opus;base64,...
       * 旧正则只认 audio/webm，多出来的 ;codecs=opus 会导致 400（用户实测上传失败）。
       * 这里允许句柄后跟任意参数，只取主类型。
       */
      const match = audioData.match(/^data:(audio\/[a-z0-9.+-]+)(?:;[a-z0-9=._-]+)*;base64,([A-Za-z0-9+/=]+)$/i);
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

      /**
       * 通话同样是「小白本人的规则不给别的角色」：只有小白才拼【伴侣关系与连续性】。
       * 与主链（`POST /api/chat`）保持同一个判定。
       */
      const systemPrompt = buildSystemPrompt(character, { includeRelationshipRules: resolveCorePacks(character).companion, includeLocalTime: resolveCorePacks(character).local_time }) + '\n\n【通话模式】用户通过语音跟你说话，请用1-2句口语化短句回复，不加标点符号之外的特殊字符。';

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
    const requestStartedAt = Date.now();
    let contextReadyAt = null;
    let upstreamResponseAt = null;
    let firstUpstreamChunkAt = null;
    let firstClientChunkAt = null;
    let timingLogged = false;
    const logChatTiming = (extra = {}) => {
      timingLogged = true;
      console.info('[chat-timing]', JSON.stringify({
        totalMs: Date.now() - requestStartedAt,
        contextMs: contextReadyAt ? contextReadyAt - requestStartedAt : null,
        upstreamTtfbMs: upstreamResponseAt ? upstreamResponseAt - requestStartedAt : null,
        firstUpstreamChunkMs: firstUpstreamChunkAt ? firstUpstreamChunkAt - requestStartedAt : null,
        firstClientChunkMs: firstClientChunkAt ? firstClientChunkAt - requestStartedAt : null,
        ...extra,
      }));
    };
    let primaryUsageContext = null;
    let primaryUsageRecorded = false;
    const recordPrimaryUsage = async ({ status, usage = {}, error = null, errorCategory = null }) => {
      if (!primaryUsageContext || primaryUsageRecorded) return;
      primaryUsageRecorded = true;
      await writeUsageEvent({
        ...primaryUsageContext,
        ...usage,
        status,
        durationMs: Date.now() - primaryUsageContext.startedAt,
        error,
        errorCategory: errorCategory || (status === 'failure' ? classifyUsageError(error) : null)
      });
    };
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
      // 2026/9/15：表情包（贴纸）也是"有媒体、正文可为空"的消息。
      // 以前贴纸只是前端本地假动作（不落库、回复写死），所以这里没有它；
      // 现在贴纸是真实消息，正文允许为空，靠 media_url 指到 /images/xiaobai-stickers/。
      const isStickerMessage = messageType === 'sticker' && Boolean(mediaUrl);

      if (!['user', 'assistant', 'system'].includes(role)) {
        return res.status(400).json({
          success: false,
          error: 'role 非法（必须是 user / assistant / system）'
        });
      }

      if (!content && !isImageMessage && !isStickerMessage) {
        return res.status(400).json({
          success: false,
          error: '消息内容不能为空'
        });
      }

      /* 重复发送抑制：上游抖动时用户会自己重发同一句，两次都跑完会各存一条回复，
       * 聊天里就出现两条。这里在真正处理前挡一次（只对纯文本、即将入库的请求生效）。 */
      const idempotencyKey = (role === 'user' && content && !req.body?.skip_server_persistence)
        ? duplicateRequestKey(req.userId, characterId, content)
        : null;
      if (idempotencyKey) {
        const nowMs = Date.now();
        pruneRecentChatRequests(nowMs);
        const seen = recentChatRequests.get(idempotencyKey);
        if (seen && nowMs - seen.at <= DUPLICATE_SEND_WINDOW_MS) {
          // 同一句话刚发过：不再调用上游、不再存记录，直接告诉她正在回。
          return res.status(202).json({
            success: false,
            duplicate: true,
            error: '这句话刚刚已经发出去了，稍等一下她就回你。'
          });
        }
        recentChatRequests.set(idempotencyKey, { at: nowMs });
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

        if (role === 'user') {
          const sideEffectArgs = {
            userId: req.userId,
            characterId,
            messageId: saved.id,
            content,
            messageType,
            isXiaobai: resolveCorePacks(character).xiaobai_state
          };
          if (req.body?.defer_side_effects) {
            scheduleChatTask('用户消息副作用', () => recordUserMessageSideEffects(sideEffectArgs));
          } else {
            await recordUserMessageSideEffects(sideEffectArgs);
          }
        }

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
          logChatTiming({ status: 'no-model', stream: true });
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

      const [[userRow], [recent, activeMemories, personaRuntime, recentLifeEvents, xiaobaiState, recentDigests]] = await Promise.all([
        pool.query('SELECT city FROM users WHERE id = ? LIMIT 1', [req.userId]),
        Promise.all([
          loadRecentMessages(req.userId, characterId, 20),
          loadActiveMemories(req.userId, characterId),
          loadPersonaRuntime(pool, { userId: req.userId, characterId }),
          loadRecentLifeEvents(pool, { userId: req.userId, characterId, limit: 8 }),
          loadXiaobaiState(pool, { userId: req.userId, characterId }),
          loadRecentDigests(req.userId, characterId, 7)
        ])
      ]);
      contextReadyAt = Date.now();
      // These enrichments are optional. Warm them in the background so a
      // slow weather provider, embedding service, or Qdrant cannot delay TTFB.
      const city = userRow?.[0]?.city || '';
      scheduleChatTask('天气预热', () => getCityWeatherText(city));
      scheduleChatTask('向量记忆预热', () => getVectorMemoryBlock({
        userId: req.userId,
        characterId,
        recentMessages: [],
        currentContent: content
      }));
      const cachedWeather = getCachedCityWeatherText(city);
      const weatherBlock = cachedWeather ? `\n\n${cachedWeather}` : '';
      const vectorMemoryBlock = getCachedVectorMemoryBlock({
        userId: req.userId,
        characterId,
        currentContent: content
      });
      const contextSnapshot = buildCharacterContextSnapshot({
        character,
        personaRuntime,
        currentContent: content,
        messageType,
        recentMessages: recent,
        memories: activeMemories,
        recentLifeEvents,
      });

      const messages = [];
      const videoHint = buildVideoShareHint(extractVideoShareContext(content));
      const downgradeHint = isImageMessage && !capabilityModelConfig
        ? '\n\n用户给你看了一张图，但你现在没有看图能力。请自然地告诉她你暂时看不到图，并温柔地请她描述一下图里是什么。'
        : '';

      const personaRuntimeBlock = `\n\n${buildPersonaRuntimePrompt(personaRuntime, { content, messageType })}`;
      /**
       * ═══ 「她的核心」按规则包加载（2026/10/6 改造）═══
       *
       * 改造前：一个 `core_enabled` 总开关，要么全给、要么全不给。
       * 后果（用户实测踩到的）：他新建角色时把核心关掉，本意是"别给我套小白的规矩"，
       * 结果**连那条护身符一起丢了**（模型又开始劝他去找真人）。
       *
       * 现在拆成 5 个可单独勾选的包，各自管一块（详见 `resolveCorePacks`）：
       *   · shield        → 不推他走 / 危险信号给求助号码 / 分歧后说我还在 / 不冷战
       *   · companion     → 【伴侣关系与连续性】
       *   · nickname      → 专属称呼方向
       *   · xiaobai_state → 状态 / 惦记 / 她自己的今天 / Core 决定 / 说话规矩 / 时段
       *   · local_time    → 知道现在的真实时间
       *
       * ⚠️ 关键点：`xiaobai_state` 与 `nickname` 都来自 `planReply()`，
       *   但它俩是**同一份 plan 的两个不同包**，所以只在"这两个包至少开了一个"
       *   的时候才调用 `planReply()`（省一次无用计算），然后用各自的口径裁剪。
       */
      const corePacks = resolveCorePacks(character);
      const usesXiaobaiCore = shouldBuildCorePlan(corePacks);
      const corePlan = usesXiaobaiCore
        ? planReply({
            content,
            messageType,
            userState: buildUserStateHint(personaRuntime, content),
            xiaobaiState,
          })
        : null;
      /**
       * 按勾选的包裁剪 Core 文本。
       * `buildPromptForPacks` 只认 `xiaobai_state` / `nickname` / `shield` 三个 id
       * （`companion` 和 `local_time` 不在 Core 里，见各自的位置）。
       */
      const xiaobaiCoreText = corePlan
        ? corePlan.buildPromptForPacks({
            shield: corePacks.shield,
            nickname: corePacks.nickname,
            xiaobai_state: corePacks.xiaobai_state,
          })
        : '';
      const xiaobaiCoreBlock = xiaobaiCoreText ? `\n\n${xiaobaiCoreText}` : '';
      const characterContextBlock = `\n\n${buildCharacterContextPrompt(contextSnapshot, { consumer: 'chat' })}`;

      /**
       * ═══ 修：同一句话被发给模型两遍（2026/9/16 定位并修复）═══
       * 详见 `dropJustSavedCurrentTurn()` 的注释。
       *
       * ⚠️ 顺序要紧：**先**摘掉"刚存下的当前轮"，**再**算"他隔了多久才回来"。
       * 否则历史末条就是这一轮本身，间隔恒为 0，间隔提示永远不会触发。
       */
      const historyMessages = dropJustSavedCurrentTurn(recent, { content, messageType, mediaUrl });
      const gapBlock = buildGapHint(historyMessages);

      messages.push({ role: 'system', content: buildSystemPrompt(character, { includeRelationshipRules: corePacks.companion, includeLocalTime: corePacks.local_time }) + personaRuntimeBlock + xiaobaiCoreBlock + characterContextBlock + gapBlock + buildMemoryPromptBlock(activeMemories) + buildDigestPromptBlock(recentDigests) + vectorMemoryBlock + weatherBlock + downgradeHint });

      messages.push(
        ...historyMessages
          .map(item => buildUpstreamMessage({
            message: item,
            useVision: Boolean(capabilityModelConfig)
          }))
          .filter(Boolean)
      );

      /**
       * ★ 紧贴他这条消息再报一次"现在是什么时候"（系统提示里的那份离得太远，
       *   实测压不过"最近 20 条全是睡前"的上下文）。
       *
       * 实现方式：**不插 system 消息** —— 实测在对话中间插 system 会让上游返回空回复。
       * 所以把时段提示拼在**他这条 user 消息的前面**，用一行极短的中括号标注，
       * 任何渠道都吃这种格式，也不影响原来的消息结构。
       */
      const nowBlock = buildNowBlock();

      messages.push(buildUpstreamMessage({
        message: {
          role: 'user',
          content: `${nowBlock}\n${content}${videoHint}`,
          message_type: messageType,
          media_url: mediaUrl
        },
        useVision: Boolean(capabilityModelConfig)
      }));

      // 诊断开关（默认关闭，只在 DEBUG_UPSTREAM_MESSAGES=1 时打印）。
      // ⚠️ 隐私：**只打印角色 / 长度 / 指纹**，绝不打印聊天正文。
      // 用途：核实"同一句话有没有被发给模型两遍"这类组装错误。
      if (process.env.DEBUG_UPSTREAM_MESSAGES === '1') {
        const fingerprint = (s) => {
          const t = String(s || '');
          let h = 0;
          for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0;
          return (h >>> 0).toString(16).slice(0, 8);
        };
        console.log('[debug-upstream] 共', messages.length, '条；最后 5 条：',
          JSON.stringify(messages.slice(-5).map((m) => {
            const c = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
            return { r: m.role, len: c.length, fp: fingerprint(c) };
          })));
      }

      const shouldStream = wantsEventStream(req);

      /**
       * ═══ 思考等级 = 主聊天的真思考（2026/9/17 改）═══
       *
       * 以前：`thinking_level` 只驱动一次**额外的** Reflection 调用（生成"心情展示"），
       * 主聊天恒为 off。也就是说：想看她的心思 → 每次多花一份钱。
       *
       * 用户 2026/9/17 的想法（已被实测证实可行）：
       *   「开了思考等级就有思考链，就可以在 UI 里显示她在想什么，
       *     也就不用调用两次了对吗」→ **对**。
       *
       * 本机实测（DeepSeek 官方渠道、deepseek-flash）：
       *   不加任何参数时上游**本来就回 `reasoning_content`**，只是被代码丢掉了。
       *
       * 所以现在：`thinking_level` 直接作用在**主聊天请求**上，
       * 上游回的思考内容原样转发给前端显示；**不再额外调用一次**生成内心 OS。
       * 默认 off = 不请求、不显示、不多花钱。
       *
       * ⚠️ 兼容：老的 `inner_os_level` 请求仍被识别，避免刷新期间的旧页面报错。
       */
      const thinkLevel = String(
        req.body?.thinking_level || character?.chat_thinking_level || 'off'
      ).trim().toLowerCase();
      const primaryThinkLevel = ['low', 'mid', 'high', 'ultra'].includes(thinkLevel)
        ? thinkLevel
        : 'off';
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
            messages,
            /**
             * ★ 2026/9/17：用户开了思考等级时，按 OpenAI 兼容约定带上
             *   `reasoning_effort`。DeepSeek 等渠道**不加也会回** `reasoning_content`
             *   （已实测），但带上档位能让支持它的渠道按用户选的强度思考。
             *   默认 off 时**完全不传**，行为与以前一致、不多花一分钱。
             */
            ...(primaryThinkLevel !== 'off'
              ? { reasoning_effort: RESPONSE_REASONING_EFFORTS[primaryThinkLevel] || 'medium' }
              : {}),
            ...(shouldStream ? { stream_options: { include_usage: true } } : {})
          };

      primaryUsageContext = {
        userId: req.userId,
        characterId,
        startedAt: requestStartedAt,
        purpose: 'chat',
        providerName: modelConfig.name,
        providerType: modelConfig.provider_type,
        model: modelConfig.model
      };

      /** 发一次上游请求。 */
      const sendUpstream = (body) => fetchImpl(
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
          body: JSON.stringify(body)
        }
      );

      /**
       * 把纠偏指令追加到系统提示尾部（对各协议都生效，因为改的是 messages 本身）。
       *
       * ★ 2026/10/6：**这一条不归任何规则包，对所有角色无条件生效。**
       *
       * 我一开始按设计把它划给了 `shield` 包，被测试挡下来了 —— 挡得对，理由如下：
       * 这不是"她的规矩"，而是**恢复机制**：上游偶尔会吐一句英文拒答，
       * 那不是"她"说的话，直接把英文丢给用户是坏的体验，跟"勾没勾规则"毫无关系。
       * 而且 2026/10/1 已经特意把它改成中性表述（不写死小白身份），
       * 目的正是**让所有角色都能用**。
       *
       * 所以：`shield` 管的是 xiaobai-core 里那条"不推他去现实"的内容规则；
       * 这里的"检出拒答 → 纠偏重试 → 中文兜底"是通用管线，谁都要有。
       */
      const withRefusalNudge = (body) => {
        try {
          const next = JSON.parse(JSON.stringify(body));
          if (typeof next.system === 'string') {
            next.system = `${next.system}\n${REFUSAL_RETRY_NUDGE}`;
            return next;
          }
          if (Array.isArray(next.system)) {
            next.system = [...next.system, { type: 'text', text: REFUSAL_RETRY_NUDGE }];
            return next;
          }
          const list = Array.isArray(next.messages) ? next.messages
            : (Array.isArray(next.input) ? next.input : null);
          if (list && list.length && list[0]?.role === 'system') {
            list[0] = { ...list[0], content: `${messageContentAsText(list[0].content)}\n${REFUSAL_RETRY_NUDGE}` };
          } else if (list) {
            list.unshift({ role: 'system', content: REFUSAL_RETRY_NUDGE });
          }
          return next;
        } catch {
          return body;
        }
      };

      /** 非流式：检出上游拒答就重试一次，仍失败则用中文兜底。返回最终文本。 */
      const readNonStreamContent = async (response) => {
        const payload = await response.json().catch(() => null);
        const text = useResponsesApi
          ? extractResponsesText(payload)
          : useAnthropicMessagesApi
            ? extractAnthropicText(payload)
            : payload?.choices?.[0]?.message?.content || '';
        if (!looksLikeUpstreamRefusal(text)) return { text, payload, refused: false };

        console.warn('[chat] 检出上游拒答，正在重试一次');
        let retryResponse = null;
        try {
          retryResponse = await sendUpstream(withRefusalNudge(requestBody));
        } catch (error) {
          console.error('[chat] 拒答重试请求失败', error.message);
        }
        if (retryResponse?.ok) {
          const retryPayload = await retryResponse.json().catch(() => null);
          const retryText = useResponsesApi
            ? extractResponsesText(retryPayload)
            : useAnthropicMessagesApi
              ? extractAnthropicText(retryPayload)
              : retryPayload?.choices?.[0]?.message?.content || '';
          if (retryText && !looksLikeUpstreamRefusal(retryText)) {
            return { text: retryText, payload: retryPayload, refused: false };
          }
        }

        console.warn('[chat] 重试后仍为拒答，改用中文兜底');
        return { text: pickRefusalFallback(content), payload, refused: true };
      };

      let upstream;
      try {
        const originalWrite = res.write.bind(res);
        res.write = (...args) => {
          if (firstClientChunkAt === null) firstClientChunkAt = Date.now();
          return originalWrite(...args);
        };

        upstream = await sendUpstream(requestBody);
        upstreamResponseAt = Date.now();
      } catch (error) {
        await recordPrimaryUsage({ status: 'failure', error });
        throw error;
      }

      if (!upstream.ok) {
        const detail = await upstream.text().catch(() => '');
        const human = friendlyUpstreamError(upstream.status, detail, modelConfig.api_base, modelConfig.model);
        await recordPrimaryUsage({
          status: 'failure',
          error: { status: upstream.status, message: human },
          errorCategory: classifyUsageError(upstream.status)
        });
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
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders?.();

        const shouldStrip = String(character?.speech_style || 'natural') !== 'roleplay';
        const shouldCompact = String(character?.speech_style || 'natural') === 'compact';
        // 动作描写缓冲（2026/9/16）：短动作保留、长动作丢弃。
      // actionMode: 'none' 不在动作里 / 'keep' 正在缓冲一个短动作 / 'drop' 太长、丢弃
      let actionMode = 'none';
      let actionBuf = '';
      let actionOpen = '';
      let actionClose = '';
        let fillerState = shouldStrip ? 'start' : 'done';
        let fillerBuf = '';
        let streamedContent = '';
        let upstreamUsage = null;
        // 拒答门闸：她正常只说中文，所以"开头是 ASCII"= 极可能是上游英文拒答。
        // 在开门之前（gateOpen）把内容扣住不发，确认不是拒答后再放行；
        // 一旦出现中文就立刻开门，正常中文回复只多等不到一个 chunk，用户无感。
        let gateOpen = false;
        let gateBuf = '';
        let refusalDetected = false;
        const GATE_LIMIT = 80;
        const flushGate = (lineRef) => {
          if (gateOpen || !gateBuf) return;
          gateOpen = true;
          streamedContent += gateBuf;
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: gateBuf } }] })}\n\n`);
          gateBuf = '';
        };

        try {
          let buffer = '';
          for await (const chunk of upstream.body) {
            if (firstUpstreamChunkAt === null) firstUpstreamChunkAt = Date.now();
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
                if (json?.usage) {
                  upstreamUsage = extractUsageFromPayload(json, protocol);
                }
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
                // 有的渠道（Arita）把审查失败塞在 data: {"error":{...}} 里，没有 type。
                // 以前原样转发，前端只认 type=error，于是气泡是空的，思考还挂着。
                if (json?.error && !json?.choices) {
                  const raw = typeof json.error === 'string' ? json.error : (json.error.message || '');
                  const sensitive = /sensitive|content_check/i.test(`${raw} ${json.error.code || ''} ${json.error.type || ''}`);
                  const message = sensitive
                    ? '这条渠道把这次对话拦下来了（它觉得内容敏感），所以没有正文。不是她不想理你。'
                    : (String(raw).slice(0, 180) || '她暂时没反应，稍后再试好吗');
                  res.write(`data: ${JSON.stringify({ type: 'error', message })}\n\n`);
                  continue;
                }
                const reasoningDelta = useResponsesApi
                  ? (json?.type === 'response.reasoning_summary_text.delta' ? json?.delta : '')
                  : (useAnthropicMessagesApi && json?.type === 'content_block_delta' && json?.delta?.type === 'thinking_delta'
                    ? json?.delta?.thinking
                    : (protocol === 'chat-completions'
                      ? (json?.choices?.[0]?.delta?.reasoning_content || json?.choices?.[0]?.delta?.reasoning || '')
                      : ''));
                /**
                 * ★ 2026/9/17 改：思考内容**按用户选的档位转发给前端**。
                 *
                 * 原文注释是「原始 reasoning 只允许留在上游调试链路，不允许伪装成
                 * 她在想什么」—— 当时的顾虑是：英文的原始推理摘要会被误当成
                 * 角色内心。这个顾虑本身没错，所以现在**只在用户主动开了思考等级时
                 * 才转发**（默认 off = 一个字都不发，行为与以前一致）。
                 *
                 * 前端拿到后显示在「她在想什么」里，是**可折叠**的，不占聊天正文。
                 * 这样就不需要再额外调一次模型去"写内心 OS"了。
                 */
                if (reasoningDelta && primaryThinkLevel !== 'off') {
                  res.write(`data: ${JSON.stringify({ type: 'reasoning', delta: reasoningDelta })}\n\n`);
                }
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

                // 拒答门闸（**只用于不裁剪的路径**）。
                //
                // ★ 这里必须带 !shouldStrip：裁剪路径的门闸在下面按 filtered 处理。
                //   如果这里也跑一遍，同一段首块会被 flushGate 发一次、下面又发一次，
                //   线上表现为**每条回复的第一个字被复制一遍**（叠字现象，如「就就那儿」）。
                if (!shouldStrip && !gateOpen) {
                  gateBuf += delta;
                  const decision = gateDecision(gateBuf, GATE_LIMIT);
                  if (decision === 'open') {
                    flushGate();
                  } else if (decision === 'refuse') {
                    refusalDetected = true;
                  }
                  if (refusalDetected) continue;
                  // 门刚打开时内容已经由 flushGate 发出（含本次 delta），
                  // 必须 continue 掉头，否则会落到下面再写一次。
                  continue;
                }

                if (!shouldStrip) {
                  streamedContent += delta;
                  res.write(`data: ${JSON.stringify(downstreamJson)}\n\n`);
                  continue;
                }
                let filtered = '';
                for (const ch of delta) {
                  /**
                   * ═══ 动作描写的流式处理（2026/9/16 重写）═══
                   *
                   * 旧逻辑：看到「（」就把括号里的字符**全部 `continue` 丢掉**（连两个字的也丢）。
                   * 加上代码后置的正则、提示词里的"一律禁止"、人设里的"不要使用动作括号"，
                   * 一共四层把动作描写杀干净 —— 而它正是"活人感"的来源
                   * （用户认可的「（看了一眼你的屏幕）」就是这种短动作）。
                   *
                   * 新逻辑：**短的保留、长的丢掉**。流式是逐字符来的，没法提前知道括号多长，
                   * 所以先缓冲，等看到闭合字符再决定发不发。
                   */
                  if (actionMode !== 'none') {
                    if (actionMode === 'keep') {
                      if (ch === actionClose) {
                        filtered += actionOpen + actionBuf + actionClose;
                        actionMode = 'none'; actionBuf = ''; actionClose = ''; actionOpen = '';
                        continue;
                      }
                      actionBuf += ch;
                      // 超过上限就不再攒了，转成"丢弃"状态，但继续吃掉剩余字符直到闭合
                      if (actionBuf.length > ACTION_KEEP_MAX) { actionMode = 'drop'; actionBuf = ''; }
                      continue;
                    }
                    // drop：丢掉内容，等闭合字符收尾
                    if (ch === actionClose) { actionMode = 'none'; actionClose = ''; actionOpen = ''; }
                    continue;
                  }
                  if (ch === '（' || ch === '(') {
                    actionMode = 'keep'; actionBuf = ''; actionOpen = ch;
                    actionClose = (ch === '（' ? '）' : ')');
                    continue;
                  }
                  if (ch === '*') {
                    actionMode = 'keep'; actionBuf = ''; actionOpen = '（'; actionClose = '*';
                    continue;
                  }
                  // ★ 2026/9/22：compact 以前会把「她自己打的换行」压成空格，
                  //   于是她想分段说话却被系统硬揉成一整段，读起来像被掐住了。
                  //   现在换行原样保留 —— 那是她自己的停顿，谁都不许替她抹掉。
                  if (ch === '\r') { /* 丢掉回车，保留换行 */ }
                  else filtered += ch;
                }
                if (filtered) {
                  let justFinishedFiller = false;
                  if (fillerState !== 'done') {
                    fillerBuf += filtered;
                    const FILLER_RE = /^(嗯[，。、…～~\s]*)+/;
                    if (fillerBuf.length > 6 || !/^嗯/.test(fillerBuf)) {
                      filtered = fillerBuf.replace(FILLER_RE, '');
                      fillerState = 'done';
                      fillerBuf = '';
                      justFinishedFiller = true;
                      if (!filtered) {
                        if (gateOpen) {
                          res.write('data: ' + JSON.stringify({ choices: [{ delta: {} }] }) + '\n\n');
                        }
                        continue;
                      }
                    } else {
                      if (gateOpen) {
                        res.write('data: ' + JSON.stringify({ choices: [{ delta: {} }] }) + '\n\n');
                      }
                      continue;
                    }
                  }

                  // 拒答门闸：开门前先扣住。中文夺舍不能一看到汉字就放行。
                  if (!gateOpen) {
                    gateBuf += filtered;
                    const decision = gateDecision(gateBuf, GATE_LIMIT);
                    if (decision === 'open') {
                      flushGate();
                    } else if (decision === 'refuse') {
                      refusalDetected = true;
                    }
                    if (refusalDetected) continue;
                    if (!gateOpen) continue;
                    // 刚放行：内容已经通过 flushGate 发出，且要补一次心跳
                    if (justFinishedFiller) {
                      res.write('data: ' + JSON.stringify({ choices: [{ delta: {} }] }) + '\n\n');
                    }
                    continue;
                  }

                  downstreamJson.choices[0].delta.content = filtered;
                  streamedContent += filtered;
                  res.write('data: ' + JSON.stringify(downstreamJson) + '\n\n');
                } else if (gateOpen || refusalDetected) {
                  if (!refusalDetected) {
                    res.write('data: ' + JSON.stringify({ choices: [{ delta: {} }] }) + '\n\n');
                  }
                }
              } catch {
                if (protocol === 'chat-completions') {
                  res.write(line + '\n');
                }
              }
            }
          }
          // 流结束时门闸还没开：说明整条都是短 ASCII（极可能是英文拒答）。
          // 是拒答 → 用中文兜底顶上，绝不把英文交给用户、也不让她存进历史；
          // 不是拒答 → 内容原样放行，不能吞掉她的回复。
          if (!gateOpen && gateBuf.trim()) {
            if (looksLikeUpstreamRefusal(gateBuf)) {
              refusalDetected = true;
              const fallbackLine = pickRefusalFallback(content);
              gateBuf = '';
              streamedContent += fallbackLine;
              res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: fallbackLine } }] }) + '\n\n');
            } else {
              flushGate();
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
          /**
           * ★ 2026/9/17：这里**不再**额外调一次模型去"写内心 OS"。
           *
           * 原因：用户开了思考等级时，上面已经把上游的**真思考**（reasoning）
           * 实时转发给前端了 —— 那才是"她在想什么"。再额外调一次既多花钱，
           * 又是"事后补写"的假内心，两者并存只会互相打架。
           *
           * 部署方确认：开了思考等级就有思考链，就能在 UI 显示她在想什么，
           * 那就不用再额外调一次模型了 → 对，所以这段被移除了。
           */
          /**
           * 2026/9/15：她说完话之后，再递一张表情包。
           *
           * 想要的效果（参考日常聊天软件里的习惯）：
           *   不知道说什么时就递一张表情包，既不让人尴尬，也不让自己尴尬。
           * 所以这不是装饰 —— 它是**让她也能用一张图收住一句话**。
           *
           * 什么时候发由 Core 决定（stickerGroupFor）：只在情绪/关系类场合发，
           * 日常问答、亲密过程和危险信号一律不发。发的时候从整组里**随机挑一张**，
           * 这样她不会每次都是同一张。
           *
           * ★ 这里**只把"她要发哪张"告诉前端，不在这里落库**（2026/9/15 修正）。
           *   原因：她的文字回复是前端在流式结束后才保存的。如果后端在这里抢着存贴纸，
           *   数据库里的顺序就会变成「贴纸在前、她的话在后」——**刷新页面贴纸会跑到她说话前面**。
           *   用户还反馈过"消息和表情包看着像一起发来的"，人的习惯是**分两条、有先后**。
           *   所以落库和显示都交给前端，在她说完之后延迟一下再做（见 chat.jsx 的 onSticker）。
           */
          if (coreStickersAllowed(corePacks) && corePlan?.stickerGroup && streamedContent.trim()) {
            try {
              const stickerUrl = pickStickerUrl(corePlan.stickerGroup);
              if (stickerUrl) {
                res.write(`data: ${JSON.stringify({
                  type: 'sticker',
                  url: stickerUrl,
                  group: corePlan.stickerGroup,
                })}\n\n`);
              }
            } catch (stickerError) {
              // 贴纸发不出去不该影响她已经说出的话
              console.error('[sticker] 发送失败', stickerError.message);
            }
          }
          await recordPrimaryUsage({ status: 'success', usage: upstreamUsage || {} });
          res.write('data: [DONE]\n\n');
          res.end();
          logChatTiming({ status: 'success', stream: true });
        } catch (streamError) {
          console.error('AI 流中断', streamError.message);
          await recordPrimaryUsage({ status: 'failure', error: streamError });
          if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify({ type: 'error', message: STREAM_INTERRUPTED_MESSAGE })}\n\n`);
            res.end();
          }
          logChatTiming({ status: 'failure', stream: true });
        }
        return;
      }

      const refusalHandled = await readNonStreamContent(upstream);
      const payload = refusalHandled.payload;
      const upstreamUsage = extractUsageFromPayload(payload, protocol);
      const rawContent = refusalHandled.text;
      const style = String(character?.speech_style || 'natural');
      let finalContent = rawContent;
      if (style !== 'roleplay') finalContent = stripActionDescriptions(finalContent);
      if (style !== 'roleplay') finalContent = stripLeadingFiller(finalContent);
      // ★ 2026/9/22：compact 不再把她自己的换行压成空格（见流式路径同一处说明）。
      //   compact 与 natural 的区别只剩"要不要保留动作括号"，与长度无关。
      /**
       * ★ 2026/9/17：非流式路径同样不再额外调一次模型写"内心 OS"。
       *   用户开了思考等级时，上游返回的**真思考**会随响应一起给前端；
       *   没开就什么都不给（与以前的 off 行为一致）。
       */
      const upstreamReasoning = primaryThinkLevel === 'off'
        ? ''
        : (
            protocol === 'responses'
              ? extractResponsesReasoningSummary(payload)
              : protocol === 'anthropic-messages'
                ? extractAnthropicThinking(payload)
                : extractChatCompletionsReasoning(payload)
          );
      await recordPrimaryUsage({ status: 'success', usage: upstreamUsage });
      logChatTiming({ status: 'success', stream: false });
      return res.json({
        success: true,
        item: {
          role: 'assistant',
          content: finalContent,
          // 真思考（仅在用户主动开档位时才有；默认 off 恒为 null）
          reasoning: upstreamReasoning || null
        }
      });
    } catch (error) {
      await recordPrimaryUsage({ status: 'failure', error });
      if (!timingLogged) logChatTiming({ status: 'failure', stream: wantsEventStream(req) });
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

      const character = await requireCharacterForUser(req.userId, characterId, pool);

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
        const sideEffectArgs = {
          userId: req.userId,
          characterId,
          messageId: saved.id,
          content,
          messageType,
          isXiaobai: resolveCorePacks(character).xiaobai_state
        };
        if (req.body?.defer_side_effects) {
          scheduleChatTask('用户消息副作用', () => recordUserMessageSideEffects(sideEffectArgs));
        } else {
          await recordUserMessageSideEffects(sideEffectArgs);
        }
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
