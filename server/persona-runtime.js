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
  /**
   * 2026/9/29 改（用户要求 + 实测证据）：
   * 旧版每一条都写死「回 1 句 / 回 1 到 2 句 / 回 1 到 3 句」，而这是
   * **所有角色都吃**的一份硬节奏。实测：连人设极短、没有任何规则、也没有小白 Core
   * 的干净角色，回复也很短 —— 说明压短她们的是这一层，不只是人设。
   * 部署方反馈：约束太紧时，她自己想说的整段会被硬截断。
   * 现在只保留"先接什么"的倾向，**句数与长短交给内容决定**。
   */
  const rules = {
    affection: '先自然接住亲昵称呼，不展开说教，不强行追问。',
    emotion: '先接住情绪，再最多问一个具体而轻的后续问题。',
    praise: '自然开心或害羞地接住，不否定互动，也不用写成长段感谢。',
    request: '先直接回应用户要解决的事，确有必要才问一个澄清问题。',
    share: '先回应这件具体小事，可带一点轻松参与感，不做机械分析。',
    casual: '跟随用户节奏，自然延续当前话题。',
  };
  const lengthHint = '条数和长短由内容决定，没有上限：内容少，一句就够；他要你细说、或你自己本来就想多说，就放开写，别为了"简短"把话憋回去。';
  const energyHint = energy < 35 ? '语气可以更安静一点，但不要冷淡。' : '表情和语气自然偶发，不能机械堆砌。';
  return `${rules[scene] || rules.casual}${lengthHint}${energyHint}`;
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

/**
 * 读取「小白自己的状态」（心情 / 惦记的事 / 上一轮话题）。
 *
 * 复用同一张 character_runtime_states 表，存在 state_json 的 `xiaobai` 键下，
 * 不新增数据库字段 —— 老库不需要迁移也能跑。
 * 拿不到就返回默认状态，聊天路径永不因它失败。
 *
 * ⚠️ 谁在写回整行 state_json，就必须把 `xiaobai` 键带回去（见 loadRuntimeRow）。
 */
export async function loadXiaobaiState(pool, { userId, characterId } = {}) {
  try {
    const [rows] = await pool.query(
      `SELECT state_json FROM character_runtime_states WHERE user_id = ? AND character_id = ? LIMIT 1`,
      [userId, characterId],
    );
    const parsed = parseJson(rows[0]?.state_json);
    return parsed && typeof parsed.xiaobai === 'object' && parsed.xiaobai !== null ? parsed.xiaobai : null;
  } catch {
    return null;
  }
}

/**
 * 读取整行运行态（含 relationship_json）。
 *
 * 为什么要有这个：state_json 里除了 persona runtime 自己的
 * mode/warmth/energy/concern，还住着「小白状态」等别的键；
 * 任何一处写回都必须带着别的键一起写，否则就是把别人的状态抹掉。
 */
async function loadRuntimeRow(pool, { userId, characterId } = {}) {
  try {
    const [rows] = await pool.query(
      `SELECT state_json, relationship_json FROM character_runtime_states WHERE user_id = ? AND character_id = ? LIMIT 1`,
      [userId, characterId],
    );
    return rows[0] || null;
  } catch {
    return null;
  }
}

export async function recordXiaobaiState(pool, { userId, characterId, xiaobaiState } = {}) {
  if (!xiaobaiState || typeof xiaobaiState !== 'object') return null;
  try {
    // ★ 2026/9/22 修复：不再用 SQL 侧的 JSON_SET / CAST(? AS JSON)。
    //   旧写法在 MySQL 5.7 能跑，但在本机的 MariaDB 会因 CAST AS JSON 语法
    //   直接报错 —— 而这里 catch 是静默的，于是本机"状态永远存不进去"，
    //   排查时看着像"她记不住事"。改成纯 JS 读-合并-写，两边行为一致。
    const row = await loadRuntimeRow(pool, { userId, characterId });
    const merged = parseJson(row?.state_json);
    merged.xiaobai = xiaobaiState;
    await pool.query(
      `
        INSERT INTO character_runtime_states (user_id, character_id, state_json, relationship_json, updated_at)
        VALUES (?, ?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE state_json = VALUES(state_json), relationship_json = VALUES(relationship_json), updated_at = NOW()
      `,
      [
        userId,
        characterId,
        JSON.stringify(merged),
        JSON.stringify(parseJson(row?.relationship_json)),
      ],
    );
  } catch {
    // 老库或权限不足时静默跳过：状态记不住，但聊天必须还能用。
  }
  return xiaobaiState;
}

