async function parseJson(response) {
  const data = await response.json().catch(() => null);

  if (!response.ok && (!data || typeof data !== "object")) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return data;
}

import { recordDiagnostic } from "./diagnostics.js";
import { apiFetch } from "./api-base.js";

const SESSION_CACHE_KEY = "ruobai_session_snapshot";
const SESSION_CACHE_TTL_MS = 10 * 60 * 1000;

async function request(path, options = {}) {
  try {
    const response = await apiFetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers ?? {}),
      },
    });
    if (!response.ok) recordDiagnostic({ area: "auth", action: path.includes("login") ? "login" : path.includes("register") ? "register" : "session", status: response.status, error: `HTTP ${response.status}` });
    return parseJson(response);
  } catch (error) {
    recordDiagnostic({ area: "auth", action: path.includes("login") ? "login" : path.includes("register") ? "register" : "session", error });
    throw error;
  }
}

export function getSession(options = {}) {
  return request("/api/auth/session", {
    method: "GET",
    ...options,
  }).then((data) => {
    if (data?.loggedIn) writeSessionSnapshot(data);
    else clearSessionSnapshot();
    return data;
  });
}

export function readSessionSnapshot() {
  try {
    const payload = JSON.parse(localStorage.getItem(SESSION_CACHE_KEY) || "null");
    if (!payload?.loggedIn || Date.now() - Number(payload.savedAt || 0) > SESSION_CACHE_TTL_MS) return null;
    return payload;
  } catch {
    return null;
  }
}

export function writeSessionSnapshot(data) {
  if (!data?.loggedIn) return;
  try {
    localStorage.setItem(SESSION_CACHE_KEY, JSON.stringify({ ...data, savedAt: Date.now() }));
  } catch {}
}

export function clearSessionSnapshot() {
  try { localStorage.removeItem(SESSION_CACHE_KEY); } catch {}
}

export function login(payload) {
  return request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  }).then((data) => {
    if (data?.loggedIn) writeSessionSnapshot(data);
    return data;
  });
}

export function register(payload) {
  return request("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(payload),
  }).then((data) => {
    if (data?.loggedIn) writeSessionSnapshot(data);
    return data;
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
    return "/profile?todo=profile-key";
  }

  if (roleCount === 0) {
    return "/characters?onboard=first-role";
  }

  return "/chat";
}

export function normalizeErrorMessage(data, fallback) {
  if (data && typeof data.error === "string" && data.error.trim()) {
    return data.error;
  }

  return fallback;
}
