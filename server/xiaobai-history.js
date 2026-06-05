function ensureIsoTimestamp(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error(`Invalid created_at value: ${value}`);
    }
    return value.toISOString();
  }

  const normalized = typeof value === 'string' ? value.trim().replace(' ', 'T') : String(value || '');
  const withZone = /(?:Z|[+-]\d{2}:\d{2})$/.test(normalized) ? normalized : `${normalized}Z`;
  const date = new Date(withZone);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid created_at value: ${value}`);
  }

  return date.toISOString();
}

export function normalizeMessage(message) {
  return {
    role: String(message.role || '').trim(),
    content: String(message.content || ''),
    message_type: message.message_type ? String(message.message_type) : 'text',
    media_url: message.media_url ?? null,
    created_at: ensureIsoTimestamp(message.created_at)
  };
}

export function buildMessageKey(message) {
  const normalized = normalizeMessage(message);
  return JSON.stringify([
    normalized.role,
    normalized.content,
    normalized.message_type,
    normalized.media_url,
    normalized.created_at
  ]);
}

export function mergeCanonicalMessages({ localMessages, baselineMessages }) {
  const canonical = [];
  const seen = new Set();

  for (const sourceMessage of localMessages) {
    const normalized = normalizeMessage(sourceMessage);
    const key = buildMessageKey(normalized);

    if (!seen.has(key)) {
      seen.add(key);
      canonical.push(normalized);
    }
  }

  let addedFromBaseline = 0;
  let skippedBaselineDuplicates = 0;

  for (const sourceMessage of baselineMessages) {
    const normalized = normalizeMessage(sourceMessage);
    const key = buildMessageKey(normalized);

    if (seen.has(key)) {
      skippedBaselineDuplicates += 1;
      continue;
    }

    seen.add(key);
    canonical.push(normalized);
    addedFromBaseline += 1;
  }

  canonical.sort((left, right) => {
    if (left.created_at === right.created_at) {
      return left.role.localeCompare(right.role) || left.content.localeCompare(right.content);
    }
    return left.created_at.localeCompare(right.created_at);
  });

  return {
    localCount: localMessages.length,
    baselineCount: baselineMessages.length,
    addedFromBaseline,
    skippedBaselineDuplicates,
    messages: canonical
  };
}

function toCalendarDay(isoTimestamp, timeZone) {
  if (!timeZone || timeZone === 'UTC') {
    return isoTimestamp.slice(0, 10);
  }

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });

  return formatter.format(new Date(isoTimestamp));
}

export function summarizeMessages(messages, { timeZone = 'UTC' } = {}) {
  const normalized = messages.map(normalizeMessage).sort((left, right) => left.created_at.localeCompare(right.created_at));
  const byRole = {};
  const byDayMap = new Map();

  for (const message of normalized) {
    byRole[message.role] = (byRole[message.role] || 0) + 1;
    const day = toCalendarDay(message.created_at, timeZone);
    byDayMap.set(day, (byDayMap.get(day) || 0) + 1);
  }

  return {
    total: normalized.length,
    first_created_at: normalized[0]?.created_at || null,
    last_created_at: normalized.at(-1)?.created_at || null,
    time_zone: timeZone,
    by_role: byRole,
    by_day: Array.from(byDayMap.entries()).map(([day, total]) => ({ day, total }))
  };
}

export function renderSummaryReport({
  summary,
  localCount,
  baselineCount,
  addedFromBaseline,
  skippedBaselineDuplicates
}) {
  const roleLines = Object.entries(summary.by_role)
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([role, total]) => `- ${role}: ${total}`);
  const dayLines = summary.by_day.map(item => `- ${item.day}: ${item.total}`);

  return [
    '# Xiaobai Canonical History Report',
    '',
    `- total_messages: ${summary.total}`,
    `- first_created_at: ${summary.first_created_at}`,
    `- last_created_at: ${summary.last_created_at}`,
    `- local_messages: ${localCount}`,
    `- baseline_messages: ${baselineCount}`,
    `- added_from_baseline: ${addedFromBaseline}`,
    `- skipped_baseline_duplicates: ${skippedBaselineDuplicates}`,
    '',
    '## By Role',
    ...roleLines,
    '',
    '## By Day',
    ...dayLines,
    ''
  ].join('\n');
}
