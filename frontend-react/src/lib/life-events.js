const STATUS_LABELS = {
  active: "还没完成",
  completed: "已经完成",
  postponed: "改到以后",
  cancelled: "不做了",
  expired: "已经过期",
};

import { apiFetch } from "./api-base.js";
import { readCachedLifeEvents, writeCachedLifeEvents } from "./local-life-event-cache.js";
import { enqueueLifeEventAction, isRetryableLifeEventError } from "./local-life-event-sync.js";

const STATUS_HINTS = {
  active: "这件事还没有做完。",
  completed: "这件事已经做完了。",
  postponed: "这件事还没做，改到以后。",
  cancelled: "这件事决定不再做了。",
  expired: "这件事超过了有效时间，不会再被当作当前待办。",
};

async function parseJson(response) {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error || `请求失败（${response.status}）`);
  }
  return data;
}

async function request(path, options = {}) {
  const response = await apiFetch(path, {
    credentials: "same-origin",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  return parseJson(response);
}

export async function getLifeEvents(characterId, { limit = 100 } = {}) {
  const params = new URLSearchParams({
    character_id: String(characterId),
    limit: String(limit),
  });
  try {
    const data = await request(`/api/life-events?${params.toString()}`, { method: "GET" });
    if (data?.success && Array.isArray(data.items)) writeCachedLifeEvents(characterId, data.items);
    return data;
  } catch (error) {
    if (isRetryableLifeEventError(error)) {
      const cached = readCachedLifeEvents(characterId);
      if (cached) return cached;
    }
    throw error;
  }
}

export async function updateLifeEvent(eventId, payload, characterId = "") {
  try {
    return await request(`/api/life-events/${encodeURIComponent(eventId)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  } catch (error) {
    if (!isRetryableLifeEventError(error) || !Number(characterId)) throw error;
    return enqueueLifeEventAction({ characterId, eventId, kind: "update", payload });
  }
}

export async function deleteLifeEvent(eventId, characterId = "") {
  try {
    return await request(`/api/life-events/${encodeURIComponent(eventId)}`, { method: "DELETE" });
  } catch (error) {
    if (!isRetryableLifeEventError(error) || !Number(characterId)) throw error;
    return enqueueLifeEventAction({ characterId, eventId, kind: "delete" });
  }
}

export function getLifeEventSource(eventId, sourceRef) {
  const [sourceType, sourceId] = String(sourceRef || "").split(":");
  if (!eventId || !/^(chat|moment|comment|memory)$/.test(sourceType) || !/^\d+$/.test(sourceId || "")) {
    return Promise.reject(new Error("来源编号非法"));
  }
  return request(`/api/life-events/${encodeURIComponent(eventId)}/source/${sourceType}/${sourceId}`, { method: "GET" });
}

export function getLifeEventStatusLabel(status) {
  return STATUS_LABELS[String(status || "active")] || STATUS_LABELS.active;
}

export function getLifeEventStatusHint(status) {
  return STATUS_HINTS[String(status || "active")] || STATUS_HINTS.active;
}

export const LIFE_EVENT_STATUS_OPTIONS = Object.entries(STATUS_LABELS);
