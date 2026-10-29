import { readSessionSnapshot } from "./auth.js";

const CACHE_PREFIX = "ruobai_memories_cache_v1";
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

function parse(value) {
  try {
    const payload = JSON.parse(String(value || ""));
    if (!payload || Date.now() - Number(payload.savedAt || 0) > CACHE_TTL_MS || !Array.isArray(payload.data)) return null;
    return { success: true, data: payload.data, cached: true };
  } catch {
    return null;
  }
}

export function readCachedMemories(characterId) {
  const key = cacheKey(characterId);
  if (!key) return null;
  try { return parse(localStorage.getItem(key)); } catch { return null; }
}

export function writeCachedMemories(characterId, data) {
  const key = cacheKey(characterId);
  if (!key || !Array.isArray(data)) return;
  try { localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data })); } catch {}
}

export function appendCachedMemory(characterId, memory) {
  const current = readCachedMemories(characterId);
  const next = [...(current?.data || []), memory];
  writeCachedMemories(characterId, next);
}

export function replaceCachedMemory(characterId, targetId, replacement) {
  const current = readCachedMemories(characterId);
  const target = String(targetId);
  const next = (current?.data || []).map((memory) => (
    String(memory?.local_id || memory?.id) === target ? { ...memory, ...replacement } : memory
  ));
  if (next.some((memory) => String(memory?.local_id || memory?.id) === target)) {
    writeCachedMemories(characterId, next);
    return;
  }
  appendCachedMemory(characterId, replacement);
}

export function patchCachedMemory(characterId, memoryId, patch = {}) {
  const current = readCachedMemories(characterId);
  const target = String(memoryId);
  const next = (current?.data || []).map((memory) => (
    String(memory?.local_id || memory?.id) === target ? { ...memory, ...patch } : memory
  ));
  writeCachedMemories(characterId, next);
}

export function removeCachedMemory(characterId, memoryId) {
  const current = readCachedMemories(characterId);
  const target = String(memoryId);
  writeCachedMemories(characterId, (current?.data || []).filter((memory) => String(memory?.local_id || memory?.id) !== target));
}
