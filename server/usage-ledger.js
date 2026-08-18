const PURPOSES = new Set([
  'chat',
  'inner_os',
  'image',
  'tts',
  'realtime',
  'other'
]);

const STATUSES = new Set(['success', 'failure']);
const COST_SOURCES = new Set(['provider', 'estimated', 'manual']);
const MAX_TEXT_LENGTH = 160;

function boundedText(value, fallback = '') {
  return String(value ?? fallback).trim().slice(0, MAX_TEXT_LENGTH);
}

function nullableInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.min(Math.trunc(number), 2147483647);
}

function nullableCost(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.min(number, 999999999999.999999);
}

export function classifyUsageError(errorOrStatus) {
  const status = Number(errorOrStatus?.status ?? errorOrStatus?.statusCode ?? errorOrStatus);
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'model_not_found';
  if (status === 429) return 'rate_limit';
  if (status >= 500 && status <= 599) return 'upstream';

  const message = String(errorOrStatus?.message || errorOrStatus || '').toLowerCase();
  if (/timeout|timed out|等待超过|超时/.test(message)) return 'timeout';
  if (/abort|aborted|中断|连接中断|network|fetch failed|econn/.test(message)) return 'network';
  if (/余额|balance|quota|额度|费用|billing|payment/.test(message)) return 'quota';
  if (/model|模型/.test(message)) return 'model_not_found';
  return 'unknown';
}

function usageNumber(...values) {
  for (const value of values) {
    const normalized = nullableInteger(value);
    if (normalized !== null) return normalized;
  }
  return null;
}

export function extractUsageFromPayload(payload = {}, protocol = 'chat-completions') {
  const usage = payload?.usage || payload?.response?.usage || {};
  if (!usage || typeof usage !== 'object') {
    return {
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      totalTokens: null,
      actualCost: null,
      costCurrency: null,
      costSource: null
    };
  }

  const inputTokens = usageNumber(usage.input_tokens, usage.prompt_tokens);
  const outputTokens = usageNumber(usage.output_tokens, usage.completion_tokens);
  const cacheReadTokens = usageNumber(
    usage.cache_read_input_tokens,
    usage.prompt_tokens_details?.cached_tokens,
    usage.input_tokens_details?.cached_tokens
  );
  const cacheWriteTokens = usageNumber(usage.cache_creation_input_tokens);
  const totalTokens = usageNumber(usage.total_tokens)
    ?? (inputTokens !== null || outputTokens !== null ? (inputTokens || 0) + (outputTokens || 0) : null);

  const actualCost = nullableCost(
    usage.cost ?? usage.total_cost ?? usage.totalCost ?? payload?.cost ?? payload?.total_cost
  );
  const costCurrency = actualCost === null
    ? null
    : boundedText(usage.currency ?? usage.cost_currency ?? payload?.currency ?? 'USD', 'USD').toUpperCase();
  const costSource = actualCost === null ? null : 'provider';

  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens,
    actualCost,
    costCurrency,
    costSource,
    protocol: boundedText(protocol)
  };
}

export function normalizeUsageEvent(input = {}) {
  const purpose = PURPOSES.has(String(input.purpose || '').trim())
    ? String(input.purpose).trim()
    : 'other';
  const status = STATUSES.has(String(input.status || '').trim())
    ? String(input.status).trim()
    : 'failure';
  const costSource = COST_SOURCES.has(String(input.costSource || '').trim())
    ? String(input.costSource).trim()
    : null;
  const duration = nullableInteger(input.durationMs);

  return {
    userId: nullableInteger(input.userId),
    characterId: nullableInteger(input.characterId),
    purpose,
    providerName: boundedText(input.providerName),
    providerType: boundedText(input.providerType),
    model: boundedText(input.model),
    inputTokens: nullableInteger(input.inputTokens),
    outputTokens: nullableInteger(input.outputTokens),
    cacheReadTokens: nullableInteger(input.cacheReadTokens),
    cacheWriteTokens: nullableInteger(input.cacheWriteTokens),
    totalTokens: nullableInteger(input.totalTokens),
    durationMs: duration,
    status,
    errorCategory: status === 'failure' ? boundedText(input.errorCategory || classifyUsageError(input.error)) : null,
    actualCost: nullableCost(input.actualCost),
    costCurrency: input.actualCost === null || input.actualCost === undefined ? null : boundedText(input.costCurrency || 'USD').toUpperCase(),
    costSource: input.actualCost === null || input.actualCost === undefined ? null : costSource,
    createdAt: input.createdAt || null
  };
}

export async function recordUsageEvent(db, input) {
  const event = normalizeUsageEvent(input);
  if (!event.userId) return null;

  const [result] = await db.query(
    `
      INSERT INTO usage_events
        (user_id, character_id, purpose, provider_name, provider_type, model,
         input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
         total_tokens, duration_ms, status, error_category, actual_cost,
         cost_currency, cost_source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, NOW()))
    `,
    [
      event.userId,
      event.characterId,
      event.purpose,
      event.providerName,
      event.providerType,
      event.model,
      event.inputTokens,
      event.outputTokens,
      event.cacheReadTokens,
      event.cacheWriteTokens,
      event.totalTokens,
      event.durationMs,
      event.status,
      event.errorCategory,
      event.actualCost,
      event.costCurrency,
      event.costSource,
      event.createdAt
    ]
  );
  return result?.insertId || null;
}

export async function listUsageEvents(db, userId, options = {}) {
  const days = Math.min(Math.max(Number.parseInt(options.days, 10) || 7, 1), 90);
  const requestedPurpose = String(options.purpose || '').trim();
  const purpose = PURPOSES.has(requestedPurpose) ? requestedPurpose : null;
  const limit = Math.min(Math.max(Number.parseInt(options.limit, 10) || 50, 1), 200);
  const conditions = ['user_id = ?', 'created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)'];
  const params = [userId, days];
  if (purpose) {
    conditions.push('purpose = ?');
    params.push(purpose);
  }
  params.push(limit);

  const [rows] = await db.query(
    `
      SELECT id, character_id, purpose, provider_name, provider_type, model,
             input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
             total_tokens, duration_ms, status, error_category, actual_cost,
             cost_currency, cost_source, created_at
      FROM usage_events
      WHERE ${conditions.join(' AND ')}
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `,
    params
  );

  return rows.map(row => ({
    id: Number(row.id),
    character_id: row.character_id === null ? null : Number(row.character_id),
    purpose: row.purpose,
    provider_name: row.provider_name || '',
    provider_type: row.provider_type || '',
    model: row.model || '',
    input_tokens: row.input_tokens === null ? null : Number(row.input_tokens),
    output_tokens: row.output_tokens === null ? null : Number(row.output_tokens),
    cache_read_tokens: row.cache_read_tokens === null ? null : Number(row.cache_read_tokens),
    cache_write_tokens: row.cache_write_tokens === null ? null : Number(row.cache_write_tokens),
    total_tokens: row.total_tokens === null ? null : Number(row.total_tokens),
    duration_ms: row.duration_ms === null ? null : Number(row.duration_ms),
    status: row.status,
    error_category: row.error_category || null,
    actual_cost: row.actual_cost === null ? null : Number(row.actual_cost),
    cost_currency: row.cost_currency || null,
    cost_source: row.cost_source || null,
    created_at: row.created_at || null
  }));
}

export { PURPOSES };
