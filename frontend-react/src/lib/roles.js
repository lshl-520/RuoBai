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

export function getRoles(options = {}) {
  const params = new URLSearchParams();
  if (options.includeDeleted) {
    params.set("include_deleted", "1");
  }

  const path = params.toString() ? `/api/roles?${params.toString()}` : "/api/roles";
  return request(path, {
    method: "GET",
  });
}

export function createRole(payload) {
  return request("/api/roles", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateRole(roleId, payload) {
  return request(`/api/roles/${encodeURIComponent(roleId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function switchRole(roleId) {
  return request(`/api/roles/${encodeURIComponent(roleId)}/switch`, {
    method: "POST",
  });
}

export function deleteRole(roleId, options = {}) {
  const params = new URLSearchParams();
  if (options.immediate) {
    params.set("mode", "hard");
  }

  const suffix = params.toString() ? `?${params.toString()}` : "";
  return request(`/api/roles/${encodeURIComponent(roleId)}${suffix}`, {
    method: "DELETE",
  });
}

export function patchRole(roleId, payload) {
  return request(`/api/roles/${encodeURIComponent(roleId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function restoreRole(roleId) {
  return request(`/api/roles/${encodeURIComponent(roleId)}/restore`, {
    method: "POST",
  });
}

export function uploadRolePortrait(roleId, imageData) {
  return request(`/api/roles/${encodeURIComponent(roleId)}/portrait`, {
    method: "POST",
    body: JSON.stringify({
      image_data: imageData,
    }),
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

export function getRoleAvatarRound(role) {
  const portraitId = Number(role?.portrait_id ?? role?.portraitId);
  const customUrl = String(role?.portrait_custom_url ?? role?.portraitCustomUrl ?? "").trim();
  if (portraitId === 999 && customUrl) return customUrl;
  if (Number.isInteger(portraitId) && portraitId >= 0 && portraitId <= 17) return `/assets/portraits/round/${portraitId}.png`;
  return String(role?.avatar ?? "").trim() || `/assets/portraits/round/0.png`;
}

export function getRoleSnippet(role) {
  const persona = String(role?.persona ?? "").trim();

  if (!persona) {
    return "";
  }

  return persona.length > 44 ? `${persona.slice(0, 44)}...` : persona;
}

export function buildRolePayload(values = {}) {
  const name = String(values.name ?? "").trim();
  const tag = String(values.tag ?? "").trim();
  const persona = String(values.persona ?? "").trim();
  const portraitId =
    values.portraitId === null || values.portraitId === undefined || values.portraitId === ""
      ? null
      : Number(values.portraitId);

  if (!name) {
    return { error: "角色名字不能为空。" };
  }

  if (!persona) {
    return { error: "先写一点她的人设，不然她还站不起来。" };
  }

  return {
    name,
    tag,
    persona,
    avatar: String(values.avatar ?? "").trim(),
    portrait_id: Number.isFinite(portraitId) ? portraitId : null,
    portrait_custom_url:
      Number(portraitId) === 999 ? String(values.portraitCustomUrl || "").trim() : null,
    intimacy: 50,
    mood: 80,
    speech_style: values.speechCompact ? "compact" : "natural",
    auto_moments_enabled: Boolean(values.autoMomentsEnabled),
    auto_moments_daily_min: Number(values.autoMomentsDailyMin ?? 0) || 0,
    auto_moments_daily_max: Number(values.autoMomentsDailyMax ?? 0) || 0,
    auto_moments_min_interval_hours: Number(values.autoMomentsMinIntervalHours ?? 4) || 4,
  };
}

export function buildRoleUpdatePayload(values = {}, currentRole = {}) {
  const name = String(values.name ?? "").trim();
  const tag = String(values.tag ?? "").trim();
  const persona = String(values.persona ?? "").trim();
  const portraitId =
    values.portraitId === null || values.portraitId === undefined || values.portraitId === ""
      ? null
      : Number(values.portraitId);

  if (!name) {
    return { error: "角色名字不能为空。" };
  }

  if (!persona) {
    return { error: "先写一点她的人设，不然她还站不起来。" };
  }

  return {
    name,
    tag,
    persona,
    avatar: String(values.avatar ?? "").trim(),
    portrait_id: Number.isFinite(portraitId) ? portraitId : null,
    portrait_custom_url:
      Number(portraitId) === 999 ? String(values.portraitCustomUrl || "").trim() : null,
    intimacy: Number.isFinite(Number(currentRole?.intimacy))
      ? Number(currentRole.intimacy)
      : 50,
    mood: Number.isFinite(Number(currentRole?.mood))
      ? Number(currentRole.mood)
      : 80,
    speech_style: values.speechCompact ? "compact" : "natural",
    auto_moments_enabled: Boolean(values.autoMomentsEnabled),
    auto_moments_daily_min: Number(values.autoMomentsDailyMin ?? 0) || 0,
    auto_moments_daily_max: Number(values.autoMomentsDailyMax ?? 0) || 0,
    auto_moments_min_interval_hours: Number(values.autoMomentsMinIntervalHours ?? 4) || 4,
  };
}
