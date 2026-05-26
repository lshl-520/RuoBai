export function buildSavedAssistantMessageUpdate(savedItem, fallback = {}) {
  if (!savedItem || savedItem.role !== 'assistant') {
    return null;
  }

  const id = Number(savedItem.id);
  if (!Number.isFinite(id) || id <= 0) {
    return null;
  }

  return {
    id,
    role: 'assistant',
    content: typeof savedItem.content === 'string' ? savedItem.content : String(fallback.content || ''),
    created_at: savedItem.created_at || fallback.created_at || null,
    message_type: savedItem.message_type || fallback.message_type || 'text',
    media_url: savedItem.media_url || fallback.media_url || null
  };
}

export function needsTtsButton(message) {
  return message?.role === 'assistant' && Number(message?.id) > 0;
}

export function isBrowserTtsResponse(data) {
  return Boolean(data?.success && data?.use_browser_tts && data?.text);
}

export function buildBrowserTtsOptions(data, voices = []) {
  const voice = voices.find(item => String(item?.lang || '').toLowerCase().startsWith('zh')) || null;
  return {
    text: String(data?.text || ''),
    lang: voice?.lang || 'zh-CN',
    rate: 0.9,
    pitch: 1.1,
    voice
  };
}
