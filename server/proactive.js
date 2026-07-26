import fs from 'node:fs';

const SHANGHAI_TIME_ZONE = 'Asia/Shanghai';
const IDLE_THRESHOLD_MS = 3 * 60 * 60 * 1000;
const ONLINE_THRESHOLD_MS = 10 * 60 * 1000;
const DEFAULT_SCAN_INTERVAL_MS = 10 * 60 * 1000;
const MODEL_TIMEOUT_MS = 20 * 1000;

function parseDate(value) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toShanghaiParts(date) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: SHANGHAI_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function isBedtimeWindow(now) {
  const { hour, minute } = toShanghaiParts(now);
  return hour === 23 && minute >= 30 && minute < 40;
}

function isOnline(lastSeenAt, now) {
  const seen = parseDate(lastSeenAt);
  return Boolean(seen && now.getTime() - seen.getTime() <= ONLINE_THRESHOLD_MS);
}

function idleEnough(lastUserMessageAt, now) {
  const last = parseDate(lastUserMessageAt);
  return Boolean(last && now.getTime() - last.getTime() >= IDLE_THRESHOLD_MS);
}

function normalizeGeneratedText(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/^["“”'‘’]+|["“”'‘’]+$/g, '')
    .trim()
    .slice(0, 80);
}

async function chooseTrigger(repository, candidate, now) {
  const { dateKey } = toShanghaiParts(now);
  if (
    candidate.bedtimeEnabled !== false &&
    isBedtimeWindow(now) &&
    isOnline(candidate.lastSeenAt, now) &&
    !(await repository.hasEventAfter({
      userId: candidate.userId,
      characterId: candidate.characterId,
      eventType: 'bedtime',
      dateKey,
    }))
  ) {
    return { reason: 'bedtime', eventType: 'bedtime', dateKey };
  }

  if (
    candidate.proactiveEnabled !== false &&
    idleEnough(candidate.lastUserMessageAt, now) &&
    !(await repository.hasEventAfter({
      userId: candidate.userId,
      characterId: candidate.characterId,
      eventType: 'idle_check',
      since: candidate.lastUserMessageAt,
    }))
  ) {
    return { reason: 'idle', eventType: 'idle_check', dateKey: null };
  }

  return null;
}

function buildNotificationPayload({ candidate, content, messageId }) {
  return {
    tokens: candidate.tokens,
    title: candidate.characterName || '小白',
    body: content,
    data: {
      path: '/chat',
      character_id: String(candidate.characterId),
      message_id: String(messageId),
    },
  };
}

async function processCandidate({ repository, candidate, trigger, generateMessage, sendPush, now, logger }) {
  const recentMessages = await repository.loadRecentMessages(candidate);
  const rawContent = await generateMessage({ candidate, reason: trigger.reason, recentMessages, now });
  const content = normalizeGeneratedText(rawContent);
  if (!content) return { skipped: 1, created: 0 };

  const saved = await repository.saveAssistantMessage({ candidate, content });
  const event = await repository.createEvent({
    userId: candidate.userId,
    characterId: candidate.characterId,
    eventType: trigger.eventType,
    dateKey: trigger.dateKey,
    messageId: saved.id,
    content,
    createdAt: now.toISOString(),
  });

  const canNotify = typeof sendPush === 'function' && candidate.tokens?.length;
  if (!canNotify) {
    await repository.markEventStored(event.id);
    return { skipped: 0, created: 1, notified: 0 };
  }

  try {
    await sendPush(buildNotificationPayload({ candidate, content, messageId: saved.id }));
    await repository.markEventSent(event.id);
    return { skipped: 0, created: 1, notified: 1 };
  } catch (error) {
    logger.warn?.(`[proactive] 通知失败，但主动消息已保留：${error.message}`);
    await repository.markEventNotificationFailed(event.id, error.message);
  }

  return { skipped: 0, created: 1, notified: 0 };
}

export async function runProactiveScan({
  repository,
  generateMessage,
  sendPush,
  now = new Date(),
  logger = console,
} = {}) {
  if (!repository || !generateMessage) {
    throw new Error('runProactiveScan 缺少必要依赖');
  }

  const candidates = await repository.listCandidates();
  const summary = { scanned: candidates.length, created: 0, skipped: 0, notified: 0 };

  for (const candidate of candidates) {
    if (!candidate.characterId) {
      summary.skipped += 1;
      continue;
    }

    const trigger = await chooseTrigger(repository, candidate, now);
    if (!trigger) {
      summary.skipped += 1;
      continue;
    }

    const result = await processCandidate({
      repository,
      candidate,
      trigger,
      generateMessage,
      sendPush,
      now,
      logger,
    });
    summary.created += result.created;
    summary.skipped += result.skipped;
    summary.notified += result.notified || 0;
  }

  return summary;
}

export function buildProactivePrompt({ candidate, reason, recentMessages }) {
  const recent = recentMessages
    .slice(-8)
    .map((item) => `${item.role === 'user' ? '用户' : candidate.characterName}：${item.content}`)
    .join('\n');
  const reasonLine = reason === 'bedtime'
    ? '现在是深夜 23:30 左右，用户还在线。请自然提醒她早点睡。'
    : '用户已经超过 3 小时没有主动聊天。请自然地发一句关心。';

  return [
    `你是${candidate.characterName || '小白'}，要像真实亲近的人一样说话。`,
    candidate.persona ? `人设：${candidate.persona}` : '',
    reasonLine,
    '只输出一句话，短一点，自然一点，不要解释规则，不要自称 AI。',
    recent ? `最近聊天：\n${recent}` : '',
  ].filter(Boolean).join('\n\n');
}

export async function generateProactiveMessage({ repository, candidate, reason, recentMessages, now, fetchImpl = fetch }) {
  const modelConfig = await repository.getModelConfig(candidate.userId);
  if (!modelConfig) return '';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);

  try {
    const response = await fetchImpl(`${String(modelConfig.api_base).replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${modelConfig.api_key}`,
      },
      body: JSON.stringify({
        model: modelConfig.model,
        stream: false,
        messages: [
          { role: 'system', content: buildProactivePrompt({ candidate, reason, recentMessages, now }) },
          { role: 'user', content: '现在给用户发一句主动关心的话。' },
        ],
      }),
    });

    if (!response.ok) return '';
    const payload = await response.json().catch(() => null);
    return payload?.choices?.[0]?.message?.content || '';
  } finally {
    clearTimeout(timer);
  }
}

