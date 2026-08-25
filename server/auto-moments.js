import { pool } from './db.js';
import { supportsDynamicSingleImage } from './capabilities.js';
import { generateImage } from './image-gen.js';
import { buildChatCompletionsUrl } from './chat.js';
import {
  buildCharacterContextSnapshot,
  loadRecentLifeEvents,
} from './character-context.js';
import { loadPersonaRuntime } from './persona-runtime.js';

const DEFAULT_DAILY_MAX = 4;
const DEFAULT_MIN_INTERVAL_HOURS = 6;
const FIRST_SCAN_DELAY_MS = 15 * 1000;
const SCAN_INTERVAL_MS = 10 * 60 * 1000;
const MAX_DAILY_PLANNER_ATTEMPTS = 6;
const IMAGE_TARGET_RETRY_ALLOWANCE = 3;
const AUTO_IMAGE_MAX_ROUNDS = 2;
const AUTO_IMAGE_RETRY_DELAYS_MS = [30 * 1000];
const MAX_MOMENT_LENGTH = 120;
const MAX_MOMENT_SUMMARY_LENGTH = 180;
const MAX_CONVERSATION_MESSAGES = 20;
const MAX_RECENT_MOMENTS_FOR_DEDUP = 12;
const RECENT_MOMENT_DEDUP_DAYS = 7;
const RECENT_MOMENT_SIMILARITY_THRESHOLD = 0.72;
const MOMENT_IMAGE_MODES = new Set(['none', 'auto', 'selfie', 'third_person']);
const UNSAFE_DAILY_VISUAL_PATTERN = /(?:裸体|裸露|内衣|情趣|床上|卧室|浴室|洗澡|私密|敏感部位|性行为|亲密接触|身体接触|湿身|撩人|性感|诱惑|自慰|亲吻|拥抱|胸|臀)/u;

export function sanitizeGeneratedMoment(value) {
  const text = stripGeneratedText(value).replace(/\s*\n+\s*/g, ' ').trim();
  if (!text) return '';

  const looksLikeConversation = /(?:用户|助手|assistant|system|系统|角色)\s*[:：]/i.test(text);
  const looksLikeCode = /```|\b(?:python|import|from|def|class|function|const|let|var|console\.)\b/i.test(text);
  const looksLikeStructuredDump = /^[{[]/.test(text) || /[{}][\s\S]*[{}]/.test(text);
  if (text.length > MAX_MOMENT_LENGTH || looksLikeConversation || looksLikeCode || looksLikeStructuredDump) {
    return '';
  }
  return text;
}

export function parseGeneratedMomentPlan(value) {
  const raw = stripGeneratedText(value);
  const json = raw.replace(/^```(?:json)?\s*|\s*```$/gi, '').trim();
  try {
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === 'object') {
      if (parsed.should_post === false) {
        return { shouldPost: false, content: '', imageMode: 'none', imageBrief: '' };
      }
      const content = sanitizeGeneratedMoment(parsed.content);
      if (!content) return { shouldPost: false, content: '', imageMode: 'none', imageBrief: '' };
      const requestedMode = String(parsed.image_mode || 'none').trim().toLowerCase();
      const imageMode = MOMENT_IMAGE_MODES.has(requestedMode) ? requestedMode : 'none';
      return {
        shouldPost: true,
        content,
        imageMode,
        imageBrief: stripGeneratedText(parsed.image_brief).slice(0, 240)
      };
    }
  } catch {
    // 兼容尚未按结构返回的旧聊天模型。
  }

  const content = sanitizeGeneratedMoment(raw);
  return content
    ? { shouldPost: true, content, imageMode: 'auto', imageBrief: '' }
    : { shouldPost: false, content: '', imageMode: 'none', imageBrief: '' };
}

export function sanitizeConversationMomentSummary(value) {
  const text = stripGeneratedText(value).replace(/\s*\n+\s*/g, ' ').trim();
  if (!text) return '';

  const looksLikeConversation = /(?:用户|助手|assistant|system|系统|角色)\s*[:：]/i.test(text);
  const looksLikeCode = /```|\b(?:python|import|from|def|class|function|const|let|var|console\.)\b/i.test(text);
  const looksLikeStructuredDump = /^[{[]/.test(text) || /[{}][\s\S]*[{}]/.test(text);
  if (text.length > MAX_MOMENT_SUMMARY_LENGTH || looksLikeConversation || looksLikeCode || looksLikeStructuredDump) {
    return '';
  }
  return text;
}

export function parseConversationMomentSummary(value) {
  const raw = stripGeneratedText(value);
  const json = raw.replace(/^```(?:json)?\s*|\s*```$/gi, '').trim();
  try {
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === 'object') {
      if (parsed.has_moment === false) return { hasMoment: false, summary: '' };
      const summary = sanitizeConversationMomentSummary(parsed.summary);
      return summary
        ? { hasMoment: true, summary }
        : { hasMoment: false, summary: '' };
    }
  } catch {
    // 兼容还不能稳定返回 JSON 的旧聊天模型。
  }

  const summary = sanitizeConversationMomentSummary(raw);
  return summary
    ? { hasMoment: true, summary }
    : { hasMoment: false, summary: '' };
}

function stripGeneratedText(value) {
  return String(value || '')
    .replace(/^\s*["'“”‘’]+|["'“”‘’]+\s*$/g, '')
    .trim()
    .slice(0, 500);
}

function extractTextFromPayload(payload) {
  return String(
    payload?.choices?.[0]?.message?.content
    || payload?.choices?.[0]?.delta?.content
    || payload?.message?.content
    || payload?.content
    || ''
  );
}

function extractTextFromSse(raw) {
  let content = '';
  for (const rawLine of String(raw || '').split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    try {
      content += extractTextFromPayload(JSON.parse(data));
    } catch {
      content += data;
    }
  }
  return content;
}

async function readGeneratedText(response) {
  const raw = await response.text().catch(() => '');
  if (!raw) return '';
  try {
    return stripGeneratedText(extractTextFromPayload(JSON.parse(raw)));
  } catch {
    return stripGeneratedText(extractTextFromSse(raw));
  }
}

export function normalizeDailyMax(value) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 12) return Math.round(parsed);
  return DEFAULT_DAILY_MAX;
}

export function normalizeDailyMin(value, dailyMax) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(dailyMax, Math.round(parsed)));
}

