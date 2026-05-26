export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function formatMemoryDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
}

function normalizeMemory(memory = {}) {
  return {
    id: Number(memory.id),
    content: String(memory.content || memory.text || '').trim(),
    tag: String(memory.tag || '普通记忆').trim() || '普通记忆',
    category: String(memory.category || '').trim(),
    isImportant: Boolean(memory.is_important || memory.isImportant),
    isDeleted: Boolean(memory.is_deleted || memory.isDeleted),
    createdAt: memory.created_at || memory.createdAt || '',
    dateText: formatMemoryDate(memory.created_at || memory.createdAt)
  };
}

export function buildMemoryViewModel(items = []) {
  return items
    .map(normalizeMemory)
    .filter(memory => Number.isFinite(memory.id) && memory.id > 0 && memory.content)
    .sort((a, b) => {
      if (a.isImportant !== b.isImportant) return a.isImportant ? -1 : 1;
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });
}

export function buildChatHistoryHref(role) {
  const id = encodeURIComponent(String(role?.id || ''));
  const name = encodeURIComponent(String(role?.name || ''));
  return `chat-room.html?id=${id}&name=${name}`;
}

export function buildMemoryPayload(form = {}) {
  const content = String(form.content || '').trim();
  const tag = String(form.tag || '').trim() || '普通记忆';
  const category = String(form.category || '').trim();
  const isImportant = Boolean(form.isImportant);

  return {
    content,
    tag,
    category,
    is_important: isImportant,
    ...(content ? {} : { error: '记忆内容不能为空' })
  };
}
