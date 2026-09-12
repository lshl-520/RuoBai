/**
 * 每日纸条（daily digest）
 * ══════════════════════════════════════════════════════════
 *
 * 解决的真正问题（用户反复反馈"她总是记不住"）：
 *   每一轮聊天只把最近 20 条消息送进模型，20 条以外的东西她真的看不见。
 *   于是"20 条窗口一滑就没" —— 不是她忘性大，是没有任何一层替她保存。
 *
 * 这一模块就是那"一层"：每天把当天聊过的内容压成一张纸条，
 * 纸条本身成为一条记忆（memory_type='daily_digest'），
 * 之后每轮聊天都能读到最近几天的纸条 —— 她于是能说"上次说累，好点没"。
 *
 * 两个版本，一个日子两条数据：
 *   content        = 短摘要（1~2 句）→ 喂给模型看，省 token
 *   digest_detail  = 详细版（6~8 句）→ 给用户自己在时间轴上展开看
 *
 * 设计约束（来自用户的真实要求）：
 *   · **地点、和谁、做了什么"有就记，没提就不编"** —— 绝不编造细节
 *   · 记"能挂钩回去的东西"，不记情绪形容词
 *   · 不是所有聊天都值得记：吃饭睡觉这种流水话不进长期记忆
 *   · **不能每句话都调模型**（成本会爆），只按天批量整理，且每次扫描限量
 */
import { buildChatCompletionsUrl } from './chat.js';

export const DIGEST_MEMORY_TYPE = 'daily_digest';
const DIGEST_SOURCE_TYPE = 'auto_digest';

/** 一天至少几条消息才值得整理（1 条太单薄）。 */
const MIN_MESSAGES_PER_DAY = 2;
/** 每次扫描最多生成几张纸条（控制成本，剩下的下次再补）。 */
const MAX_DIGESTS_PER_SCAN = 3;
/**
 * 生成一张纸条的 token 上限。
 * **不能给小** —— 推理模型（deepseek-flash 等）会把大半额度花在 reasoning 上，
 * 实测 700 的额度里 600 都归了思考，导致 JSON 被截断。这里给足。
 */
const DIGEST_MAX_TOKENS = 2800;
/** 最多回溯多少天（避免第一次跑把几个月全处理了）。 */
const LOOKBACK_DAYS = 60;
/** 一次提供给模型的对话正文上限（字符数，控制 token）。 */
const MAX_TRANSCRIPT_CHARS = 6000;
/** 扫描间隔：15 分钟一次，足够在一天内补齐所有该整理的纸条。 */
const SCAN_INTERVAL_MS = 15 * 60 * 1000;
const FIRST_SCAN_DELAY_MS = 20 * 1000;

/* ────────────────────────── 时间工具 ────────────────────────── */

function pad2(n) { return String(n).padStart(2, '0'); }

