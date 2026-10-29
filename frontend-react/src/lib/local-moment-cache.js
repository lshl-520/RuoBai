import { readSessionSnapshot } from "./auth.js";

const CACHE_PREFIX = "ruobai_moments_cache_v1";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function currentUserId() {
  const id = Number(readSessionSnapshot()?.user?.id);
  return Number.isInteger(id) && id > 0 ? String(id) : "";
}

function normalizedRequest(request = {}) {
  return {
    scope: String(request.scope || "all"),
    characterId: String(request.characterId || ""),
    viewerCharacterId: String(request.viewerCharacterId || ""),
  };
}

export function getMomentCacheKey(request = {}) {
  const userId = currentUserId();
  if (!userId) return "";
  const normalized = normalizedRequest(request);
  return [
    CACHE_PREFIX,
    userId,
    normalized.scope,
    normalized.characterId,
    normalized.viewerCharacterId,
  ].map((part) => encodeURIComponent(part)).join(":");
}

function parseCache(value) {
  try {
    const payload = JSON.parse(String(value || ""));
    if (!payload || Date.now() - Number(payload.savedAt || 0) > CACHE_TTL_MS) return null;
    if (!Array.isArray(payload.items)) return null;
    return {
      success: true,
      items: payload.items,
      has_more: Boolean(payload.has_more),
      cached: true,
    };
  } catch {
    return null;
  }
}

export function readCachedMoments(request = {}) {
  const key = getMomentCacheKey(request);
  if (!key) return null;
  try { return parseCache(localStorage.getItem(key)); } catch { return null; }
}

export function writeCachedMoments(request = {}, payload = {}) {
  const key = getMomentCacheKey(request);
  if (!key || !Array.isArray(payload.items)) return;
  try {
    localStorage.setItem(key, JSON.stringify({
      savedAt: Date.now(),
      has_more: Boolean(payload.has_more),
      items: payload.items,
    }));
  } catch {}
}

function userCacheKeys() {
  const userId = currentUserId();
  const prefix = CACHE_PREFIX + ":" + encodeURIComponent(userId) + ":";
  if (!userId) return [];
  const keys = [];
  try {
    for (let index = 0; index < Number(localStorage.length || 0); index += 1) {
      const key = localStorage.key(index);
      if (key && key.startsWith(prefix)) keys.push(key);
    }
  } catch {}
  return keys;
}

function updateAcrossCaches(updater) {
  for (const key of userCacheKeys()) {
    try {
      const payload = JSON.parse(localStorage.getItem(key) || "null");
      if (!payload || !Array.isArray(payload.items)) continue;
      const nextItems = updater(payload.items);
      if (nextItems === payload.items) continue;
      localStorage.setItem(key, JSON.stringify({ ...payload, savedAt: Date.now(), items: nextItems }));
    } catch {}
  }
}

export function patchCachedMomentAcrossCaches(momentId, patch = {}) {
  const target = String(momentId);
  updateAcrossCaches((items) => {
    let changed = false;
    const next = items.map((item) => {
      if (String(item?.id) !== target) return item;
      changed = true;
      return { ...item, ...patch };
    });
    return changed ? next : items;
  });
}

export function appendCachedMomentCommentAcrossCaches(momentId, comment) {
  const target = String(momentId);
  updateAcrossCaches((items) => {
    let changed = false;
    const next = items.map((item) => {
      if (String(item?.id) !== target) return item;
      changed = true;
      const comments = Array.isArray(item.comments) ? item.comments : [];
      if (comments.some((entry) => String(entry?.id || entry?.local_id) === String(comment?.id || comment?.local_id))) return item;
      return { ...item, comments: [...comments, comment] };
    });
    return changed ? next : items;
  });
}

export function replaceCachedMomentCommentAcrossCaches(momentId, localId, replacement) {
  const targetMomentId = String(momentId);
  const targetCommentId = String(localId);
  updateAcrossCaches((items) => {
    let changed = false;
    const next = items.map((item) => {
      if (String(item?.id) !== targetMomentId) return item;
      const comments = Array.isArray(item.comments) ? item.comments : [];
      let commentChanged = false;
      const nextComments = comments.map((comment) => {
        if (String(comment?.local_id || comment?.id) !== targetCommentId) return comment;
        changed = true;
        commentChanged = true;
        return { ...comment, ...replacement };
      });
      if (commentChanged) return { ...item, comments: nextComments };
      changed = true;
      return { ...item, comments: [...comments, replacement] };
    });
    return changed ? next : items;
  });
}
