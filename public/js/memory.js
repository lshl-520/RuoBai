/* ====== Memory Page ====== */
import { characters, memoryData, state, getChar, getCurrentChar } from './store.js';
import { avatar, icon, emojiAvatar, revealAttr, renderTopbar, renderMobileHeader } from './components.js';
import { loadMemories, createMemory, updateMemory, deleteMemory } from './api-backend.js';
import { openDialog } from './dialog.js';

let activeScope = 'all';
let activeFilter = '全部记忆';

function memoryFilters() {
  // displayedMemories uses createdAt timestamp with Date/getTime sorting.
  const allItems = displayedMemories();
  const dynamic = new Set(['全部记忆']);
  allItems.forEach(item => {
    if (item.cat) dynamic.add(item.cat);
    if (item.tag) dynamic.add(item.tag);
  });
  return Array.from(dynamic).slice(0, 8);
}

function charFilter() {
  return `
  <div class="memory-chars">
    <div class="memory-char ${activeScope === 'all' ? 'active' : ''}" data-memory-scope="all">
      <div class="avatar avatar-sm all-avatar">全</div>
      <span>全部</span>
    </div>
    ${characters.map(c => `
      <div class="memory-char ${activeScope === c.id ? 'active' : ''}" data-char="${c.id}">
        ${avatar(c, 'sm')}
        <span>${c.name}</span>
      </div>
    `).join('')}
    <button class="btn-ghost memory-dialog-btn">${icon('plus', 14)} 添加对话</button>
  </div>`;
}

function memoryItem(m, charId) {
  const c = getChar(charId);
  return `
  <div class="memory-item" data-memory-id="${m.id || ''}">
    <div class="memory-item-avatar">${avatar(c, 'md')}</div>
    <div class="memory-item-body">
      <div class="memory-item-head">
        <span class="memory-item-name">${c.name}</span>
        <span class="pill memory-item-tag">${m.tag}</span>
        <div class="memory-item-actions">
          <button type="button" class="memory-action-btn memory-edit-btn">编辑</button>
          <button type="button" class="memory-action-btn memory-delete-btn">删除</button>
        </div>
      </div>
      <div class="memory-item-text">${m.text}</div>
      <div class="memory-item-time">${m.time}</div>
    </div>
    <div class="memory-item-img">
      ${m.image ? `<img src="${m.image}" alt="${c.name} 的记忆图片">` : ''}
    </div>
  </div>`;
}

function displayedMemories() {
  let items;
  if (activeScope !== 'all') {
    items = (memoryData[activeScope] || []).map(item => ({ ...item, charId: activeScope }));
  } else {
    items = [];
    for (const [charId, mems] of Object.entries(memoryData)) {
      for (const m of mems) items.push({ ...m, charId });
    }
  }

  if (activeFilter !== '全部记忆') {
    items = items.filter(item => item.cat === activeFilter || item.tag === activeFilter);
  }

  return items.sort((a, b) => {
    const ta = new Date(a.createdAt || a.created_at || a.time || 0).getTime();
    const tb = new Date(b.createdAt || b.created_at || b.time || 0).getTime();
    return tb - ta;
  });
}

function intimacyDash() {
  const c = getCurrentChar();
  if (!c) {
    return `
    <aside class="right-panel">
      <section class="section-card glass intimacy-dash">
        <p style="text-align:center;padding:20px;color:#999">请先创建一个角色</p>
      </section>
    </aside>`;
  }
  const mems = memoryData[c.id] || [];
  return `
  <aside class="right-panel">
    <section class="section-card glass intimacy-dash">
      ${avatar(c, 'xl')}
      <h3>${c.name}</h3>
      <div class="dash-sub">当前角色记忆概览</div>
      <div class="intimacy-ring">
        <div><b>${c.intimacy}%</b><small>亲密度</small></div>
      </div>
      <div class="intimacy-stats">
        <div class="intimacy-stat"><b>${mems.length}</b><span>记忆条数</span></div>
        <div class="intimacy-stat"><b>15.0</b><span>记忆强度</span></div>
      </div>
    </section>
    <section class="section-card glass compact-card">
      <div class="rail-title compact-title">最近总结</div>
      ${mems.length > 0
        ? `<div class="muted-copy">${mems[0].text}</div>`
        : '<div class="soft-copy">暂无记忆</div>'}
    </section>
    <section class="section-card glass compact-card memory-add-card">
      <div class="rail-title compact-title">添加记忆</div>
      <textarea class="memory-note-input" rows="4" placeholder="写下一条新的共同记忆..."></textarea>
      <button class="btn-soft memory-save-btn">保存记忆</button>
    </section>
    <section class="section-card glass compact-card">
      <div class="rail-title compact-title">记忆小贴士</div>
      <div class="muted-copy">记忆是你们关系的沉淀，聊天中提到的偏好、约定和共同经历都会被自动记录。</div>
    </section>
  </aside>`;
}

export function renderDesktop() {
  const mems = displayedMemories();
  const categories = memoryFilters();
  return `
  ${renderTopbar('记忆', '珍藏每一次心动的瞬间', '<button class="btn-publish">' + icon('plus',16) + ' 添加记忆</button>')}
  ${charFilter()}
  <div class="memory-filter">
    ${categories.map(cat => `<button type="button" class="memory-filter-item ${activeFilter === cat ? 'active' : ''}" data-memory-filter="${cat}">${cat}</button>`).join('')}
  </div>
  <div class="memory-list">
    ${mems.map(m => memoryItem(m, m.charId)).join('')}
  </div>`;
}

