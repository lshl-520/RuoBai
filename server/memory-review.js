export const CHAT_CANDIDATE_SOURCE_TYPE = 'chat_candidate';
export const CHAT_CONFIRMED_SOURCE_TYPE = 'chat_confirmed';

const REVIEW_STATUSES = new Set(['candidate', 'active', 'important']);
const CONFIRMED_REVIEW_STATUSES = new Set(['active', 'important']);

function normalizeSourceType(value, fallback = 'manual') {
  return String(value || '').trim() || fallback;
}

function normalizeReviewStatus(value, fallback = 'active') {
  const status = String(value || '').trim().toLowerCase();
  return REVIEW_STATUSES.has(status) ? status : fallback;
}

export function isUnconfirmedChatCandidate(memory = {}) {
  return normalizeSourceType(memory?.source_type) === CHAT_CANDIDATE_SOURCE_TYPE;
}

export function getEffectiveMemoryReviewStatus(memory = {}) {
  if (isUnconfirmedChatCandidate(memory)) return 'candidate';
  return normalizeReviewStatus(memory?.review_status);
}

export function isConfirmedMemory(memory = {}) {
  return Number(memory?.is_deleted || 0) !== 1
    && !isUnconfirmedChatCandidate(memory)
    && CONFIRMED_REVIEW_STATUSES.has(getEffectiveMemoryReviewStatus(memory));
}

export function resolveMemoryReviewUpdate(memory = {}, input = {}, fields = {}) {
  const hasReviewStatus = Object.hasOwn(input, 'review_status');
  const requestedReviewStatus = hasReviewStatus
    ? normalizeReviewStatus(input.review_status, '')
    : '';

  if (isUnconfirmedChatCandidate(memory)) {
    if (CONFIRMED_REVIEW_STATUSES.has(requestedReviewStatus)) {
      const isImportant = requestedReviewStatus === 'important' || Number(fields.is_important || 0) === 1;
      return {
        review_status: isImportant ? 'important' : 'active',
        source_type: CHAT_CONFIRMED_SOURCE_TYPE,
        is_important: isImportant ? 1 : 0,
      };
    }

    return {
      review_status: 'candidate',
      source_type: CHAT_CANDIDATE_SOURCE_TYPE,
      is_important: 0,
    };
  }

  const isImportant = Number(fields.is_important || 0) === 1;
  return {
    review_status: requestedReviewStatus || (isImportant ? 'important' : getEffectiveMemoryReviewStatus(memory)),
    source_type: normalizeSourceType(memory?.source_type),
    is_important: isImportant ? 1 : 0,
  };
}
