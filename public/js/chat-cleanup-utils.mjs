export function isHistoricalErrorBubble(message) {
  if (message?.role !== 'assistant') {
    return false;
  }

  if (message?.message_type === 'image' && message?.media_url) {
    return false;
  }

  const content = String(message?.content || '').trim();
  if (!content) {
    return true;
  }

  if (looksLikeJsonError(content)) {
    return true;
  }

  const lower = content.toLowerCase();
  const technicalMarkers = [
    '"detail"',
    '"error"',
    'not found',
    'cannot get ',
    'cannot post ',
    'failed to fetch',
    'fetch failed',
    'is not defined',
    'referenceerror',
    'typeerror',
    'syntaxerror',
    'unexpected token',
    'econn',
    'etimedout',
    '/api/',
    '/v1/v1',
    'status code',
    'http 400',
    'http 401',
    'http 403',
    'http 404',
    'http 500',
    '404:',
    '500:'
  ];

  if (technicalMarkers.some(marker => lower.includes(marker))) {
    return true;
  }

  const mojibakeErrorMarkers = ['锛堝嚭', '澶辫触', '閿欒', 'ʧ败'];
  return mojibakeErrorMarkers.some(marker => content.includes(marker));
}

function looksLikeJsonError(content) {
  if (!content.startsWith('{') || !content.endsWith('}')) {
    return false;
  }

  try {
    const parsed = JSON.parse(content);
    return Boolean(parsed && (parsed.detail || parsed.error || parsed.message));
  } catch {
    return false;
  }
}
