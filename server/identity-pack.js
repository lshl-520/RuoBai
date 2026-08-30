import { isConfirmedMemory } from './memory-review.js';

const IDENTITY_PACK_VERSION = '1.1.0';

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  try { return typeof value === 'string' ? JSON.parse(value) : value; } catch { return fallback; }
}

function toNumberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toBoolean(value) {
  return value === true || value === 1 || value === '1';
}

export function buildIdentityPack({ character = {}, runtime = {}, memories = [] } = {}) {
  return {
    version: IDENTITY_PACK_VERSION,
    updated_at: new Date().toISOString(),
    identity: {
      name: String(character.name || '').trim(),
      persona: String(character.persona || '').trim(),
      tag: String(character.tag || '').trim(),
      speech_style: String(character.speech_style || 'natural'),
      portrait: {
        portrait_id: character.portrait_id ?? null,
        portrait_custom_url: character.portrait_custom_url || null,
        fixed_identity_rules: '年龄感、脸型、眼睛、发色、气质保持连续；衣服、地点、画风和拍摄方式可以变化。'
      },
      avatar: character.avatar || null
    },
    current: {
      mood: toNumberOrNull(character.mood),
      intimacy: toNumberOrNull(character.intimacy)
    },
    dynamic_life: {
      enabled: toBoolean(character.auto_moments_enabled),
      images_enabled: toBoolean(character.auto_moments_images_enabled),
      image_resolution: String(character.auto_moments_image_resolution || 'channel'),
      image_profile: parseJson(character.auto_moments_image_profile, null),
      templates: parseJson(character.auto_moments_templates, []),
      daily_min: toNumberOrNull(character.auto_moments_daily_min),
      daily_max: toNumberOrNull(character.auto_moments_daily_max),
      min_interval_hours: toNumberOrNull(character.auto_moments_min_interval_hours),
      response_enabled: toBoolean(character.moment_response_enabled)
    },
    relationship: parseJson(runtime.relationship_json || runtime.relationship, {}),
    state: parseJson(runtime.state_json || runtime.state, {}),
    memories: memories.filter(isConfirmedMemory).map(memory => ({
      id: memory.id,
      content: memory.content,
      tag: memory.tag,
      category: memory.category,
      memory_type: memory.memory_type,
      source_type: memory.source_type,
      source_id: memory.source_id,
      review_status: memory.review_status || 'active',
      confidence: Number(memory.confidence ?? 1),
      weight: Number(memory.weight ?? 50),
      is_important: Boolean(memory.is_important),
      appointment_at: memory.appointment_at || null,
      appointment_status: memory.appointment_status || null
    }))
  };
}

export { IDENTITY_PACK_VERSION };
