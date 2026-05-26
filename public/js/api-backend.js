const API_BASE = globalThis.__API_BASE || '';

const backendRoleIdByKey = new Map();
const backendRoleKeyById = new Map();

function apiUrl(path) {
  return `${API_BASE}${path}`;
}

function buildHeaders(headers = {}, hasJsonBody = false) {
  const nextHeaders = { ...headers };
  if (hasJsonBody && !nextHeaders['Content-Type']) {
    nextHeaders['Content-Type'] = 'application/json';
  }
  return nextHeaders;
}

function getDetailFromPayload(payload) {
  if (!payload) return '';
  if (typeof payload === 'string') return payload;
  return payload.error || payload.message || payload.detail || '';
}

async function parseResponseBody(res) {
  const text = await res.text().catch(() => '');
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function apiFetch(path, options = {}) {
  const { redirectOn401 = true, headers, body, ...rest } = options;
  const hasJsonBody = typeof body === 'string' && !headers?.['Content-Type'];
  const res = await fetch(apiUrl(path), {
    credentials: 'include',
    headers: buildHeaders(headers, hasJsonBody),
    body,
    ...rest
  });

  if (res.status === 401) {
    if (redirectOn401) {
      window.location.href = 'auth.html';
    }
    const error = new Error('Unauthorized');
    error.status = 401;
    throw error;
  }

  if (!res.ok) {
    const payload = await parseResponseBody(res).catch(() => null);
    const error = new Error(getDetailFromPayload(payload) || `Request failed: ${res.status}`);
    error.status = res.status;
    error.payload = payload;
    throw error;
  }

  return res;
}

async function apiJson(path, options = {}) {
  const res = await apiFetch(path, options);
  if (res.status === 204) return null;
  const text = await res.text().catch(() => '');
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function apiFetchAny(paths, options = {}) {
  let lastError = null;
  for (const path of Array.isArray(paths) ? paths : [paths]) {
    try {
      return await apiFetch(path, options);
    } catch (error) {
      if (error?.status === 404 || error?.status === 405) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }
  throw lastError || new Error('Request failed');
}

async function apiJsonAny(paths, options = {}) {
  const res = await apiFetchAny(paths, options);
  if (res.status === 204) return null;
  const text = await res.text().catch(() => '');
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function toArray(payload, key) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.[key])) return payload[key];
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

function firstObject(payload) {
  if (payload?.item && typeof payload.item === 'object' && !Array.isArray(payload.item)) return payload.item;
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) return payload;
  return null;
}

function formatChatTime(value) {
  if (!value) {
    return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function formatMemoryTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatPostTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function parseImageList(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [value];
  }
}

function extractStreamText(payload) {
  if (typeof payload === 'string') return payload;
  return (
    payload?.text ||
    payload?.reply ||
    payload?.content ||
    payload?.message?.content ||
    payload?.message ||
    payload?.choices?.[0]?.delta?.content ||
    payload?.choices?.[0]?.message?.content ||
    ''
  );
}

function frontendRoleKey(role) {
  return role?.char_key || role?.charKey || role?.key || (role?.id != null ? String(role.id) : '');
}

function rememberRoles(roles) {
  roles.forEach(role => {
    const key = frontendRoleKey(role);
    const backendId = role?.backendId ?? role?.id ?? role?.character_id ?? null;
    if (!key || backendId == null) return;
    backendRoleIdByKey.set(key, backendId);
    backendRoleKeyById.set(String(backendId), key);
  });
}

function resolveCharacterId(characterId) {
  if (characterId == null || characterId === '') return null;
  if (backendRoleIdByKey.has(characterId)) {
    return backendRoleIdByKey.get(characterId);
  }
  return characterId;
}

function resolveCharacterKey(characterId) {
  if (characterId == null || characterId === '') return null;
  if (backendRoleKeyById.has(String(characterId))) {
    return backendRoleKeyById.get(String(characterId));
  }
  return String(characterId);
}

function characterHeaders(characterId) {
  const resolved = resolveCharacterId(characterId);
  return resolved == null ? {} : { 'x-character-id': String(resolved) };
}

function normalizeRole(role) {
  const key = frontendRoleKey(role);
  const backendId = role?.id ?? role?.backendId ?? null;
  return {
    id: key,
    backendId,
    name: role?.name || key,
    tag: role?.tag || '恋人',
    avatar: role?.avatar || '',
    mood: Number(role?.mood ?? 80),
    intimacy: Number(role?.intimacy ?? 50),
    desc: role?.desc || role?.description || role?.persona || '',
    status: role?.status || (role?.is_active ? '在线' : '在线'),
    anniversary: role?.anniversary || null,
    personaSafe: role?.persona || role?.personaSafe || '',
    personaFull: role?.persona || role?.personaFull || role?.personaSafe || '',
    isActive: Boolean(role?.is_active ?? role?.isActive),
    isDeleted: Boolean(role?.is_deleted ?? role?.isDeleted),
    deleteAfter: role?.delete_after || role?.deleteAfter || null,
    createdAt: role?.created_at || role?.createdAt || ''
  };
}

function normalizeMessage(message) {
  const type = message?.message_type && message.message_type !== 'text' ? message.message_type : undefined;
  return {
    id: message?.id ?? null,
    from: message?.role === 'user' ? 'me' : 'her',
    text: message?.content || '',
    time: formatChatTime(message?.created_at || message?.createdAt),
    type,
    image: type === 'image' ? message?.media_url || message?.mediaUrl || '' : undefined,
    mediaUrl: message?.media_url || message?.mediaUrl || '',
    createdAt: message?.created_at || message?.createdAt || '',
    backendSaved: true
  };
}

function normalizeMemory(memory) {
  return {
    id: memory?.id ?? null,
    tag: memory?.tag || '普通记忆',
    text: memory?.content || memory?.text || '',
    time: formatMemoryTime(memory?.created_at || memory?.createdAt),
    cat: memory?.category || memory?.cat || '',
    image: memory?.image_url || memory?.image || ''
  };
}

function normalizePost(post) {
  return {
    id: post?.id ?? null,
    charId: resolveCharacterKey(post?.character_id || post?.characterId) || 'ruobai',
    time: formatPostTime(post?.created_at || post?.createdAt),
    tag: post?.tag || '动态',
    text: post?.content || post?.text || '',
    images: parseImageList(post?.image_url || post?.imageUrl || post?.images),
    likes: Number(post?.likes ?? 0),
    comments: Number(post?.comments_count ?? post?.comments ?? 0)
  };
}

function normalizeModelConfig(config) {
  return {
    id: config?.id ?? null,
    name: config?.name || '',
    providerType: config?.provider_type || config?.providerType || 'openai-compatible',
    apiBase: config?.api_base || config?.apiBase || '',
    apiKey: config?.api_key || config?.apiKey || '',
    model: config?.model || '',
    isActive: Boolean(config?.is_active ?? config?.isActive)
  };
}

function normalizeModelConfigStatus(payload) {
  if (!payload || typeof payload !== 'object') return null;
  return {
    hasAnyConfig: Boolean(payload.has_any_config ?? payload.hasAnyConfig),
    hasActiveConfig: Boolean(payload.has_active_config ?? payload.hasActiveConfig),
    hasTestConfig: Boolean(payload.has_test_config ?? payload.hasTestConfig),
    hasCustomConfig: Boolean(payload.has_custom_config ?? payload.hasCustomConfig),
    activeConfigIsTest: Boolean(payload.active_config_is_test ?? payload.activeConfigIsTest),
    needsOnboarding: Boolean(payload.needs_onboarding ?? payload.needsOnboarding),
    canUseTestConfig: Boolean(payload.can_use_test_config ?? payload.canUseTestConfig ?? true),
    onboardingMessage: payload.onboarding_message ?? payload.onboardingMessage ?? ''
  };
}

function normalizeSettings(settings, modelConfigs = []) {
  const activeModelConfig = modelConfigs.find(config => config.isActive) || modelConfigs[0] || null;
  const normalized = {
    theme: settings?.theme || 'purple',
    temperature: Number(settings?.temperature ?? 0.8),
    maxTokens: Number(settings?.max_tokens ?? settings?.maxTokens ?? 2048),
    ttsEnabled: Boolean(settings?.tts_enabled ?? settings?.ttsEnabled ?? false),
    ttsEngine: settings?.tts_engine || settings?.ttsEngine || 'browser',
    ttsVoiceURI: settings?.tts_voice_uri || settings?.ttsVoiceURI || '',
    qwenVoiceId: settings?.qwen_voice_id || settings?.qwenVoiceId || '',
    userName: settings?.user_name || settings?.userName || '',
    girlName: settings?.girl_name || settings?.girlName || '',
    userAvatar: settings?.user_avatar || settings?.userAvatar || '',
    girlAvatar: settings?.girl_avatar || settings?.girlAvatar || ''
  };

  const providerEntries = modelConfigs.map(config => {
    const providerId =
      config.providerType && ['dashscope', 'deepseek', 'grok', 'volcengine', 'custom'].includes(config.providerType)
        ? config.providerType
        : 'custom';
    return [
      providerId,
      {
        apiBase: config.apiBase,
        apiKey: config.apiKey,
        model: config.model
      }
    ];
  });

  if (providerEntries.length) {
    normalized.providers = Object.fromEntries(providerEntries);
  }

  if (activeModelConfig) {
    normalized.modelProvider =
      activeModelConfig.providerType && ['dashscope', 'deepseek', 'grok', 'volcengine', 'custom'].includes(activeModelConfig.providerType)
        ? activeModelConfig.providerType
        : 'custom';
  }

  return normalized;
}

function normalizeRelationship(payload) {
  if (!payload || typeof payload !== 'object') return null;
  return {
    affection: Number(payload.affection ?? 0),
    daysTogether: Number(payload.days_together ?? payload.daysTogether ?? 0),
    stage: payload.stage || ''
  };
}

function normalizeUsageStats(payload) {
  if (!payload || typeof payload !== 'object') return null;
  return {
    dailyChatUsed: Number(payload.daily_chat_used ?? payload.dailyChatUsed ?? 0),
    dailyLimit: Number(payload.daily_limit ?? payload.dailyLimit ?? 0),
    messageTotal: Number(payload.messages_total ?? payload.messageTotal ?? 0),
    memoryTotal: Number(payload.memories_total ?? payload.memoryTotal ?? 0),
    roleTotal: Number(payload.roles_total ?? payload.roleTotal ?? 0),
    postTotal: Number(payload.posts_total ?? payload.postTotal ?? 0),
    currentModelName: payload.current_model_name ?? payload.currentModelName ?? '',
    username: payload.username || '',
    registeredAt: payload.registered_at || payload.registeredAt || null
  };
}

async function readSseResponse(res, onChunk) {
  if (!res.body) {
    throw new Error('当前浏览器不支持流式响应。');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let answer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) continue;

      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;

      let chunk = '';
      try {
        chunk = extractStreamText(JSON.parse(data));
      } catch {
        chunk = data;
      }

      if (!chunk) continue;
      answer += chunk;
      onChunk?.(chunk);
    }
  }

  return answer;
}

