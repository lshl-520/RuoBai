/* ====== RuoBai App - Main Entry ====== */
import { initBackend } from './api-backend.js';
import { initTheme, setPage, enableBackend, characters, chatData, memoryData, posts, state } from './store.js';
import { getCurrentRoute, onRouteChange } from './router.js';
import { getPreferredInitialRoute } from './model-onboarding.js';
import { renderBottomTab, bindNav } from './components.js';
import * as feed from './feed.js';
import * as chat from './chat.js';
import * as roles from './roles.js';
import * as memory from './memory.js';
import * as me from './me.js';

const pages = { feed, chat, roles, memory, me };

function initRevealAnimations() {
  const els = document.querySelectorAll('[data-reveal]');
  if (!els.length) return;
  const obs = new IntersectionObserver((entries, o) => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      e.target.classList.add('is-visible');
      o.unobserve(e.target);
    });
  }, { threshold: 0.14 });
  els.forEach(el => obs.observe(el));
}

function render(page) {
  setPage(page);
  const p = pages[page];
  const app = document.getElementById('app');

  if (page !== 'chat') {
    state.chatView = 'list';
  }

  const inChatRoom = page === 'chat' && state.chatView === 'room';

  app.innerHTML = `
    <div class="mobile-app">
      ${p.renderMobile()}
      ${inChatRoom ? '' : renderBottomTab(page)}
    </div>`;

  bindNav();
  applyDynamicStyles();
  initRevealAnimations();
  p.bindChatEvents?.(() => render(page));
  p.bindSettings?.(() => render(page));
  p.bindPageEvents?.(() => render(page));

  // Scroll chat to bottom
  const msgs = document.getElementById('chat-msgs');
  if (msgs) msgs.scrollTop = msgs.scrollHeight;
}

function applyDynamicStyles() {
  document.querySelectorAll('[data-width]').forEach(el => {
    el.style.width = `${el.dataset.width}%`;
  });
  document.querySelectorAll('[data-height]').forEach(el => {
    el.style.height = `${el.dataset.height}px`;
  });
  document.querySelectorAll('[data-height-pct]').forEach(el => {
    el.style.height = `${el.dataset.heightPct}%`;
  });
}

function replaceArray(target, items) {
  target.splice(0, target.length, ...items);
}

function replaceRecord(target, next) {
  Object.keys(target).forEach(key => delete target[key]);
  Object.assign(target, next);
}

function mergeRole(existing, incoming) {
  if (!existing) {
    return {
      id: incoming.id,
      name: incoming.name,
      tag: incoming.tag || '恋人',
      mood: incoming.mood ?? 80,
      intimacy: incoming.intimacy ?? 50,
      color: incoming.color || '#c4b5ff',
      avatar: incoming.avatar || '/assets/avatar-bai.png',
      desc: incoming.desc || incoming.personaSafe || incoming.personaFull || '自定义角色',
      status: incoming.status || '在线',
      anniversary: incoming.anniversary || null,
      personaSafe: incoming.personaSafe || '',
      personaFull: incoming.personaFull || incoming.personaSafe || '',
      backendId: incoming.backendId ?? null,
      deleteAfter: incoming.deleteAfter || null,
      createdAt: incoming.createdAt || ''
    };
  }

  return {
    ...existing,
    ...incoming,
    avatar: incoming.avatar || existing.avatar,
    desc: incoming.desc || existing.desc,
    status: incoming.status || existing.status,
    anniversary: incoming.anniversary ?? existing.anniversary,
    personaSafe: incoming.personaSafe || existing.personaSafe,
    personaFull: incoming.personaFull || existing.personaFull,
    backendId: incoming.backendId ?? existing.backendId ?? null,
    deleteAfter: incoming.deleteAfter ?? existing.deleteAfter ?? null,
    createdAt: incoming.createdAt || existing.createdAt || ''
  };
}

function applyBackendData(backendData) {
  const currentRoles = new Map(characters.map(char => [char.id, char]));
  const nextCharacters = (backendData.roles || []).map(role => mergeRole(currentRoles.get(role.id), role));
  if (Array.isArray(backendData.roles)) {
    replaceArray(characters, nextCharacters);
  }

  const nextChatData = Object.fromEntries(
    characters.map(char => {
      const backendMessages = backendData.messages?.[char.id];
      return [char.id, Array.isArray(backendMessages) ? backendMessages : []];
    })
  );
  replaceRecord(chatData, nextChatData);

  const nextMemoryData = Object.fromEntries(
    characters.map(char => {
      const backendMemories = backendData.memories?.[char.id];
      return [char.id, Array.isArray(backendMemories) ? backendMemories : []];
    })
  );
  replaceRecord(memoryData, nextMemoryData);

  if (Array.isArray(backendData.posts)) {
    replaceArray(posts, backendData.posts);
  }

  if (backendData.settings) {
    const { providers: providerPatch = {}, ...settingsPatch } = backendData.settings;
    Object.assign(state.settings, settingsPatch);
    state.settings.providers = {
      ...(state.settings.providers || {}),
      ...providerPatch
    };
  }

  if (backendData.user) {
    state.user.username = backendData.user.username || state.user.username;
    state.user.registeredAt = backendData.user.created_at || state.user.registeredAt || '';
  }
  if (backendData.settings?.userName) {
    state.user.nickname = backendData.settings.userName;
  }
  if (backendData.settings?.userAvatar) {
    state.user.avatar = backendData.settings.userAvatar;
  }
  if (backendData.usageStats) {
    state.user.totalMessages = backendData.usageStats.messageTotal ?? state.user.totalMessages ?? 0;
    state.user.totalMemories = backendData.usageStats.memoryTotal ?? state.user.totalMemories ?? 0;
    state.user.totalPosts = backendData.usageStats.postTotal ?? state.user.totalPosts ?? 0;
    state.user.dailyChatUsed = backendData.usageStats.dailyChatUsed ?? 0;
    state.user.dailyChatLimit = backendData.usageStats.dailyLimit ?? 200;
    state.user.currentModelName = backendData.usageStats.currentModelName || '';
    state.user.registeredAt = backendData.usageStats.registeredAt || state.user.registeredAt || '';
  }
  if (Array.isArray(backendData.modelConfigs)) {
    state.modelConfigs = backendData.modelConfigs;
  }
  if (backendData.modelConfigStatus) {
    state.modelConfigStatus = backendData.modelConfigStatus;
  }
  if (backendData.activeRoleId) {
    state.currentCharId = backendData.activeRoleId;
  } else if (characters[0]) {
    state.currentCharId = characters[0].id;
  }
}

async function start() {
  initTheme();

  try {
    const backendData = await initBackend();
    if (backendData === false) {
      window.location.replace('auth.html');
      return;
    }
    if (backendData) {
      applyBackendData(backendData);
      enableBackend();
      initTheme();
      const preferredRoute = getPreferredInitialRoute(
        window.location.hash,
        state.modelConfigStatus,
        state.user.username
      );
      if (preferredRoute !== getCurrentRoute()) {
        window.location.hash = `#${preferredRoute}`;
      }
    }
  } catch (error) {
    console.log('后端不可用，使用本地模式', error);
  }

  onRouteChange(render);
}

// Start
void start();
