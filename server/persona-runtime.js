const DEFAULT_STATE = Object.freeze({
  mode: 'calm',
  warmth: 65,
  energy: 60,
  concern: 20,
});

const DEFAULT_RELATIONSHIP = Object.freeze({
  familiarity: 50,
  trust: 50,
  safety: 50,
  tacit: 50,
  rituals: [],
});

function clamp(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : fallback;
}

function normalizeState(value = {}) {
  return {
    mode: ['calm', 'bright', 'gentle', 'concerned', 'sleepy', 'playful'].includes(value.mode)
      ? value.mode
      : DEFAULT_STATE.mode,
    warmth: clamp(value.warmth, DEFAULT_STATE.warmth),
    energy: clamp(value.energy, DEFAULT_STATE.energy),
    concern: clamp(value.concern, DEFAULT_STATE.concern),
  };
}

function normalizeRelationship(value = {}) {
  return {
    familiarity: clamp(value.familiarity, DEFAULT_RELATIONSHIP.familiarity),
    trust: clamp(value.trust, DEFAULT_RELATIONSHIP.trust),
    safety: clamp(value.safety, DEFAULT_RELATIONSHIP.safety),
    tacit: clamp(value.tacit, DEFAULT_RELATIONSHIP.tacit),
    rituals: Array.isArray(value.rituals)
      ? value.rituals.map(item => String(item || '').trim()).filter(Boolean).slice(0, 6)
      : [],
  };
}

function parseJson(value) {
  if (!value) return {};
  try {
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    return {};
  }
}

export function normalizePersonaRuntime(row = {}) {
  return {
    state: normalizeState(parseJson(row.state_json || row.state)),
    relationship: normalizeRelationship(parseJson(row.relationship_json || row.relationship)),
  };
}

export function classifyConversationScene({ content, messageType = 'text' } = {}) {
  const text = String(content || '').trim();
  if (messageType === 'image') return 'share';
  if (/^(宝|宝宝|在吗|在不在|想你|抱抱)[呀啊呢嘛？?！!~～]*$/u.test(text)) return 'affection';
  if (/(累|难受|委屈|失眠|想哭|烦|焦虑|不舒服|崩溃|害怕)/u.test(text)) return 'emotion';
  if (/(好看|漂亮|可爱|厉害|喜欢你|想你|真棒|夸)/u.test(text)) return 'praise';
  if (/(怎么|如何|帮我|能不能|可以吗|要不要|吗[？?]?$)/u.test(text)) return 'request';
  if (/(看看|今天|刚刚|吃了|买了|西瓜|照片|分享|发工资|旅行)/u.test(text)) return 'share';
  return 'casual';
}

export function buildReplyRhythm(scene, runtime = {}) {
  const energy = normalizeState(runtime.state).energy;
  const rules = {
    affection: '短回 1 句；先自然接住亲昵称呼，不展开说教，不强行追问。',
    emotion: '回 1 到 2 句；先接住情绪，再最多问一个具体而轻的后续问题。',
    praise: '回 1 句；自然开心或害羞地接住，不否定互动，也不写成长段感谢。',
    request: '回 1 到 3 句；先直接回应用户要解决的事，确有必要才问一个澄清问题。',
    share: '回 1 句；先回应这件具体小事，可带一点轻松参与感，不做机械分析。',
    casual: '回 1 到 2 句；跟随用户节奏，自然延续当前话题。',
  };
  const energyHint = energy < 35 ? '语气可以更安静、简短，但不要冷淡。' : '表情和语气自然偶发，不能机械堆砌。';
  return `${rules[scene] || rules.casual}${energyHint}`;
}

export function deriveNextPersonaRuntime(runtime, { content, messageType } = {}) {
  const normalized = normalizePersonaRuntime(runtime);
  const scene = classifyConversationScene({ content, messageType });
  const state = { ...normalized.state };

  if (scene === 'emotion') {
    state.mode = 'concerned';
    state.concern = Math.min(80, state.concern + 16);
    state.warmth = Math.min(90, state.warmth + 6);
  } else if (scene === 'praise' || scene === 'share') {
    state.mode = 'bright';
    state.energy = Math.min(82, state.energy + 5);
    state.concern = Math.max(10, state.concern - 5);
  } else if (scene === 'affection') {
    state.mode = 'gentle';
    state.warmth = Math.min(90, state.warmth + 4);
  } else {
    state.mode = 'calm';
    state.concern = Math.max(12, state.concern - 3);
  }

  return { state: normalizeState(state), relationship: normalized.relationship };
}

export function buildPersonaRuntimePrompt(runtime, { content, messageType } = {}) {
  const normalized = normalizePersonaRuntime(runtime);
  const scene = classifyConversationScene({ content, messageType });
  const relationship = normalized.relationship;
  const rituals = relationship.rituals.length ? `；共同习惯：${relationship.rituals.join('、')}` : '';

  return [
    '【本轮陪伴上下文】',
    `场景：${scene}。${buildReplyRhythm(scene, normalized)}`,
    `当前状态：${normalized.state.mode}；温暖感 ${normalized.state.warmth}/100，精力 ${normalized.state.energy}/100，关心程度 ${normalized.state.concern}/100。状态只影响语气和节奏，不能编造事实或拿情绪要求用户回应。`,
    `关系摘要：熟悉 ${relationship.familiarity}/100，信任 ${relationship.trust}/100，安全感 ${relationship.safety}/100，默契 ${relationship.tacit}/100${rituals}。`,
  ].join('\n');
}

export async function loadPersonaRuntime(pool, { userId, characterId } = {}) {
  try {
    const [rows] = await pool.query(
      `SELECT state_json, relationship_json FROM character_runtime_states WHERE user_id = ? AND character_id = ? LIMIT 1`,
      [userId, characterId],
    );
    return normalizePersonaRuntime(rows[0]);
  } catch {
    return normalizePersonaRuntime();
  }
}

export async function recordPersonaRuntimeTurn(pool, { userId, characterId, content, messageType } = {}) {
  const current = await loadPersonaRuntime(pool, { userId, characterId });
  const next = deriveNextPersonaRuntime(current, { content, messageType });
  try {
    await pool.query(
      `
        INSERT INTO character_runtime_states (user_id, character_id, state_json, relationship_json, updated_at)
        VALUES (?, ?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE state_json = VALUES(state_json), relationship_json = VALUES(relationship_json), updated_at = NOW()
      `,
      [userId, characterId, JSON.stringify(next.state), JSON.stringify(next.relationship)],
    );
  } catch {
    // The chat path must stay available while an older database is awaiting its startup migration.
  }
  return next;
}
