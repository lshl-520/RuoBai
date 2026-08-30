import fs from 'node:fs';

const SHANGHAI_TIME_ZONE = 'Asia/Shanghai';
const IDLE_THRESHOLD_MS = 3 * 60 * 60 * 1000;
const ONLINE_THRESHOLD_MS = 10 * 60 * 1000;
const DEFAULT_SCAN_INTERVAL_MS = 10 * 60 * 1000;
const MODEL_TIMEOUT_MS = 20 * 1000;
const APPOINTMENT_EVENT_TYPE = 'appointment_follow_up';
const APPOINTMENT_SOURCE_TYPE = 'memory';
const APPOINTMENT_SOURCE_COOLDOWN_MINUTES = 30;

function buildProviderUrl(apiBase, endpoint) {
  const base = String(apiBase || '').trim().replace(/\/+$/, '');
  if (!base) return `/v1/${endpoint}`;
  if (new RegExp(`/${endpoint}$`, 'i').test(base)) return base;
  if (/\/v\d+(?:\/[^/]+)*$/i.test(base)) return `${base}/${endpoint}`;
  return `${base}/v1/${endpoint}`;
}

function getProactiveProtocol(modelConfig) {
  const model = String(modelConfig?.model || '').trim();
  const provider = String(modelConfig?.provider_type || '').trim();
  if (/^gpt-5(?:[.-]|$)/i.test(model)) return 'responses';
  if (provider === 'anthropic' || /^(?:claude)(?:[._-]|$)/i.test(model)) return 'anthropic-messages';
  return 'chat-completions';
}

function getChatCompletionsMaxTokens(modelConfig) {
  const model = String(modelConfig?.model || '').trim();
  return /deepseek|reasoner|reasoning|(?:^|[-_.])r1(?:[-_.]|$)/i.test(model) ? 512 : 120;
}

