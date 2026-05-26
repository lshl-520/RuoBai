/* ====== Shared UI Components ====== */
import { characters, state, getChar, getCurrentChar } from './store.js';
import { navigate } from './router.js';

// SVG Icons
const icons = {
  feed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>',
  roles: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 000-7.78z"/></svg>',
  memory: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg>',
  me: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/></svg>',
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8"/></svg>',
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>',
  smile: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>',
  phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.79 19.79 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>',
  logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/></svg>',
  palette: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="8" r="1.5" fill="currentColor"/><circle cx="8" cy="12" r="1.5" fill="currentColor"/><circle cx="16" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="16" r="1.5" fill="currentColor"/></svg>',
  volume: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07"/></svg>',
  git: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><path d="M18 9v1a2 2 0 01-2 2H8a2 2 0 01-2-2V9M12 12v3"/></svg>',
  model: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 9h6M9 13h6M9 17h4"/></svg>',
  key: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>',
  heart: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 000-7.78z"/></svg>',
  comment: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg>',
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13"/></svg>',
  dots: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>',
};

export function icon(name, size = 22) {
  return `<span class="ico ico-${size}">${icons[name] || ''}</span>`;
}

function escapeAttr(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
}

/* Avatar: always prefer real image assets */
export function avatar(charIdOrObj, size = 'md', extra = '') {
  const c = typeof charIdOrObj === 'string' ? getChar(charIdOrObj) : charIdOrObj;
  const letter = c ? c.name[0] : '?';
  const src = c?.avatar;
  return `<div class="avatar avatar-${size} ${extra}" title="${escapeAttr(c?.name || '')}">
    ${src ? `<img src="${escapeAttr(src)}" alt="${escapeAttr(c.name)}">` : `<span>${escapeAttr(letter)}</span>`}
  </div>`;
}

/* Emoji avatar: renders emoji in a gradient circle (ui-preview style) */
export function emojiAvatar(charIdOrObj, size = 'md') {
  const c = typeof charIdOrObj === 'string' ? getChar(charIdOrObj) : charIdOrObj;
  const emoji = c?.emoji || '🌸';
  return `<div class="avatar avatar-emoji avatar-${size}" title="${escapeAttr(c?.name || '')}">${emoji}</div>`;
}

/* Reveal animation attribute helper */
export function revealAttr(delay = 0) {
  return `data-reveal style="--delay:${delay}ms"`;
}

/* Desktop Sidebar */
export function renderSidebar(activePage) {
  const navItems = [
    ['chat', '✦', '聊天'],
    ['roles', '☺', '角色'],
    ['feed', '◌', '动态'],
    ['memory', '⌑', '记忆'],
    ['me', '◠', '我的'],
  ];
  return `
  <aside class="sidebar surface">
    <div class="sidebar-brand-card">
      <div class="brand">
        <img class="brand-logo" src="/assets/logo-ruobai.png" alt="若白 RuoBai">
        <div class="brand-sub">AI 陪伴 · 心动日常</div>
      </div>
      <nav class="nav">
        ${navItems.map(([page, glyph, label]) => `
          <div class="nav-item ${activePage === page ? 'active' : ''}" data-nav="${page}">
            <span class="nav-glyph">${glyph}</span><span>${label}</span>
          </div>
        `).join('')}
      </nav>
    </div>
    <div class="sidebar-poster">
      <img class="poster-hero" src="/assets/char-ruobai-full.png" alt="若白立绘">
      <img class="poster-sticker poster-sticker-tag" src="/assets/deco-bow-stars.png" alt="" aria-hidden="true">
      <img class="poster-sticker poster-sticker-hearts" src="/assets/deco-hearts.png" alt="" aria-hidden="true">
      <img class="poster-sticker poster-sticker-bear" src="/assets/deco-bear.png" alt="" aria-hidden="true">
    </div>
  </aside>`;
}

/* Mobile Bottom Tab */
export function renderBottomTab(activePage) {
  const tabs = [
    ['chat', 'chat', '聊天'],
    ['roles', 'roles', '角色'],
    ['feed', 'feed', '动态'],
    ['memory', 'memory', '记忆'],
    ['me', 'me', '我的'],
  ];
  return `
  <nav class="bottom-tab">
    ${tabs.map(([page, ic, label]) => `
      <div class="tab-item ${activePage === page ? 'active' : ''}" data-nav="${page}">
        ${icon(ic)} ${label}
      </div>
    `).join('')}
  </nav>`;
}

/* Desktop Top Bar */
export function renderTopbar(title, subtitle, extras = '') {
  return `
  <div class="topbar">
    <div class="title">
      <h1>${title} <img class="title-deco" src="/assets/deco-star.png" alt="" aria-hidden="true"></h1>
      <p>${subtitle}</p>
    </div>
    <div class="search-bar">${icon('search',18)}<input placeholder="搜索角色、动态、心情..." /></div>
    ${extras}
  </div>`;
}

/* Mobile Header */
export function renderMobileHeader(title, subtitle = '', rightHtml = '') {
  return `
  <div class="mobile-header">
    <div>
      <h1>${title} <img class="title-deco" src="/assets/deco-star.png" alt="" aria-hidden="true"></h1>
      ${subtitle ? `<p>${subtitle}</p>` : ''}
    </div>
    ${rightHtml}
  </div>`;
}

/* Character stories row */
export function renderStories(activeId) {
  return `
  <div class="stories">
    ${characters.filter(c => c.tag === '恋人').map(c => `
      <div class="story" data-char="${c.id}">
        ${avatar(c, 'lg', c.id === activeId ? 'avatar-ring' : '')}
        <span class="story-name">${c.name}</span>
      </div>
    `).join('')}
  </div>`;
}

/* Bind nav clicks (call after rendering) */
export function bindNav() {
  document.querySelectorAll('[data-nav]').forEach(el => {
    el.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      navigate(el.dataset.nav);
    };
  });
  document.querySelectorAll('.story[data-char], .feed-story[data-char], .care-btn[data-char]').forEach(el => {
    el.onclick = () => {
      state.currentCharId = el.dataset.char;
      // Re-render current page
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    };
  });
}
