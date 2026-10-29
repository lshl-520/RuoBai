import { readSessionSnapshot } from "./auth.js";
import { apiFetch } from "./api-base.js";
import { patchCachedLifeEvent, removeCachedLifeEvent } from "./local-life-event-cache.js";

const QUEUE_PREFIX = "ruobai_pending_life_event_actions_v1";

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

export function isRetryableLifeEventError(error) {
  return /failed to fetch|networkerror|load failed|network request failed|网络|超时|等待太久/i.test(errorText(error));
}

export function getPendingLifeEventActionCount() {
  return readQueue().length;
}

function applyOptimistic(action) {
  if (action.kind === "delete") removeCachedLifeEvent(action.characterId, action.eventId);
  else patchCachedLifeEvent(action.characterId, action.eventId, { ...(action.payload || {}), sync_state: "pending" });
}

export async function enqueueLifeEventAction({ characterId, eventId, kind, payload = {} }) {
  const userId = currentUserId();
  if (!userId || !characterId || !eventId || !kind) return null;
  const action = {
    localId: "pending-life-event-" + Date.now() + "-" + Math.random().toString(36).slice(2),
    characterId: Number(characterId),
    eventId: String(eventId),
    kind,
    payload: { ...payload },
    createdAt: new Date().toISOString(),
    attempts: 0,
    lastError: "",
  };
  const queue = readQueue();
  queue.push(action);
  writeQueue(queue);
  applyOptimistic(action);
  return { success: true, queued: true, action };
}

function pathFor(action) {
  return "/api/life-events/" + encodeURIComponent(action.eventId);
}

function methodFor(action) {
  return action.kind === "delete" ? "DELETE" : "PATCH";
}

export async function flushPendingLifeEventActions() {
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
      if (action.kind === "delete") removeCachedLifeEvent(action.characterId, action.eventId);
      else patchCachedLifeEvent(action.characterId, action.eventId, { ...(action.payload || {}), sync_state: "synced" });
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
