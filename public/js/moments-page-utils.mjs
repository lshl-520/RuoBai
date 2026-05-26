export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function normalizeMomentImages(value) {
  const raw = typeof value === 'string'
    ? (() => {
        try {
          return JSON.parse(value);
        } catch {
          return [];
        }
      })()
    : value;

  if (!Array.isArray(raw)) return [];
  return raw.map(item => String(item || '').trim()).filter(Boolean).slice(0, 9);
}

export function buildMomentImageItems(images = []) {
  return normalizeMomentImages(images).map((src, index) => ({
    src,
    index,
    alt: `动态图片 ${index + 1}`
  }));
}

export function formatMomentDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function findRole(roles, characterId) {
  return roles.find(role => String(role.id) === String(characterId)) || null;
}

export function buildMomentViewModel(items = [], roles = [], options = {}) {
  const viewerName = String(options.viewerName || '江湖小白').trim() || '江湖小白';
  const viewerAvatar = String(options.viewerAvatar || '').trim();

  return items
    .map(item => {
      const role = item.character_id ? findRole(roles, item.character_id) : null;
      const isMine = !item.character_id;
      const comments = Array.isArray(item.comments) ? item.comments : [];
      return {
        id: Number(item.id),
        characterId: item.character_id || item.characterId || null,
        authorName: role?.name || (isMine ? viewerName : `角色 ${item.character_id || ''}`.trim()),
        avatar: isMine ? viewerAvatar : (role?.portraitRound || role?.avatar || ''),
        tagText: isMine ? '我' : (role?.tag || '角色'),
        isMine,
        content: String(item.content || '').trim(),
        images: normalizeMomentImages(item.images),
        likesCount: Number(item.likes_count ?? item.likesCount ?? 0),
        commentsCount: Number(item.comments_count ?? item.commentsCount ?? comments.length),
        liked: Boolean(item.liked),
        comments,
        createdAt: item.created_at || item.createdAt || '',
        dateText: formatMomentDate(item.created_at || item.createdAt)
      };
    })
    .filter(item => Number.isFinite(item.id) && item.id > 0 && item.content)
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

export function buildMomentDetailViewModel(item = {}, roles = [], options = {}) {
  const [detail] = buildMomentViewModel([item], roles, options);
  return {
    ...(detail || {}),
    canRender: Boolean(detail && detail.id && detail.content)
  };
}

export function buildMomentPayload(form = {}) {
  const content = String(form.content || '').trim();
  const images = normalizeMomentImages(form.images);

  return {
    content,
    images,
    ...(content ? {} : { error: '动态内容不能为空' })
  };
}

export function buildCommentPayload(value) {
  const content = String(value || '').trim();
  return {
    content,
    ...(content ? {} : { error: '评论内容不能为空' })
  };
}
