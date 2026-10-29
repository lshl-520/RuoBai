import { Capacitor } from "@capacitor/core";
import { readSessionSnapshot } from "./auth.js";
import { openNativeLocalDatabase } from "./local-sqlite.js";

const CACHE_PREFIX = "ruobai_roles_cache_v1";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function currentUserId() {
  const id = Number(readSessionSnapshot()?.user?.id);
  return Number.isInteger(id) && id > 0 ? String(id) : "";
}

function cacheKey(userId = currentUserId()) {
  return userId ? `${CACHE_PREFIX}:${userId}` : "";
}

/**
 * ★ 2026/10/6：把角色列表排成「主陪伴第一、其余按 id」——
 * 必须和 `server/roles.js` 的 `ORDER BY is_deleted ASC, is_active DESC, id ASC`
 * 保持一致，否则手机上的本地缓存会和服务端给出两种顺序，列表就会跳。
 */
export function sortRolesLikeServer(items = []) {
  return [...(Array.isArray(items) ? items : [])].sort((a, b) => {
    const primaryDiff = (b?.is_active ? 1 : 0) - (a?.is_active ? 1 : 0);
    if (primaryDiff !== 0) return primaryDiff;
    return Number(a?.id) - Number(b?.id);
  });
}

function normalizeItems(items) {
  return (Array.isArray(items) ? items : [])
    .filter((item) => item && Number.isInteger(Number(item.id)))
    .map((item) => ({ ...item, id: Number(item.id) }));
}

function parseStored(value) {
  try {
    const payload = JSON.parse(String(value || ""));
    if (!payload || Date.now() - Number(payload.savedAt || 0) > CACHE_TTL_MS) return null;
    const items = normalizeItems(payload.items);
    return items.length ? { success: true, items, cached: true } : null;
  } catch {
    return null;
  }
}

function readWebCache(userId) {
  const key = cacheKey(userId);
  if (!key) return null;
  try {
    return parseStored(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function writeWebCache(userId, items) {
  const key = cacheKey(userId);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), items: normalizeItems(items) }));
  } catch {}
}

async function readNativeCache(userId) {
  if (!Capacitor.isNativePlatform?.() || !userId) return null;
  const opened = await openNativeLocalDatabase();
  if (!opened) return null;

  const owner = await opened.db.query(
    "SELECT value FROM app_meta WHERE key = ?",
    ["roles_user_id"],
  );
  if (String(owner?.values?.[0]?.value || "") !== String(userId)) return null;

  /**
   * ★ 2026/10/6 修：手机 App 聊天列表顺序错乱（小白从第一掉到最后）。
   *
   * 病根：原来这里按 updated_at 倒序 —— 而 updated_at 是
   * **本地写入时间**，每次同步都会把**刚刚被写进去的角色**排到最前。
   * 于是「谁最后被同步」而不是「谁是主陪伴」决定了谁在最上面，
   * 表现就是：先看到缓存给的顺序、几秒后拉到服务端数据又整列表跳一次，
   * 你的小白（id 48）被反复挤到最后。
   *
   * 服务端的顺序才是唯一事实（`roles.js`：is_deleted ASC, is_active DESC, id ASC
   * —— 主陪伴/当前角色在最前）。所以这里改成：
   *   ① 主陪伴（current_json.is_active）最前；
   *   ② 其余按 id 升序，和服务端保持一致；
   *   ③ updated_at 只当最后的兜底，绝不再让它决定名次。
   *
   * 这样缓存顺序 === 服务端顺序，列表就不再跳。
   */
  const result = await opened.db.query(
    "SELECT remote_id, current_json, identity_json FROM characters WHERE remote_id IS NOT NULL",
  );
  const items = (result?.values || []).map((row) => {
    try {
      const parsed = JSON.parse(String(row.current_json || row.identity_json || "{}"));
      return { ...parsed, id: Number(row.remote_id) };
    } catch {
      return null;
    }
  }).filter(Boolean);
  if (!items.length) return null;
  return { success: true, items: normalizeItems(sortRolesLikeServer(items)), cached: true };
}

async function writeNativeCache(userId, items) {
  if (!Capacitor.isNativePlatform?.() || !userId) return;
  const opened = await openNativeLocalDatabase();
  if (!opened) return;
  const normalized = normalizeItems(items);
  await opened.db.run("BEGIN");
  try {
    await opened.db.run("DELETE FROM characters WHERE remote_id IS NOT NULL");
    for (const item of normalized) {
      const now = new Date().toISOString();
      const remoteId = Number(item.id);
      await opened.db.run(
        `INSERT OR REPLACE INTO characters
          (local_id, remote_id, char_key, identity_json, current_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          `remote-character-${remoteId}`,
          remoteId,
          String(item.char_key || item.name || remoteId),
          JSON.stringify(item),
          JSON.stringify(item),
          String(item.created_at || now),
          now,
        ],
      );
    }
    await opened.db.run(
      "INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)",
      ["roles_user_id", String(userId)],
    );
    await opened.db.run("COMMIT");
  } catch (error) {
    try { await opened.db.run("ROLLBACK"); } catch {}
    throw error;
  }
}

export async function readCachedRoles() {
  const userId = currentUserId();
  if (!userId) return null;
  try {
    const native = await readNativeCache(userId);
    if (native) return native;
  } catch {}
  return readWebCache(userId);
}

export async function writeCachedRoles(items) {
  const userId = currentUserId();
  if (!userId) return;
  const normalized = normalizeItems(items);
  writeWebCache(userId, normalized);
  try {
    await writeNativeCache(userId, normalized);
  } catch {}
}

export function clearCachedRoles() {
  const userId = currentUserId();
  const key = cacheKey(userId);
  if (!key) return;
  try { localStorage.removeItem(key); } catch {}
}