export async function checkSession() {
  let res;
  try {
    res = await apiFetch('/api/auth/session', { redirectOn401: false });
  } catch (error) {
    if (error?.status === 401) {
      return { loggedIn: false, user: null };
    }
    throw error;
  }
  const payload = await parseResponseBody(res);
  if (!payload) return { loggedIn: false, user: null };
  if (payload.loggedIn === false) return { loggedIn: false, user: null };
  if (payload.loggedIn === true) {
    return { loggedIn: true, user: payload.user || null };
  }
  if (payload.user || payload.username || payload.id) {
    return { loggedIn: true, user: payload.user || payload };
  }
  return { loggedIn: false, user: null };
}

export async function login(username, password) {
  return apiJson('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  });
}

export async function register(username, password, inviteCode) {
  return apiJson('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, password, inviteCode })
  });
}

export async function logout() {
  return apiJson('/api/auth/logout', { method: 'POST' });
}

export async function updateSecurity(data) {
  return apiJson('/api/auth/password', {
    method: 'PATCH',
    body: JSON.stringify(data)
  });
}

export async function loadMessages(characterId, limit = 200) {
  const resolvedId = resolveCharacterId(characterId);
  const query = new URLSearchParams();
  if (resolvedId != null) query.set('character_id', String(resolvedId));
  if (limit != null) query.set('limit', String(limit));
  const payload = await apiJson(`/api/messages?${query.toString()}`);
  return toArray(payload, 'messages')
    .slice()
    .sort((a, b) => new Date(a.created_at || a.createdAt || 0) - new Date(b.created_at || b.createdAt || 0))
    .map(normalizeMessage);
}

