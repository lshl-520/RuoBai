/* ====== Feed Page ====== */
import { posts, characters, state, getChar } from './store.js';
import { avatar, icon, emojiAvatar, revealAttr, renderMobileHeader, renderStories } from './components.js';
import { loadPosts, createPost, likePost, unlikePost, loadPostComments, createPostComment } from './api-backend.js';
import { openDialog } from './dialog.js';

const themeAssets = {
  sceneCafe: '/assets/scene-cafe.png',
  sceneSunset: '/assets/scene-sunset.png',
  sceneKitchen: '/assets/scene-kitchen.png',
  sceneStreet: '/assets/scene-street.png'
};

const feedImageMap = {
  ruobai: [themeAssets.sceneCafe, themeAssets.sceneStreet],
  linxia: [themeAssets.sceneKitchen, '/assets/cover-cake.png'],
  lingyin: [themeAssets.sceneStreet, themeAssets.sceneSunset],
  qiqi: [themeAssets.sceneSunset, themeAssets.sceneCafe]
};

const avatarMap = {
  ruobai: '/assets/char-ruobai.png',
  linxia: '/assets/char-linxia.png',
  lingyin: '/assets/char-lingyin.png'
};

const myPosts = [
  {
    time: '今天 18:20',
    tag: '心情分享',
    text: '下班路上看到超美的晚霞 🌇\n忍不住拍了下来，想和你们分享～',
    images: [themeAssets.sceneSunset, themeAssets.sceneSunset, themeAssets.sceneSunset],
    likes: 52,
    comments: 12
  },
  {
    time: '昨天 21:46',
    tag: '生活记录',
    text: '周末做了抹茶蛋糕 🍰\n虽然卖相一般，但味道还不错～',
    images: ['/assets/cover-cake.png', themeAssets.sceneKitchen, themeAssets.sceneCafe],
    likes: 36,
    comments: 15
  },
  {
    time: '前天 16:30',
    tag: '日常碎片',
    text: '今天和朋友去了书店，收获满满 📚\n喜欢这种安静又充实的感觉。',
    images: ['/assets/memory-city.png', themeAssets.sceneStreet, themeAssets.sceneCafe],
    likes: 44,
    comments: 18
  }
];

let feedLoaded = false;
let feedLoading = false;

function postCard(p) {
  const c = getChar(p.charId);
  const images = Array.isArray(p.images) && p.images.length ? p.images : (feedImageMap[p.charId] || []);
  const imgs = images.map((src, i) =>
    `<div class="post-img">
      ${src ? `<img src="${src}" alt="${c.name} 的动态图片">` : ''}
    </div>`
  ).join('');
  const cols = Math.min(Math.max(images.length, 1), 3);
  return `
  <article class="post" data-post-id="${p.id || ''}">
    <div class="post-head">
      ${avatar(c, 'md')}
      <div class="post-head-main">
        <span class="post-name">${c.name}</span>
        <span class="post-time">${p.time}</span>
        <span class="pill">${p.tag}</span>
      </div>
      <span class="post-more">${icon('dots',18)}</span>
    </div>
    <div class="post-text">${p.text.replace(/\n/g,'<br>')}</div>
    <div class="post-images cols-${cols}">${imgs}</div>
    <div class="post-actions">
      <button type="button" class="liked post-like-btn">${icon('heart',16)} ${p.likes}</button>
      <button type="button" class="post-comment-btn">${icon('comment',16)} ${p.comments}</button>
      <span>${icon('share',16)} 分享</span>
    </div>
  </article>`;
}

function desktopPostCard(p) {
  const c = getChar(p.charId);
  const images = Array.isArray(p.images) && p.images.length ? p.images : (feedImageMap[p.charId] || []);
  const layout = p.charId === 'linxia' ? 'compact-media' : '';
  return `
  <article class="feed-post-card ${layout}" data-post-id="${p.id || ''}">
    <div class="feed-post-avatar">${avatar(c, 'md')}</div>
    <div class="feed-post-copy">
      <div class="feed-post-meta">
        <strong>${c.name}</strong>
        <span>${p.time}</span>
        <span class="pill">${p.tag}</span>
      </div>
      <p>${p.text.replace(/\n/g, '<br>')}</p>
      <div class="feed-post-actions">
        <button type="button" class="liked post-like-btn">${icon('heart',16)} ${p.likes}</button>
        <button type="button" class="post-comment-btn">${icon('comment',16)} ${p.comments}</button>
        <span>${icon('share',16)} 回复</span>
      </div>
    </div>
    <div class="feed-post-media">
      ${images.slice(0, 2).map(src => `<img src="${src}" alt="${c.name} 的动态图片">`).join('')}
    </div>
    <span class="feed-post-more">${icon('dots',18)}</span>
  </article>`;
}

