import {
  classifyConversationScene,
  deriveNextPersonaRuntime,
  normalizePersonaRuntime,
} from './persona-runtime.js';
import { isConfirmedMemory } from './memory-review.js';

const MODE_LABELS = Object.freeze({
  calm: '平静',
  bright: '轻快',
  gentle: '温柔',
  concerned: '担心',
  sleepy: '有点疲惫',
  playful: '调皮',
});

const SCENE_LABELS = Object.freeze({
  affection: '亲密回应',
  emotion: '情绪陪伴',
  praise: '被夸或被肯定',
  request: '解决问题',
  share: '生活分享',
  casual: '普通聊天',
});

const POSTURE_LABELS = Object.freeze({
  affection: '自然接住亲密感',
  emotion: '先倾听和安慰，再最多问一个轻问题',
  praise: '开心地接住，不写成长段感谢',
  request: '先把事情说清楚，必要时再澄清',
  share: '回应这件具体小事，保持轻松参与感',
  casual: '跟随用户节奏自然延续',
});

const LONG_TERM_TYPES = new Set([
  'core',
  'shared_experience',
  'appointment',
  'important_event',
]);

const RECENT_TYPES = new Set([
  'life',
  'emotional',
  'shared_experience',
  'appointment',
  'important_event',
]);

function normalizeText(value, maxLength = 240) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function parseSourceRefs(value) {
  if (Array.isArray(value)) return value.map(item => String(item || '').trim()).filter(Boolean);
  return String(value || '').split(',').map(item => item.trim()).filter(Boolean);
}

function formatMessage(message = {}) {
  const content = normalizeText(message.content, 260);
  if (!content) return null;
  return {
    role: ['user', 'assistant', 'system'].includes(message.role) ? message.role : 'user',
    content,
    messageType: String(message.message_type || 'text'),
    createdAt: message.created_at || null,
  };
}

function formatMemory(memory = {}) {
  const content = normalizeText(memory.content, 260);
  if (!content || !isConfirmedMemory(memory)) return null;
  return {
    id: memory.id ?? null,
    content,
    tag: normalizeText(memory.tag || memory.category || '记忆', 60),
    memoryType: String(memory.memory_type || 'life'),
    isImportant: Number(memory.is_important || 0) === 1,
    reviewStatus: String(memory.review_status || 'active'),
    occurredAt: memory.occurred_at || null,
    createdAt: memory.created_at || null,
    sourceRef: memory.source_type && memory.source_id
      ? `${memory.source_type}:${memory.source_id}`
      : null,
    appointmentStatus: memory.appointment_status || null,
  };
}

function formatLifeEvent(event = {}) {
  const title = normalizeText(event.title || event.content, 260);
  if (!title) return null;
  return {
    kind: 'recent_event',
    content: title,
    id: event.id ?? null,
    title,
    eventType: String(event.event_type || 'life'),
    status: String(event.status || 'active'),
    occurredAt: event.occurred_at || event.created_at || null,
    sourceRefs: parseSourceRefs(event.source_refs || event.sources),
    roleMomentRefs: parseSourceRefs(event.character_moment_refs || event.role_moment_refs),
  };
}