function normalizeMinInterval(value, dailyMax) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed >= 1) return parsed;
  return Math.max(1, Math.round(24 / (dailyMax || DEFAULT_DAILY_MAX))) || DEFAULT_MIN_INTERVAL_HOURS;
}

function startOfLocalDay(now) {
  const value = new Date(now);
  value.setHours(0, 0, 0, 0);
  return value;
}

function parseDynamicSetting(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function describeDynamicProfile(character) {
  const profile = parseDynamicSetting(character?.auto_moments_image_profile);
  if (!profile) return '';
  const labels = { temperament: '气质', face: '脸型', eyes: '眼睛', hair: '头发', skin: '皮肤', expression: '表情', other: '补充' };
  const lines = [];
  if (profile.name) lines.push(`姓名：${String(profile.name).slice(0, 60)}`);
  if (profile.age_feel) lines.push(`年龄感：${String(profile.age_feel).slice(0, 60)}`);
  for (const [key, label] of Object.entries(labels)) {
    if (Array.isArray(profile[key]) && profile[key].length) lines.push(`${label}：${profile[key].slice(0, 16).join('、')}`);
  }
  return lines.join('；');
}

function describeDynamicTemplates(character) {
  const templates = parseDynamicSetting(character?.auto_moments_templates);
  if (!templates) return '';
  const labels = { categories: '动态类别', selfie_scenes: '自拍场景', poses: '姿势', moods: '心情', custom: '自定义' };
  return Object.entries(labels)
    .filter(([key]) => Array.isArray(templates[key]) && templates[key].length)
    .map(([key, label]) => `${label}：${templates[key].slice(0, 16).join('、')}`)
    .join('；');
}

function chooseOne(values, random = Math.random) {
  const choices = (Array.isArray(values) ? values : [])
    .map(value => String(value || '').trim())
    .filter(Boolean);
  if (!choices.length) return '';
  return choices[Math.min(choices.length - 1, Math.max(0, Math.floor(random() * choices.length)))];
}

function momentTokens(value) {
  const text = String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  if (!text) return [];
  const chars = [...text];
  if (chars.length <= 2) return chars;
  return chars.map((_char, index) => chars.slice(index, index + 2).join('')).slice(0, 160);
}

export function calculateMomentSimilarity(left, right) {
  const leftText = String(left || '').toLowerCase().replace(/\s+/g, '').trim();
  const rightText = String(right || '').toLowerCase().replace(/\s+/g, '').trim();
  if (!leftText || !rightText) return 0;
  if (leftText === rightText) return 1;
  const leftTokens = new Set(momentTokens(leftText));
  const rightTokens = new Set(momentTokens(rightText));
  if (!leftTokens.size || !rightTokens.size) return 0;
  let intersection = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) intersection += 1;
  const jaccard = intersection / (leftTokens.size + rightTokens.size - intersection);
  const containment = intersection / Math.min(leftTokens.size, rightTokens.size);
  return Math.max(jaccard, containment);
}

export function hasRecentSimilarMoment(content, recentMoments = [], {
  now = new Date(),
  windowDays = RECENT_MOMENT_DEDUP_DAYS,
  threshold = RECENT_MOMENT_SIMILARITY_THRESHOLD
} = {}) {
  const currentTime = new Date(now).getTime();
  const windowMs = Number(windowDays) * 24 * 60 * 60 * 1000;
  return (Array.isArray(recentMoments) ? recentMoments : []).some(item => {
    const createdAt = item?.created_at || item?.createdAt;
    if (createdAt) {
      const timestamp = new Date(String(createdAt).replace(' ', 'T')).getTime();
      if (Number.isFinite(timestamp) && Number.isFinite(currentTime) && currentTime - timestamp > windowMs) return false;
    }
    return calculateMomentSimilarity(content, item?.content) >= threshold;
  });
}

