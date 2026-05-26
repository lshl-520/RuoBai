/* ====== Chat Page ====== */
import { characters, chatData, state, getChar, getCurrentChar, appendChatMessage, updateLastChatMessage } from './store.js';
import { avatar, icon, emojiAvatar, revealAttr, renderMobileHeader } from './components.js';
import { sendMessageStream, saveChatMessage, deleteMessage } from './api-backend.js';
import { speak } from './tts.js';

function contactList() {
  return characters.filter(c => c.tag === '恋人').map(c => {
    const msgs = chatData[c.id] || [];
    const last = msgs[msgs.length - 1];
    const isActive = c.id === state.currentCharId;
    const unread = isActive ? 0 : Math.floor(Math.random() * 3);
    return `
    <div class="contact-row ${isActive ? 'active' : ''}" data-char="${c.id}">
      ${avatar(c, 'md')}
      <div class="contact-main">
        <div class="contact-name">${c.name}</div>
        <div class="contact-last">${last ? last.text || (last.type === 'voice' ? '[语音消息]' : '[图片]') : '暂无消息'}</div>
      </div>
      <div class="contact-meta">
        <div class="contact-time">${last ? last.time : ''}</div>
        ${unread > 0 ? `<div class="contact-badge">${unread}</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

function messageList(charId) {
  const msgs = chatData[charId] || [];
  const c = getChar(charId);
  return msgs.map(m => {
    const isMe = m.from === 'me';
    const deleteButton = m.id
      ? `<button type="button" class="msg-delete-btn" data-message-delete="${m.id}" title="删除这条消息">${icon('trash', 14)}</button>`
      : '';
    let content = '';
    if (m.type === 'voice') {
      content = `<div class="bubble-wrap"><div class="bubble ${isMe ? 'me' : 'her'}"><div class="bubble-voice">
        <span class="voice-play">${icon('play',14)}</span>
        <span class="voice-wave">${[8,14,10,16,12,18,10,14,8].map(h => `<span data-height="${h}"></span>`).join('')}</span>
        <span class="voice-dur">${m.duration}</span>
      </div></div>${deleteButton}</div>`;
    } else if (m.type === 'image') {
      content = `<div class="bubble-wrap"><div class="bubble ${isMe ? 'me' : 'her'}">
        <div class="bubble-img"><div class="post-img chat-photo">${m.image ? `<img src="${m.image}" alt="聊天图片">` : ''}</div></div>
        ${m.text ? `<div class="bubble-caption">${m.text}</div>` : ''}
      </div>${deleteButton}</div>`;
    } else {
      content = `<div class="bubble-wrap"><div class="bubble ${isMe ? 'me' : 'her'} ${m.pending ? 'thinking' : ''}" data-stream-last="${m.streaming ? '1' : ''}">${m.pending ? '<span class="thinking-dots"><i></i><i></i><i></i></span>' : (m.text || '')}</div>${deleteButton}</div>`;
    }
    return `
    <div class="msg-row ${isMe ? 'me' : ''}" data-message-row="${m.id || ''}">
      ${!isMe ? avatar(c, 'sm') : ''}
      <div>
        ${content}
        <div class="bubble-time">${m.time}</div>
      </div>
      ${isMe ? avatar({name:'我', color:'#b0b6d4'}, 'sm') : ''}
    </div>`;
  }).join('');
}

function chatWindow(charId) {
  const c = getChar(charId);
  if (!c) {
    return `
      <section class="chat-window">
        <div class="chat-messages" id="chat-msgs">
          <div class="soft-copy">还没有可聊天的角色，先去角色页创建一个吧。</div>
        </div>
      </section>
    `;
  }
  // 计算"陪伴 X 天"
  const anchorDate = c.anniversary || c.createdAt || c.created_at;
  const daysToget = c.daysTogether || (anchorDate ? Math.max(0, Math.floor((Date.now() - new Date(anchorDate).getTime()) / 86400000)) : 0);
  const mood = c.mood ?? 90;
  const intimacy = c.intimacy ?? 88;
  return `
  <section class="chat-window">
    <div class="chat-header">
      <button class="chat-back-btn" type="button" title="返回">${icon('chevron',18)}</button>
      ${avatar(c, 'lg')}
      <div class="chat-header-main">
        <div class="chat-header-name">
          <span class="char-name">${c.name}</span>
          <span class="status-dot" title="在线"></span>
          <span class="chat-tag-pill">${c.tag || '恋人'}</span>
        </div>
        <div class="chat-header-stats">
          <span class="chat-intimacy" title="心动值">
            <span class="chat-intimacy-bar"><span class="chat-intimacy-fill" style="width:${mood}%"></span></span>
            <span class="chat-intimacy-val">${mood}%</span>
          </span>
          <span class="chat-days">陪伴 <b>${daysToget}</b> 天</span>
          <span class="chat-intimacy-num">亲密 <b>${intimacy}</b></span>
        </div>
      </div>
      <button class="chat-detail-btn" type="button">详情</button>
    </div>
    <div class="chat-messages" id="chat-msgs">
      ${messageList(charId)}
    </div>
    <div class="composer">
      <button class="composer-tool" type="button" title="语音通话" data-tool="phone">${icon('phone',18)}</button>
      <button class="composer-tool" type="button" title="发语音消息" data-tool="mic">${icon('mic',18)}</button>
      <button class="composer-tool" type="button" title="发图片" data-tool="image">${icon('image',18)}</button>
      <button class="composer-tool" type="button" title="表情" data-tool="smile">${icon('smile',18)}</button>
      <input class="composer-input" id="chat-input" placeholder="跟${c.name}说点什么..." autocomplete="off" />
      <button class="composer-send" id="chat-send" type="button" title="发送">${icon('send',18)}</button>
    </div>
  </section>`;
}

function toApiMessages(charId) {
  return (chatData[charId] || [])
    .filter(m => !m.pending && !m.type && m.text)
    .slice(-20)
    .map(m => ({ role: m.from === 'me' ? 'user' : 'assistant', content: m.text }));
}

function scrollToBottom() {
  const msgs = document.getElementById('chat-msgs');
  if (msgs) msgs.scrollTop = msgs.scrollHeight;
}

function fallbackReply(text, char) {
  const trimmed = text.trim();
  if (!trimmed) return '我在呢。你慢慢说，我听着。';
  if (/想你|抱|在吗|宝宝|宝贝/.test(trimmed)) return `我在呢，${char.name === '小白' ? '宝' : '宝宝'}。靠近一点，让我陪你一会儿。`;
  return `我听见啦。你刚刚说“${trimmed.slice(0, 18)}${trimmed.length > 18 ? '...' : ''}”，我会认真放在心上的。`;
}

export function bindChatEvents(renderCurrent) {
  // Chat list → room navigation
  document.querySelectorAll('[data-enter-chat]').forEach(el => {
    el.addEventListener('click', () => {
      state.currentCharId = el.dataset.enterChat;
      state.chatView = 'room';
      renderCurrent();
    });
  });

  // Back button from room → list
  const backBtn = document.querySelector('.chat-back-btn');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      state.chatView = 'list';
      renderCurrent();
    });
  }

  const input = document.getElementById('chat-input');
  const send = document.getElementById('chat-send');
  const charId = state.currentCharId;
  const char = getChar(charId);
  if (!char) return;

  async function submit(textFromButton = '') {
    const text = (textFromButton || input?.value || '').trim();
    if (!text) return;
    if (input) input.value = '';

    appendChatMessage(charId, { from: 'me', text, backendSaved: true });
    await saveChatMessage({ from: 'me', text }, charId).catch(() => null);
    appendChatMessage(charId, { from: 'her', text: '', pending: true, streaming: true, backendSaved: true });
    renderCurrent();
    scrollToBottom();

    let answer = '';
    const bubbleText = () => {
      const bubble = document.querySelector('[data-stream-last="1"]');
      if (bubble) {
        bubble.classList.remove('thinking');
        bubble.textContent = answer;
      }
    };

    try {
      await sendMessageStream(text, charId, chunk => {
        answer += chunk;
        updateLastChatMessage(charId, { text: answer, pending: false, streaming: true, backendSaved: true });
        bubbleText();
        scrollToBottom();
      });
      const finalText = answer || fallbackReply(text, char);
      updateLastChatMessage(charId, { text: finalText, pending: false, streaming: false, backendSaved: true });
      await saveChatMessage({ from: 'her', text: finalText }, charId).catch(() => null);
      renderCurrent();
      scrollToBottom();
      await speak(finalText).catch(() => {});
    } catch (error) {
      const finalText = answer || `${fallbackReply(text, char)}\n\n（模型暂时没有接通：${error.message}）`;
      updateLastChatMessage(charId, { text: finalText, pending: false, streaming: false, backendSaved: true });
      await saveChatMessage({ from: 'her', text: finalText }, charId).catch(() => null);
      renderCurrent();
      scrollToBottom();
    }
  }

  send?.addEventListener('click', () => submit());
  input?.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  });
  document.querySelectorAll('[data-quick]').forEach(btn => {
    btn.addEventListener('click', () => submit(btn.dataset.quick || ''));
  });

  document.querySelectorAll('[data-message-delete]').forEach(button => {
    button.addEventListener('click', async event => {
      event.stopPropagation();
      const messageId = button.getAttribute('data-message-delete');
      if (!messageId) return;
      if (!window.confirm('确认删除这条消息？')) return;
      await deleteMessage(messageId).catch(() => null);
      chatData[charId] = (chatData[charId] || []).filter(item => String(item.id) !== String(messageId));
      renderCurrent();
    });
  });

  document.querySelectorAll('[data-message-row]').forEach(row => {
    let pressTimer = null;
    const trigger = async () => {
      const messageId = row.getAttribute('data-message-row');
      if (!messageId) return;
      if (!window.confirm('确认删除这条消息？')) return;
      await deleteMessage(messageId).catch(() => null);
      chatData[charId] = (chatData[charId] || []).filter(item => String(item.id) !== String(messageId));
      renderCurrent();
    };

    row.addEventListener('contextmenu', async event => {
      event.preventDefault();
      await trigger();
    });
    row.addEventListener('touchstart', () => {
      if (!row.getAttribute('data-message-row')) return;
      pressTimer = window.setTimeout(() => {
        void trigger();
      }, 520);
    }, { passive: true });
    row.addEventListener('touchend', () => {
      if (pressTimer) {
        window.clearTimeout(pressTimer);
        pressTimer = null;
      }
    }, { passive: true });
  });
}

