async function parseJson(response) {
  const data = await response.json().catch(() => null);

  if (!response.ok && (!data || typeof data !== "object")) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return data;
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });

  return parseJson(response);
}

export function getMemories(characterId, { includeDeleted = false, limit = 100 } = {}) {
  const params = new URLSearchParams({
    character_id: String(characterId),
    limit: String(limit),
  });

  if (includeDeleted) {
    params.set("include_deleted", "1");
  }

  return request(`/api/memories?${params.toString()}`, {
    method: "GET",
  });
}

export function createMemory(characterId, payload) {
  return request(`/api/memories?character_id=${encodeURIComponent(characterId)}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateMemory(memoryId, payload) {
  return request(`/api/memories/${encodeURIComponent(memoryId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteMemory(memoryId) {
  return request(`/api/memories/${encodeURIComponent(memoryId)}`, {
    method: "DELETE",
  });
}

export function restoreMemory(memoryId) {
  return request(`/api/memories/${encodeURIComponent(memoryId)}/restore`, {
    method: "POST",
  });
}
