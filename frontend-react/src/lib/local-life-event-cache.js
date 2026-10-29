import { readSessionSnapshot } from "./auth.js";

const CACHE_PREFIX = "ruobai_life_events_cache_v1";
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function currentUserId() {
  const id = Number(readSessionSnapshot()?.user?.id);
  return Number.isInteger(id) && id > 0 ? String(id) : "";
}

function cacheKey(characterId) {
  const userId = currentUserId();
  const roleId = Number(characterId);
  return userId && Number.isInteger(roleId) && roleId > 0 ? CACHE_PREFIX + ":" + userId + ":" + roleId : "";
}

function parseCache(value) {
  try {
    const payload = JSON.parse(String(value || ""));
    if (!payload || Date.now() - Number(payload.savedAt || 0) > CACHE_TTL_MS) return null;
    if (!Array.isArray(payload.items)) return null;
    return { success: true, items: payload.items, cached: true };
  } catch {
    return null;
  }
}

export function readCachedLifeEvents(characterId) {
  const key = cacheKey(characterId);
  if (!key) return null;
  try { return parseCache(localStorage.getItem(key)); } catch { return null; }
}

export function writeCachedLifeEvents(characterId, items) {
  const key = cacheKey(characterId);
  if (!key || !Array.isArray(items)) return;
  try { localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), items })); } catch {}
}

export function patchCachedLifeEvent(characterId, eventId, patch = {}) {
  const current = readCachedLifeEvents(characterId);
  const target = String(eventId);
  const items = current?.items || [];
  let found = false;
  const next = items.map((event) => {
    if (String(event?.id) !== target) return event;
    found = true;
    return { ...event, ...patch, id: event.id };
  });
  if (!found && eventId) next.push({ id: eventId, ...patch });
  writeCachedLifeEvents(characterId, next);
}

export function removeCachedLifeEvent(characterId, eventId) {
  const current = readCachedLifeEvents(characterId);
  const target = String(eventId);
  writeCachedLifeEvents(characterId, (current?.items || []).filter((event) => String(event?.id) !== target));
}