function chatProfile(charId) {
  const c = getChar(charId);
  return `
  <aside class="right-panel">
    <section class="section-card glass chat-profile">
      <div class="chat-profile-hero">
        <img src="/assets/char-ruobai-full.png" alt="${c.name}立绘">
        <div class="chat-profile-hero-caption">
          <h3>${c.name}</h3>
          <span>${c.tag} · ${c.status}</span>
        </div>
        <img class="profile-deco profile-deco-hearts" src="/assets/deco-hearts.png" alt="" aria-hidden="true">
      </div>
      <div class="chat-profile-stats">
        <div class="chat-profile-stat metric"><b>${c.intimacy}%</b><span>亲密度</span></div>
        <div class="chat-profile-stat metric"><b>${c.anniversary || '未设置'}</b><span>纪念日</span></div>
      </div>
      <div class="bar"><div class="bar-fill" data-width="${c.intimacy}"></div></div>
      <div class="profile-score">心动值 ${c.mood}% · 亲密度 ${c.intimacy}%</div>
      <div class="profile-desc">${c.desc}</div>
      <div class="quick-actions">
        <button class="btn-soft" data-nav="memory">查看记忆</button>
        <button class="btn-ghost" data-nav="me">编辑人设</button>
      </div>
    </section>
    <section class="section-card glass compact-card">
      <div class="rail-title compact-title">最近记忆</div>
      <div class="muted-copy">她记得你喜欢安静的窗边、热拿铁，也记得你说过"被认真听见会很安心"。</div>
    </section>
  </aside>`;
}

