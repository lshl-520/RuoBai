import { readSessionSnapshot } from "./auth.js";
import { apiFetch } from "./api-base.js";
import {
  appendCachedMemory,
  patchCachedMemory,
  removeCachedMemory,
  replaceCachedMemory,
} from "./local-memory-cache.js";

const QUEUE_PREFIX = "ruobai_pending_memory_actions_v1";

function currentUserId() {
  const id = Number(readSessionSnapshot()?.user?.id);
  return Number.isInteger(id) && id > 0 ? String(id) : "";
}

function queueKey() {
  const userId = currentUserId();
  return userId ? QUEUE_PREFIX + ":" + userId : "";
}

function readQueue() {
  const key = queueKey();
  if (!key) return [];
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function writeQueue(items) {
  const key = queueKey();
  if (!key) return;
  try { localStorage.setItem(key, JSON.stringify(items)); } catch {}
}

function text(error) {
  return String(error instanceof Error ? error.message : error || "网络未连接").slice(0, 240);
}

export function isRetryableMemoryError(error) {
  return /failed to fetch|networkerror|load failed|network request failed|网络|超时|等待太久/i.test(text(error));
}

export function getPendingMemoryActionCount() {
  return readQueue().length;
}

function applyOptimistic(action) {
  if (action.kind === "create" && action.optimisticMemory) appendCachedMemory(action.characterId, action.optimisticMemory);
  if (action.kind === "update" || action.kind === "restore") patchCachedMemory(action.characterId, action.memoryId, action.optimisticPatch || {});
  if (action.kind === "delete") removeCachedMemory(action.characterId, action.memoryId);
}

export async function enqueueMemoryAction({ characterId, kind, memoryId = "", payload = {}, optimisticMemory = null, optimisticPatch = null }) {
  const userId = currentUserId();
  if (!userId || !characterId || !kind) return null;

  const queue = readQueue();
  const localId = optimisticMemory?.local_id || memoryId || "pending-memory-" + Date.now() + "-" + Math.random().toString(36).slice(2);

  // 同一条刚离线新增的记忆后续编辑时，合并进新增动作，避免拿本地临时 id 请求服务器。
  if (kind === "update" && String(memoryId).startsWith("pending-memory-")) {
    const created = queue.find((item) => item.kind === "create" && item.localId === String(memoryId));
    if (created) {
      created.payload = { ...created.payload, ...payload };
      writeQueue(queue);
      patchCachedMemory(characterId, memoryId, optimisticPatch || payload);
      return { success: true, queued: true, data: optimisticMemory || null };
    }
  }

  if (kind === "delete" && String(memoryId).startsWith("pending-memory-")) {
    writeQueue(queue.filter((item) => item.localId !== String(memoryId)));
    removeCachedMemory(characterId, memoryId);
    return { success: true, queued: true };
  }

  const action = {
    localId,
    characterId: Number(characterId),
    memoryId: String(memoryId || localId),
    kind,
    payload: { ...payload },
    optimisticMemory,
    optimisticPatch,
    createdAt: new Date().toISOString(),
    attempts: 0,
    lastError: "",
  };
  queue.push(action);
  writeQueue(queue);
  applyOptimistic(action);
  return { success: true, queued: true, data: optimisticMemory || null };
}

function pathFor(action) {
  if (action.kind === "create") return "/api/memories?character_id=" + encodeURIComponent(action.characterId);
  if (action.kind === "restore") return "/api/memories/" + encodeURIComponent(action.memoryId) + "/restore";
  return "/api/memories/" + encodeURIComponent(action.memoryId);
}

function methodFor(action) {
  if (action.kind === "create") return "POST";
  if (action.kind === "update") return "PATCH";
  if (action.kind === "restore") return "POST";
  return "DELETE";
}

export async function flushPendingMemoryActions() {
  const queue = readQueue();
  if (!queue.length) return { sent: 0, remaining: 0 };
  const remaining = [];
  let sent = 0;

  for (let index = 0; index < queue.length; index += 1) {
    const action = queue[index];
    try {
      const response = await apiFetch(pathFor(action), {
        method: methodFor(action),
        headers: { "Content-Type": "application/json" },
        body: action.kind === "delete" ? undefined : JSON.stringify(action.payload || {}),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) throw new Error(data?.error || "HTTP " + response.status);

      if (action.kind === "create" && data.data) replaceCachedMemory(action.characterId, action.localId, { ...data.data, local_id: action.localId, sync_state: "synced" });
      if (action.kind === "update" && data.data) replaceCachedMemory(action.characterId, action.memoryId, { ...data.data, local_id: action.memoryId, sync_state: "synced" });
      if (action.kind === "restore" && data.data) replaceCachedMemory(action.characterId, action.memoryId, { ...data.data, local_id: action.memoryId, sync_state: "synced" });
      if (action.kind === "delete") removeCachedMemory(action.characterId, action.memoryId);
      sent += 1;
    } catch (error) {
      remaining.push({ ...action, attempts: Number(action.attempts || 0) + 1, lastError: text(error) });
      remaining.push(...queue.slice(index + 1));
      break;
    }
  }

  writeQueue(remaining);
  return { sent, remaining: remaining.length };
}
