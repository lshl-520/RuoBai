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