export function buildProactiveRequest({ modelConfig, systemPrompt, userPrompt }) {
  const protocol = getProactiveProtocol(modelConfig);
  const commonHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${modelConfig.api_key}`,
  };

  if (protocol === 'responses') {
    return {
      protocol,
      url: buildProviderUrl(modelConfig.api_base, 'responses'),
      options: {
        method: 'POST',
        headers: commonHeaders,
        body: JSON.stringify({
          model: modelConfig.model,
          stream: false,
          input: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        }),
      },
    };
  }

  if (protocol === 'anthropic-messages') {
    return {
      protocol,
      url: buildProviderUrl(modelConfig.api_base, 'messages'),
      options: {
        method: 'POST',
        headers: {
          ...commonHeaders,
          'x-api-key': modelConfig.api_key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: modelConfig.model,
          max_tokens: 256,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        }),
      },
    };
  }

  return {
    protocol,
    url: buildProviderUrl(modelConfig.api_base, 'chat/completions'),
    options: {
      method: 'POST',
      headers: commonHeaders,
      body: JSON.stringify({
        model: modelConfig.model,
        stream: false,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: getChatCompletionsMaxTokens(modelConfig),
      }),
    },
  };
}

function readTextContent(value) {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value
    .map((item) => typeof item === 'string' ? item : (item?.text || item?.content || ''))
    .filter(Boolean)
    .join('');
}

export function extractProactiveText(protocol, payload) {
  if (protocol === 'responses') {
    if (typeof payload?.output_text === 'string') return payload.output_text;
    return (Array.isArray(payload?.output) ? payload.output : [])
      .flatMap((item) => Array.isArray(item?.content) ? item.content : [])
      .filter((item) => item?.type === 'output_text' || item?.type === 'text')
      .map((item) => item.text || '')
      .join('');
  }
  if (protocol === 'anthropic-messages') {
    return readTextContent(payload?.content);
  }
  return readTextContent(payload?.choices?.[0]?.message?.content);
}

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
  if (candidate.proactiveEnabled !== false && typeof repository.findDueAppointment === 'function') {
    const appointment = await repository.findDueAppointment({
      userId: candidate.userId,
      characterId: candidate.characterId,
      now,
    });
    if (appointment) {
      const appointmentDate = parseDate(appointment.appointmentAt) || now;
      return {
        reason: 'appointment',
        eventType: APPOINTMENT_EVENT_TYPE,
        dateKey: toShanghaiParts(appointmentDate).dateKey,
        appointment,
      };
    }
  }

  if (
    candidate.isActive !== false &&
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
    candidate.isActive !== false &&
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
  let event = null;
  if (trigger.appointment && typeof repository.reserveAppointmentEvent === 'function') {
    event = await repository.reserveAppointmentEvent({
      candidate,
      appointment: trigger.appointment,
      dateKey: trigger.dateKey,
    });
    if (!event?.created) return { skipped: 1, created: 0 };
  }

  const recentMessages = await repository.loadRecentMessages(candidate);
  const rawContent = await generateMessage({
    candidate,
    reason: trigger.reason,
    appointment: trigger.appointment || null,
    recentMessages,
    now,
  });
  const content = normalizeGeneratedText(rawContent);
  if (!content) {
    if (event?.created) await repository.markEventGenerationFailed?.(event.id, '模型没有返回可用的回访内容');
    return { skipped: 1, created: 0 };
  }

  let saved;
  try {
    saved = await repository.saveAssistantMessage({ candidate, content });
    if (event?.created) {
      await repository.completeReservedEvent?.({ eventId: event.id, messageId: saved.id, content });
    } else {
      event = await repository.createEvent({
        userId: candidate.userId,
        characterId: candidate.characterId,
        eventType: trigger.eventType,
        dateKey: trigger.dateKey,
        messageId: saved.id,
        content,
        createdAt: now.toISOString(),
      });
    }
  } catch (error) {
    if (event?.created) {
      await repository.markEventGenerationFailed?.(event.id, `回访保存失败：${String(error?.message || error).slice(0, 180)}`);
      return { skipped: 1, created: 0 };
    }
    throw error;
  }

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

export function buildProactivePrompt({ candidate, reason, appointment = null, recentMessages }) {
  const recent = recentMessages
    .slice(-8)
    .map((item) => `${item.role === 'user' ? '用户' : candidate.characterName}：${item.content}`)
    .join('\n');
  const appointmentText = String(appointment?.content || '').replace(/\s+/g, ' ').trim().slice(0, 240);
  const reasonLine = reason === 'appointment'
    ? `现在到了你们之前约定的时间。请自然提起这件事，不催促、不指责；用户暂时忙时可以轻松改期。${appointmentText ? `约定内容：${appointmentText}` : ''}`
    : reason === 'bedtime'
      ? '现在是深夜 23:30 左右，用户还在线。请自然提醒她早点睡。'
      : '用户已经超过 3 小时没有主动聊天。请自然地发一句关心。';

  return [
    `你是${candidate.characterName || '小白'}，要像真实亲近的人一样说话。`,
    candidate.persona ? `人设：${candidate.persona}` : '',
    reasonLine,
    '只输出一句话，短一点，自然一点，不要解释规则；知道自己是 AI，但不要主动把这句话变成客服式身份声明。',
    reason === 'appointment' ? '如果最近聊天已经刚回应过同一件事，不要复制原句；回访要像隔了一段时间后的自然续话。' : '',
    recent ? `最近聊天：\n${recent}` : '',
  ].filter(Boolean).join('\n\n');
}

export async function generateProactiveMessage({ repository, candidate, reason, appointment = null, recentMessages, now, fetchImpl = fetch }) {
  const modelConfig = await repository.getModelConfig(candidate.userId, candidate.characterId);
  if (!modelConfig) return '';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);

  try {
    const request = buildProactiveRequest({
      modelConfig,
      systemPrompt: buildProactivePrompt({ candidate, reason, appointment, recentMessages, now }),
      userPrompt: reason === 'appointment' ? '现在自然地回应这次约定。' : '现在给用户发一句主动关心的话。',
    });
    const response = await fetchImpl(request.url, {
      ...request.options,
      signal: controller.signal,
    });

    if (!response.ok) return '';
    const payload = await response.json().catch(() => null);
    return extractProactiveText(request.protocol, payload);
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
            c.is_active AS character_is_active,
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
            c.is_active,
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
        isActive: Number(row.character_is_active) === 1,
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

    async getModelConfig(userId, characterId) {
      if (characterId) {
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
          [characterId, userId],
        );
        if (roleRows[0]) return roleRows[0];
      }

      const [rows] = await pool.query(
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
        [userId],
      );
      if (rows[0]) return rows[0];

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

    async findDueAppointment({ userId, characterId }) {
      const [rows] = await pool.query(
        `
          SELECT m.id, m.content, m.appointment_at
          FROM memories m
          WHERE m.user_id = ?
            AND m.character_id = ?
            AND m.memory_type = 'appointment'
            AND m.appointment_status = 'pending'
            AND m.appointment_at IS NOT NULL
            AND m.appointment_at <= NOW()
            AND (m.created_at IS NULL OR m.created_at <= DATE_SUB(NOW(), INTERVAL ${APPOINTMENT_SOURCE_COOLDOWN_MINUTES} MINUTE))
            AND m.is_deleted = 0
            AND COALESCE(m.review_status, 'active') IN ('active', 'important')
            AND COALESCE(m.source_type, 'manual') <> 'chat_candidate'
            AND NOT EXISTS (
              SELECT 1
              FROM proactive_events e
              WHERE e.user_id = m.user_id
                AND e.character_id = m.character_id
                AND e.event_type = ?
                AND e.source_type = ?
                AND e.source_id = m.id
            )
          ORDER BY m.appointment_at ASC, m.id ASC
          LIMIT 1
        `,
        [userId, characterId, APPOINTMENT_EVENT_TYPE, APPOINTMENT_SOURCE_TYPE],
      );
      if (!rows[0]) return null;
      return {
        id: rows[0].id,
        content: rows[0].content,
        appointmentAt: rows[0].appointment_at,
      };
    },

    async reserveAppointmentEvent({ candidate, appointment, dateKey }) {
      const [result] = await pool.query(
        `
          INSERT IGNORE INTO proactive_events
            (user_id, character_id, message_id, event_type, event_date, source_type, source_id, content, status, created_at)
          VALUES (?, ?, NULL, ?, ?, ?, ?, '', 'processing', NOW())
        `,
        [candidate.userId, candidate.characterId, APPOINTMENT_EVENT_TYPE, dateKey,
          APPOINTMENT_SOURCE_TYPE, appointment.id],
      );
      if (!result.affectedRows) return { created: false };
      return { id: result.insertId, created: true };
    },

    async completeReservedEvent({ eventId, messageId, content }) {
      await pool.query(
        `
          UPDATE proactive_events
          SET message_id = ?, content = ?, status = 'created', error_message = ''
          WHERE id = ? AND event_type = ?
        `,
        [messageId, content, eventId, APPOINTMENT_EVENT_TYPE],
      );
    },

    async markEventGenerationFailed(eventId, errorMessage) {
      await pool.query(
        "UPDATE proactive_events SET status = 'generation_failed', error_message = ? WHERE id = ?",
        [String(errorMessage || '').slice(0, 500), eventId],
      );
    },

    async saveAssistantMessage({ candidate, content }) {
      const [result] = await pool.query(
        `
          INSERT INTO messages
            (user_id, character_id, role, content, message_type, media_url, is_active, created_at)
          VALUES (?, ?, 'assistant', ?, 'proactive', NULL, 1, NOW())
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