function uniqueByContent(items = []) {
  const seen = new Set();
  return items.filter(item => {
    const key = normalizeText(item?.content || item?.title || '').toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractKeywords(value) {
  const text = normalizeText(value, 500).toLowerCase();
  const chunks = text.match(/[a-z0-9]{2,}|[\u4e00-\u9fff]{2,}/giu) || [];
  const result = new Set(chunks);
  for (const chunk of chunks) {
    if (chunk.length > 4) {
      for (let index = 0; index <= chunk.length - 2; index += 1) {
        result.add(chunk.slice(index, index + 2));
      }
    }
  }
  return result;
}

function isRelatedToCurrent(content, candidate) {
  const current = extractKeywords(content);
  const target = extractKeywords(candidate);
  for (const keyword of current) {
    if (keyword.length >= 2 && target.has(keyword)) return true;
  }
  return false;
}

function focusForScene(scene, content) {
  const text = normalizeText(content, 80);
  const focus = {
    affection: '用户正在表达亲近或想念',
    emotion: '用户此刻的情绪和需要被接住的部分',
    praise: '用户对角色或当下互动的肯定',
    request: '用户当前想解决的事情',
    share: '用户刚刚分享的生活小事',
    casual: '当前对话话题',
  }[scene] || '当前对话话题';
  return text ? `${focus}：${text}` : focus;
}

function buildContinuity({ currentContent, recentLife, longTerm }) {
  const candidates = [
    ...recentLife.map(item => ({ ...item, kind: 'recent_event', content: item.title })),
    ...longTerm.map(item => ({ ...item, kind: 'confirmed_memory' })),
  ];
  const related = candidates.filter(item => isRelatedToCurrent(currentContent, item.content));
  return related.slice(0, 1);
}

export function buildMemoryLayers({ recentMessages = [], memories = [], recentLifeEvents = [] } = {}) {
  const confirmedMemories = memories.map(formatMemory).filter(Boolean);
  const recentEvents = recentLifeEvents.map(formatLifeEvent).filter(Boolean);
  const immediate = recentMessages.map(formatMessage).filter(Boolean).slice(-20);
  const recentMemoryItems = confirmedMemories.filter(item => RECENT_TYPES.has(item.memoryType));
  const longTerm = uniqueByContent(
    confirmedMemories.filter(item => LONG_TERM_TYPES.has(item.memoryType) || item.isImportant)
  ).slice(0, 8);
  const recentLife = uniqueByContent([
    ...recentEvents,
    ...recentMemoryItems,
  ]).slice(0, 8);

  return {
    immediate,
    recentLife,
    longTerm,
  };
}

export function buildCharacterContextSnapshot({
  character = {},
  personaRuntime = {},
  currentContent = '',
  messageType = 'text',
  recentMessages = [],
  memories = [],
  recentLifeEvents = [],
  now = new Date(),
} = {}) {
  const normalizedRuntime = normalizePersonaRuntime(personaRuntime);
  const scene = classifyConversationScene({ content: currentContent, messageType });
  const projectedRuntime = deriveNextPersonaRuntime(normalizedRuntime, {
    content: currentContent,
    messageType,
  });
  const layers = buildMemoryLayers({ recentMessages, memories, recentLifeEvents });
  const continuity = buildContinuity({
    currentContent,
    recentLife: layers.recentLife,
    longTerm: layers.longTerm,
  });

  return {
    version: 'ruobai-context-v2.0.3',
    generatedAt: now.toISOString(),
    character: {
      id: character.id ?? null,
      name: normalizeText(character.name || '陪伴角色', 80),
      persona: normalizeText(character.persona, 1200),
    },
    turn: {
      scene,
      sceneLabel: SCENE_LABELS[scene] || SCENE_LABELS.casual,
      posture: POSTURE_LABELS[scene] || POSTURE_LABELS.casual,
      focus: focusForScene(scene, currentContent),
      messageType: String(messageType || 'text'),
    },
    state: {
      mode: projectedRuntime.state.mode,
      modeLabel: MODE_LABELS[projectedRuntime.state.mode] || MODE_LABELS.calm,
      warmth: projectedRuntime.state.warmth,
      energy: projectedRuntime.state.energy,
      concern: projectedRuntime.state.concern,
      source: 'current_turn_projection',
    },
    relationship: {
      ...projectedRuntime.relationship,
    },
    layers,
    continuity,
  };
}

function formatState(snapshot) {
  const state = snapshot?.state || {};
  return `${state.modeLabel || '平静'}；温暖感 ${state.warmth ?? 65}/100，精力 ${state.energy ?? 60}/100，关心程度 ${state.concern ?? 20}/100`;
}

function formatRelation(snapshot) {
  const relationship = snapshot?.relationship || {};
  const rituals = Array.isArray(relationship.rituals) && relationship.rituals.length
    ? `；共同习惯：${relationship.rituals.join('、')}`
    : '';
  return `熟悉 ${relationship.familiarity ?? 50}/100，信任 ${relationship.trust ?? 50}/100，安全感 ${relationship.safety ?? 50}/100，默契 ${relationship.tacit ?? 50}/100${rituals}`;
}

function formatRecentItem(item) {
  if (!item) return '';
  if (item.kind === 'recent_event') {
    const status = item.status && item.status !== 'active' ? `，状态：${item.status}` : '';
    const roleMomentRefs = Array.isArray(item.roleMomentRefs) ? item.roleMomentRefs : [];
    const isCharacterMoment = roleMomentRefs.length > 0;
    return `${isCharacterMoment ? '- 角色最近发布的动态' : '- 近期生活'}：${item.title}${status}`;
  }
  const tag = item.tag ? `（${item.tag}）` : '';
  const status = item.appointmentStatus ? `，约定状态：${item.appointmentStatus}` : '';
  return `- 已确认记忆${tag}：${item.content}${status}`;
}

export function buildCharacterContextPrompt(snapshot, { consumer = 'chat' } = {}) {
  if (!snapshot) return '';
  const lines = [
    '【角色生命上下文 · 本轮只读快照】',
    `快照版本：${snapshot.version}`,
    `本轮场景：${snapshot.turn.sceneLabel}。${snapshot.turn.posture}`,
    `当前关注：${snapshot.turn.focus}`,
    `当前状态：${formatState(snapshot)}。状态只影响语气和节奏，不代表新的事实。`,
    `关系摘要：${formatRelation(snapshot)}。关系只按用户与当前角色理解，不能凭空升级。`,
  ];

  if (consumer === 'os') {
    const continuity = snapshot.continuity?.[0];
    if (continuity) {
      lines.push(`本轮最多可参考一条连续性事实：${formatRecentItem(continuity)}`);
    } else {
      lines.push('本轮没有足够可靠的连续性事实，不要为了显得深情而编造过去。');
    }
    return lines.join('\n');
  }

  const recent = snapshot.layers?.recentLife?.slice(0, 4).map(formatRecentItem).filter(Boolean) || [];
  const longTerm = snapshot.layers?.longTerm?.slice(0, 4).map(formatRecentItem).filter(Boolean) || [];
  if (recent.length) lines.push('近期生活线索（只在相关时使用）：', ...recent);
  if (longTerm.length) lines.push('已确认长期事实（只在相关时使用）：', ...longTerm);
  return lines.join('\n');
}

export async function loadRecentLifeEvents(db, { userId, characterId, limit = 8 } = {}) {
  if (!db?.query || !userId || !characterId) return [];
  try {
    const [rows] = await db.query(
      `
        SELECT e.id, e.title, e.event_type,
               CASE WHEN e.status = 'active' AND e.expires_at IS NOT NULL AND e.expires_at <= NOW() THEN 'expired' ELSE e.status END AS status,
               e.occurred_at, e.expires_at, e.created_at,
               valid_sources.source_refs,
               valid_sources.character_moment_refs
        FROM life_events e
        INNER JOIN (
          SELECT
            s.event_id,
            GROUP_CONCAT(
              CASE
                WHEN s.source_type = 'chat' AND EXISTS (
                  SELECT 1
                  FROM messages msg
                  WHERE msg.id = s.source_id
                    AND msg.user_id = s.user_id
                    AND msg.character_id = e2.character_id
                    AND msg.is_active = 1
                ) AND NOT EXISTS (
                  SELECT 1
                  FROM memories candidate_mem
                  WHERE candidate_mem.user_id = s.user_id
                    AND candidate_mem.character_id = e2.character_id
                    AND candidate_mem.source_type = 'chat_candidate'
                    AND candidate_mem.source_id = s.source_id
                ) THEN CONCAT(s.source_type, ':', s.source_id)
                WHEN s.source_type = 'moment' AND EXISTS (
                  SELECT 1
                  FROM moments m
                  WHERE m.id = s.source_id
                    AND m.user_id = s.user_id
                    AND m.is_deleted = 0
                    AND (
                      m.character_id = e2.character_id
                      OR EXISTS (
                        SELECT 1
                        FROM moment_audiences ma
                        WHERE ma.moment_id = m.id
                          AND ma.user_id = m.user_id
                          AND ma.character_id = e2.character_id
                      )
                    )
                ) THEN CONCAT(s.source_type, ':', s.source_id)
                WHEN s.source_type = 'comment' AND EXISTS (
                  SELECT 1
                  FROM moment_comments mc
                  INNER JOIN moments parent_moment
                    ON parent_moment.id = mc.moment_id
                   AND parent_moment.user_id = mc.user_id
                  WHERE mc.id = s.source_id
                    AND mc.user_id = s.user_id
                    AND parent_moment.is_deleted = 0
                    AND (
                      parent_moment.character_id = e2.character_id
                      OR EXISTS (
                        SELECT 1
                        FROM moment_audiences parent_audience
                        WHERE parent_audience.moment_id = parent_moment.id
                          AND parent_audience.user_id = parent_moment.user_id
                          AND parent_audience.character_id = e2.character_id
                      )
                    )
                ) THEN CONCAT(s.source_type, ':', s.source_id)
                WHEN s.source_type = 'memory' AND EXISTS (
                  SELECT 1
                  FROM memories mem
                  WHERE mem.id = s.source_id
                    AND mem.user_id = s.user_id
                    AND mem.character_id = e2.character_id
                    AND mem.is_deleted = 0
                    AND COALESCE(mem.review_status, 'active') IN ('active', 'important')
                    AND COALESCE(mem.source_type, 'manual') <> 'chat_candidate'
                ) THEN CONCAT(s.source_type, ':', s.source_id)
              END
              ORDER BY s.id SEPARATOR ','
            ) AS source_refs,
            GROUP_CONCAT(
              CASE
                WHEN s.source_type = 'moment' AND EXISTS (
                  SELECT 1
                  FROM moments role_moment
                  WHERE role_moment.id = s.source_id
                    AND role_moment.user_id = s.user_id
                    AND role_moment.character_id = e2.character_id
                    AND role_moment.is_deleted = 0
                ) THEN CONCAT(s.source_type, ':', s.source_id)
              END
              ORDER BY s.id SEPARATOR ','
            ) AS character_moment_refs
          FROM life_event_sources s
          INNER JOIN life_events e2
            ON e2.id = s.event_id
           AND e2.user_id = s.user_id
          WHERE s.user_id = ?
          GROUP BY s.event_id
        ) valid_sources ON valid_sources.event_id = e.id
        WHERE e.user_id = ? AND e.character_id = ?
          AND e.status NOT IN ('cancelled', 'expired')
          AND (e.expires_at IS NULL OR e.expires_at > NOW())
          AND valid_sources.source_refs IS NOT NULL
        ORDER BY COALESCE(e.occurred_at, e.created_at) DESC, e.id DESC
        LIMIT ?
      `,
      [userId, userId, characterId, Math.max(1, Math.min(Number(limit) || 8, 20))]
    );
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

export default {
  buildMemoryLayers,
  buildCharacterContextSnapshot,
  buildCharacterContextPrompt,
  loadRecentLifeEvents,
};
