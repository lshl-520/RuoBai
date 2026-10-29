import { readSessionSnapshot } from "./auth.js";
import { apiFetch } from "./api-base.js";
import { writeCachedProfile } from "./local-profile-cache.js";

const QUEUE_PREFIX = "ruobai_pending_profile_actions_v1";

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

function errorText(error) {
  return String(error instanceof Error ? error.message : error || "网络未连接").slice(0, 240);
}

export function isRetryableProfileError(error) {
  return /failed to fetch|networkerror|load failed|network request failed|网络|超时|等待太久/i.test(errorText(error));
}

export function getPendingProfileActionCount() {
  return readQueue().length;
}

export function enqueueProfileUpdate(payload, user) {
  const queue = readQueue();
  queue.push({
    payload: { ...payload },
    createdAt: new Date().toISOString(),
    attempts: 0,
    lastError: "",
  });
  writeQueue(queue);
  writeCachedProfile(user);
  return { success: true, queued: true, user };
}

export async function flushPendingProfileActions() {
  const queue = readQueue();
  if (!queue.length) return { sent: 0, remaining: 0 };
  const remaining = [];
  let sent = 0;

  for (let index = 0; index < queue.length; index += 1) {
    const action = queue[index];
    try {
      const response = await apiFetch("/api/users/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action.payload || {}),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success || !data?.user) throw new Error(data?.error || "HTTP " + response.status);
      writeCachedProfile(data.user);
      sent += 1;
    } catch (error) {
      remaining.push({ ...action, attempts: Number(action.attempts || 0) + 1, lastError: errorText(error) });
      remaining.push(...queue.slice(index + 1));
      break;
    }
  }

  writeQueue(remaining);
  return { sent, remaining: remaining.length };
}
