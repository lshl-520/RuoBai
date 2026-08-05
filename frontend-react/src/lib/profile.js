async function parseJson(response) {
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.error || data?.message || `Request failed with status ${response.status}`);
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

export function getSessionProfile() {
  return request("/api/auth/session", {
    method: "GET",
  });
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

export function getUsageStats() {
  return request("/api/usage/stats", {
    method: "GET",
  });
}

export function updateNickname(payload) {
  return request("/api/users/me", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
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