function desktopStories() {
  const storyChars = characters.filter(c => c.tag === '恋人').slice(0, 6);
  return `
  <section class="feed-story-row" aria-label="角色动态">
    ${storyChars.map(c => `
      <div class="feed-story ${c.id === state.currentCharId ? 'active' : ''}" data-char="${c.id}">
        ${avatar({ ...c, avatar: avatarMap[c.id] || c.avatar }, 'lg')}
        <span>${c.name}</span>
      </div>
    `).join('')}
    <button class="feed-story-more" type="button">更多⌄</button>
  </section>`;
}

function rightRail() {
  const topChars = characters.slice(0, 3);
  return `
  <aside class="right-panel feed-right-panel">
    <section class="section-card glass feed-care-panel">
      <div class="rail-title">今天最该关心谁 <span class="see-all">查看全部 ›</span></div>
      <div class="care-grid">
        ${topChars.map(c => `
          <div class="care-card">
            ${avatar({ ...c, avatar: avatarMap[c.id] || c.avatar }, 'md')}
            <div class="care-name">${c.name}</div>
            <span class="pill">${c.tag}</span>
            <div class="bar care-bar"><div class="bar-fill" data-width="${c.mood}"></div></div>
            <div class="care-score">${c.mood}%</div>
            <button class="btn-ghost care-btn" data-char="${c.id}">去看看</button>
          </div>
        `).join('')}
      </div>
    </section>
    <section class="section-card glass feed-mine-panel">
      <div class="rail-title">我的动态 <span class="see-all">全部 ›</span></div>
      <div class="mini-post-list">
        ${myPosts.map(post => `
          <article class="mini-post">
            <div class="mini-head">
              ${avatar({ name:'我', avatar:'/assets/avatar.png' }, 'sm')}
              <div><b>我</b> <span class="mini-time">${post.time}</span> <span class="pill">${post.tag}</span></div>
            </div>
            <div class="mini-text">${post.text.replace(/\n/g, '<br>')}</div>
            <div class="mini-thumbs">
              ${post.images.map(src => `<img src="${src}" alt="我的动态图片">`).join('')}
            </div>
            <div class="mini-actions">
              <span class="liked">${icon('heart',14)} ${post.likes}</span>
              <span>${icon('comment',14)} ${post.comments}</span>
            </div>
            <span class="mini-menu">${icon('dots',16)}</span>
          </article>
        `).join('')}
      </div>
    </section>
  </aside>`;
}

export function renderDesktop() {
  const desktopPosts = posts.slice(0, 3);
  return `
  <div class="feed-desktop">
    <header class="feed-page-header">
      <div>
        <h1>动态 <img class="title-deco" src="/assets/deco-star.png" alt="" aria-hidden="true"></h1>
        <p>看看她们今天的心情</p>
      </div>
      <div class="search-bar feed-search">${icon('search',18)}<input placeholder="搜索角色或动态、心情..." /></div>
      <button class="btn-publish">${icon('plus',16)} 发布心情</button>
    </header>
    ${desktopStories()}
    <div class="feed-scroll-region">
      ${desktopPosts.map(desktopPostCard).join('')}
    </div>
  </div>`;
}

export function renderDesktopRight() {
  return rightRail();
}

