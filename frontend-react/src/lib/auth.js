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

export function getSession() {
  return request("/api/auth/session", {
    method: "GET",
  });
}

export function login(payload) {
  return request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function register(payload) {
  return request("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getModelConfigStatus() {
  return request("/api/model-configs/status", {
    method: "GET",
  });
}

export function getRoles() {
  return request("/api/roles", {
    method: "GET",
  });
}

export async function resolvePostAuthRedirect() {
  const [statusData, rolesData] = await Promise.all([
    getModelConfigStatus().catch(() => null),
    getRoles().catch(() => null),
  ]);

  const needsKey = Boolean(
    statusData?.success &&
      statusData?.item &&
      statusData.item.needs_onboarding,
  );
  const roleCount =
    rolesData?.success && Array.isArray(rolesData.items) ? rolesData.items.length : 0;

  if (needsKey) {
    return "/auth?todo=profile-key";
  }

  if (roleCount === 0) {
    return "/auth?todo=first-role";
  }

  return "/auth?todo=profile";
}

export function normalizeErrorMessage(data, fallback) {
  if (data && typeof data.error === "string" && data.error.trim()) {
    return data.error;
  }

  return fallback;
}
