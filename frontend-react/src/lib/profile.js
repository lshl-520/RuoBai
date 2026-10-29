import { apiFetch } from "./api-base.js";
import { readCachedProfile, readCachedProfileStats, writeCachedProfile, writeCachedProfileStats } from "./local-profile-cache.js";
import { enqueueProfileUpdate, isRetryableProfileError } from "./local-profile-sync.js";

async function parseJson(response) {
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.error || data?.message || `Request failed with status ${response.status}`);
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

export async function getSessionProfile() {
  try {
    const data = await request("/api/auth/session", { method: "GET" });
    if (data?.success && data.user) writeCachedProfile(data.user);
    return data;
  } catch (error) {
    if (isRetryableProfileError(error)) {
      const cached = readCachedProfile();
      if (cached) return cached;
    }
    throw error;
  }
}

export function getFullChatExport() {
  return request('/api/chat/export', { method: 'GET' });
}

export function getUserSettings() {
  return request("/api/settings", {
    method: "GET",
  });
}

export function getRelationshipStatus() {
  return request("/api/relationship", {
    method: "GET",
  });
}

export function updateUserSettings(payload) {
  return request("/api/settings", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function getUsageStats() {
  try {
    const data = await request("/api/usage/stats", { method: "GET" });
    if (data?.success && data.item) writeCachedProfileStats(data.item);
    return data;
  } catch (error) {
    if (isRetryableProfileError(error)) {
      const cached = readCachedProfileStats();
      if (cached) return cached;
    }
    throw error;
  }
}

export function getUsageSummary(options = {}) {
  const query = new URLSearchParams();
  if (options.days) query.set("days", String(options.days));
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return request(`/api/usage/summary${suffix}`, { method: "GET" });
}

export function getUsageEvents(options = {}) {
  const query = new URLSearchParams();
  if (options.days) query.set("days", String(options.days));
  if (options.purpose && options.purpose !== "all") query.set("purpose", String(options.purpose));
  if (options.limit) query.set("limit", String(options.limit));
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return request(`/api/usage/events${suffix}`, { method: "GET" });
}

export async function updateNickname(payload) {
  try {
    const data = await request("/api/users/me", {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    if (data?.success && data.user) writeCachedProfile(data.user);
    return data;
  } catch (error) {
    if (!isRetryableProfileError(error)) throw error;
    const cached = readCachedProfile();
    const current = { ...(cached?.user || {}) };
    if (payload?.nickname !== undefined) current.nickname = payload.nickname;
    if (payload?.avatar_url !== undefined) current.avatar = payload.avatar_url;
    if (payload?.city !== undefined) current.city = payload.city;
    return enqueueProfileUpdate(payload, current);
  }
}

export function uploadAvatarImage(imageData) {
  return request("/api/users/avatar", {
    method: "POST",
    body: JSON.stringify({
      image_data: imageData,
    }),
  });
}

export function deleteAvatarImage(avatarUrl) {
  return request("/api/users/avatar", {
    method: "DELETE",
    body: JSON.stringify({
      avatar_url: avatarUrl,
    }),
  });
}

export function changePassword(payload) {
  return request("/api/auth/password", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function logoutSession() {
  return request("/api/auth/logout", {
    method: "POST",
  });
}

export function getModelConfigStatus() {
  return request("/api/model-configs/status", {
    method: "GET",
  });
}

export function getModelConfigs() {
  return request("/api/model-configs", {
    method: "GET",
  });
}

export function createModelConfig(payload) {
  return request("/api/model-configs", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateModelConfig(configId, payload) {
  return request(`/api/model-configs/${encodeURIComponent(configId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function useTestModelConfig() {
  return request("/api/model-configs/use-test-config", {
    method: "POST",
  });
}

export function activateModelConfig(configId) {
  return request(`/api/model-configs/${encodeURIComponent(configId)}/activate`, {
    method: "POST",
  });
}

export function deleteModelConfig(configId) {
  return request(`/api/model-configs/${encodeURIComponent(configId)}`, {
    method: "DELETE",
  });
}

export function testModelConfig(payload) {
  return request("/api/model-configs/test", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function discoverModelConfigs(payload) {
  return request("/api/model-configs/discover-models", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getCapabilities() {
  return request("/api/capabilities", { method: "GET" });
}

export function updateCapability(cap, payload) {
  return request(`/api/capabilities/${encodeURIComponent(cap)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function getCredentials() {
  return request("/api/credentials", { method: "GET" });
}

export function getCredentialModels(credId) {
  return request(`/api/credentials/${encodeURIComponent(credId)}/models`, {
    method: "GET",
  });
}

export function createCredential(payload) {
  return request("/api/credentials", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateCredential(credId, payload) {
  return request(`/api/credentials/${encodeURIComponent(credId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteCredential(credId) {
  return request(`/api/credentials/${encodeURIComponent(credId)}`, {
    method: "DELETE",
  });
}

export function refreshCredentialModels(credId) {
  return request(`/api/credentials/${encodeURIComponent(credId)}/refresh-models`, {
    method: "POST",
  });
}

/**
 * ★ 2026/9/17 新增：保存"这个渠道我要用哪几个模型"
 *
 * 起因：渠道一次能抓回 22 个模型，前台全铺出来很乱。
 * 现在抓取只刷新目录，用户在渠道里勾选后才会出现在聊天室的模型选择器里。
 */
export function setCredentialEnabledModels(credId, modelIds) {
  return request(`/api/credentials/${encodeURIComponent(credId)}/enabled-models`, {
    method: "PUT",
    body: JSON.stringify({ model_ids: Array.isArray(modelIds) ? modelIds : [] }),
  });
}
export function testCredential(credId) {
  return request(`/api/credentials/${encodeURIComponent(credId)}/test`, {
    method: "POST",
  });
}

export function testCredentialDraft(payload) {
  return request("/api/credentials/test-draft", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function applyCredential(credId, payload) {
  return request(`/api/credentials/${encodeURIComponent(credId)}/apply`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getRoles() {
  return request("/api/roles", { method: "GET" });
}

export function updateRole(roleId, payload) {
  return request(`/api/roles/${encodeURIComponent(roleId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}