export async function sendMessage(message, characterId) {
  const payload = await apiJson('/api/chat', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      ...characterHeaders(characterId)
    },
    body: JSON.stringify({
      content: message,
      character_id: resolveCharacterId(characterId),
      skip_server_persistence: true
    })
  });
  return {
    text: extractStreamText(payload),
    raw: payload
  };
}

export async function sendMessageStream(message, characterId, onChunk) {
  const res = await apiFetch('/api/chat', {
    method: 'POST',
    headers: {
      Accept: 'text/event-stream',
      ...characterHeaders(characterId)
    },
    body: JSON.stringify({
      content: message,
      character_id: resolveCharacterId(characterId),
      skip_server_persistence: true
    })
  });
  return readSseResponse(res, onChunk);
}

export async function saveChatMessage(message, characterId) {
  const content = message?.text || message?.content || '';
  if (!content && (message?.type || 'text') === 'text') {
    return null;
  }

  try {
    const payload = await apiJson('/api/chat/save', {
      method: 'POST',
      headers: characterHeaders(characterId),
      body: JSON.stringify({
        role: message?.from === 'me' ? 'user' : 'assistant',
        content,
        character_id: resolveCharacterId(characterId),
        message_type: message?.type || 'text',
        media_url: message?.image || message?.mediaUrl || null
      })
    });
    return payload || { ok: true };
  } catch (error) {
    return null;
  }
}