/**
 * 点赞：只轻轻推一下她的短期状态。
 *
 * ★ 设计决定（2026/9/10 用户确认）：点赞**绝不调用模型**，零成本。
 *   它只是「他看过我、还喜欢」这件事留在她心里的一点余温 ——
 *   温暖感上去一点、精力上去一点，就这么简单。
 *
 * 注意：这里只动 persona runtime 自己的 mode/warmth/energy/concern，
 *       `xiaobai` 那份状态原样带回（见 loadRuntimeRow 的说明）。
 */
export async function recordMomentLikeSignal(pool, {
  userId,
  characterId,
  liked = true,
} = {}) {
  if (!userId || !characterId) return null;
  const row = await loadRuntimeRow(pool, { userId, characterId });
  const current = normalizePersonaRuntime(row || {});
  const state = { ...current.state };
  if (liked) {
    state.warmth = Math.min(95, state.warmth + 4);
    state.energy = Math.min(88, state.energy + 3);
    state.concern = Math.max(10, state.concern - 2);
    if (state.mode === 'calm' || state.mode === 'concerned') state.mode = 'bright';
  } else {
    // 取消点赞不惩罚她，只是把刚才那一点余温收回去。
    state.warmth = Math.max(20, state.warmth - 2);
  }
  const next = { state: normalizePersonaRuntime({ state }).state, relationship: current.relationship };
  try {
    const merged = { ...parseJson(row?.state_json), ...next.state };
    await pool.query(
      `
        INSERT INTO character_runtime_states (user_id, character_id, state_json, relationship_json, updated_at)
        VALUES (?, ?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE state_json = VALUES(state_json), relationship_json = VALUES(relationship_json), updated_at = NOW()
      `,
      [userId, characterId, JSON.stringify(merged), JSON.stringify(next.relationship)],
    );
  } catch {
    // 状态记不住不影响点赞本身。
  }
  return next;
}

export async function recordPersonaRuntimeTurn(pool, { userId, characterId, content, messageType } = {}) {
  const row = await loadRuntimeRow(pool, { userId, characterId });
  const current = normalizePersonaRuntime(row || {});
  const next = deriveNextPersonaRuntime(current, { content, messageType });
  try {
    // ★ 2026/9/22 修复（「她活不起来」的一个地基问题）：
    //   旧写法把 state_json 整个覆盖成 next.state，而 next.state 里没有
    //   `xiaobai` 这个键（normalizePersonaRuntime 只认 mode/warmth/energy/concern）。
    //   结果 chat.js 里紧跟着的 loadXiaobaiState() 永远读回默认值 ——
    //   她的「心情 / 上一轮惦记的事 / 上一轮话题」每一轮都被清零，
    //   所以线上 turnsSince 恒为 0、carriesOver 恒为空，等于每句话都失忆重来。
    //   现在只覆盖 persona runtime 自己那几个键，别的键原样带回。
    const merged = { ...parseJson(row?.state_json), ...next.state };
    await pool.query(
      `
        INSERT INTO character_runtime_states (user_id, character_id, state_json, relationship_json, updated_at)
        VALUES (?, ?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE state_json = VALUES(state_json), relationship_json = VALUES(relationship_json), updated_at = NOW()
      `,
      [userId, characterId, JSON.stringify(merged), JSON.stringify(next.relationship)],
    );
  } catch {
    // The chat path must stay available while an older database is awaiting its startup migration.
  }
  return next;
}
