async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.success === false) throw new Error(data?.error || `请求失败（HTTP ${response.status}）`);
  return data;
}

export function getProactiveEvents({ characterId = "", limit = 100 } = {}) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (characterId) params.set("character_id", String(characterId));
  return request(`/api/proactive-events?${params.toString()}`, { method: "GET" });
}

export function markProactiveEventRead(eventId) {
  return request(`/api/proactive-events/${encodeURIComponent(eventId)}/read`, { method: "POST" });
}