export function renderMobile() {
  return `
  <div class="app-body">
    <div class="page-header" ${revealAttr(0)}>
      <h1>动态</h1>
      <div class="icon-btn btn-publish">${icon('plus', 18)}</div>
    </div>
    <div class="moment-list">
      ${posts.map((p, i) => {
        const c = getChar(p.charId);
        const isMine = p.charId === state.currentCharId;
        const images = Array.isArray(p.images) && p.images.length ? p.images : [];
        return `
        <div class="moment-card ${isMine ? 'mine' : ''}" data-post-id="${p.id || ''}" ${revealAttr(60 + i * 70)}>
          <div class="moment-head">
            ${emojiAvatar(c, 'sm')}
            <div><div class="nm">${c.name}</div><div class="tm">${p.time}</div></div>
            <span class="pill">${p.tag}</span>
          </div>
          <div class="moment-body">${(p.text || '').replace(/\n/g,'<br>')}</div>
          ${images.length ? `<div class="moment-img">${images[0] ? `<img src="${images[0]}" alt="">` : (c.emoji || '🌸')}</div>` : ''}
          <div class="moment-actions">
            <button class="action-btn ${p.likes > 0 ? 'liked' : ''} post-like-btn">💗 ${p.likes || 0}</button>
            <button class="action-btn post-comment-btn">💬 ${p.comments || 0}</button>
            <button class="action-btn" style="margin-left:auto">分享</button>
          </div>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

export function bindPageEvents(renderCurrent) {
  async function refreshPosts(force = false) {
    if (feedLoading || (feedLoaded && !force)) return;
    feedLoading = true;
    const latest = await loadPosts().catch(() => []);
    posts.splice(0, posts.length, ...latest);
    feedLoaded = true;
    feedLoading = false;
    renderCurrent();
  }

  async function openComments(postId, post) {
    const comments = await loadPostComments(postId).catch(() => []);
    openDialog({
      title: '评论',
      content: `
        <div class="rb-comment-list">
          ${comments.length ? comments.map(item => `
            <div class="rb-comment-item">
              <strong>${getChar(String(item.character_id || post?.charId || state.currentCharId))?.name || '我'}</strong>
              <span>${item.content || ''}</span>
            </div>
          `).join('') : '<div class="rb-help">还没有评论，发第一条吧。</div>'}
        </div>
        <div class="rb-field">
          <label for="feed-comment-input">写评论</label>
          <textarea id="feed-comment-input" placeholder="输入评论内容"></textarea>
        </div>
      `,
      actions: [
        { label: '关闭' },
        {
          label: '发送',
          variant: 'primary',
          closeOnClick: false,
          onClick: async ({ root, close }) => {
            const content = root.querySelector('#feed-comment-input')?.value.trim() || '';
            if (!content) {
              window.alert('请输入评论内容');
              return;
            }
            await createPostComment(postId, content, state.currentCharId).catch(() => null);
            if (post) {
              post.comments = Number(post.comments || 0) + 1;
            }
            renderCurrent();
            close();
          }
        }
      ]
    });
  }

  document.querySelectorAll('.btn-publish').forEach(btn => {
    btn.addEventListener('click', async () => {
      const content = window.prompt('输入想发布的动态内容');
      if (!content || !content.trim()) return;
      const created = await createPost(content.trim(), state.currentCharId, '').catch(() => null);
      const createdItem = created?.item || created;
      if (createdItem?.id || createdItem?.content) {
        posts.unshift({
          id: createdItem.id,
          charId: state.currentCharId,
          time: createdItem.created_at || '刚刚',
          tag: '动态',
          text: createdItem.content || content.trim(),
          images: createdItem.images || [],
          likes: createdItem.likes || 0,
          comments: createdItem.comments_count || 0
        });
        renderCurrent();
      } else {
        await refreshPosts(true);
      }
    });
  });

  document.querySelectorAll('[data-post-id]').forEach(node => {
    const postId = node.getAttribute('data-post-id');
    if (!postId) return;
    const post = posts.find(item => String(item.id) === String(postId));
    const likeBtn = node.querySelector('.post-like-btn');
    const commentBtn = node.querySelector('.post-comment-btn');

    likeBtn?.addEventListener('click', async () => {
      if (!post) return;
      const liked = node.dataset.liked === '1';
      if (liked) {
        await unlikePost(postId).catch(() => null);
        node.dataset.liked = '0';
        post.likes = Math.max(0, Number(post.likes || 0) - 1);
      } else {
        await likePost(postId).catch(() => null);
        node.dataset.liked = '1';
        post.likes = Number(post.likes || 0) + 1;
      }
      renderCurrent();
    });

    commentBtn?.addEventListener('click', async () => {
      await openComments(postId, post);
    });
  });

  void refreshPosts();
}