function chooseSafeDailyVisual(values, fallback, random = Math.random) {
  const safeChoices = (Array.isArray(values) ? values : [])
    .map(value => String(value || '').trim())
    .filter(value => value && !UNSAFE_DAILY_VISUAL_PATTERN.test(value));
  return chooseOne(safeChoices, random) || fallback;
}

export function resolveDynamicImageTemplate(character, plan, random = Math.random) {
  const templates = parseDynamicSetting(character?.auto_moments_templates) || {};
  const isSelfie = plan?.imageMode !== 'third_person';
  const sceneChoices = isSelfie
    ? templates.selfie_scenes
    : [...(templates.custom || []), ...(templates.categories || [])];

  return {
    scene: chooseSafeDailyVisual(sceneChoices, isSelfie ? '窗边的日常自拍' : '安静的生活片段', random),
    pose: chooseSafeDailyVisual(templates.poses, '自然放松的姿势', random),
    mood: chooseSafeDailyVisual(templates.moods, '放松', random),
    isSelfie
  };
}

function buildConversationSummaryMessages(character, context) {
  const name = String(character?.name || '她').trim() || '她';
  const recentLines = context.messages
    .map(item => `${item.role === 'assistant' ? name : '用户'}：${String(item.content || '').trim()}`)
    .filter(line => line.length > 4)
    .join('\n');

  return [
    {
      role: 'system',
      content: [
        `你是${name}的聊天理解器。把最近聊天压缩成一条供她本人写动态时使用的“生活片段摘要”。`,
        '摘要只保留今天发生了什么、情绪、互动氛围和关系感；绝不照抄对话，也不要保留姓名、账号、地址、身体或私密过程等具体细节。',
        '任何不适合直接写入动态的细节，都改成含蓄、生活化的概括，例如“亲近”“调皮”“被安慰”“轻松聊天”。原始细节不能出现在摘要里。',
        '只在完全没有可概括的互动时返回 has_moment=false；只要存在可用的情绪或相处氛围，就应提炼成非露骨摘要。',
        '只输出 JSON：{"has_moment":true,"summary":"10 到 80 字的非露骨生活片段摘要"}；没有任何可概括内容时输出 {"has_moment":false}。'
      ].join('\n')
    },
    {
      role: 'user',
      content: recentLines ? `最近聊天（只用于理解，不可复述）：\n${recentLines}` : '最近聊天：暂时没有。'
    }
  ];
}

function buildMomentStateContext(snapshot = {}) {
  const state = snapshot.state || {};
  const relationship = snapshot.relationship || {};
  return [
    '【角色当前状态】',
    `心情：${String(state.modeLabel || '平静')}；温暖感 ${Number(state.warmth ?? 65)}/100，精力 ${Number(state.energy ?? 60)}/100，关心程度 ${Number(state.concern ?? 20)}/100。状态只影响语气和节奏，不代表新的事实。`,
    `关系状态：熟悉 ${Number(relationship.familiarity ?? 50)}/100，信任 ${Number(relationship.trust ?? 50)}/100，安全感 ${Number(relationship.safety ?? 50)}/100，默契 ${Number(relationship.tacit ?? 50)}/100。关系只用于决定表达的亲近程度，不能凭空升级。`
  ].join('\n');
}

