/* ====== Roles Page ====== */
import { characters, chatData, memoryData, state, getChar, getCurrentChar } from './store.js';
import { avatar, icon, emojiAvatar, revealAttr, renderTopbar, renderMobileHeader } from './components.js';
import { openDialog } from './dialog.js';
import {
  loadMessages,
  loadMemories,
  loadRoles,
  loadDeletedRoles,
  createRole,
  updateRole,
  deleteRole,
  restoreRole,
  switchRole
} from './api-backend.js';

const presetAvatars = [
  '/assets/avatars/0.png',
  '/assets/avatars/1.png',
  '/assets/avatars/2.png',
  '/assets/avatars/3.png',
  '/assets/avatars/4.png',
  '/assets/avatars/5.png',
  '/assets/avatars/6.png',
  '/assets/avatars/7.png',
  '/assets/avatars/8.png',
  '/assets/char-ruobai.png',
  '/assets/char-linxia.png',
  '/assets/char-lingyin.png'
];

let deletedRoles = [];

function replaceCharacters(nextRoles) {
  characters.splice(0, characters.length, ...nextRoles);
}

function daysUntilDelete(deleteAfter) {
  if (!deleteAfter) return null;
  const now = Date.now();
  const target = new Date(deleteAfter).getTime();
  if (Number.isNaN(target)) return null;
  const diff = Math.max(0, target - now);
  return Math.max(1, Math.ceil(diff / (24 * 60 * 60 * 1000)));
}

function filteredRoles() {
  return characters.slice();
}

