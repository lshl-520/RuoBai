import { toBoolean } from './helpers.js';

export const MEMORY_TYPES = new Set(['life', 'important_event', 'shared_experience', 'emotional', 'core', 'appointment']);
export const APPOINTMENT_STATUSES = new Set(['pending', 'completed', 'cancelled']);

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function normalizeDateTime(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/.test(text)) return null;
  return text.replace('T', ' ') + (text.length === 16 ? ':00' : '');
}

export function normalizeMemoryFields(input = {}, current = {}) {
  const hasType = Object.hasOwn(input, 'memory_type');
  const memoryType = hasType
    ? (MEMORY_TYPES.has(String(input.memory_type || '').trim()) ? String(input.memory_type).trim() : 'life')
    : (MEMORY_TYPES.has(current.memory_type) ? current.memory_type : 'life');
  const isAppointment = memoryType === 'appointment';
  const hasStatus = Object.hasOwn(input, 'appointment_status');
  const appointmentStatus = isAppointment
    ? (hasStatus && APPOINTMENT_STATUSES.has(String(input.appointment_status || '').trim())
      ? String(input.appointment_status).trim()
      : (APPOINTMENT_STATUSES.has(current.appointment_status) ? current.appointment_status : 'pending'))
    : null;

  return {
    memory_type: memoryType,
    source_type: String(current.source_type || 'manual').trim() || 'manual',
    source_id: current.source_id || null,
    occurred_at: Object.hasOwn(input, 'occurred_at') ? normalizeDateTime(input.occurred_at) : (current.occurred_at || null),
    confidence: Number(current.confidence) || 1,
    weight: clampInteger(input.weight, clampInteger(current.weight, 50, 0, 100), 0, 100),
    appointment_at: isAppointment
      ? (Object.hasOwn(input, 'appointment_at') ? normalizeDateTime(input.appointment_at) : (current.appointment_at || null))
      : null,
    appointment_status: appointmentStatus,
    is_important: (Object.hasOwn(input, 'is_important') ? toBoolean(input.is_important) : Boolean(current.is_important))
      || memoryType === 'core' || memoryType === 'appointment' ? 1 : 0,
  };
}

export function memoryTypeLabel(memoryType) {
  return ({
    life: '普通生活', important_event: '重要事件', shared_experience: '共同经历',
    emotional: '情感记忆', core: '核心记忆', appointment: '未来约定',
  })[memoryType] || '普通生活';
}