function buildMomentMessages(character, context, { mustPost = false, forceImage = false } = {}) {
  const name = String(character?.name || '她').trim() || '她';
  const persona = String(character?.persona || '').trim();
  const profile = describeDynamicProfile(character);
  const templates = describeDynamicTemplates(character);
  const conversationSummary = sanitizeConversationMomentSummary(context.conversationSummary);
  const memoryTags = context.memories
    .map(item => String(item.tag || item.category || '记忆').trim())
    .filter(Boolean)
    .join('\n');
  const previousMomentLines = context.recentMoments
    .slice(0, 4)
    .map(item => `- ${String(item.content || '').trim()}`)
    .filter(line => line.length > 4)
    .join('\n');
  const characterContext = buildMomentStateContext(context.contextSnapshot);

  return [
    {
      role: 'system',
      content: [
        mustPost
          ? `你现在是${name}的动态规划器。用户为她设置了每日发布目标，当前进度尚未完成，请规划一条安全的个人动态。`
          : `你现在是${name}的动态规划器，请决定她此刻是否适合发一条个人动态。`,
        mustPost
          ? '只使用已经脱敏的生活摘要，不照抄或泄露聊天。即使原聊天有不适合公开的细节，也要保留其中可用的情绪和关系氛围；无法使用摘要时，改从人设和生活模板写一条普通日常。'
          : '只使用已经脱敏的生活摘要，不照抄或泄露聊天。原聊天是否含私密细节不是“不发”的理由：只要摘要保留了情绪、互动或生活感，就用含蓄、非露骨的方式表达；仅在没有任何可用生活片段且不适合凭人设写日常时才选择不发。',
        forceImage
          ? '自动动态发图已开启。若发布，image_mode 必须为 selfie 或 third_person，不能选择 none；image_brief 只能写衣着完整、单人、日常生活场景，不能描述亲密互动、身体接触或私密细节。'
          : '',
        '若发，正文写 1 到 2 句自然生活化中文，10 到 60 字，最长不超过 120 字；不解释、不加标题、不说自己是 AI。',
        mustPost
          ? '只输出 JSON：{"should_post":true,"content":"正文","image_mode":"none|selfie|third_person","image_brief":"给图片的简短生活场景"}。除非无法生成安全内容，否则不要返回 should_post=false。'
          : '只输出 JSON：{"should_post":true,"content":"正文","image_mode":"none|selfie|third_person","image_brief":"给图片的简短生活场景"}。不发时输出 {"should_post":false}。',
        persona ? `人设参考：${persona.slice(0, 1000)}` : '',
        profile ? `固定形象：${profile}` : '',
        templates ? `可选生活模板：${templates}` : '',
        characterContext
      ].filter(Boolean).join('\n')
    },
    {
      role: 'user',
      content: [
        conversationSummary ? `聊天生活摘要（已脱敏，只能依据它表达）：\n${conversationSummary}` : '聊天生活摘要：没有可用摘要；可按人设和生活模板写普通日常，不能编造具体聊天事实。',
        memoryTags ? `已确认记忆标签（不含原文，只作为轻微连续性提醒）：\n${memoryTags}` : '已确认记忆标签：暂时没有。',
        previousMomentLines ? `最近已发动态：\n${previousMomentLines}` : '最近已发动态：暂时没有。'
      ].join('\n\n')
    }
  ];
}

export function buildAutoImagePrompt(character, content, plan, resolvedTemplate = {}) {
  const name = String(character?.name || '她').trim() || '她';
  const profile = describeDynamicProfile(character);
  const scene = String(resolvedTemplate.scene || '').trim() || '自然生活片段';
  const pose = String(resolvedTemplate.pose || '').trim() || '自然放松的姿势';
  const mood = String(resolvedTemplate.mood || '').trim() || '放松';
  return [
    `任务：生成${name}今天发布的一条个人动态配图。`,
    '【输出规则】只生成一张完整的单幅照片，单一连续构图。严禁九宫格、拼贴、分镜、接触表、网格、多张照片、多人并排、重复的人脸或身体。不要出现文字、水印或界面。',
    '【固定身份】角色是已成年的女性。年龄感、脸型、五官、眼睛、发色和整体气质必须与设定一致；衣服只可随本次场景自然变化，不能借此把角色画成另一个人。',
    resolvedTemplate.isSelfie === false
      ? '使用第三人称单人生活抓拍构图，只出现角色本人。'
      : '使用角色自己的第一人称手机视角或单人自拍构图。',
    '画面必须是衣着完整、单人、自然的日常生活照片；不表现亲密互动、身体接触或任何私密内容。不要出现陌生男性、男性的手或身体、男性影子、男性倒影，也不要要求用户上传自己的照片。',
    profile ? `角色固定形象：${profile}` : '',
    `【本次安全生活场景】场景：${scene}；姿势：${pose}；心情：${mood}。`,
    '不要从聊天、动态正文或其他来源补全画面；只按照以上安全生活场景构图。'
  ].join('\n');
}

function getPlannerAttemptLimit(dailyTarget) {
  return dailyTarget > 0
    ? Math.max(MAX_DAILY_PLANNER_ATTEMPTS, dailyTarget + IMAGE_TARGET_RETRY_ALLOWANCE)
    : MAX_DAILY_PLANNER_ATTEMPTS;
}

function buildFallbackDailyContent(character, recentMoments = [], random = Math.random) {
  const name = String(character?.name || '她').trim() || '她';
  const templates = [
    `${name}今天也在慢慢过自己的小日子，把一份安静留在这里。`,
    `给今天留一张小小的生活切片。${name}在，好好过着自己的日子。`,
    `窗外的光刚好，${name}想把这一点平常的温柔记下来。`,
    `${name}今天也有认真照顾自己的片刻，想和你轻轻打个招呼。`
  ];
  const available = templates.filter(content => !hasRecentSimilarMoment(content, recentMoments));
  return chooseOne(available.length ? available : templates, random) || templates[0];
}

function getDynamicGenerationAttemptLimit(imageConfig) {
  // 常见 gpt-image 中转偶发 502；限定为最多五次，且仅在用户已选该渠道时发生。
  return /^gpt-image-/i.test(String(imageConfig?.model || '')) ? 5 : 3;
}

