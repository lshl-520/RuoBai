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

export function getMoments({ characterId = "", limit = 50 } = {}) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (characterId) {
    params.set("character_id", String(characterId));
  }

  return request(`/api/moments?${params.toString()}`, {
    method: "GET",
  });
}

export function createMoment(payload) {
  return request("/api/moments", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function generateMomentDraft(characterId) {
  return request("/api/moments/draft", {
    method: "POST",
    body: JSON.stringify({
      character_id: characterId,
    }),
  });
}

export function likeMoment(momentId) {
  return request(`/api/moments/${encodeURIComponent(momentId)}/like`, {
    method: "POST",
  });
}

export function getMomentDetail(momentId) {
  return request(`/api/moments/${encodeURIComponent(momentId)}`, {
    method: "GET",
  });
}

export function commentMoment(momentId, payload) {
  return request(`/api/moments/${encodeURIComponent(momentId)}/comment`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function deleteMoment(momentId) {
  return request(`/api/moments/${encodeURIComponent(momentId)}`, {
    method: "DELETE",
  });
}
