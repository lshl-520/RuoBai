import { readSessionSnapshot } from "./auth.js";
import { apiFetch } from "./api-base.js";
import { appendCachedMessages, replaceCachedMessage } from "./local-message-cache.js";

const QUEUE_PREFIX = "ruobai_pending_messages_v1";

function currentUserId() {
  const id = Number(readSessionSnapshot()?.user?.id);
  return Number.isInteger(id) && id > 0 ? String(id) : "";
}

function queueKey(userId = currentUserId()) {
  return userId ? QUEUE_PREFIX + ":" + userId : "";
}

function readQueue() {
  const key = queueKey();
  if (!key) return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(items) {
  const key = queueKey();
  if (!key) return;
  try { localStorage.setItem(key, JSON.stringify(items)); } catch {}
}

function queuePath(characterId, kind) {
  return kind === "save"
    ? "/api/chat/save?character_id=" + encodeURIComponent(characterId)
    : "/api/chat";
}

function queueBody(characterId, payload, kind) {
  return kind === "save"
    ? { ...payload }
    : { character_id: characterId, defer_side_effects: true, ...payload };
}

function serializeError(error) {
  return String(error instanceof Error ? error.message : error || "网络未连接").slice(0, 240);
}

export function isRetryableOfflineError(error) {
  const message = serializeError(error);
  return Boolean(
    error?.name === "AbortError"
    || /failed to fetch|networkerror|load failed|network request failed|网络|超时|等待太久/i.test(message)
  );
}

export function getPendingMessageCount() {
  return readQueue().length;
}

export async function enqueuePendingMessage(characterId, payload, { kind = "user" } = {}) {
  const userId = currentUserId();
  const roleId = Number(characterId);
  if (!userId || !Number.isInteger(roleId) || roleId <= 0) return null;

  const localId = "pending-" + Date.now() + "-" + Math.random().toString(36).slice(2);
  const createdAt = new Date().toISOString();
  const item = {
    ...payload,
    id: localId,
    local_id: localId,
    character_id: roleId,
    created_at: createdAt,
    sync_state: "pending",
  };
  await appendCachedMessages(roleId, [item]);

  const queue = readQueue();
  queue.push({
    localId,
    characterId: roleId,
    kind,
    payload: { ...payload },
    createdAt,
    attempts: 0,
    lastError: "",
  });
  writeQueue(queue);

  return { success: true, queued: true, item };
}

export async function flushPendingMessages() {
  const queue = readQueue();
  if (!queue.length) return { sent: 0, remaining: 0 };

  const remaining = [];
  let sent = 0;
  for (let index = 0; index < queue.length; index += 1) {
    const entry = queue[index];
    try {
      const response = await apiFetch(queuePath(entry.characterId, entry.kind), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(queueBody(entry.characterId, entry.payload, entry.kind)),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success || !data?.item) {
        const error = new Error(data?.error || "HTTP " + response.status);
        error.status = response.status;
        throw error;
      }
      await replaceCachedMessage(entry.characterId, entry.localId, {
        ...data.item,
        character_id: Number(data.item.character_id || entry.characterId),
        local_id: entry.localId,
        sync_state: "synced",
      });
      sent += 1;
    } catch (error) {
      remaining.push({ ...entry, attempts: Number(entry.attempts || 0) + 1, lastError: serializeError(error) });
      // 队列按发送顺序排，当前条失败时先不跳过，避免上下文乱序。
      remaining.push(...queue.slice(index + 1));
      break;
    }
  }

  writeQueue(remaining);
  return { sent, remaining: remaining.length };
}
