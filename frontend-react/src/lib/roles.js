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

export function getRoles() {
  return request("/api/roles", {
    method: "GET",
  });
}

export function clampIntimacy(value) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return Math.max(0, Math.min(99, Math.round(numeric)));
}

export function getRolePortraitSrc(role) {
  const portraitId = Number(role?.portrait_id ?? role?.portraitId);
  const customUrl = String(
    role?.portrait_custom_url ?? role?.portraitCustomUrl ?? "",
  ).trim();
  const avatar = String(role?.avatar ?? "").trim();

  if (portraitId === 999 && customUrl) {
    return customUrl;
  }

  if (Number.isInteger(portraitId) && portraitId >= 0 && portraitId <= 17) {
    return `/assets/portraits/square/${portraitId}.png`;
  }

  return avatar;
}

export function getRoleSnippet(role) {
  const persona = String(role?.persona ?? "").trim();

  if (!persona) {
    return "";
  }

  return persona.length > 44 ? `${persona.slice(0, 44)}...` : persona;
}