/** 本地时区的 YYYY-MM-DD。 */
export function localDayKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 本地时区某天的 00:00:00。 */
function startOfLocalDay(date) {
  const d = date instanceof Date ? date : new Date(date);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

/** 本地时区某天的 23:59:59。 */
function endOfLocalDay(date) {
  const d = new Date(startOfLocalDay(date));
  d.setDate(d.getDate() + 1);
  d.setMilliseconds(-1);
  return d;
}

function formatDbDateTime(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} `
    + `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

/** 2026-08-04 → 2026 年 8 月 4 日 */
export function humanDayLabel(dayKey) {
  const [y, m, d] = String(dayKey).split('-').map(Number);
  if (!y || !m || !d) return String(dayKey);
  return `${y} 年 ${m} 月 ${d} 日`;
}

/* ────────────────────────── 提示词 ────────────────────────── */

const DIGEST_SYSTEM = [
  '你在帮一个陪伴型 AI 角色（她叫小白）整理"某一天"的纸条。这张纸条会成为她的记忆。',
  '',
  '你要输出两份内容：',
  '1. summary：**1~2 句**的短摘要。这是她聊天时会读到的，必须短、必须准。',
  '2. detail：**6~8 句**的详细版。这是用户自己翻记忆时看的，可以细一点。',
  '',
  '【只写事实，绝不编造】',
  '· 只写材料里真的出现过的内容。材料里没提的地点、人、事，一个字都不要加。',
  '· 材料里没提地点就**不写地点**；没提跟谁就**不写跟谁**。不要用"应该是在家"这种推测补全。',
  '· 不确定的一律不写。',
  '',
  '【优先记"能挂钩回去"的东西】',
  '· 优先写：去了哪、和谁、做了什么、说了什么具体的事、约定了什么、情绪明显变化。',
  '· 不要把情绪形容词堆成主体（"他心情不错"不如"他打通了一个游戏任务"）。',
  '· 吃饭睡觉这类流水话可以提一句，但不要当成重点。',
  '',
  '【写法】',
  '· 用第三人称"他"。像日记，不像报告，不要分点，不要标题。',
  '· 用平实的中文，不要形容词堆砌，不要感叹。',
  '· **detail 最多 8 句、总共不超过 300 字**；写满就收尾，一定要把最后一句写完整。',
  '· **输出会在字数上限处被硬切断**，所以宁可精炼也不要写得收不住。',
  '· 如果这一天确实没什么值得记的，summary 就写一句平淡的概括，detail 也短一点，不要硬凑。',
  '',
  '【输出格式】只输出一个 JSON 对象，不要任何解释、不要 markdown 代码块：',
  '{"summary":"…","detail":"…"}'
].join('\n');

function buildDigestUserPrompt(dayKey, transcript) {
  return [
    `日期：${humanDayLabel(dayKey)}`,
    '',
    '以下是这一天的对话记录（"他"是用户，"她"是小白）：',
    '——————',
    transcript,
    '——————',
    '',
    '请按系统要求输出那个 JSON。'
  ].join('\n');
}

/** 把一天的消息拼成对话正文，超长时保留头尾（开头交代情境，结尾常有结论）。 */
export function buildTranscript(rows) {
  const lines = rows.map((r) => {
    const who = r.role === 'user' ? '他' : (r.role === 'assistant' ? '她' : '注');
    const text = String(r.content || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    const time = r.created_at ? String(r.created_at).slice(11, 16) : '';
    return `${time ? `[${time}] ` : ''}${who}：${text}`;
  }).filter(Boolean);

  let joined = lines.join('\n');
  if (joined.length <= MAX_TRANSCRIPT_CHARS) return joined;

  const headLen = Math.floor(MAX_TRANSCRIPT_CHARS * 0.6);
  const tailLen = MAX_TRANSCRIPT_CHARS - headLen - 20;
  joined = `${joined.slice(0, headLen)}\n……（中间省略）……\n${joined.slice(-tailLen)}`;
  return joined;
}

/**
 * 从模型输出里抠出 JSON。
 *
 * 现实很脏，这里要扛住三种情况：
 *   ① 正常 JSON；② 被 ```json 包起来；③ **JSON 被截断**
 * 第 ③ 种不是特例 —— 推理模型（如 deepseek-flash）会把大半 token 花在
 * reasoning_content 上，正式输出经常在 detail 中途被 max_tokens 切断，
 * JSON.parse 必然失败。所以最后用正则把两个字段各自抠出来。
 */
export function parseDigestOutput(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  const cleaned = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();

  const pick = (obj) => {
    const summary = String(obj?.summary || '').trim();
    const detail = String(obj?.detail || '').trim();
    if (!summary && !detail) return null;
    return { summary: summary || detail.slice(0, 120), detail: detail || summary };
  };

  // ①② 直接解析
  try { return pick(JSON.parse(cleaned)); } catch { /* 继续 */ }
  const brace = /\{[\s\S]*\}/.exec(cleaned);
  if (brace) { try { return pick(JSON.parse(brace[0])); } catch { /* 继续 */ } }

  // ③ 截断兜底：把两个字段分别抠出来（缺结尾引号也能取到）
  const grab = (key) => {
    const m = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`).exec(cleaned);
    if (!m) return '';
    return m[1]
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
      .trim();
  };
  const summary = grab('summary');
  const detail = grab('detail');
  if (!summary && !detail) return null;
  return { summary: summary || detail.slice(0, 120), detail: detail || summary };
}

/* ────────────────────────── 服务 ────────────────────────── */

export function createDailyDigestService({
  db,
  fetchImpl = fetch,
  logger = console,
  now = () => new Date()
} = {}) {
  if (!db) throw new Error('createDailyDigestService 需要 db');

  /**
   * 角色当前用的聊天渠道。
   * 分四级降级，避免"角色配置的模型名已经失效"时整个功能直接瘫掉：
   *   ① 角色指定的 凭据 + 模型
   *   ② 同一个凭据下任意可用模型
   *   ③ 该用户任意启用的聊天凭据（取第一个模型）
   *   ④ 老表 model_configs
   */
  async function resolveChatConfig(userId, character) {
    const credentialId = Number(character?.chat_credential_id);
    const modelId = String(character?.chat_model_id || '').trim();

    if (Number.isInteger(credentialId) && credentialId > 0 && modelId) {
      const [rows] = await db.query(
        `
          SELECT c.id, c.name, c.provider_type, c.api_base, c.api_key, cm.model_id AS model
          FROM credentials c
          INNER JOIN credential_models cm ON cm.credential_id = c.id
          WHERE c.id = ? AND c.user_id = ? AND c.is_enabled = 1 AND cm.model_id = ?
          LIMIT 1
        `,
        [credentialId, userId, modelId]
      );
      if (rows[0]) return rows[0];
      logger.warn?.(`[daily-digest] 角色配置的模型 ${modelId} 在凭据 ${credentialId} 下不存在，降级处理`);
    }

    if (Number.isInteger(credentialId) && credentialId > 0) {
      const [rows] = await db.query(
        `
          SELECT c.id, c.name, c.provider_type, c.api_base, c.api_key, cm.model_id AS model
          FROM credentials c
          INNER JOIN credential_models cm ON cm.credential_id = c.id
          WHERE c.id = ? AND c.user_id = ? AND c.is_enabled = 1
          ORDER BY cm.id ASC
          LIMIT 1
        `,
        [credentialId, userId]
      );
      if (rows[0]) return rows[0];
    }

    const [anyEnabled] = await db.query(
      `
        SELECT c.id, c.name, c.provider_type, c.api_base, c.api_key, cm.model_id AS model
        FROM credentials c
        INNER JOIN credential_models cm ON cm.credential_id = c.id
        WHERE c.user_id = ? AND c.is_enabled = 1
          AND c.api_base IS NOT NULL AND c.api_base <> ''
          AND c.api_key IS NOT NULL AND c.api_key <> ''
        ORDER BY c.id ASC, cm.id ASC
        LIMIT 1
      `,
      [userId]
    );
    if (anyEnabled[0]) return anyEnabled[0];

    const [fallback] = await db.query(
      `
        SELECT id, name, provider_type, api_base, api_key, model
        FROM model_configs
        WHERE user_id = ? AND purpose = 'chat' AND is_active = 1
        ORDER BY id DESC LIMIT 1
      `,
      [userId]
    );
    return fallback[0] || null;
  }

  async function requestText(chatConfig, messages, maxTokens) {
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
        temperature: 0.3,
        max_tokens: maxTokens,
        messages
      })
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      const error = new Error(detail || `上游返回 ${response.status}`);
      error.status = response.status;
      throw error;
    }
    const data = await response.json();
    return data?.choices?.[0]?.message?.content || '';
  }

  /** 找出"有对话、但还没有纸条"的历史日子（不含今天 —— 今天还没过完）。 */
  async function findDaysNeedingDigest(userId, characterId, { limit = MAX_DIGESTS_PER_SCAN } = {}) {
    const todayStart = startOfLocalDay(now());
    const floor = new Date(todayStart);
    floor.setDate(floor.getDate() - LOOKBACK_DAYS);
    const [rows] = await db.query(
      `
        SELECT DATE(m.created_at) AS day, COUNT(*) AS cnt
        FROM messages m
        WHERE m.user_id = ? AND m.character_id = ? AND m.is_active = 1
          AND m.created_at >= ? AND m.created_at < ?
          AND NOT EXISTS (
            SELECT 1 FROM memories mem
            WHERE mem.user_id = m.user_id AND mem.character_id = m.character_id
              AND mem.memory_type = ? AND mem.is_deleted = 0
              AND DATE(mem.occurred_at) = DATE(m.created_at)
          )
        GROUP BY DATE(m.created_at)
        HAVING cnt >= ?
        ORDER BY day DESC
        LIMIT ?
      `,
      [userId, characterId, formatDbDateTime(floor), formatDbDateTime(todayStart), DIGEST_MEMORY_TYPE, MIN_MESSAGES_PER_DAY, limit]
    );
    return rows.map((r) => ({ dayKey: localDayKey(r.day), count: Number(r.cnt) }));
  }

  async function loadDayMessages(userId, characterId, dayKey) {
    const [rows] = await db.query(
      `
        SELECT role, content, created_at
        FROM messages
        WHERE user_id = ? AND character_id = ? AND is_active = 1
          AND DATE(created_at) = ?
        ORDER BY id ASC
      `,
      [userId, characterId, dayKey]
    );
    return rows;
  }

  /** 为某一天生成纸条并入库。dryRun=true 时只生成、不写库（用于预览/测试）。 */
  async function generateDigestForDay({ userId, characterId, character, dayKey, dryRun = false }) {
    const rows = await loadDayMessages(userId, characterId, dayKey);
    if (rows.length < MIN_MESSAGES_PER_DAY) return null;

    const chatConfig = await resolveChatConfig(userId, character);
    if (!chatConfig) {
      logger.warn?.('[daily-digest] 没有可用的聊天渠道，跳过');
      return null;
    }

    const transcript = buildTranscript(rows);
    if (!transcript.trim()) return null;

    const raw = await requestText(chatConfig, [
      { role: 'system', content: DIGEST_SYSTEM },
      { role: 'user', content: buildDigestUserPrompt(dayKey, transcript) }
    ], DIGEST_MAX_TOKENS);

    const parsed = parseDigestOutput(raw);
    if (!parsed) {
      logger.warn?.(`[daily-digest] ${dayKey} 输出无法解析，跳过`);
      return null;
    }

    if (dryRun) {
      return { dayKey, summary: parsed.summary, detail: parsed.detail, id: null, dryRun: true, messageCount: rows.length };
    }

    const occurredAt = formatDbDateTime(new Date(`${dayKey}T12:00:00`));
    const [result] = await db.query(
      `
        INSERT INTO memories
          (user_id, character_id, content, tag, category, memory_type, source_type,
           review_status, detected_reason, digest_detail, occurred_at, confidence, weight, is_important)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, 1.000, ?, 0)
      `,
      [
        userId, characterId,
        parsed.summary, '那天的纸条', '每日回顾',
        DIGEST_MEMORY_TYPE, DIGEST_SOURCE_TYPE,
        `由 ${rows.length} 条对话自动整理`,
        parsed.detail,
        occurredAt,
        40
      ]
    );
    logger.log?.(`[daily-digest] ${dayKey} 已生成纸条（${rows.length} 条对话，id=${result?.insertId ?? '?'}）`);
    return { dayKey, summary: parsed.summary, detail: parsed.detail, id: result?.insertId };
  }

  /** 扫一遍所有角色，把该整理的纸条补齐。 */
  async function runScan() {
    const [characters] = await db.query(
      `SELECT id, user_id, name, chat_credential_id, chat_model_id
       FROM characters WHERE is_deleted = 0`
    );
    const results = [];
    for (const character of characters) {
      const userId = Number(character.user_id);
      const characterId = Number(character.id);
      let days = [];
      try {
        days = await findDaysNeedingDigest(userId, characterId);
      } catch (error) {
        logger.error?.(`[daily-digest] 查询待整理日期失败：${error.message}`);
        continue;
      }
      for (const { dayKey } of days) {
        try {
          const made = await generateDigestForDay({ userId, characterId, character, dayKey });
          if (made) results.push({ characterId, ...made });
        } catch (error) {
          logger.error?.(`[daily-digest] ${dayKey} 生成失败：${error.message}`);
        }
      }
    }
    return results;
  }

  return {
    runScan, findDaysNeedingDigest, generateDigestForDay,
    loadDayMessages, resolveChatConfig,
    buildTranscript, parseDigestOutput
  };
}

export function startDailyDigestScheduler({
  setTimeoutImpl = setTimeout,
  setIntervalImpl = setInterval,
  service = null,
  ...serviceOptions
} = {}) {
  const digestService = service || createDailyDigestService(serviceOptions);
  const runSafely = () => digestService.runScan().catch((error) => {
    (serviceOptions.logger || console).error?.(`[daily-digest] 定时扫描失败：${error.message}`);
  });

  const firstTimer = setTimeoutImpl(runSafely, FIRST_SCAN_DELAY_MS);
  const interval = setIntervalImpl(runSafely, SCAN_INTERVAL_MS);
  firstTimer?.unref?.();
  interval?.unref?.();
  (serviceOptions.logger || console).log?.('[daily-digest] 定时器已启动：20 秒后首次扫描，之后每 15 分钟一次');

  return { ...digestService, firstTimer, interval };
}

export const DIGEST_CONSTANTS = {
  MIN_MESSAGES_PER_DAY,
  MAX_DIGESTS_PER_SCAN,
  LOOKBACK_DAYS,
  MAX_TRANSCRIPT_CHARS,
  SCAN_INTERVAL_MS,
  FIRST_SCAN_DELAY_MS
};