export function createMysqlProactiveRepository(pool) {
  return {
    async listCandidates() {
      const [rows] = await pool.query(
        `
          SELECT
            u.id AS user_id,
            c.id AS character_id,
            c.name AS character_name,
            c.persona,
            GROUP_CONCAT(pd.fcm_token SEPARATOR '\n') AS fcm_tokens,
            MAX(pd.last_seen_at) AS last_seen_at,
            COALESCE(pp.proactive_enabled, 1) AS proactive_enabled,
            COALESCE(pp.bedtime_enabled, 1) AS bedtime_enabled,
            COALESCE(pp.quiet_night_enabled, 0) AS quiet_night_enabled,
            (
              SELECT MAX(m.created_at)
              FROM messages m
              WHERE m.user_id = u.id
                AND m.character_id = c.id
                AND m.role = 'user'
                AND m.is_active = 1
            ) AS last_user_message_at
          FROM users u
          INNER JOIN characters c
            ON c.user_id = u.id
           AND c.is_active = 1
           AND c.is_deleted = 0
          LEFT JOIN push_devices pd
            ON pd.user_id = u.id
           AND pd.enabled = 1
          LEFT JOIN push_preferences pp
            ON pp.user_id = u.id
          WHERE u.is_enabled = 1
          GROUP BY
            u.id,
            c.id,
            c.name,
            c.persona,
            pp.proactive_enabled,
            pp.bedtime_enabled,
            pp.quiet_night_enabled
        `,
      );

      return rows.map((row) => ({
        userId: row.user_id,
        characterId: row.character_id,
        characterName: row.character_name,
        persona: row.persona || '',
        tokens: String(row.fcm_tokens || '').split('\n').filter(Boolean).slice(0, 500),
        proactiveEnabled: Number(row.proactive_enabled) === 1,
        bedtimeEnabled: Number(row.bedtime_enabled) === 1,
        quietNightEnabled: Number(row.quiet_night_enabled) === 1,
        lastUserMessageAt: row.last_user_message_at,
        lastSeenAt: row.last_seen_at,
      }));
    },

    async loadRecentMessages(candidate) {
      const [rows] = await pool.query(
        `
          SELECT role, content
          FROM messages
          WHERE user_id = ?
            AND character_id = ?
            AND is_active = 1
          ORDER BY created_at DESC, id DESC
          LIMIT 8
        `,
        [candidate.userId, candidate.characterId],
      );
      return rows.reverse();
    },

    async getModelConfig(userId) {
      const [rows] = await pool.query(
        `
          SELECT c.api_base, c.api_key, ca.model_id AS model
          FROM capability_assignments ca
          INNER JOIN credentials c ON c.id = ca.credential_id
          WHERE ca.user_id = ?
            AND ca.capability = 'chat'
            AND ca.enabled = 1 AND c.is_enabled = 1
          ORDER BY ca.id DESC
          LIMIT 1
        `,
        [userId],
      );
      if (rows[0]) return rows[0];

      const [legacyRows] = await pool.query(
        `
          SELECT api_base, api_key, model
          FROM model_configs
          WHERE user_id = ?
            AND purpose = 'chat'
            AND is_active = 1
          ORDER BY id DESC
          LIMIT 1
        `,
        [userId],
      );
      return legacyRows[0] || null;
    },

    async hasEventAfter({ userId, characterId, eventType, since, dateKey }) {
      const dateFilter = dateKey ? 'AND event_date = ?' : 'AND created_at >= ?';
      const param = dateKey || since;
      const [rows] = await pool.query(
        `
          SELECT id
          FROM proactive_events
          WHERE user_id = ?
            AND character_id = ?
            AND event_type = ?
            ${dateFilter}
          LIMIT 1
        `,
        [userId, characterId, eventType, param],
      );
      return rows.length > 0;
    },

    async saveAssistantMessage({ candidate, content }) {
      const [result] = await pool.query(
        `
          INSERT INTO messages
            (user_id, character_id, role, content, message_type, media_url, is_active, created_at)
          VALUES (?, ?, 'assistant', ?, 'text', NULL, 1, NOW())
        `,
        [candidate.userId, candidate.characterId, content],
      );
      return { id: result.insertId, content };
    },

    async createEvent(event) {
      const [result] = await pool.query(
        `
          INSERT INTO proactive_events
            (user_id, character_id, message_id, event_type, event_date, content, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, 'created', NOW())
        `,
        [event.userId, event.characterId, event.messageId, event.eventType, event.dateKey, event.content],
      );
      return { id: result.insertId };
    },

    async markEventSent(eventId) {
      await pool.query(
        "UPDATE proactive_events SET status = 'sent', sent_at = NOW(), error_message = '' WHERE id = ?",
        [eventId],
      );
    },

    async markEventStored(eventId) {
      await pool.query(
        "UPDATE proactive_events SET status = 'stored', sent_at = NULL, error_message = '' WHERE id = ?",
        [eventId],
      );
    },

    async markEventNotificationFailed(eventId, errorMessage) {
      await pool.query(
        "UPDATE proactive_events SET status = 'notification_failed', error_message = ? WHERE id = ?",
        [String(errorMessage || '').slice(0, 500), eventId],
      );
    },
  };
}

