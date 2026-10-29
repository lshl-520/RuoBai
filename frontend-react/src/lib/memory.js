import { apiFetch } from "./api-base.js";
import { readCachedMemories, writeCachedMemories } from "./local-memory-cache.js";
import { enqueueMemoryAction, isRetryableMemoryError } from "./local-memory-sync.js";

async function parseJson(response) {
  const data = await response.json().catch(() => null);

  if (!response.ok || data?.success === false) {
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

export async function getMemories(characterId, { includeDeleted = false, limit = 100 } = {}) {
  const params = new URLSearchParams({
    character_id: String(characterId),
    limit: String(limit),
  });

  if (includeDeleted) {
    params.set("include_deleted", "1");
  }

  try {
    const data = await request(`/api/memories?${params.toString()}`, {
      method: "GET",
    });
    if (data?.success && Array.isArray(data.data)) writeCachedMemories(characterId, data.data);
    return data;
  } catch (error) {
    if (!includeDeleted && isRetryableMemoryError(error)) {
      const cached = readCachedMemories(characterId);
      if (cached) return cached;
    }
    throw error;
  }
}

export async function createMemory(characterId, payload) {
  try {
    return await request(`/api/memories?character_id=${encodeURIComponent(characterId)}`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  } catch (error) {
    if (!isRetryableMemoryError(error)) throw error;
    const localId = "pending-memory-" + Date.now() + "-" + Math.random().toString(36).slice(2);
    const now = new Date().toISOString();
    const optimisticMemory = {
      ...payload,
      id: localId,
      local_id: localId,
      character_id: Number(characterId),
      memory_type: payload?.memory_type || "life",
      memory_type_label: "普通生活",
      source_type: "manual",
      review_status: "active",
      requires_confirmation: false,
      is_important: Boolean(payload?.is_important),
      weight: Number(payload?.weight ?? 50),
      created_at: now,
      updated_at: now,
      sync_state: "pending",
    };
    return enqueueMemoryAction({ characterId, kind: "create", payload, optimisticMemory });
  }
}

export async function updateMemory(memoryId, payload, characterId = "") {
  try {
    return await request(`/api/memories/${encodeURIComponent(memoryId)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  } catch (error) {
    if (!isRetryableMemoryError(error)) throw error;
    const roleId = Number(characterId || payload?.character_id);
    if (!roleId) throw error;
    return enqueueMemoryAction({
      characterId: roleId,
      kind: "update",
      memoryId,
      payload,
      optimisticPatch: { ...payload, sync_state: "pending" },
    });
  }
}

export async function deleteMemory(memoryId, characterId = "") {
  try {
    return await request(`/api/memories/${encodeURIComponent(memoryId)}`, {
      method: "DELETE",
    });
  } catch (error) {
    if (!isRetryableMemoryError(error)) throw error;
    if (!Number(characterId)) throw error;
    return enqueueMemoryAction({ characterId, kind: "delete", memoryId });
  }
}

export async function restoreMemory(memoryId, characterId = "") {
  try {
    return await request(`/api/memories/${encodeURIComponent(memoryId)}/restore`, {
      method: "POST",
    });
  } catch (error) {
    if (!isRetryableMemoryError(error)) throw error;
    if (!Number(characterId)) throw error;
    return enqueueMemoryAction({
      characterId,
      kind: "restore",
      memoryId,
      optimisticPatch: { is_deleted: false, sync_state: "pending" },
    });
  }
}
