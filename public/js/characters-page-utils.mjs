export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function clampPercent(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(100, Math.max(0, Math.round(number)));
}

function clampNumber(value, fallback, min, max) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function normalizeAutoMomentSettings(values = {}) {
  const enabled = values.auto_moments_enabled === true
    || values.auto_moments_enabled === 1
    || values.auto_moments_enabled === '1'
    || values.auto_moments_enabled === 'true'
    || values.auto_moments_enabled === 'on'
    || values.autoMomentsEnabled === true;
  const dailyMin = clampNumber(
    values.auto_moments_daily_min ?? values.autoMomentsDailyMin,
    enabled ? 2 : 0,
    0,
    6
  );
  const dailyMax = clampNumber(
    values.auto_moments_daily_max ?? values.autoMomentsDailyMax,
    enabled ? 6 : 0,
    0,
    6
  );

  return {
    enabled,
    dailyMin: enabled ? Math.min(dailyMin, dailyMax) : 0,
    dailyMax: enabled ? Math.max(dailyMin, dailyMax) : 0,
    minIntervalHours: clampNumber(
      values.auto_moments_min_interval_hours ?? values.autoMomentsMinIntervalHours,
      4,
      4,
      24
    )
  };
}

function normalizeTag(value) {
  return String(value || '').trim();
}

function normalizePortraitId(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number)) return null;
  if (number === 999) return 999;
  return number >= 0 && number <= 17 ? number : null;
}

function normalizePersona(value) {
  return String(value || '').trim() || '还没有人设';
}

function normalizeName(value, id) {
  return String(value || '').trim() || `角色 ${id || ''}`.trim();
}

function daysSince(value) {
  const time = value ? new Date(value).getTime() : NaN;
  if (!Number.isFinite(time)) return null;
  const diff = Date.now() - time;
  if (diff < 0) return 1;
  return Math.max(1, Math.ceil(diff / (24 * 60 * 60 * 1000)));
}

function defaultPortraitFor(role) {
  const name = String(role?.name || '');
  if (name.includes('若白') || name.includes('小白')) {
    return 'images/ruobai-standing.png';
  }
  return '';
}

function defaultRoomBackgroundFor() {
  return 'images/ruobai-theme/room.webp';
}

export function buildCharactersViewModel(items = []) {
  return items.map(item => {
    const id = Number(item?.id);
    const name = normalizeName(item?.name, id);
    const tag = normalizeTag(item?.tag);
    const persona = normalizePersona(item?.persona);
    const avatar = String(item?.avatar || '').trim();
    const portraitId = normalizePortraitId(item?.portrait_id ?? item?.portraitId);
    const portraitCustomUrl = String(item?.portrait_custom_url || item?.portraitCustomUrl || '').trim();
    const intimacy = clampPercent(item?.intimacy, 50);
    const mood = clampPercent(item?.mood, 80);
    const autoMoments = normalizeAutoMomentSettings(item);
    return {
      id,
      name,
      tag,
      persona,
      avatar,
      portraitId,
      portraitCustomUrl,
      mood,
      intimacy,
      speechStyle: item?.speech_style || item?.speechStyle || 'natural',
      autoMomentsEnabled: autoMoments.enabled,
      autoMomentsDailyMin: autoMoments.dailyMin,
      autoMomentsDailyMax: autoMoments.dailyMax,
      autoMomentsMinIntervalHours: autoMoments.minIntervalHours,
      autoMomentsLastPostedAt: item?.auto_moments_last_posted_at || item?.autoMomentsLastPostedAt || null,
      isActive: Boolean(item?.is_active || item?.isActive),
      isDeleted: Boolean(item?.is_deleted || item?.isDeleted),
      deleteAfter: item?.delete_after || item?.deleteAfter || null,
      createdDays: daysSince(item?.created_at),
      portrait: getPortraitImage({ portraitId, portraitCustomUrl, avatar, name }, 'full'),
      portraitSquare: getPortraitImage({ portraitId, portraitCustomUrl, avatar, name }, 'square'),
      portraitRound: getPortraitImage({ portraitId, portraitCustomUrl, avatar, name }, 'round'),
      roomBackground: String(item?.room_background || item?.roomBackground || '').trim() || defaultRoomBackgroundFor()
    };
  }).filter(role => Number.isFinite(role.id) && role.id > 0);
}

export function getPortraitImage(role = {}, variant = 'square') {
  const portraitId = normalizePortraitId(role.portraitId ?? role.portrait_id);
  const customUrl = String(role.portraitCustomUrl || role.portrait_custom_url || '').trim();
  if (portraitId === 999 && customUrl) return customUrl;
  if (portraitId !== null) return `/assets/portraits/${variant}/${portraitId}.png`;
  return String(role.avatar || role.portrait || role.standing_image || '').trim() || defaultPortraitFor(role);
}

export function buildPortraitChoices({ portraitId = null, customUrl = '' } = {}) {
  const activeId = normalizePortraitId(portraitId);
  const uploadedUrl = String(customUrl || '').trim();
  const uploaded = uploadedUrl
    ? [{
        id: 999,
        label: '我上传的',
        src: uploadedUrl,
        uploaded: true,
        active: activeId === 999
      }]
    : [];
  const presets = Array.from({ length: 18 }, (_item, index) => ({
    id: index,
    label: `${index} 号`,
    src: `/assets/portraits/square/${index}.png`,
    uploaded: false,
    active: activeId === index
  }));
  return [...uploaded, ...presets];
}

export function buildFilterItems(roles = []) {
  const counts = new Map();
  for (const role of roles) {
    const tag = normalizeTag(role?.tag);
    if (!tag) continue;
    counts.set(tag, (counts.get(tag) || 0) + 1);
  }

  return [
    { label: '全部', value: 'all', count: roles.length },
    ...Array.from(counts.entries()).map(([tag, count]) => ({
      label: tag,
      value: tag,
      count
    }))
  ];
}

export function getChatHref(role) {
  const id = encodeURIComponent(String(role?.id || ''));
  const name = encodeURIComponent(String(role?.name || ''));
  return `chat-room.html?id=${id}&name=${name}`;
}

export function pickActiveRole(roles = []) {
  return roles.find(role => role.isActive) || roles[0] || null;
}

export function buildRolePayload(values = {}) {
  const name = String(values.name || '').trim();
  const persona = String(values.persona || '').trim();
  if (!name) return { error: '请先填写角色名字' };
  if (!persona) return { error: '请先填写角色人设' };

  const autoMoments = normalizeAutoMomentSettings(values);

  return {
    name,
    tag: normalizeTag(values.tag),
    persona,
    avatar: String(values.avatar || '').trim(),
    portrait_id: normalizePortraitId(values.portrait_id ?? values.portraitId),
    portrait_custom_url: normalizePortraitId(values.portrait_id ?? values.portraitId) === 999
      ? (String(values.portrait_custom_url || values.portraitCustomUrl || '').trim() || null)
      : null,
    mood: clampPercent(values.mood, 80),
    intimacy: clampPercent(values.intimacy, 50),
    speech_style: ['natural', 'compact', 'roleplay'].includes(values.speech_style) ? values.speech_style : 'natural',
    auto_moments_enabled: autoMoments.enabled,
    auto_moments_daily_min: autoMoments.dailyMin,
    auto_moments_daily_max: autoMoments.dailyMax,
    auto_moments_min_interval_hours: autoMoments.minIntervalHours
  };
}