export function createFcmSender({ admin, logger = console } = {}) {
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (!admin || !serviceAccountPath || !fs.existsSync(serviceAccountPath)) {
    return null;
  }

  if (!admin.apps?.length) {
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  }

  return async function sendPush({ tokens, title, body, data }) {
    const response = await admin.messaging().sendEachForMulticast({
      tokens,
      notification: { title, body },
      data,
      android: {
        priority: 'high',
        notification: {
          channelId: 'ruobai_proactive',
          clickAction: 'OPEN_CHAT',
        },
      },
    });

    if (response.failureCount > 0) {
      logger.warn?.(`[proactive] FCM 部分失败 ${response.failureCount}/${tokens.length}`);
    }
  };
}

export function startProactiveScheduler({ pool, sendPush, logger = console, fetchImpl = fetch } = {}) {
  const messagesEnabled = process.env.PROACTIVE_MESSAGES_ENABLED === 'true'
    || process.env.PROACTIVE_PUSH_ENABLED === 'true';
  if (!messagesEnabled) {
    logger.info?.('[proactive] 主动留言未启用');
    return { stop() {} };
  }

  const notificationSender = process.env.PROACTIVE_PUSH_ENABLED === 'true' ? sendPush : null;

  const repository = createMysqlProactiveRepository(pool);
  const run = () => runProactiveScan({
    repository,
    sendPush: notificationSender,
    logger,
    generateMessage: (args) => generateProactiveMessage({ repository, fetchImpl, ...args }),
  }).catch((error) => logger.error?.(`[proactive] 扫描失败：${error.message}`));

  const timer = setInterval(run, DEFAULT_SCAN_INTERVAL_MS);
  run();
  return { stop: () => clearInterval(timer) };
}