export async function deleteMessage(id) {
  return apiJson(`/api/messages/${id}`, {
    method: 'DELETE'
  });
}

export async function loadMemories(characterId) {
  const resolvedId = resolveCharacterId(characterId);
  const query = new URLSearchParams();
  if (resolvedId != null) query.set('character_id', String(resolvedId));
  const payload = await apiJson(`/api/memories?${query.toString()}`);
  return toArray(payload, 'memories').map(normalizeMemory);
}

export async function createMemory(content, characterId, tag, category = '') {
  const payload = await apiJson('/api/memories', {
    method: 'POST',
    headers: characterHeaders(characterId),
    body: JSON.stringify({
      content,
      character_id: resolveCharacterId(characterId),
      tag,
      category
    })
  });
  return firstObject(payload);
}

export async function updateMemory(id, data) {
  return apiJson(`/api/memories/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data)
  });
}

export async function deleteMemory(id) {
  return apiJson(`/api/memories/${id}`, { method: 'DELETE' });
}

export async function restoreMemory(id) {
  return apiJson(`/api/memories/${id}/restore`, { method: 'POST' });
}

export async function loadRoles() {
  const payload = await apiJson('/api/roles');
  const roles = toArray(payload, 'roles').map(normalizeRole);
  rememberRoles(roles);
  return roles;
}

export async function loadDeletedRoles() {
  const payload = await apiJson('/api/roles?include_deleted=1');
  const roles = toArray(payload, 'roles').map(normalizeRole);
  rememberRoles(roles);
  return roles.filter(role => role.isDeleted);
}

export async function createRole(data) {
  return apiJson('/api/roles', {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function updateRole(id, data) {
  return apiJson(`/api/roles/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data)
  });
}

export async function deleteRole(id) {
  return apiJson(`/api/roles/${id}`, { method: 'DELETE' });
}

export async function restoreRole(id) {
  return apiJson(`/api/roles/${id}/restore`, { method: 'POST' });
}

export async function switchRole(id) {
  return apiJson(`/api/roles/${id}/switch`, { method: 'POST' });
}

export async function loadModelConfigs() {
  const payload = await apiJson('/api/model-configs');
  const source = Array.isArray(payload?.configs)
    ? payload.configs
    : Array.isArray(payload?.items)
      ? payload.items
      : Array.isArray(payload)
        ? payload
        : [];
  return source
    .map(normalizeModelConfig);
}

export async function loadModelConfigStatus() {
  const payload = await apiJson('/api/model-configs/status');
  return normalizeModelConfigStatus(firstObject(payload));
}

