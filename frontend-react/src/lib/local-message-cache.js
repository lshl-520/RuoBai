import { Capacitor } from "@capacitor/core";
import { readSessionSnapshot } from "./auth.js";
import { openNativeLocalDatabase } from "./local-sqlite.js";

const CACHE_PREFIX = "ruobai_messages_cache_v1";
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_CACHED_MESSAGES = 400;

function currentUserId() {
  const id = Number(readSessionSnapshot()?.user?.id);
  return Number.isInteger(id) && id > 0 ? String(id) : "";
}

function cacheKey(userId, characterId) {
  return userId && characterId ? `${CACHE_PREFIX}:${userId}:${characterId}` : "";
}

function normalizeMessages(items) {
  return (Array.isArray(items) ? items : [])
    .filter((item) => item && item.created_at && item.role)
    .map((item) => ({
      ...item,
      id: Number.isInteger(Number(item.id)) ? Number(item.id) : item.id,
      character_id: Number(item.character_id || 0),
      content: String(item.content || ""),
      message_type: String(item.message_type || "text"),
      created_at: String(item.created_at),
    }));
}

function parseJson(value) {
  try {
    return JSON.parse(String(value || ""));
  } catch {
    return null;
  }
}

function parseWebCache(value) {
  const payload = parseJson(value);
  if (!payload || Date.now() - Number(payload.savedAt || 0) > CACHE_TTL_MS) return null;
  const items = normalizeMessages(payload.items);
  return items.length ? { success: true, items, has_more: false, cached: true } : null;
}

function readWebCache(userId, characterId) {
  const key = cacheKey(userId, characterId);
  if (!key) return null;
  try {
    return parseWebCache(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function writeWebCache(userId, characterId, items) {
  const key = cacheKey(userId, characterId);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), items: normalizeMessages(items) }));
  } catch {}
}

function packExtras(message) {
  return JSON.stringify({
    media_url: message.media_url || null,
    reasoning_summary: message.reasoning_summary || "",
    inner_os_content: message.inner_os_content || "",
    inner_os_source: message.inner_os_source || "",
    dur: message.dur || "",
    tag: message.tag || "",
    sticker_img: message.sticker_img || "",
    audio_url: message.audio_url || "",
  });
}

async function readNativeCache(userId, characterId) {
  if (!Capacitor.isNativePlatform?.() || !userId || !characterId) return null;
  const opened = await openNativeLocalDatabase();
  if (!opened) return null;
  const owner = await opened.db.query(
    "SELECT value FROM app_meta WHERE key = ?",
    ["messages_user_id"],
  );
  if (String(owner?.values?.[0]?.value || "") !== String(userId)) return null;

  const result = await opened.db.query(
    `SELECT local_id, remote_id, role, content, message_type, media_ref, created_at, sync_state
       FROM messages
      WHERE character_local_id = ?
      ORDER BY created_at ASC, remote_id ASC`,
    [`remote-character-${characterId}`],
  );
  const items = (result?.values || []).map((row) => {
    const extras = parseJson(row.media_ref) || {};
    return {
      id: row.remote_id == null ? row.local_id : Number(row.remote_id),
      local_id: row.local_id,
      character_id: Number(characterId),
      role: row.role,
      content: row.content || "",
      message_type: row.message_type || "text",
      created_at: row.created_at,
      sync_state: row.sync_state || "synced",
      ...extras,
    };
  });
  return items.length ? { success: true, items: normalizeMessages(items), has_more: false, cached: true } : null;
}

async function writeNativeCache(userId, characterId, items) {
  if (!Capacitor.isNativePlatform?.() || !userId || !characterId) return;
  const opened = await openNativeLocalDatabase();
  if (!opened) return;
  const normalized = normalizeMessages(items);
  await opened.db.run("BEGIN");
  try {
    await opened.db.run(
      "DELETE FROM messages WHERE character_local_id = ?",
      [`remote-character-${characterId}`],
    );
    for (const [index, item] of normalized.entries()) {
      const remoteId = Number.isInteger(Number(item.id)) ? Number(item.id) : null;
      const localId = String(item.local_id || (remoteId ? "remote-message-" + characterId + "-" + remoteId : "local-message-" + characterId + "-" + index));
      const now = new Date().toISOString();
      await opened.db.run(
        `INSERT OR REPLACE INTO messages
          (local_id, remote_id, character_local_id, role, content, message_type, media_ref, created_at, sync_state)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          localId,
          remoteId,
          `remote-character-${characterId}`,
          String(item.role),
          String(item.content || ""),
          String(item.message_type || "text"),
          packExtras(item),
          String(item.created_at || now),
          String(item.sync_state || "synced"),
        ],
      );
    }
    await opened.db.run(
      "INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)",
      ["messages_user_id", String(userId)],
    );
    await opened.db.run("COMMIT");
  } catch (error) {
    try { await opened.db.run("ROLLBACK"); } catch {}
    throw error;
  }
}

export async function readCachedMessages(characterId) {
  const userId = currentUserId();
  const roleId = Number(characterId);
  if (!userId || !Number.isInteger(roleId) || roleId <= 0) return null;
  try {
    const native = await readNativeCache(userId, roleId);
    if (native) return native;
  } catch {}
  return readWebCache(userId, roleId);
}

export async function writeCachedMessages(characterId, items) {
  const userId = currentUserId();
  const roleId = Number(characterId);
  if (!userId || !Number.isInteger(roleId) || roleId <= 0) return;
  const normalized = normalizeMessages(items);
  if (!normalized.length) return;
  writeWebCache(userId, roleId, normalized);
  try {
    await writeNativeCache(userId, roleId, normalized);
  } catch {}
}

export async function appendCachedMessages(characterId, items) {
  const current = await readCachedMessages(characterId);
  const merged = [...(current?.items || []), ...normalizeMessages(items)];
  const seen = new Set();
  const unique = merged.filter((item) => {
    const key = Number.isInteger(Number(item.id))
      ? `id:${item.id}`
      : `${item.role}|${item.created_at}|${item.message_type}|${item.content}|${item.media_url || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  await writeCachedMessages(characterId, unique.slice(-MAX_CACHED_MESSAGES));
}

export async function replaceCachedMessage(characterId, localId, replacement) {
  const current = await readCachedMessages(characterId);
  const target = String(localId || "");
  const nextItem = {
    ...replacement,
    local_id: target || replacement?.local_id,
    sync_state: replacement?.sync_state || "synced",
  };
  const items = current?.items || [];
  const index = items.findIndex((item) => String(item.local_id || item.id) === target);
  if (index < 0) {
    await appendCachedMessages(characterId, [nextItem]);
    return;
  }
  const next = [...items];
  next[index] = { ...next[index], ...nextItem };
  await writeCachedMessages(characterId, next.slice(-MAX_CACHED_MESSAGES));
}

export async function clearCachedMessages(characterId) {
  const userId = currentUserId();
  const roleId = Number(characterId);
  if (!userId || !Number.isInteger(roleId) || roleId <= 0) return;
  const key = cacheKey(userId, roleId);
  try { localStorage.removeItem(key); } catch {}
  if (!Capacitor.isNativePlatform?.()) return;
  try {
    const opened = await openNativeLocalDatabase();
    await opened?.db.run(
      "DELETE FROM messages WHERE character_local_id = ?",
      [`remote-character-${roleId}`],
    );
  } catch {}
}