export function renderDesktopRight() { return intimacyDash(); }

export function renderMobile() {
  const mems = displayedMemories();
  return `
  <div class="app-body">
    <div class="page-header" ${revealAttr(0)}>
      <h1>记忆</h1>
      <div class="icon-btn memory-add">${icon('plus', 18)}</div>
    </div>
    <div class="filter-tabs" ${revealAttr(40)}>
      ${characters.map(c => `
        <button class="filter-tab ${activeScope === c.id ? 'active' : ''}" data-char="${c.id}">${c.name}</button>
      `).join('')}
    </div>
    <div class="memory-list">
      ${mems.map((m, i) => {
        const isPinned = m.pinned || m.tag === '重要记忆';
        return `
        <div class="memory-card ${isPinned ? 'pinned' : ''}" data-memory-id="${m.id || ''}" ${revealAttr(80 + i * 70)}>
          ${isPinned ? `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <div class="ttl">${m.tag || '记忆'}</div>
            <span class="pin">📌</span>
          </div>` : `<div class="ttl">${m.tag || '记忆'}</div>`}
          <div class="desc">${m.text}</div>
          <div class="meta">
            <span>${m.time || ''}</span>
            <span class="edit memory-edit-btn">编辑</span>
          </div>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

export function bindPageEvents(renderCurrent) {
  const saveBtn = document.querySelector('.memory-save-btn');
  const textarea = document.querySelector('.memory-note-input');
  const createButtons = document.querySelectorAll('.memory-dialog-btn, .btn-publish, .memory-add');

  async function reloadCurrentChar() {
    const items = await loadMemories(state.currentCharId).catch(() => []);
    memoryData[state.currentCharId] = items.map(item => ({
      ...item,
      time: item.time || ''
    }));
    renderCurrent();
  }

  async function createMemoryEntry(content) {
    if (!content || !content.trim()) return;
    const item = await createMemory(content.trim(), state.currentCharId, '普通记忆', '').catch(() => null);
    if (item) {
      memoryData[state.currentCharId] = memoryData[state.currentCharId] || [];
      memoryData[state.currentCharId].unshift({
        id: item.id,
        tag: item.tag || '普通记忆',
        text: item.content || content.trim(),
        time: item.created_at || '',
        createdAt: item.created_at || '',
        cat: item.category || ''
      });
      if (textarea) textarea.value = '';
      activeScope = state.currentCharId;
      renderCurrent();
    }
  }

  saveBtn?.addEventListener('click', async () => {
    await createMemoryEntry(textarea?.value.trim() || '');
  });

  createButtons.forEach(btn => {
    btn.addEventListener('click', async () => {
      if (textarea) {
        textarea.focus();
        if (window.innerWidth > 768) return;
      }
      const content = window.prompt('输入新的记忆内容');
      await createMemoryEntry(content || '');
    });
  });

  document.querySelectorAll('[data-memory-scope="all"]').forEach(btn => {
    btn.addEventListener('click', () => {
      activeScope = 'all';
      renderCurrent();
    });
  });

  document.querySelectorAll('.filter-tab[data-char]').forEach(btn => {
    btn.addEventListener('click', async () => {
      state.currentCharId = btn.dataset.char;
      activeScope = btn.dataset.char;
      await reloadCurrentChar();
      renderCurrent();
    });
  });

  document.querySelectorAll('[data-memory-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      activeFilter = btn.getAttribute('data-memory-filter') || '全部记忆';
      renderCurrent();
    });
  });

  document.querySelectorAll('.memory-card[data-memory-id]').forEach((item, index) => {
    const mem = displayedMemories()[index];
    if (!mem?.id) return;
    const editBtn = item.querySelector('.memory-edit-btn');
    const deleteBtn = item.querySelector('.memory-delete-btn');
    editBtn?.addEventListener('click', async () => {
      openDialog({
        title: '编辑记忆',
        content: `
          <div class="rb-form-grid">
            <div class="rb-field">
              <label for="memory-edit-text">记忆内容</label>
              <textarea id="memory-edit-text">${mem.text || ''}</textarea>
            </div>
            <div class="rb-form-two">
              <div class="rb-field">
                <label for="memory-edit-tag">标签</label>
                <input id="memory-edit-tag" value="${mem.tag || ''}">
              </div>
              <div class="rb-field">
                <label for="memory-edit-cat">分类</label>
                <input id="memory-edit-cat" value="${mem.cat || ''}">
              </div>
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
              const nextText = root.querySelector('#memory-edit-text')?.value.trim() || '';
              const nextTag = root.querySelector('#memory-edit-tag')?.value.trim() || '普通记忆';
              const nextCat = root.querySelector('#memory-edit-cat')?.value.trim() || '';
              if (!nextText) {
                window.alert('记忆内容不能为空');
                return;
              }
              await updateMemory(mem.id, { content: nextText, tag: nextTag, category: nextCat }).catch(() => null);
              const list = memoryData[mem.charId] || [];
              const target = list.find(entry => entry.id === mem.id);
              if (target) {
                target.text = nextText;
                target.tag = nextTag;
                target.cat = nextCat;
              }
              renderCurrent();
              close();
            }
          }
        ]
      });
    });
    deleteBtn?.addEventListener('click', async () => {
      if (!window.confirm('确认删除这条记忆吗？')) return;
      await deleteMemory(mem.id).catch(() => null);
      memoryData[mem.charId] = (memoryData[mem.charId] || []).filter(entry => entry.id !== mem.id);
      renderCurrent();
    });
  });
}