export async function useTestModelConfig() {
  const payload = await apiJson('/api/model-configs/use-test-config', {
    method: 'POST'
  });
  return {
    item: payload?.item ? normalizeModelConfig(payload.item) : null,
    status: normalizeModelConfigStatus(payload?.status)
  };
}

export async function saveModelConfig(data) {
  const basePaths = ['/api/model-configs'];
  const isUpdate = data?.id != null;
  const paths = isUpdate ? basePaths.map(path => `${path}/${data.id}`) : basePaths;
  return apiJsonAny(paths, {
    method: isUpdate ? 'PATCH' : 'POST',
    body: JSON.stringify(data)
  });
}

export async function deleteModelConfig(id) {
  return apiJson(`/api/model-configs/${id}`, {
    method: 'DELETE'
  });
}

export async function useModelConfig(id) {
  return apiJsonAny([
    `/api/model-configs/${id}/use`,
    `/api/model-configs/${id}/activate`
  ], {
    method: 'POST'
  });
}

export async function testModelConfig(data) {
  return apiJson('/api/model-configs/test', {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

// ⚠️ 旧版动态系统，新功能请用 moments 系列。
// 保留是为了兼容前端旧调用，等前端切完再删。
export async function loadPosts() {
  const payload = await apiJson('/api/posts');
  return toArray(payload, 'posts').map(normalizePost);
}

export async function createPost(content, characterId, imageUrl = '') {
  return apiJsonAny(['/api/posts', '/api/moments'], {
    method: 'POST',
    headers: characterHeaders(characterId),
    body: JSON.stringify({
      content,
      character_id: resolveCharacterId(characterId),
      image_url: imageUrl
    })
  });
}

export async function likePost(id) {
  return apiJson(`/api/posts/${id}/like`, { method: 'POST' });
}

export async function unlikePost(id) {
  return apiJson(`/api/posts/${id}/like`, { method: 'DELETE' });
}

export async function loadPostComments(postId) {
  const payload = await apiJson(`/api/posts/${postId}/comments`);
  return toArray(payload, 'items');
}

export async function createPostComment(postId, content, characterId) {
  return apiJson(`/api/posts/${postId}/comments`, {
    method: 'POST',
    headers: characterHeaders(characterId),
    body: JSON.stringify({
      content,
      character_id: resolveCharacterId(characterId)
    })
  });
}

export async function loadSettings() {
  const payload = await apiJson('/api/settings');
  return firstObject(payload) || {};
}

export async function saveSettings(data) {
  return apiJsonAny(['/api/settings'], {
    method: 'PATCH',
    body: JSON.stringify(data)
  });
}

export async function loadRelationship() {
  const payload = await apiJson('/api/relationship');
  return normalizeRelationship(firstObject(payload));
}

export async function loadUsageStats() {
  const payload = await apiJson('/api/usage/stats');
  return normalizeUsageStats(firstObject(payload));
}

export async function loadStoreSnapshot() {
  return apiJson('/api/store/snapshot');
}

export async function saveStoreSnapshot(snapshot) {
  return apiJson('/api/store/snapshot', {
    method: 'PUT',
    body: JSON.stringify(snapshot)
  });
}

export async function initBackend() {
  const session = await checkSession();
  if (!session.loggedIn) return false;

  const roles = await loadRoles();
  const activeRole = roles.find(role => role.isActive) || roles[0] || null;

  const [settingsPayload, modelConfigs, posts, relationship, usageStats, modelConfigStatus] = await Promise.all([
    loadSettings(),
    loadModelConfigs().catch(() => []),
    loadPosts().catch(() => []),
    loadRelationship().catch(() => null),
    loadUsageStats().catch(() => null),
    loadModelConfigStatus().catch(() => null)
  ]);

  const settings = normalizeSettings(settingsPayload, modelConfigs);
  const messagePairs = await Promise.all(
    roles.map(async role => [role.id, await loadMessages(role.id).catch(() => [])])
  );
  const memoryPairs = await Promise.all(
    roles.map(async role => [role.id, await loadMemories(role.id).catch(() => [])])
  );

  return {
    user: session.user || null,
    roles,
    activeRoleId: activeRole?.id || null,
    messages: Object.fromEntries(messagePairs),
    memories: Object.fromEntries(memoryPairs),
    settings,
    posts,
    relationship,
    usageStats,
    modelConfigs,
    modelConfigStatus
  };
}
