const DEFAULT_TARGET_CHARS = 900;
const DEFAULT_MAX_CHARS = 1200;
const PREVIEW_CHARS = 180;
const ROLE_LABELS = {
  user: '用户',
  assistant: null,
  system: '系统'
};

export function normalizeMergedMessage(raw) {
  const role = String(raw?.role || '').trim();
  const content = String(raw?.content || '').trim();
  const type = String(raw?.type || raw?.message_type || 'text').trim() || 'text';
  const date = String(raw?.date || raw?.created_at || '').trim();
  const source = String(raw?.source || '').trim();

  if (!role || !content) {
    return null;
  }

  return { role, content, type, date, source };
}

function getRoleLabel(role, characterName) {
  return ROLE_LABELS[role] ?? characterName;
}

function formatMessage(message, characterName) {
  const label = getRoleLabel(message.role, characterName);
  return `${label}：${message.content}`;
}

function getChunkType(messages) {
  const roles = [...new Set(messages.map(message => message.role))];
  if (roles.includes('user') && roles.includes('assistant')) {
    return 'turn_pair';
  }
  if (roles.length === 1 && roles[0] === 'user') {
    return 'user_only';
  }
  if (roles.length === 1 && roles[0] === 'assistant') {
    return 'assistant_only';
  }
  return 'mixed';
}

function splitText(text, maxChars) {
  if (text.length <= maxChars) {
    return [text];
  }

  const parts = [];
  let remaining = text;
  while (remaining.length > maxChars) {
    let cutAt = remaining.lastIndexOf('。', maxChars);
    if (cutAt < Math.floor(maxChars * 0.55)) {
      cutAt = remaining.lastIndexOf('\n', maxChars);
    }
    if (cutAt < Math.floor(maxChars * 0.55)) {
      cutAt = maxChars;
    }

    parts.push(remaining.slice(0, cutAt + 1).trim());
    remaining = remaining.slice(cutAt + 1).trim();
  }

  if (remaining) {
    parts.push(remaining);
  }

  return parts.filter(Boolean);
}

function buildChunk({ userId, characterId, characterName, messages, text, partIndex = 0 }) {
  const roles = [...new Set(messages.map(message => message.role))];
  const sources = [...new Set(messages.map(message => message.source).filter(Boolean))];
  const first = messages[0];
  const last = messages[messages.length - 1];

  return {
    id: `${userId}-${characterId}-${first.date || 'no-date'}-${partIndex}-${text.length}`
      .replace(/[^\w-]+/g, '-')
      .replace(/-+/g, '-'),
    user_id: userId,
    character_id: characterId,
    character_name: characterName,
    roles,
    start_date: first.date || '',
    end_date: last.date || first.date || '',
    source: sources.join('+') || '',
    chunk_index: 0,
    chunk_type: getChunkType(messages),
    text,
    content_preview: text.slice(0, PREVIEW_CHARS)
  };
}

function makeChunksFromGroup({ userId, characterId, characterName, group, maxChars }) {
  const text = group.map(message => formatMessage(message, characterName)).join('\n');
  return splitText(text, maxChars).map((part, partIndex) => buildChunk({
    userId,
    characterId,
    characterName,
    messages: group,
    text: part,
    partIndex
  }));
}

export function chunkCharacterMessages({
  userId,
  characterId,
  characterName,
  messages,
  targetChars = DEFAULT_TARGET_CHARS,
  maxChars = DEFAULT_MAX_CHARS
}) {
  if (!userId) {
    throw new Error('导入向量记忆必须显式传入 userId');
  }
  if (!characterId) {
    throw new Error(`角色 ${characterName || ''} 缺少 characterId`);
  }

  const normalized = (messages || []).map(normalizeMergedMessage).filter(Boolean);
  const chunks = [];
  let group = [];

  const flush = () => {
    if (!group.length) return;
    chunks.push(...makeChunksFromGroup({ userId, characterId, characterName, group, maxChars }));
    group = [];
  };

  for (const message of normalized) {
    const nextText = [...group, message].map(item => formatMessage(item, characterName)).join('\n');

    if (message.role === 'user' && group.some(item => item.role === 'user')) {
      flush();
    } else if (nextText.length > targetChars && group.length > 0) {
      flush();
    }

    group.push(message);
  }

  flush();

  return chunks.map((chunk, index) => ({
    ...chunk,
    chunk_index: index
  }));
}

export function chunkMergedChatExport({
  userId,
  exportData,
  characterMap,
  targetChars = DEFAULT_TARGET_CHARS,
  maxChars = DEFAULT_MAX_CHARS
}) {
  if (!userId) {
    throw new Error('导入向量记忆必须显式传入 userId');
  }
  if (!exportData || !Array.isArray(exportData.characters)) {
    throw new Error('合并记录格式不正确：缺少 characters 数组');
  }

  const chunks = [];
  const stats = {
    totalMessages: Number(exportData.total_messages || 0),
    characters: []
  };

  for (const character of exportData.characters) {
    const name = String(character?.name || '').trim();
    const characterId = characterMap?.get(name);
    if (!characterId) {
      throw new Error(`找不到角色映射：${name}`);
    }

    const characterChunks = chunkCharacterMessages({
      userId,
      characterId,
      characterName: name,
      messages: character.messages || [],
      targetChars,
      maxChars
    });

    chunks.push(...characterChunks);
    stats.characters.push({
      name,
      character_id: characterId,
      message_count: Number(character.message_count || character.messages?.length || 0),
      chunk_count: characterChunks.length
    });
  }

  return { chunks, stats };
}