function chatListView() {
  const chars = characters.filter(c => c.tag === '恋人' || c.tag === '闺蜜' || c.tag === '青梅竹马' || c.tag);
  const greeting = getGreeting();
  return `
  <div class="app-body">
    <div class="greeting" ${revealAttr(0)}>
      <h1>${greeting}，${state.user?.nickname || '你'}</h1>
      <p>今天也想认真陪着你～</p>
    </div>
    <div class="chat-list">
      ${chars.map((c, i) => {
        const msgs = chatData[c.id] || [];
        const last = msgs[msgs.length - 1];
        const intimacy = c.intimacy ?? 50;
        const isCurrent = c.id === state.currentCharId;
        const unread = isCurrent ? 0 : Math.floor(Math.random() * 3);
        return `
        <div class="chat-card ${isCurrent ? 'featured' : ''}" data-enter-chat="${c.id}" ${revealAttr(60 + i * 70)}>
          ${emojiAvatar(c, 'md')}
          <div class="chat-info">
            <div class="chat-top">
              <span class="chat-name">${c.name}</span>
              <span class="chat-time">${last ? last.time : ''}</span>
            </div>
            <div class="chat-msg">${last ? (last.text || (last.type === 'voice' ? '[语音消息]' : '[图片]')) : '点击开始聊天'}</div>
            <div class="intimacy">
              <div class="intimacy-bar"><div class="intimacy-fill" style="width:${intimacy}%"></div></div>
              <span class="intimacy-label">亲密 ${intimacy}</span>
            </div>
          </div>
          ${unread > 0 ? `<span class="badge">${unread}</span>` : ''}
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 6) return '夜深了';
  if (h < 9) return '早上好呀';
  if (h < 12) return '上午好';
  if (h < 14) return '中午好';
  if (h < 18) return '下午好';
  if (h < 22) return '晚上好呀';
  return '夜深了';
}

export function renderDesktop() {
  return `
  <div class="chat-layout">
    ${chatWindow(state.currentCharId)}
  </div>`;
}

export function renderDesktopRight() {
  return chatProfile(state.currentCharId);
}

export function renderMobile() {
  if (state.chatView === 'room') {
    return `
    <div class="mobile-chat-wrap">
      ${chatWindow(state.currentCharId)}
    </div>`;
  }
  return chatListView();
}
