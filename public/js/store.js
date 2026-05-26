/* ====== RuoBai Store - State Management ====== */
import { saveChatMessage } from './api-backend.js';

const DEFAULT_PERSONA = '你是一个AI陪伴角色。请根据角色设定自然对话。';

export const modelProviders = [
  { id: 'dashscope', name: '阿里云(DashScope)', apiBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-max' },
  { id: 'deepseek', name: 'DeepSeek', apiBase: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { id: 'grok', name: 'Grok', apiBase: 'https://api.x.ai/v1', model: '' },
  { id: 'custom', name: '自定义(OpenAI兼容)', apiBase: '', model: '' }
];

const defaultProviderSettings = Object.fromEntries(modelProviders.map(provider => [
  provider.id,
  { apiBase: provider.apiBase, apiKey: '', model: provider.model }
]));

const defaultSettings = {
  theme: 'purple',
  modelProvider: 'dashscope',
  providers: defaultProviderSettings,
  temperature: 0.8,
  maxTokens: 2048,
  ttsEnabled: false,
  ttsEngine: 'browser',
  ttsVoiceURI: '',
  qwenVoiceId: 'qwen-tts-vd-bailian-voice-20260511143305690-0d51',
  ttsRate: 0.9
};

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

function getStoredUser() {
  try {
    const legacy = localStorage.getItem('rb-user');
    const saved = localStorage.getItem('rb-username');
    return saved || legacy || 'lshl';
  } catch {
    return 'lshl';
  }
}

export const characters = [
  { id:'test', name:'测试', tag:'其他', mood:50, intimacy:50, color:'#ccc', avatar:'', emoji:'🧪',
    desc:'空角色，用于测试。', status:'在线', anniversary:null,
    personaSafe: DEFAULT_PERSONA, personaFull: DEFAULT_PERSONA }
];

export const chatData = {};

export const memoryData = {};

export const posts = [];

export const state = {
  currentPage: 'chat',
  currentCharId: 'test',
  chatView: 'list',
  settings: { ...defaultSettings, ...readJson('rb-settings', {}) },
  modelConfigStatus: null,
  user: {
    username: getStoredUser(),
    nickname: '',
    avatar: ''
  }
};

state.settings.providers = {
  ...defaultProviderSettings,
  ...(state.settings.providers || {})
};

export function getChar(id) {
  return characters.find(c => c.id === id) || characters[0];
}

export function getCurrentChar() {
  return getChar(state.currentCharId);
}

export function setPage(page) {
  state.currentPage = page;
}

export function setCurrentChar(id) {
  state.currentCharId = id;
}

export function getPersona(charId = state.currentCharId) {
  const char = getChar(charId);
  return char?.personaFull || char?.personaSafe || DEFAULT_PERSONA;
}

export function getModelSettings() {
  const providerId = state.settings.modelProvider || 'dashscope';
  const provider = state.settings.providers[providerId] || defaultProviderSettings[providerId];
  return {
    providerId,
    providerName: modelProviders.find(p => p.id === providerId)?.name || providerId,
    apiBase: provider.apiBase,
    apiKey: provider.apiKey,
    model: provider.model,
    temperature: Number(state.settings.temperature ?? 0.8),
    maxTokens: Number(state.settings.maxTokens ?? 2048),
    providers: state.settings.providers
  };
}

export function saveSettings() {
  saveJson('rb-settings', state.settings);
  document.body?.setAttribute('data-theme', state.settings.theme || 'purple');
}

export function setSetting(key, value) {
  state.settings[key] = value;
  saveSettings();
}

export function setProviderSetting(providerId, key, value) {
  state.settings.providers[providerId] = {
    ...(state.settings.providers[providerId] || {}),
    [key]: value
  };
  saveSettings();
}

export function setUser(username) {
  state.user.username = username || 'guest';
  try {
    localStorage.setItem('rb-username', state.user.username);
    localStorage.setItem('rb-user', state.user.username);
  } catch {}
}

async function syncChatMessage(charId, message) {
  if (!backendEnabled || !message || message.pending || message.backendSaved) return;

  const hasPayload = Boolean(message.text || message.image || message.mediaUrl || message.type);
  if (!hasPayload) return;

  const result = await saveChatMessage(message, charId).catch(() => null);
  if (result) {
    message.backendSaved = true;
  }
}

export function appendChatMessage(charId, message) {
  if (!chatData[charId]) chatData[charId] = [];
  const nextMessage = {
    ...message,
    time: message.time || new Date().toLocaleTimeString('zh-CN', { hour:'2-digit', minute:'2-digit' })
  };
  chatData[charId].push(nextMessage);
  void syncChatMessage(charId, nextMessage);
}

export function updateLastChatMessage(charId, patch) {
  const list = chatData[charId] || [];
  const last = list[list.length - 1];
  if (last) {
    Object.assign(last, patch);
    if (!last.pending && !last.streaming) {
      void syncChatMessage(charId, last);
    }
  }
}

export function initTheme() {
  document.body?.setAttribute('data-theme', state.settings.theme || 'purple');
}

// === 后端持久化钩子 ===
let backendEnabled = false;

export function enableBackend() {
  backendEnabled = true;
}

export function isBackendEnabled() {
  return backendEnabled;
}
