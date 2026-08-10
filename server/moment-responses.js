import { pool as defaultPool } from './db.js';
import { recordLifeEventSource } from './life-events.js';
import { buildProactiveRequest, extractProactiveText } from './proactive.js';

const EVENT_TYPE = 'moment_response';
const SOURCE_TYPE = 'moment';
const RESPONSE_COOLDOWN_MINUTES = 240;
const MAX_MOMENT_AGE_DAYS = 7;
const FIRST_SCAN_DELAY_MS = 30 * 1000;
const SCAN_INTERVAL_MS = 10 * 60 * 1000;
const MODEL_TIMEOUT_MS = 20 * 1000;
const MAX_COMMENT_LENGTH = 120;

function normalizeComment(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_COMMENT_LENGTH);
}

function stripCodeFence(value) {
  return String(value || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}

export function parseMomentResponsePlan(value) {
  const text = stripCodeFence(value);
  const jsonText = text.startsWith('{') && text.endsWith('}')
    ? text
    : text.match(/\{[\s\S]*\}/)?.[0];
  if (!jsonText) throw new Error('模型没有返回 JSON 决策');

  let payload;
  try {
    payload = JSON.parse(jsonText);
  } catch {
    throw new Error('模型返回的动态回应决策无法解析');
  }

  const action = String(payload?.action || '').trim().toLowerCase();
  if (action === 'skip') return { action: 'skip' };
  if (action !== 'comment') throw new Error('模型返回了未知的动态回应动作');

  const content = normalizeComment(payload?.content);
  if (!content) throw new Error('模型选择评论但没有提供内容');
  return { action: 'comment', content };
}

export function buildMomentResponsePrompt(candidate) {
  const name = String(candidate?.characterName || '她').trim() || '她';
  const persona = String(candidate?.persona || '').trim().slice(0, 1000);
  const momentContent = String(candidate?.momentContent || '').trim().slice(0, 1200);

  return [
    `你是${name}。用户刚刚明确把一条私人动态分享给你。`,
    persona ? `人设参考：${persona}` : '',
    '先判断这条动态是否真的需要回应。日常记录、情绪宣泄、内容太私密、没有自然可说的话，或容易显得机械陪伴时，选择 skip。',
    '只有确实有自然、具体、克制的回应时才选择 comment。评论只写 1 到 2 句中文，不超过 120 字；不要复述整条动态，不要提模型、系统、提示词或规则，不要制造内疚。',
    '只输出 JSON，不要 Markdown：不回应时 {"action":"skip"}；回应时 {"action":"comment","content":"评论正文"}。',
    `用户分享的动态：${momentContent || '（动态没有可用正文）'}`
  ].filter(Boolean).join('\n\n');
}

export async function generateMomentResponse({ modelConfig, candidate, fetchImpl = fetch }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);

  try {
    const request = buildProactiveRequest({
      modelConfig,
      systemPrompt: buildMomentResponsePrompt(candidate),
      userPrompt: '请只给出这条动态的 JSON 决策。'
    });
    const response = await fetchImpl(request.url, {
      ...request.options,
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`动态回应模型返回 ${response.status}`);

    const payload = await response.json().catch(() => null);
    const text = extractProactiveText(request.protocol, payload);
    return parseMomentResponsePlan(text);
  } finally {
    clearTimeout(timer);
  }
}

export function createMysqlMomentResponseRepository(pool) {
  return {
    async listCandidates() {
      const [rows] = await pool.query(
        `
          SELECT
            m.id AS moment_id,
            m.user_id,
            m.content AS moment_content,
            m.created_at AS moment_created_at,
            c.id AS character_id,
            c.name AS character_name,
            c.persona
          FROM moments m
          INNER JOIN moment_audiences ma
            ON ma.moment_id = m.id
           AND ma.user_id = m.user_id
          INNER JOIN characters c
            ON c.id = ma.character_id
           AND c.user_id = m.user_id
           AND c.is_deleted = 0
           AND c.moment_response_enabled = 1
          INNER JOIN users u
            ON u.id = m.user_id
           AND u.is_enabled = 1
          WHERE m.character_id IS NULL
            AND m.is_deleted = 0
            AND m.created_at >= DATE_SUB(NOW(), INTERVAL ${MAX_MOMENT_AGE_DAYS} DAY)
            AND NOT EXISTS (
              SELECT 1
              FROM proactive_events e
              WHERE e.user_id = m.user_id
                AND e.character_id = c.id
                AND e.event_type = ?
                AND e.source_type = ?
                AND e.source_id = m.id
            )
            AND NOT EXISTS (
              SELECT 1
              FROM proactive_events e
              WHERE e.user_id = m.user_id
                AND e.character_id = c.id
                AND e.event_type = ?
                AND e.created_at >= DATE_SUB(NOW(), INTERVAL ${RESPONSE_COOLDOWN_MINUTES} MINUTE)
            )
          ORDER BY m.created_at DESC, m.id DESC
          LIMIT 100
        `,
        [EVENT_TYPE, SOURCE_TYPE, EVENT_TYPE]
      );

      return rows.map(row => ({
        userId: Number(row.user_id),
        momentId: Number(row.moment_id),
        momentContent: String(row.moment_content || ''),
        momentCreatedAt: row.moment_created_at,
        characterId: Number(row.character_id),
        characterName: String(row.character_name || ''),
        persona: String(row.persona || '')
      }));
    },

    async getModelConfig(userId, characterId) {
      const [roleRows] = await pool.query(
        `
          SELECT c.api_base, c.api_key, c.provider_type, ch.chat_model_id AS model
          FROM characters ch
          INNER JOIN credentials c ON c.id = ch.chat_credential_id
          WHERE ch.id = ?
            AND ch.user_id = ?
            AND ch.is_deleted = 0
            AND ch.chat_model_id IS NOT NULL
            AND ch.chat_model_id <> ''
            AND c.is_enabled = 1
          LIMIT 1
        `,
        [characterId, userId]
      );
      if (roleRows[0]) return roleRows[0];

      const [capabilityRows] = await pool.query(
        `
          SELECT c.api_base, c.api_key, c.provider_type, ca.model_id AS model
          FROM capability_assignments ca
          INNER JOIN credentials c ON c.id = ca.credential_id
          WHERE ca.user_id = ?
            AND ca.capability = 'chat'
            AND ca.enabled = 1 AND c.is_enabled = 1
          ORDER BY ca.id DESC
          LIMIT 1
        `,
        [userId]
      );
      if (capabilityRows[0]) return capabilityRows[0];

      const [legacyRows] = await pool.query(
        `
          SELECT api_base, api_key, provider_type, model
          FROM model_configs
          WHERE user_id = ?
            AND purpose = 'chat'
            AND is_active = 1
          ORDER BY id DESC
          LIMIT 1
        `,
        [userId]
      );
      return legacyRows[0] || null;
    },

    async reserveEvent(candidate) {
      const [result] = await pool.query(
        `
          INSERT IGNORE INTO proactive_events
            (user_id, character_id, message_id, event_type, source_type, source_id, content, status, created_at)
          VALUES (?, ?, NULL, ?, ?, ?, '', 'processing', NOW())
        `,
        [candidate.userId, candidate.characterId, EVENT_TYPE, SOURCE_TYPE, candidate.momentId]
      );
      return result?.affectedRows ? { created: true, id: result.insertId } : { created: false };
    },

    async markEventSkipped(eventId) {
      await pool.query(
        "UPDATE proactive_events SET status = 'skipped', error_message = '' WHERE id = ? AND event_type = ?",
        [eventId, EVENT_TYPE]
      );
    },

    async markEventGenerationFailed(eventId, errorMessage) {
      await pool.query(
        "UPDATE proactive_events SET status = 'generation_failed', error_message = ? WHERE id = ? AND event_type = ?",
        [String(errorMessage || '').slice(0, 500), eventId, EVENT_TYPE]
      );
    },

    async saveCommentAndCompleteEvent({ eventId, candidate, content }) {
      const [commentResult] = await pool.query(
        `
          INSERT INTO moment_comments
            (moment_id, user_id, character_id, content, created_at)
          VALUES (?, ?, ?, ?, NOW())
        `,
        [candidate.momentId, candidate.userId, candidate.characterId, content]
      );
      await pool.query(
        `
          UPDATE proactive_events
          SET content = ?, status = 'created', error_message = ''
          WHERE id = ? AND event_type = ?
        `,
        [content, eventId, EVENT_TYPE]
      );
      return { id: commentResult.insertId, content };
    }
  };
}

export function createMomentResponseService({
  db = defaultPool,
  fetchImpl = fetch,
  repository = null,
  recordLifeEvent = recordLifeEventSource,
  logger = console
} = {}) {
  const responseRepository = repository || createMysqlMomentResponseRepository(db);

  async function processCandidate(candidate) {
    const modelConfig = await responseRepository.getModelConfig(candidate.userId, candidate.characterId);
    if (!modelConfig) return { characterId: candidate.characterId, momentId: candidate.momentId, status: 'skipped_no_chat_capability' };

    const event = await responseRepository.reserveEvent(candidate);
    if (!event.created) return { characterId: candidate.characterId, momentId: candidate.momentId, status: 'skipped_duplicate' };

    let plan;
    try {
      plan = await generateMomentResponse({ modelConfig, candidate, fetchImpl });
    } catch (error) {
      await responseRepository.markEventGenerationFailed(event.id, error.message);
      return { characterId: candidate.characterId, momentId: candidate.momentId, status: 'generation_failed' };
    }

    if (plan.action === 'skip') {
      await responseRepository.markEventSkipped(event.id);
      return { characterId: candidate.characterId, momentId: candidate.momentId, status: 'skipped_planner' };
    }

    try {
      const comment = await responseRepository.saveCommentAndCompleteEvent({
        eventId: event.id,
        candidate,
        content: plan.content
      });
      try {
        await recordLifeEvent(db, {
          userId: candidate.userId,
          characterId: candidate.characterId,
          sourceType: 'comment',
          sourceId: comment.id,
          title: `${candidate.momentContent} ${comment.content}`.trim(),
          eventType: 'life',
          relatedSourceType: SOURCE_TYPE,
          relatedSourceId: candidate.momentId
        });
      } catch (error) {
        logger.warn?.({
          code: 'MOMENT_RESPONSE_LIFE_EVENT_FAILED',
          characterId: candidate.characterId,
          momentId: candidate.momentId,
          reason: String(error?.message || error).slice(0, 180)
        });
      }
      return { characterId: candidate.characterId, momentId: candidate.momentId, commentId: comment.id, status: 'commented' };
    } catch (error) {
      await responseRepository.markEventGenerationFailed(event.id, `评论保存失败：${String(error?.message || error).slice(0, 180)}`);
      return { characterId: candidate.characterId, momentId: candidate.momentId, status: 'generation_failed' };
    }
  }

  async function runScan() {
    const candidates = await responseRepository.listCandidates();
    const processedCharacterIds = new Set();
    const results = [];

    for (const candidate of candidates) {
      if (!candidate.characterId || processedCharacterIds.has(candidate.characterId)) continue;
      processedCharacterIds.add(candidate.characterId);
      try {
        results.push(await processCandidate(candidate));
      } catch (error) {
        logger.error?.({
          code: 'MOMENT_RESPONSE_PROCESS_FAILED',
          characterId: candidate.characterId,
          momentId: candidate.momentId,
          reason: String(error?.message || error).slice(0, 180)
        });
        results.push({ characterId: candidate.characterId, momentId: candidate.momentId, status: 'generation_failed' });
      }
    }

    return {
      scanned: candidates.length,
      commented: results.filter(item => item.status === 'commented').length,
      skipped: results.filter(item => item.status.startsWith('skipped_')).length,
      failed: results.filter(item => item.status === 'generation_failed').length,
      results
    };
  }

  return { runScan, processCandidate };
}

export function startMomentResponseScheduler({
  pool = defaultPool,
  service = null,
  logger = console,
  setTimeoutImpl = setTimeout,
  setIntervalImpl = setInterval,
  ...serviceOptions
} = {}) {
  if (process.env.MOMENT_RESPONSES_ENABLED !== 'true') {
    logger.info?.('[moment-responses] 角色动态回应未启用');
    return { stop() {} };
  }

  const responseService = service || createMomentResponseService({ db: pool, logger, ...serviceOptions });
  let running = false;
  const runSafely = async () => {
    if (running) return;
    running = true;
    try {
      await responseService.runScan();
    } catch (error) {
      logger.error?.(`[moment-responses] 定时扫描失败：${error.message}`);
    } finally {
      running = false;
    }
  };

  const firstTimer = setTimeoutImpl(runSafely, FIRST_SCAN_DELAY_MS);
  const interval = setIntervalImpl(runSafely, SCAN_INTERVAL_MS);
  firstTimer?.unref?.();
  interval?.unref?.();
  logger.info?.('[moment-responses] 定时器已启动：30 秒后首次扫描，之后每 10 分钟检查一次');

  return {
    ...responseService,
    firstTimer,
    interval,
    stop() {
      clearTimeout(firstTimer);
      clearInterval(interval);
    }
  };
}