function buildDynamicImageMetadata({ imageConfig, plan, resolvedTemplate, outputHandling, imageStatus, resolution }) {
  return JSON.stringify({
    version: 'dynamic-image-v1',
    image_mode: 'single',
    channel: String(imageConfig?.name || ''),
    model: String(imageConfig?.model || ''),
    resolution: String(resolution || 'channel'),
    composition: plan?.imageMode === 'third_person' ? 'third_person' : 'selfie',
    template: {
      scene: String(resolvedTemplate?.scene || ''),
      pose: String(resolvedTemplate?.pose || ''),
      mood: String(resolvedTemplate?.mood || '')
    },
    output_handling: outputHandling || 'none',
    status: imageStatus
  });
}

function buildChannelTestPlan(character) {
  const name = String(character?.name || '她').trim() || '她';
  return {
    shouldPost: true,
    content: `想趁现在和你打个招呼。${name}今天也在慢慢过自己的小日子。`,
    imageMode: 'selfie',
    imageBrief: '一张自然的日常自拍，用于确认动态发图渠道是否正常'
  };
}

export function createAutoMomentsService({
  db = pool,
  fetchImpl = fetch,
  generateImageImpl = generateImage,
  sleepImpl = ms => new Promise(resolve => setTimeout(resolve, ms)),
  imageRetryRounds = AUTO_IMAGE_MAX_ROUNDS,
  imageRetryDelaysMs = AUTO_IMAGE_RETRY_DELAYS_MS,
  now = () => new Date(),
  random = Math.random,
  logger = console
} = {}) {
  async function getCapability(userId, capability) {
    const [rows] = await db.query(
      `
        SELECT
          ca.id,
          ca.capability,
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
    const item = rows[0] || null;
    return capability === 'dynamic' && item && !supportsDynamicSingleImage(item.model) ? null : item;
  }

  async function getCharacterChatCapability(userId, character) {
    const credentialId = Number(character?.chat_credential_id);
    const modelId = String(character?.chat_model_id || '').trim();
    if (Number.isInteger(credentialId) && credentialId > 0 && modelId) {
      const [rows] = await db.query(
        `
          SELECT c.id, c.name, c.provider_type, c.api_base, c.api_aux_base,
                 c.api_key, cm.model_id AS model
          FROM credentials c
          INNER JOIN credential_models cm ON cm.credential_id = c.id
          WHERE c.id = ? AND c.user_id = ? AND c.is_enabled = 1 AND cm.model_id = ?
          LIMIT 1
        `,
        [credentialId, userId, modelId]
      );
      if (rows[0]) return rows[0];
    }
    return getCapability(userId, 'chat');
  }

  async function loadPlannerAttemptState(userId, characterId) {
    const [rows] = await db.query(
      `
        SELECT SUM(created_at >= ?) AS cnt, MAX(next_retry_at) AS next_retry_at
        FROM auto_moment_attempts
        WHERE user_id = ? AND character_id = ?
      `,
      [startOfLocalDay(now()), userId, characterId]
    );
    return {
      count: Number(rows[0]?.cnt || 0),
      nextRetryAt: rows[0]?.next_retry_at || null
    };
  }

  async function beginPlannerAttempt(userId, characterId, chatConfig) {
    const [result] = await db.query(
      `
        INSERT INTO auto_moment_attempts
          (user_id, character_id, provider_name, provider_type, model, outcome,
           image_status, error_category, duration_ms, next_retry_at, created_at)
        VALUES (?, ?, ?, ?, ?, 'planner_started', 'not_requested', NULL, NULL,
                DATE_ADD(NOW(), INTERVAL 1 HOUR), NOW())
      `,
      [
        userId,
        characterId,
        String(chatConfig?.name || '').slice(0, 160),
        String(chatConfig?.provider_type || '').slice(0, 80),
        String(chatConfig?.model || '').slice(0, 160)
      ]
    );
    return Number(result?.insertId || 0);
  }

  async function finishPlannerAttempt(attemptId, {
    outcome,
    imageStatus = 'not_requested',
    errorCategory = null,
    durationMs = null,
    momentId = null
  }) {
    if (!attemptId) return;
    await db.query(
      `
        UPDATE auto_moment_attempts
        SET outcome = ?, image_status = ?, error_category = ?, duration_ms = ?, moment_id = ?
        WHERE id = ?
      `,
      [outcome, imageStatus, errorCategory, durationMs, momentId, attemptId]
    );
  }

  function classifyAttemptError(error) {
    const status = Number(error?.status || error?.statusCode || 0);
    if (status === 401 || status === 403) return 'auth';
    if (status === 429) return 'rate_limit';
    if (status >= 500) return 'upstream';
    const message = String(error?.message || error || '').toLowerCase();
    if (/timeout|timed out|超时/.test(message)) return 'timeout';
    if (/network|fetch failed|econn|连接|中断/.test(message)) return 'network';
    if (/quota|balance|余额|额度|费用/.test(message)) return 'quota';
    return 'unknown';
  }

  async function loadContext(userId, characterId, character = {}) {
    const [[messages], [memories], [recentMoments]] = await Promise.all([
      db.query(
        `
          SELECT role, content, created_at
          FROM messages
          WHERE user_id = ? AND character_id = ? AND is_active = 1
          ORDER BY id DESC
          LIMIT ?
        `,
        [userId, characterId, MAX_CONVERSATION_MESSAGES]
      ),
      db.query(
        `
          SELECT tag, category, content
          FROM memories
           WHERE user_id = ? AND character_id = ? AND is_deleted = 0
             AND COALESCE(review_status, 'active') <> 'candidate'
          ORDER BY is_important DESC, created_at DESC, id DESC
          LIMIT ?
        `,
        [userId, characterId, 4]
      ),
      db.query(
        `
          SELECT content, created_at
          FROM moments
          WHERE user_id = ? AND character_id = ? AND is_deleted = 0
          ORDER BY created_at DESC, id DESC
          LIMIT ?
        `,
        [userId, characterId, MAX_RECENT_MOMENTS_FOR_DEDUP]
      )
    ]);
    const [personaRuntime, recentLifeEvents] = await Promise.all([
      loadPersonaRuntime(db, { userId, characterId }),
      loadRecentLifeEvents(db, { userId, characterId, limit: 8 })
    ]);
    const orderedMessages = messages.reverse();
    const contextSnapshot = buildCharacterContextSnapshot({
      character,
      personaRuntime,
      recentMessages: orderedMessages,
      memories,
      recentLifeEvents,
    });
    return { messages: orderedMessages, memories, recentMoments, contextSnapshot };
  }

  async function countTodayMoments(userId, characterId) {
    const [rows] = await db.query(
      `
        SELECT COUNT(*) AS cnt
        FROM moments
        WHERE user_id = ? AND character_id = ? AND is_deleted = 0 AND created_at >= ?
      `,
      [userId, characterId, startOfLocalDay(now())]
    );
    return Number(rows[0]?.cnt || 0);
  }

  async function requestChatText(chatConfig, { messages, maxTokens }) {
    const response = await fetchImpl(buildChatCompletionsUrl(chatConfig.api_base), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${chatConfig.api_key}`
      },
      body: JSON.stringify({
        model: chatConfig.model,
        stream: false,
        temperature: 0.9,
        max_tokens: maxTokens,
        messages
      })
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      const error = new Error(detail || `聊天模型返回 ${response.status}`);
      error.status = response.status;
      throw error;
    }

    return readGeneratedText(response);
  }

  async function summarizeConversation(character, chatConfig, context) {
    const raw = await requestChatText(chatConfig, {
      maxTokens: 160,
      messages: buildConversationSummaryMessages(character, context)
    });
    return parseConversationMomentSummary(raw);
  }

  async function generateMomentPlan(character, chatConfig, context, options = {}) {
    const raw = await requestChatText(chatConfig, {
      maxTokens: 180,
      messages: buildMomentMessages(character, context, options)
    });
    return parseGeneratedMomentPlan(raw);
  }

  async function processCharacter(character, { ignoreLimits = false, forceChannelTest = false } = {}) {
    const characterId = Number(character.id);
    const userId = Number(character.user_id);
    const dailyMax = normalizeDailyMax(character.auto_moments_daily_max);
    const dailyMin = normalizeDailyMin(character.auto_moments_daily_min, dailyMax);
    const plannerAttemptLimit = getPlannerAttemptLimit(dailyMin);
    const minIntervalHours = normalizeMinInterval(character.auto_moments_min_interval_hours, dailyMax);
    let todayCount = 0;

    if (!ignoreLimits) {
      todayCount = await countTodayMoments(userId, characterId);
      if (todayCount >= dailyMax) {
        return { characterId, status: 'skipped_daily_limit' };
      }

      if (character.auto_moments_last_posted_at) {
        const lastPost = new Date(character.auto_moments_last_posted_at);
        const elapsedHours = (new Date(now()).getTime() - lastPost.getTime()) / 3600000;
        if (Number.isFinite(elapsedHours) && elapsedHours < minIntervalHours) {
          return { characterId, status: 'skipped_interval' };
        }
      }

      const attemptState = await loadPlannerAttemptState(userId, characterId);
      if (attemptState.count >= plannerAttemptLimit) {
        return { characterId, status: 'skipped_planner_daily_limit' };
      }
      if (attemptState.nextRetryAt) {
        const remainingMs = new Date(attemptState.nextRetryAt).getTime() - new Date(now()).getTime();
        if (Number.isFinite(remainingMs) && remainingMs > 0) {
          return { characterId, status: 'skipped_planner_cooldown' };
        }
      }
    }

    let plan;
    let context = null;
    let plannerAttemptId = 0;
    let plannerStartedAt = 0;
    if (forceChannelTest) {
      plan = buildChannelTestPlan(character);
    } else {
      const chatConfig = await getCharacterChatCapability(userId, character);
      if (!chatConfig) {
        logger.warn?.(`[auto-moments] ${character.name} 未启用聊天能力，跳过本次动态`);
        return { characterId, status: 'skipped_no_chat_capability' };
      }
      context = await loadContext(userId, characterId, character);
      plannerAttemptId = await beginPlannerAttempt(userId, characterId, chatConfig);
      plannerStartedAt = Date.now();
      try {
        const conversation = await summarizeConversation(character, chatConfig, context);
        context.conversationSummary = conversation.summary
          || (context.messages.length
            ? '今天和用户有一段值得轻轻记下的互动，适合用含蓄、生活化的方式表达。'
            : '');
        plan = await generateMomentPlan(character, chatConfig, context, {
          mustPost: todayCount < dailyMin,
          forceImage: Number(character.auto_moments_images_enabled || 0) === 1
        });
      } catch (error) {
        await finishPlannerAttempt(plannerAttemptId, {
          outcome: 'planner_failed',
          errorCategory: classifyAttemptError(error),
          durationMs: Date.now() - plannerStartedAt
        });
        throw error;
      }
    }
    const imagesEnabled = Number(character.auto_moments_images_enabled || 0) === 1;
    if (forceChannelTest && !imagesEnabled) {
      return {
        characterId,
        status: 'skipped_image_disabled',
        imageStatus: 'disabled',
        imageError: '动态发图未开启',
        testMode: true
      };
    }
    const requiresTargetPost = todayCount < dailyMin;
    if (!plan.shouldPost && requiresTargetPost) {
      plan = {
        shouldPost: true,
        content: buildFallbackDailyContent(character, context?.recentMoments || [], random),
        imageMode: imagesEnabled ? 'selfie' : 'none',
        imageBrief: ''
      };
    }
    if (!plan.shouldPost) {
      await finishPlannerAttempt(plannerAttemptId, {
        outcome: 'planner_skipped',
        durationMs: plannerStartedAt ? Date.now() - plannerStartedAt : null
      });
      return { characterId, status: 'skipped_planner' };
    }
    if (hasRecentSimilarMoment(plan.content, context?.recentMoments || [], { now: now() })) {
      if (requiresTargetPost) {
        plan = {
          ...plan,
          content: buildFallbackDailyContent(character, context?.recentMoments || [], random),
          imageBrief: ''
        };
      }
      if (hasRecentSimilarMoment(plan.content, context?.recentMoments || [], { now: now() })) {
        await finishPlannerAttempt(plannerAttemptId, {
          outcome: 'duplicate_skipped',
          durationMs: plannerStartedAt ? Date.now() - plannerStartedAt : null
        });
        return { characterId, status: 'skipped_duplicate' };
      }
    }
    if (imagesEnabled && plan.imageMode === 'none') {
      plan = { ...plan, imageMode: 'selfie', imageBrief: '' };
    }
    const content = plan.content;

    let images = null;
    let imageStatus = 'disabled';
    let imageError = '';
    let imageMetadata = null;
    const imageConfig = imagesEnabled ? await getCapability(userId, 'dynamic') : null;
    if (imagesEnabled && !imageConfig) imageStatus = 'dynamic_unconfigured';
    if (imagesEnabled && imageConfig) {
      imageStatus = 'pending';
      const resolvedTemplate = resolveDynamicImageTemplate(character, plan, random);
      const imagePrompt = buildAutoImagePrompt(character, content, plan, resolvedTemplate);
      let outputHandling = 'none';
      const rounds = forceChannelTest ? 1 : Math.max(1, Math.min(3, Number(imageRetryRounds) || AUTO_IMAGE_MAX_ROUNDS));
      let lastImageError = null;
      for (let round = 1; round <= rounds; round += 1) {
        try {
          const generated = await generateImageImpl(
            imagePrompt,
            {
              providerType: imageConfig.provider_type,
              apiBase: imageConfig.api_base,
              taskApiBase: imageConfig.api_aux_base,
              apiKey: imageConfig.api_key,
              model: imageConfig.model,
              extras: imageConfig.extras,
              resolution: character.auto_moments_image_resolution || 'channel',
              fetchImpl,
              expectedSingleImage: true,
              generationMaxAttempts: getDynamicGenerationAttemptLimit(imageConfig),
              returnResult: true
            }
          );
          const imageUrl = typeof generated === 'string' ? generated : generated?.url;
          if (imageUrl) {
            images = JSON.stringify([imageUrl]);
            imageStatus = 'generated';
            outputHandling = typeof generated === 'object' ? generated.outputHandling || 'single' : 'single';
            break;
          }
          throw new Error('图片渠道没有返回可用图片');
        } catch (error) {
          lastImageError = error;
          if (round < rounds) {
            const delay = Number(imageRetryDelaysMs[round - 1]) || 30_000;
            logger.warn?.(`[auto-moments] ${character.name} 第 ${round} 轮配图失败，${Math.round(delay / 1000)} 秒后继续尝试：${error.message}`);
            await sleepImpl(delay);
          }
        }
      }
      if (!images && lastImageError) {
        imageStatus = 'failed';
        imageError = String(lastImageError.message || 'unknown').slice(0, 200);
        logger.warn?.({
          code: 'AUTO_MOMENT_IMAGE_FAILED',
          capability: 'dynamic',
          characterId,
          rounds,
          reason: String(lastImageError.message || 'unknown').slice(0, 200)
        });
      }
      imageMetadata = buildDynamicImageMetadata({
        imageConfig,
        plan,
        resolvedTemplate,
        outputHandling,
        imageStatus,
        resolution: character.auto_moments_image_resolution || 'channel'
      });
    }

    if (imagesEnabled && !images) {
      const failed = imageStatus !== 'dynamic_unconfigured';
      await finishPlannerAttempt(plannerAttemptId, {
        outcome: failed ? 'image_failed' : 'image_unconfigured',
        imageStatus,
        errorCategory: failed ? 'image_failed' : 'dynamic_unconfigured',
        durationMs: plannerStartedAt ? Date.now() - plannerStartedAt : null
      });
      return {
        characterId,
        status: failed ? 'skipped_image_failed' : 'skipped_image_unconfigured',
        content,
        images: [],
        imageStatus,
        imageError,
        testMode: forceChannelTest
      };
    }

    let result;
    try {
      [result] = await db.query(
        `
          INSERT INTO moments
            (user_id, character_id, visibility_mode, content, images, image_generation_status, image_generation_error, mood, likes_count, image_mode, image_generation_metadata, created_at, is_deleted)
          VALUES (?, ?, 'publisher', ?, ?, ?, ?, ?, 0, 'single', ?, NOW(), 0)
        `,
        [userId, characterId, content, images, imageStatus, imageError || null, null, imageMetadata]
      );
    } catch (error) {
      await finishPlannerAttempt(plannerAttemptId, {
        outcome: 'publish_failed',
        imageStatus,
        errorCategory: classifyAttemptError(error),
        durationMs: plannerStartedAt ? Date.now() - plannerStartedAt : null
      });
      throw error;
    }
    await db.query(
      'UPDATE characters SET auto_moments_last_posted_at = NOW() WHERE id = ? AND user_id = ?',
      [characterId, userId]
    );
    await finishPlannerAttempt(plannerAttemptId, {
      outcome: images ? 'posted_image' : 'posted_text',
      imageStatus,
      errorCategory: imageStatus === 'failed' ? 'image_failed' : null,
      durationMs: plannerStartedAt ? Date.now() - plannerStartedAt : null,
      momentId: result?.insertId || null
    });
    logger.log?.(`[auto-moments] ${character.name}(id=${characterId}) 已发布${images ? '图文' : '文字'}动态`);
    return {
      characterId,
      momentId: result?.insertId || null,
      status: 'posted',
      content,
      images: images ? JSON.parse(images) : [],
      imageStatus,
      imageError,
      testMode: forceChannelTest
    };
  }

  async function runScan({ characterId = null, ignoreLimits = false, forceChannelTest = false } = {}) {
    const params = [];
    let characterFilter = '';
    if (characterId != null) {
      characterFilter = ' AND id = ?';
      params.push(Number(characterId));
    }

    try {
      const [characters] = await db.query(
        `
          SELECT id, user_id, name, persona, chat_credential_id, chat_model_id, auto_moments_daily_min, auto_moments_daily_max,
                 auto_moments_min_interval_hours, auto_moments_last_posted_at,
                 auto_moments_images_enabled, auto_moments_image_resolution, auto_moments_image_profile, auto_moments_templates
          FROM characters
          WHERE auto_moments_enabled = 1 AND is_deleted = 0${characterFilter}
          ORDER BY id ASC
        `,
        params
      );

      const results = [];
      for (const character of characters) {
        try {
          results.push(await processCharacter(character, { ignoreLimits, forceChannelTest }));
        } catch (error) {
          logger.error?.(`[auto-moments] 处理角色 ${character.name || character.id} 失败：${error.message}`);
          results.push({ characterId: Number(character.id), status: 'failed', error: error.message });
        }
      }
      return results;
    } catch (error) {
      logger.error?.(`[auto-moments] 扫描失败：${error.message}`);
      return [{ characterId: characterId == null ? null : Number(characterId), status: 'failed', error: error.message }];
    }
  }

  return { runScan, processCharacter };
}

export function startAutoMomentsScheduler({
  setTimeoutImpl = setTimeout,
  setIntervalImpl = setInterval,
  service = null,
  ...serviceOptions
} = {}) {
  const autoMomentsService = service || createAutoMomentsService(serviceOptions);
  const runSafely = () => autoMomentsService.runScan().catch(error => {
    (serviceOptions.logger || console).error?.(`[auto-moments] 定时扫描失败：${error.message}`);
  });

  const firstTimer = setTimeoutImpl(runSafely, FIRST_SCAN_DELAY_MS);
  const interval = setIntervalImpl(runSafely, SCAN_INTERVAL_MS);
  firstTimer?.unref?.();
  interval?.unref?.();
  (serviceOptions.logger || console).log?.('[auto-moments] 定时器已启动：15 秒后首次扫描，之后每 10 分钟检查一次');

  return { ...autoMomentsService, firstTimer, interval };
}
