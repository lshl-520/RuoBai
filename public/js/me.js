/* ====== Me / Profile Page ====== */
import { characters, state, setSetting, saveSettings } from './store.js';
import { avatar, icon, revealAttr, renderTopbar, renderMobileHeader } from './components.js';
import { getBrowserVoices, testSpeak } from './tts.js';
import { openDialog } from './dialog.js';
import {
  logout,
  loadModelConfigs,
  loadModelConfigStatus,
  saveModelConfig,
  useModelConfig,
  useTestModelConfig,
  deleteModelConfig,
  loadUsageStats,
  updateSecurity,
  saveSettings as saveBackendSettings
} from './api-backend.js';
import { markModelOnboardingDismissed, shouldShowModelOnboarding } from './model-onboarding.js';

const themes = [
  { id: 'purple', name: '紫' },
  { id: 'pink', name: '粉' },
  { id: 'blue', name: '蓝' },
  { id: 'green', name: '绿' }
];

const MODEL_PRESETS = [
  { id: 'deepseek', label: 'DeepSeek', name: 'DeepSeek', apiBase: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { id: 'grok', label: 'Grok', name: 'Grok', apiBase: 'https://api.x.ai/v1', model: '' },
  { id: 'custom', label: '自定义兼容接口', name: '', apiBase: '', model: '' }
];

let remoteLoaded = false;
let remoteLoading = false;

function formatDate(value) {
  if (!value) return '未知';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('zh-CN');
}

function activeModel() {
  return (state.modelConfigs || []).find(item => item.isActive) || null;
}

function activeModelLabel() {
  if (state.modelConfigStatus?.activeConfigIsTest && !state.modelConfigStatus?.hasCustomConfig) {
    return '测试配置';
  }
  return activeModel()?.name || '未配置模型';
}

function shouldRenderModelOnboarding() {
  return shouldShowModelOnboarding(state.modelConfigStatus, state.user.username);
}

function modelOnboardingCard(delay = 120) {
  if (!shouldRenderModelOnboarding()) {
    return '';
  }

  return `
    <div class="settings-block" ${revealAttr(delay)}>
      <div class="block-title">首次使用引导</div>
      <div style="padding: 6px 6px 2px;">
        <div style="font-family:var(--serif);font-size:18px;font-weight:600;color:var(--pink-900);margin-bottom:6px;">先配置模型，聊天才能开始</div>
        <div class="rb-help" style="margin-bottom:10px;">
          你可以直接填自己的 DeepSeek、Grok，或任意兼容 OpenAI 格式的接口。<br>
          最简单的顺序是：1. 选一种模型 2. 填 API key 3. 保存后回聊天页。
        </div>
        <div class="rb-inline-actions">
          <button class="btn-soft btn-small" data-model-onboarding="configure">立即配置我的模型</button>
          <button class="btn-ghost btn-small" data-model-onboarding="test">先用测试配置体验</button>
        </div>
      </div>
    </div>
  `;
}

function profileCard() {
  const u = state.user;
  return `
    <div class="me-profile">
      ${avatar({ name: u.nickname || u.username || '我', avatar: u.avatar, color: '#b0b6d4' }, 'xl', 'avatar-ring')}
      <div class="me-profile-info">
        <h2>${u.nickname || u.username || '若白用户'} <span class="pill">${activeModelLabel()}</span></h2>
        <div class="me-profile-sub">UID: ${u.username || 'guest'} · 注册于 ${formatDate(u.registeredAt)}</div>
        <div class="me-profile-id">${u.username === 'lshl' ? '私人管理员账号 · 完整人设' : '普通账号 · PG-13 安全人设'}</div>
      </div>
    </div>
  `;
}

function statsRow() {
  const u = state.user;
  return `
    <div class="me-stats">
      <div class="me-stat metric"><b>${u.dailyChatUsed || 0}/${u.dailyChatLimit || 200}</b><span>今日轮数</span><div class="progress"><span data-width="${Math.min(100, Math.round(((u.dailyChatUsed || 0) / Math.max(1, u.dailyChatLimit || 200)) * 100))}"></span></div></div>
      <div class="me-stat"><b>${u.totalMessages || 0}</b><span>消息</span></div>
      <div class="me-stat"><b>${u.totalMemories || 0}</b><span>记忆</span></div>
      <div class="me-stat"><b>${u.totalPosts || 0}</b><span>动态</span></div>
    </div>
  `;
}

function modelList() {
  const configs = state.modelConfigs || [];
  return `
    <div class="setting-block">
      <h4>${icon('model', 16)} 模型配置</h4>
      <div class="rb-inline-actions">
        <button class="btn-soft btn-small" data-model-action="create">新增模型</button>
      </div>
      <div class="me-model-list">
        ${configs.length ? configs.map(config => `
          <div class="me-model-item ${config.isActive ? 'active' : ''}">
            <div class="me-model-copy">
              <strong>${config.name}</strong>
              <span>${config.model} · ${config.apiBase}</span>
            </div>
            <div class="rb-inline-actions">
              ${config.isActive ? '<span class="pill">当前使用</span>' : `<button class="btn-soft btn-small" data-model-action="use" data-model-id="${config.id}">切换</button>`}
              <button class="btn-ghost btn-small" data-model-action="edit" data-model-id="${config.id}">编辑</button>
              <button class="btn-ghost btn-small danger-btn" data-model-action="delete" data-model-id="${config.id}">删除</button>
            </div>
          </div>
        `).join('') : '<div class="rb-help">还没有模型配置，先添加一个吧。</div>'}
      </div>
    </div>
  `;
}

function voiceForm() {
  const voices = getBrowserVoices();
  return `
    <div class="setting-block">
      <h4>${icon('volume', 16)} 语音设置</h4>
      <div class="setting-line">
        <div><b>TTS 总开关</b><span>默认关闭，开启后 AI 回复完成自动朗读</span></div>
        <button class="toggle ${state.settings.ttsEnabled ? 'on' : ''}" id="setting-tts-enabled" aria-label="TTS开关"></button>
      </div>
      <label>引擎选择</label>
      <select id="setting-tts-engine">
        <option value="browser" ${state.settings.ttsEngine === 'browser' ? 'selected' : ''}>浏览器语音</option>
        <option value="qwen" ${state.settings.ttsEngine === 'qwen' ? 'selected' : ''}>千问 TTS</option>
      </select>
      <label>浏览器音色</label>
      <select id="setting-browser-voice">
        <option value="">系统默认</option>
        ${voices.map(v => `<option value="${v.voiceURI}" ${v.voiceURI === state.settings.ttsVoiceURI ? 'selected' : ''}>${v.name} (${v.lang})</option>`).join('')}
      </select>
      <label>千问音色 ID</label>
      <input id="setting-qwen-voice" value="${state.settings.qwenVoiceId || ''}">
      <button class="btn-soft settings-test-voice" id="setting-test-voice">${icon('play', 14)} 试听</button>
    </div>
  `;
}

function themeForm() {
  return `
    <div class="setting-block">
      <h4>${icon('palette', 16)} 主题切换</h4>
      <div class="theme-picker">
        ${themes.map(t => `<button class="theme-dot theme-${t.id} ${t.id === state.settings.theme ? 'active' : ''}" data-theme="${t.id}" title="${t.name}"></button>`).join('')}
      </div>
    </div>
  `;
}

function securityPanel() {
  return `
    <aside class="right-panel">
      <section class="section-card glass settings-panel">
        <h3>设置中心</h3>
        <div class="setting-block compact">
          <h4>${icon('key', 16)} 账号安全</h4>
          <div class="setting-line">
            <div><b>用户名</b><span>${state.user.username || 'guest'}</span></div>
          </div>
          <div class="setting-line">
            <div><b>注册时间</b><span>${formatDate(state.user.registeredAt)}</span></div>
          </div>
          <div class="setting-line">
            <div><b>当前模型</b><span>${activeModelLabel()}</span></div>
          </div>
          <button class="btn-ghost" data-account-action="password">修改密码</button>
        </div>
        ${modelList()}
        ${voiceForm()}
        ${themeForm()}
        <button class="me-logout" id="logout-btn">${icon('logout', 18)} 退出登录</button>
      </section>
    </aside>
  `;
}

function activitySection() {
  return `
    <div class="me-section">
      <div class="me-section-title">${icon('roles', 18)} 当前角色</div>
      <div class="me-chars">
        ${characters.slice(0, 8).map(c => `
          <div class="me-char-item" data-char="${c.id}">
            ${avatar(c, 'lg')}
            <span>${c.name}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function summarySection() {
  const u = state.user;
  return `
    <div class="me-section">
      <div class="me-section-title">${icon('heart', 18)} 使用概览</div>
      <div class="achievement-grid">
        <div><b>${u.totalMessages || 0}</b><span>总消息</span></div>
        <div><b>${u.totalMemories || 0}</b><span>总记忆</span></div>
        <div><b>${characters.length}</b><span>角色数</span></div>
        <div><b>${u.currentModelName || '无'}</b><span>当前模型</span></div>
      </div>
    </div>
  `;
}

async function persistSettings() {
  saveSettings();
  await saveBackendSettings({
    theme: state.settings.theme,
    tts_enabled: state.settings.ttsEnabled,
    tts_engine: state.settings.ttsEngine,
    tts_voice_uri: state.settings.ttsVoiceURI,
    qwen_voice_id: state.settings.qwenVoiceId
  }).catch(() => null);
}

function applyPresetToEditor(root, presetId) {
  const preset = MODEL_PRESETS.find(item => item.id === presetId);
  if (!preset) return;

  root.querySelector('#model-name')?.setAttribute('value', preset.name);
  root.querySelector('#model-base')?.setAttribute('value', preset.apiBase);
  root.querySelector('#model-model')?.setAttribute('value', preset.model);

  const nameInput = root.querySelector('#model-name');
  const baseInput = root.querySelector('#model-base');
  const modelInput = root.querySelector('#model-model');
  if (nameInput) nameInput.value = preset.name;
  if (baseInput) baseInput.value = preset.apiBase;
  if (modelInput) modelInput.value = preset.model;

  root.querySelectorAll('[data-model-preset]').forEach(button => {
    button.classList.toggle('active', button.getAttribute('data-model-preset') === presetId);
  });
}

function openModelEditor(existing, renderCurrent, presetId = 'deepseek') {
  openDialog({
    title: existing ? '编辑模型' : '新增模型',
    content: `
      <div class="rb-form-grid">
        ${existing ? '' : `
          <div class="rb-field">
            <label>快捷预设</label>
            <div class="rb-inline-actions">
              ${MODEL_PRESETS.map(preset => `
                <button type="button" class="btn-ghost btn-small" data-model-preset="${preset.id}">${preset.label}</button>
              `).join('')}
            </div>
          </div>
        `}
        <div class="rb-field">
          <label for="model-name">名称</label>
          <input id="model-name" value="${existing?.name || ''}" placeholder="例如：DeepSeek">
        </div>
        <div class="rb-field">
          <label for="model-base">API 地址</label>
          <input id="model-base" value="${existing?.apiBase || ''}" placeholder="https://api.deepseek.com">
        </div>
        <div class="rb-field">
          <label for="model-key">API 密钥</label>
          <input id="model-key" type="password" value="" placeholder="${existing ? '不填写则保持原密钥' : 'sk-...'}">
        </div>
        <div class="rb-field">
          <label for="model-model">模型名</label>
          <input id="model-model" value="${existing?.model || ''}" placeholder="deepseek-chat">
        </div>
      </div>
    `,
    actions: [
      { label: '取消' },
      {
        label: existing ? '保存' : '添加',
        variant: 'primary',
        closeOnClick: false,
        onClick: async ({ root, close }) => {
          const name = root.querySelector('#model-name')?.value.trim() || '';
          const apiBase = root.querySelector('#model-base')?.value.trim() || '';
          const apiKey = root.querySelector('#model-key')?.value.trim() || '';
          const model = root.querySelector('#model-model')?.value.trim() || '';

          if (!name || !apiBase || !model || (!apiKey && !existing)) {
            window.alert('请把名称、API 地址、密钥和模型名填完整');
            return;
          }

          const payload = {
            id: existing?.id,
            name,
            provider_type: 'openai-compatible',
            api_base: apiBase,
            model
          };
          if (apiKey) payload.api_key = apiKey;
          await saveModelConfig(payload);

          remoteLoaded = false;
          await refreshRemoteData(renderCurrent, true);
          close();
        }
      }
    ],
    onMount: root => {
      if (existing) return;
      root.querySelectorAll('[data-model-preset]').forEach(button => {
        button.addEventListener('click', () => {
          applyPresetToEditor(root, button.getAttribute('data-model-preset'));
        });
      });
      applyPresetToEditor(root, presetId);
    }
  });
}

function openPasswordDialog(renderCurrent) {
  openDialog({
    title: '修改密码',
    content: `
      <div class="rb-form-grid">
        <div class="rb-field">
          <label for="password-current">当前密码</label>
          <input id="password-current" type="password">
        </div>
        <div class="rb-field">
          <label for="password-next">新密码</label>
          <input id="password-next" type="password">
        </div>
        <div class="rb-field">
          <label for="password-confirm">确认新密码</label>
          <input id="password-confirm" type="password">
        </div>
      </div>
    `,
    actions: [
      { label: '取消' },
      {
        label: '保存',
        variant: 'primary',
        closeOnClick: false,
        onClick: async ({ root, close }) => {
          const currentPassword = root.querySelector('#password-current')?.value || '';
          const newPassword = root.querySelector('#password-next')?.value || '';
          const confirmPassword = root.querySelector('#password-confirm')?.value || '';
          if (!currentPassword || !newPassword) {
            window.alert('请填写完整');
            return;
          }
          if (newPassword !== confirmPassword) {
            window.alert('两次新密码不一致');
            return;
          }
          await updateSecurity({
            current_password: currentPassword,
            new_password: newPassword
          });
          renderCurrent();
          close();
        }
      }
    ]
  });
}

async function refreshRemoteData(renderCurrent, force = false) {
  if (remoteLoading || (remoteLoaded && !force)) return;
  remoteLoading = true;
  try {
    const [configs, usage, modelConfigStatus] = await Promise.all([
      loadModelConfigs().catch(() => []),
      loadUsageStats().catch(() => null),
      loadModelConfigStatus().catch(() => null)
    ]);
    state.modelConfigs = configs;
    state.modelConfigStatus = modelConfigStatus;
    if (usage) {
      state.user.dailyChatUsed = usage.dailyChatUsed;
      state.user.dailyChatLimit = usage.dailyLimit;
      state.user.totalMessages = usage.messageTotal;
      state.user.totalMemories = usage.memoryTotal;
      state.user.totalPosts = usage.postTotal;
      state.user.currentModelName = usage.currentModelName;
      state.user.registeredAt = usage.registeredAt || state.user.registeredAt;
    }
    remoteLoaded = true;
    renderCurrent();
  } finally {
    remoteLoading = false;
  }
}

export function bindSettings(renderCurrent) {
  void refreshRemoteData(renderCurrent);

  document.querySelectorAll('[data-model-onboarding="configure"]').forEach(button => {
    button.addEventListener('click', () => openModelEditor(null, renderCurrent, 'deepseek'));
  });

  document.querySelectorAll('[data-model-onboarding="test"]').forEach(button => {
    button.addEventListener('click', async () => {
      await useTestModelConfig().catch(() => null);
      markModelOnboardingDismissed(state.user.username);
      remoteLoaded = false;
      await refreshRemoteData(renderCurrent, true);
    });
  });

  document.querySelectorAll('[data-model-action="create"]').forEach(button => {
    button.addEventListener('click', () => openModelEditor(null, renderCurrent, 'deepseek'));
  });

  document.querySelectorAll('[data-model-action="edit"]').forEach(button => {
    button.addEventListener('click', () => {
      const modelId = Number(button.getAttribute('data-model-id'));
      const current = (state.modelConfigs || []).find(item => item.id === modelId);
      if (current) openModelEditor(current, renderCurrent);
    });
  });

  document.querySelectorAll('[data-model-action="use"]').forEach(button => {
    button.addEventListener('click', async () => {
      const modelId = Number(button.getAttribute('data-model-id'));
      await useModelConfig(modelId).catch(() => null);
      remoteLoaded = false;
      await refreshRemoteData(renderCurrent, true);
    });
  });

  document.querySelectorAll('[data-model-action="delete"]').forEach(button => {
    button.addEventListener('click', async () => {
      const modelId = Number(button.getAttribute('data-model-id'));
      if (!window.confirm('确认删除这个模型配置吗？')) return;
      await deleteModelConfig(modelId).catch(() => null);
      remoteLoaded = false;
      await refreshRemoteData(renderCurrent, true);
    });
  });

  document.querySelectorAll('[data-account-action="password"]').forEach(button => {
    button.addEventListener('click', () => openPasswordDialog(renderCurrent));
  });

  document.querySelectorAll('[data-theme]').forEach(button => {
    button.addEventListener('click', async () => {
      setSetting('theme', button.getAttribute('data-theme'));
      await persistSettings();
      renderCurrent();
    });
  });

  document.getElementById('setting-tts-enabled')?.addEventListener('click', async () => {
    setSetting('ttsEnabled', !state.settings.ttsEnabled);
    await persistSettings();
    renderCurrent();
  });

  document.getElementById('setting-tts-engine')?.addEventListener('change', async event => {
    setSetting('ttsEngine', event.target.value);
    await persistSettings();
  });

  document.getElementById('setting-browser-voice')?.addEventListener('change', async event => {
    setSetting('ttsVoiceURI', event.target.value);
    await persistSettings();
  });

  document.getElementById('setting-qwen-voice')?.addEventListener('input', async event => {
    setSetting('qwenVoiceId', event.target.value);
    await persistSettings();
  });

  document.getElementById('setting-test-voice')?.addEventListener('click', async () => {
    const wasEnabled = state.settings.ttsEnabled;
    state.settings.ttsEnabled = true;
    await testSpeak().catch(error => alert(error.message));
    state.settings.ttsEnabled = wasEnabled;
    saveSettings();
  });

  // 退出登录（桌面版和移动版）
  const handleLogout = async () => {
    try { await logout(); } catch {}
    localStorage.removeItem('rb-username');
    localStorage.removeItem('rb-user');
    location.href = 'auth.html';
  };

  document.getElementById('logout-btn')?.addEventListener('click', handleLogout);
  document.getElementById('logout-btn-mobile')?.addEventListener('click', handleLogout);
}

export function renderDesktop() {
  return `
    ${renderTopbar('我的', '整理账号、模型和使用偏好')}
    <div class="glass-card me-hero">
      ${profileCard()}
      ${statsRow()}
    </div>
    ${modelOnboardingCard(120)}
    ${activitySection()}
    ${summarySection()}
  `;
}

export function renderDesktopRight() {
  return securityPanel();
}

export function renderMobile() {
  const u = state.user;
  return `
  <div class="app-body">
    <div class="page-header" ${revealAttr(0)}>
      <h1>我的</h1>
    </div>

    <div class="profile-hero" ${revealAttr(60)}>
      <div class="profile-avatar-lg">${(u.nickname || u.username || '我')[0]}</div>
      <div style="flex:1">
        <div class="profile-nm">${u.nickname || u.username || '若白用户'}</div>
        <div class="profile-id">@${u.username || 'guest'} · ${formatDate(u.registeredAt)}</div>
        <span class="profile-badge">🌸 RuoBai · 永远在你身边</span>
      </div>
    </div>

    <div class="stats-row" ${revealAttr(120)}>
      <div class="stat-card"><div class="stat-n">${characters.length}</div><div class="stat-l">陪伴角色</div></div>
      <div class="stat-card"><div class="stat-n">${u.totalMessages || 0}</div><div class="stat-l">总消息</div></div>
      <div class="stat-card"><div class="stat-n">${u.totalMemories || 0}</div><div class="stat-l">长期记忆</div></div>
    </div>

    ${modelOnboardingCard(180)}

    <div class="settings-block" ${revealAttr(240)}>
      <div class="block-title">模型接口</div>
      <div class="setting-row" data-model-action="create">
        <div class="row-icon">💬</div>
        <div class="lb">文字聊天模型</div>
        <div class="vl">${activeModelLabel() === '未配置模型' ? '点击配置' : activeModelLabel()}</div>
        <div class="arrow">›</div>
      </div>
      <div class="setting-row" id="setting-tts-enabled">
        <div class="row-icon">🎤</div>
        <div class="lb">语音 TTS</div>
        <div class="vl">${state.settings.ttsEnabled ? '已开启' : '未开启'}</div>
        <div class="arrow">›</div>
      </div>
    </div>

    <div class="settings-block" ${revealAttr(300)}>
      <div class="block-title">通用</div>
      <div class="setting-row" data-account-action="password">
        <div class="row-icon">👤</div>
        <div class="lb">账号与密码</div>
        <div class="vl">${u.username || 'guest'}</div>
        <div class="arrow">›</div>
      </div>
      <div class="setting-row">
        <div class="row-icon">🎨</div>
        <div class="lb">主题外观</div>
        <div class="vl">${state.settings.theme || 'pink'}</div>
        <div class="arrow">›</div>
      </div>
      <div class="setting-row logout" id="logout-btn-mobile">
        <div class="row-icon">↩️</div>
        <div class="lb">退出登录</div>
        <div class="arrow">›</div>
      </div>
    </div>
  </div>`;
}