function restoreSection() {
  if (!deletedRoles.length) {
    return '';
  }

  return `
    <section class="section-card glass role-restore-section">
      <div class="section-title">
        <div>
          <h3>可恢复角色</h3>
          <p>这些角色已经删除，但还能从本地数据里找回来。</p>
        </div>
      </div>
      <div class="role-grid">
        ${deletedRoles.map(role => `
          <div class="role-card is-pending-delete" data-deleted-role-card="${role.id}">
            <div class="role-card-head">
              ${avatar(role, 'xl')}
              <div>
                <h3>${role.name}</h3>
                <div class="role-card-stats">已删除</div>
              </div>
            </div>
            <div class="role-card-desc">${role.personaSafe || '还没有人设'}</div>
            <div class="role-card-foot">
              <div class="rb-inline-actions">
                <button class="btn-soft btn-small" data-role-action="restore" data-role-id="${role.id}">恢复</button>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    </section>
  `;
}

function emptyState() {
  return `
    <div class="role-empty glass">
      <div class="role-add-icon">${icon('plus', 36)}</div>
      <h3>还没有角色</h3>
      <p>先创建一个新陪伴角色吧。</p>
      <button class="btn-soft" data-role-action="create">添加角色</button>
    </div>
  `;
}

function featuredCard() {
  const c = getCurrentChar();
  if (!c) {
    return emptyState();
  }

  const deleteDays = daysUntilDelete(c.deleteAfter);
  return `
    <div class="role-featured ${deleteDays ? 'is-pending-delete' : ''}">
      ${avatar(c, 'xl', 'avatar-ring')}
      <div class="role-featured-info">
        <h2>${c.name}</h2>
        <div class="role-featured-desc">${c.personaSafe || '还没有人设'}</div>
        <div class="role-featured-stats">
          <span class="role-featured-stat"><b>${(chatData[c.id] || []).length}</b> 条对话</span>
          <span class="role-featured-stat"><b>${(memoryData[c.id] || []).length}</b> 条记忆</span>
        </div>
        ${deleteDays ? `<div class="role-delete-note">还有 ${deleteDays} 天自动删除，可随时撤销。</div>` : ''}
        <div class="role-actions">
          <button class="btn-soft" data-role-action="chat" data-role-id="${c.id}">开始聊天</button>
          <button class="btn-ghost" data-role-action="edit" data-role-id="${c.id}">编辑角色</button>
        </div>
      </div>
    </div>
  `;
}

function roleCard(c) {
  const deleteDays = daysUntilDelete(c.deleteAfter);
  return `
    <div class="role-card ${deleteDays ? 'is-pending-delete' : ''}" data-role-card="${c.id}">
      <div class="role-card-head">
        ${avatar(c, 'xl')}
        <div>
          <h3>${c.name}</h3>
          <div class="role-card-stats">${(chatData[c.id] || []).length} 条对话</div>
        </div>
      </div>
      <div class="role-card-desc">${c.personaSafe || '还没有人设'}</div>
      ${deleteDays ? `<div class="role-delete-note">还有 ${deleteDays} 天删除</div>` : ''}
      <div class="role-card-foot">
        <div class="rb-inline-actions">
          ${deleteDays
            ? `<button class="btn-ghost btn-small" data-role-action="undo" data-role-id="${c.id}">撤销</button>`
            : `<button class="btn-ghost btn-small" data-role-action="edit" data-role-id="${c.id}">编辑</button>`}
          <button class="btn-soft btn-small" data-role-action="chat" data-role-id="${c.id}">${c.id === state.currentCharId ? '进入聊天' : '切换聊天'}</button>
        </div>
      </div>
    </div>
  `;
}

function addCard() {
  return `
    <div class="role-add" data-role-action="create">
      <div class="role-add-icon">${icon('plus', 36)}</div>
      <div class="role-add-title">添加新角色</div>
      <div class="role-add-sub">名字、头像、人设，填完就能聊</div>
    </div>
  `;
}

function roleDetail() {
  const c = getCurrentChar();
  if (!c) {
    return '<aside class="right-panel"></aside>';
  }

  const deleteDays = daysUntilDelete(c.deleteAfter);
  const bars = [c.mood, c.intimacy, Math.max(32, c.intimacy - 10), Math.max(46, c.mood - 6), 72, 58, 84]
    .map(h => `<div class="role-chart-bar" data-height-pct="${h}"></div>`)
    .join('');

  return `
    <aside class="right-panel">
      <section class="section-card glass role-detail ${deleteDays ? 'is-pending-delete' : ''}">
        <div class="role-detail-hero">
          <img class="role-detail-portrait" src="${c.avatar || '/assets/char-ruobai-full.png'}" alt="${c.name}立绘">
          <div class="role-detail-hero-copy">
            ${avatar(c, 'xl')}
            <h3><span class="decorated-name">${c.name}</span></h3>
            <span class="pill">${c.tag}</span>
          </div>
        </div>
        <div class="role-detail-sub">${c.desc || c.personaSafe || '还没有角色简介'}</div>
        <div class="role-chart">${bars}</div>
        <div class="role-detail-row"><span class="role-detail-label">关系</span><span class="role-detail-val">${c.tag}</span></div>
        <div class="role-detail-row"><span class="role-detail-label">亲密度</span><span class="role-detail-val accent-val">${c.intimacy}%</span></div>
        <div class="role-detail-row"><span class="role-detail-label">心情</span><span class="role-detail-val">${c.mood}%</span></div>
        <div class="role-detail-row"><span class="role-detail-label">消息数</span><span class="role-detail-val">${(chatData[c.id] || []).length}</span></div>
        <div class="role-detail-row"><span class="role-detail-label">记忆数</span><span class="role-detail-val">${(memoryData[c.id] || []).length}</span></div>
        ${deleteDays ? `<div class="role-delete-note">将于 ${deleteDays} 天后自动删除</div>` : ''}
        <div class="role-detail-actions">
          <button class="btn-soft" data-role-action="chat" data-role-id="${c.id}">聊天</button>
          <button class="btn-ghost" data-role-action="edit" data-role-id="${c.id}">编辑</button>
          ${deleteDays
            ? `<button class="btn-ghost" data-role-action="undo" data-role-id="${c.id}">撤销删除</button>`
            : `<button class="btn-ghost danger-btn" data-role-action="delete" data-role-id="${c.id}">${icon('trash',14)} 删除</button>`}
        </div>
      </section>
    </aside>
  `;
}

export function renderDesktop() {
  const roleList = filteredRoles();
  return `
    ${renderTopbar('角色', '与你相遇的每一个特别的人')}
    <div class="roles-toolbar">
      <button class="btn-ghost role-sort" data-role-action="create">添加角色</button>
    </div>
    ${featuredCard()}
    <div class="role-grid">
      ${roleList.map(roleCard).join('')}
      ${addCard()}
    </div>
    ${restoreSection()}
  `;
}

export function renderDesktopRight() {
  return roleDetail();
}

export function renderMobile() {
  const roleList = filteredRoles();
  return `
    <div class="app-body">
      <div class="page-header" ${revealAttr(0)}>
        <div>
          <h1>我的角色</h1>
          <p>把每一份陪伴都收好</p>
        </div>
        <div class="header-actions">
          <div class="icon-btn" data-role-action="create">${icon('plus', 18)}</div>
        </div>
      </div>
      <div class="char-grid">
        ${roleList.map((c, i) => `
          <div class="char-card" data-role-card="${c.id}" ${revealAttr(60 + i * 70)}>
            <div class="char-top">${c.avatar ? `<img src="${c.avatar}" alt="${c.name}">` : (c.emoji || '🌸')}</div>
            <div class="char-bottom">
              <div class="char-name">${c.name}</div>
              <div class="char-desc">${c.desc || c.personaSafe || '还没有人设'}</div>
              <div class="char-actions">
                <button class="char-action-btn" data-role-action="edit" data-role-id="${c.id}">编辑</button>
                <button class="char-action-btn danger" data-role-action="delete" data-role-id="${c.id}">删除</button>
              </div>
            </div>
          </div>
        `).join('')}
        <div class="char-card add-card" data-role-action="create" ${revealAttr(60 + roleList.length * 70)}>
          <div class="add-icon">+</div>
          <span>添加角色</span>
        </div>
      </div>
      ${restoreSection()}
    </div>
  `;
}

async function syncRolesFromBackend() {
  const [roles, deleted] = await Promise.all([
    loadRoles().catch(() => []),
    loadDeletedRoles().catch(() => [])
  ]);
  replaceCharacters(roles);
  deletedRoles = deleted;
  state.currentCharId = roles.find(role => role.isActive)?.id || roles[0]?.id || state.currentCharId;
  roles.forEach(role => {
    chatData[role.id] = chatData[role.id] || [];
    memoryData[role.id] = memoryData[role.id] || [];
  });
  return roles;
}

async function syncCurrentRoleData(roleId) {
  const [messages, memories] = await Promise.all([
    loadMessages(roleId).catch(() => []),
    loadMemories(roleId).catch(() => [])
  ]);
  chatData[roleId] = messages;
  memoryData[roleId] = memories;
}

function openRoleEditor(role, renderCurrent) {
  const isEdit = Boolean(role);
  const currentAvatar = role?.avatar || '';
  const currentTag = role?.tag || '恋人';
  openDialog({
    title: isEdit ? '编辑角色' : '创建角色',
    className: 'rb-role-modal',
    content: `
      <form class="rb-form-grid" id="role-form">
        <div class="rb-field">
          <label for="role-name">名称</label>
          <input id="role-name" name="name" value="${role?.name || ''}" placeholder="给她起个名字">
        </div>
        <div class="rb-field">
          <label for="role-tag">标签</label>
          <div class="rb-tag-options">
            ${['恋人','闺蜜','青梅竹马','姐姐','其他'].map(t => `
              <button type="button" class="rb-tag-option ${t === currentTag ? 'active' : ''}" data-tag-option="${t}">${t}</button>
            `).join('')}
          </div>
        </div>
        <div class="rb-field">
          <label>头像</label>
          <div class="rb-avatar-grid">
            ${presetAvatars.map(src => `
              <button type="button" class="rb-avatar-option ${src === currentAvatar ? 'active' : ''}" data-avatar-option="${src}">
                <img src="${src}" alt="头像">
              </button>
            `).join('')}
          </div>
          <input type="file" id="role-avatar-upload" accept="image/*" style="display:none">
          <button type="button" class="btn-ghost btn-small" style="margin-top:8px" onclick="document.getElementById('role-avatar-upload').click()">本地上传</button>
        </div>
        <div class="rb-field">
          <label for="role-desc">简介（可选）</label>
          <input id="role-desc" name="desc" value="${role?.desc || ''}" placeholder="一句话描述角色">
        </div>
        <div class="rb-field">
          <label for="role-persona">人设提示词</label>
          <textarea id="role-persona" name="persona" rows="8" placeholder="在这里粘贴你的专属人设">${role?.personaFull || role?.personaSafe || ''}</textarea>
        </div>
      </form>
    `,
    actions: [
      { label: '取消' },
      {
        label: isEdit ? '保存修改' : '创建角色',
        variant: 'primary',
        closeOnClick: false,
        onClick: async ({ root, close }) => {
          const form = root.querySelector('#role-form');
          const name = form.querySelector('#role-name')?.value.trim() || '';
          const persona = form.querySelector('#role-persona')?.value.trim() || '';
          const desc = form.querySelector('#role-desc')?.value.trim() || '';
          const tag = root.querySelector('.rb-tag-option.active')?.getAttribute('data-tag-option') || '恋人';
          const selectedAvatar = root.querySelector('.rb-avatar-option.active')?.getAttribute('data-avatar-option') || '';
          const uploadInput = root.querySelector('#role-avatar-upload');

          if (!name) {
            window.alert('请先填写名称');
            return;
          }

          let avatarVal = selectedAvatar;

          if (uploadInput?.files?.[0]) {
            const file = uploadInput.files[0];
            const reader = new FileReader();
            avatarVal = await new Promise((resolve, reject) => {
              reader.onload = e => resolve(e.target.result);
              reader.onerror = reject;
              reader.readAsDataURL(file);
            });
          }

          const payload = {
            name,
            persona,
            avatar: avatarVal,
            desc,
            tag
          };

          if (isEdit) {
            await updateRole(role.backendId || role.id, payload);
          } else {
            await createRole(payload);
          }

          await syncRolesFromBackend();
          renderCurrent();
          close();
        }
      }
    ],
    onMount: root => {
      root.querySelectorAll('[data-avatar-option]').forEach(button => {
        button.addEventListener('click', () => {
          root.querySelectorAll('[data-avatar-option]').forEach(item => item.classList.remove('active'));
          button.classList.add('active');
        });
      });
      root.querySelectorAll('[data-tag-option]').forEach(button => {
        button.addEventListener('click', () => {
          root.querySelectorAll('[data-tag-option]').forEach(item => item.classList.remove('active'));
          button.classList.add('active');
        });
      });
    }
  });
}

function openDeleteDialog(role, renderCurrent) {
  openDialog({
    title: `删除 ${role.name}`,
    content: `
      <div class="rb-choice-list">
        <button type="button" class="rb-choice-card active" data-delete-mode="cooldown">
          <div class="rb-choice-title">冷静一下，3天后自动删除</div>
          <div class="rb-choice-desc">角色会先变灰标记，3 天内你都可以回来撤销。</div>
        </button>
        <button type="button" class="rb-choice-card" data-delete-mode="now">
          <div class="rb-choice-title">我想好了，立即删除</div>
          <div class="rb-choice-desc">会立刻移除角色，并清空这个角色的聊天记录和记忆。</div>
        </button>
      </div>
    `,
    actions: [
      { label: '取消' },
      {
        label: '确认',
        variant: 'primary',
        closeOnClick: false,
        onClick: async ({ root, close }) => {
          const mode = root.querySelector('[data-delete-mode].active')?.getAttribute('data-delete-mode') || 'cooldown';
          if (mode === 'cooldown') {
            const deleteAfter = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
            await updateRole(role.backendId || role.id, { delete_after: deleteAfter });
          } else {
            if (!window.confirm('删除后聊天记录和记忆也会清空，确定吗？')) {
              return;
            }
            await deleteRole(role.backendId || role.id);
          }
          await syncRolesFromBackend();
          renderCurrent();
          close();
        }
      }
    ],
    onMount: root => {
      root.querySelectorAll('[data-delete-mode]').forEach(button => {
        button.addEventListener('click', () => {
          root.querySelectorAll('[data-delete-mode]').forEach(item => item.classList.remove('active'));
          button.classList.add('active');
        });
      });
    }
  });
}

export function bindPageEvents(renderCurrent) {
  document.querySelectorAll('[data-role-action="create"]').forEach(button => {
    button.addEventListener('click', () => openRoleEditor(null, renderCurrent));
  });

  document.querySelectorAll('[data-role-card]').forEach(node => {
    node.addEventListener('click', async event => {
      if (event.target.closest('[data-role-action]')) return;
      const roleId = node.getAttribute('data-role-card');
      if (!roleId) return;
      const role = getChar(roleId);
      if (!role) return;
      await switchRole(role.backendId || role.id);
      await syncRolesFromBackend();
      await syncCurrentRoleData(role.id);
      location.hash = '#chat';
    });
  });

  document.querySelectorAll('[data-role-action="chat"]').forEach(button => {
    button.addEventListener('click', async event => {
      event.stopPropagation();
      const roleId = button.getAttribute('data-role-id');
      const role = roleId ? getChar(roleId) : null;
      if (!role) return;
      await switchRole(role.backendId || role.id);
      await syncRolesFromBackend();
      await syncCurrentRoleData(role.id);
      location.hash = '#chat';
    });
  });

  document.querySelectorAll('[data-role-action="edit"]').forEach(button => {
    button.addEventListener('click', event => {
      event.stopPropagation();
      const roleId = button.getAttribute('data-role-id');
      const role = roleId ? getChar(roleId) : null;
      if (!role) return;
      openRoleEditor(role, renderCurrent);
    });
  });

  document.querySelectorAll('[data-role-action="delete"]').forEach(button => {
    button.addEventListener('click', event => {
      event.stopPropagation();
      const roleId = button.getAttribute('data-role-id');
      const role = roleId ? getChar(roleId) : null;
      if (!role) return;
      openDeleteDialog(role, renderCurrent);
    });
  });

  document.querySelectorAll('[data-role-action="undo"]').forEach(button => {
    button.addEventListener('click', async event => {
      event.stopPropagation();
      const roleId = button.getAttribute('data-role-id');
      const role = roleId ? getChar(roleId) : null;
      if (!role) return;
      await updateRole(role.backendId || role.id, { delete_after: null });
      await syncRolesFromBackend();
      renderCurrent();
    });
  });

  document.querySelectorAll('[data-role-action="restore"]').forEach(button => {
    button.addEventListener('click', async event => {
      event.stopPropagation();
      const roleId = button.getAttribute('data-role-id');
      const role = deletedRoles.find(item => String(item.id) === String(roleId));
      if (!role) return;
      await restoreRole(role.backendId || role.id);
      const roles = await syncRolesFromBackend();
      state.currentCharId = roles.find(item => item.backendId === role.backendId)?.id || role.id;
      renderCurrent();
    });
  });
}
