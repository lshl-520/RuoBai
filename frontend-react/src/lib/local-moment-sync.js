import { readSessionSnapshot } from "./auth.js";
import { apiFetch } from "./api-base.js";
import {
  appendCachedMomentCommentAcrossCaches,
  patchCachedMomentAcrossCaches,
  replaceCachedMomentCommentAcrossCaches,
} from "./local-moment-cache.js";

const QUEUE_KEY_PREFIX = "ruobai_pending_moment_actions_v1";

function currentUserId() {
  const id = Number(readSessionSnapshot()?.user?.id);
  return Number.isInteger(id) && id > 0 ? String(id) : "";
}

function queueKey() {
  const userId = currentUserId();
  return userId ? QUEUE_KEY_PREFIX + ":" + userId : "";
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

export function isRetryableMomentError(error) {
  return /failed to fetch|networkerror|load failed|network request failed|网络|超时|等待太久/i.test(errorText(error));
}

export function getPendingMomentActionCount() {
  return readQueue().length;
}

function actionPath(action) {
  return "/api/moments/" + encodeURIComponent(action.momentId) + "/" + action.kind;
}

export async function enqueueMomentAction({ momentId, kind, payload = {}, optimisticPatch = null, optimisticComment = null }) {
  const userId = currentUserId();
  if (!userId || !momentId || !kind) return null;

  const localId = optimisticComment?.local_id || ("pending-moment-" + Date.now() + "-" + Math.random().toString(36).slice(2));
  const action = {
    localId,
    momentId: Number(momentId),
    kind,
    payload: { ...payload },
    optimisticPatch,
    optimisticComment,
    createdAt: new Date().toISOString(),
    attempts: 0,
    lastError: "",
  };
  const queue = readQueue();
  queue.push(action);
  writeQueue(queue);

  if (optimisticPatch) patchCachedMomentAcrossCaches(momentId, optimisticPatch);
  if (optimisticComment) appendCachedMomentCommentAcrossCaches(momentId, optimisticComment);
  return { success: true, queued: true, local_id: localId, item: optimisticComment || null };
}

export async function flushPendingMomentActions() {
  const queue = readQueue();
  if (!queue.length) return { sent: 0, remaining: 0 };

  const remaining = [];
  let sent = 0;
  for (let index = 0; index < queue.length; index += 1) {
    const action = queue[index];
    try {
      const response = await apiFetch(actionPath(action), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action.payload || {}),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) throw new Error(data?.error || "HTTP " + response.status);

      if (action.kind === "like") {
        patchCachedMomentAcrossCaches(action.momentId, {
          liked: Boolean(data.liked),
          likes_count: Number(data.likes_count || 0),
        });
      }
      if (action.kind === "comment" && data.item) {
        replaceCachedMomentCommentAcrossCaches(action.momentId, action.localId, {
          ...data.item,
          local_id: action.localId,
          pending: false,
        });
      }
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
