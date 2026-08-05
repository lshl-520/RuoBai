function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function parseAppointmentDate(text, now = new Date()) {
  const match = text.match(/(?:(20\d{2})年)?\s*(\d{1,2})月(\d{1,2})[日号]/);
  if (!match) return null;
  const year = Number(match[1] || now.getFullYear());
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} 20:00:00`;
}

export function extractExplicitMemory(content, { now = new Date() } = {}) {
  const text = normalizeText(content);
  if (!text) return null;

  const hasAppointment = /(我们|咱们).{0,12}(约好|约定)|约好.{0,18}(一起|见面|看|吃|去)|一起.{0,16}(约好|记得)/u.test(text);
  const explicitlyRemember = /(你要|一定要|请|帮我)?记得/u.test(text);
  if (!hasAppointment && !explicitlyRemember) return null;

  const appointmentAt = hasAppointment ? parseAppointmentDate(text, now) : null;
  return {
    content: text,
    tag: hasAppointment ? '未来约定' : '明确记住',
    category: '聊天明确交代',
    memory_type: hasAppointment ? 'appointment' : 'important_event',
    source_type: 'chat',
    confidence: 0.95,
    weight: hasAppointment ? 88 : 78,
    appointment_at: appointmentAt,
    appointment_status: hasAppointment ? 'pending' : null,
    is_important: 1,
  };
}

export async function recordExplicitChatMemory(pool, { userId, characterId, messageId, content, now } = {}) {
  const extracted = extractExplicitMemory(content, { now });
  if (!extracted || !messageId) return null;

  try {
    const [existing] = await pool.query(
      `SELECT id FROM memories WHERE user_id = ? AND character_id = ? AND source_type = 'chat' AND source_id = ? LIMIT 1`,
      [userId, characterId, messageId],
    );
    if (existing[0]) return null;

    const [result] = await pool.query(
      `
        INSERT INTO memories
          (user_id, character_id, content, tag, category, memory_type, source_type, source_id, confidence, weight,
           appointment_at, appointment_status, is_important, is_deleted, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'chat', ?, ?, ?, ?, ?, ?, 0, NOW())
      `,
      [userId, characterId, extracted.content, extracted.tag, extracted.category, extracted.memory_type, messageId,
        extracted.confidence, extracted.weight, extracted.appointment_at, extracted.appointment_status, extracted.is_important],
    );
    return { id: result.insertId, ...extracted };
  } catch {
    return null;
  }
}

function extractCandidate(content) {
  const text = normalizeText(content);
  if (!text || text.length < 4 || text.length > 240) return null;
  if (/(?:记得|约好|约定)/u.test(text)) return null;

  const looksPersonal = /(?:我|我的|本人)(?:喜欢|爱|不喜欢|讨厌|习惯|怕|害怕|不想|想要|希望|是|叫|住|来自|在.{0,12}(?:上班|工作|值班))/u.test(text);
  if (!looksPersonal) return null;

  return {
    content: text,
    tag: '可能记忆',
    category: '聊天自动识别',
    memory_type: 'life',
    source_type: 'chat_candidate',
    confidence: 0.55,
    weight: 35,
    review_status: 'candidate',
    detected_reason: '从聊天中的个人偏好或长期信息表达中识别，先作为低优先级参考。',
    is_important: 0,
  };
}

export async function recordAutoMemoryCandidate(pool, { userId, characterId, messageId, content } = {}) {
  const extracted = extractCandidate(content);
  if (!extracted || !messageId) return null;

  try {
    const [existing] = await pool.query(
      `SELECT id FROM memories WHERE user_id = ? AND character_id = ? AND source_type = 'chat_candidate' AND source_id = ? LIMIT 1`,
      [userId, characterId, messageId],
    );
    if (existing[0]) return null;

    const [result] = await pool.query(
      `
        INSERT INTO memories
          (user_id, character_id, content, tag, category, memory_type, source_type, source_id,
           confidence, weight, review_status, detected_reason, is_important, is_deleted, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NOW())
      `,
      [userId, characterId, extracted.content, extracted.tag, extracted.category, extracted.memory_type,
        extracted.source_type, messageId, extracted.confidence, extracted.weight,
        extracted.review_status, extracted.detected_reason, extracted.is_important],
    );
    return { id: result.insertId, ...extracted };
  } catch {
    return null;
  }
}
