import { readSessionSnapshot, writeSessionSnapshot } from "./auth.js";

const PROFILE_PREFIX = "ruobai_profile_cache_v1";
const STATS_PREFIX = "ruobai_profile_stats_cache_v1";
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function currentUserId() {
  const id = Number(readSessionSnapshot()?.user?.id);
  return Number.isInteger(id) && id > 0 ? String(id) : "";
}

function key(prefix) {
  const userId = currentUserId();
  return userId ? prefix + ":" + userId : "";
}

function readPayload(storageKey) {
  if (!storageKey) return null;
  try {
    const payload = JSON.parse(localStorage.getItem(storageKey) || "null");
    if (!payload || Date.now() - Number(payload.savedAt || 0) > CACHE_TTL_MS) return null;
    return payload;
  } catch {
    return null;
  }
}

export function readCachedProfile() {
  const payload = readPayload(key(PROFILE_PREFIX));
  if (payload?.user) return { success: true, loggedIn: true, user: payload.user, cached: true };
  const snapshot = readSessionSnapshot();
  return snapshot?.user ? { success: true, loggedIn: true, user: snapshot.user, cached: true } : null;
}

export function writeCachedProfile(user) {
  if (!user) return;
  const storageKey = key(PROFILE_PREFIX);
  try { if (storageKey) localStorage.setItem(storageKey, JSON.stringify({ savedAt: Date.now(), user })); } catch {}
  try { writeSessionSnapshot({ loggedIn: true, user }); } catch {}
}

export function readCachedProfileStats() {
  const payload = readPayload(key(STATS_PREFIX));
  return payload?.item ? { success: true, item: payload.item, cached: true } : null;
}

export function writeCachedProfileStats(item) {
  const storageKey = key(STATS_PREFIX);
  if (!storageKey || !item) return;
  try { localStorage.setItem(storageKey, JSON.stringify({ savedAt: Date.now(), item })); } catch {}
}
