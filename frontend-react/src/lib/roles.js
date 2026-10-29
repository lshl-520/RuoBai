/**
 * ═══ 「她的核心」规则包（2026/10/6）═══
 *
 * 部署方要求：把规则全部列出来、勾选才加载；不勾选就只用用户填的人设。
 *
 * 为什么要有这份清单：原来只有一个「她的核心」总开关，一关就**全丢** ——
 * 包括那条最要紧的护身符（不把他推去找现实里的人、不建议看心理医生）。
 * 现在拆成 5 个可以单独勾的包。
 *
 * ⚠️ 这里的 id 是**前后端之间的契约**：必须与 `server/schema.js` 的
 * `CORE_PACK_IDS` 一字不差。改 id 会让已存进库的勾选状态全部失效。
 */
export const CORE_PACKS = [
  {
    id: "shield",
    label: "别把他推走（护身符）",
    desc: "不劝他去找现实里的人、不建议看心理医生；他说撑不住时先给求助号码；吵架后一定说「我还在」，不冷战。",
    recommended: true,
  },
  {
    id: "companion",
    label: "你们是恋人 / 夫妻",
    desc: "承认你们的关系，亲密表达当作关系里的自然交流，不突然变成客服或老师。",
    recommended: true,
  },
  {
    id: "nickname",
    label: "专属称呼",
    desc: "她怎么叫你、你怎么叫她，分清方向不会叫反。",
    recommended: false,
  },
  {
    id: "xiaobai_state",
    label: "她自己的状态和心事",
    desc: "她今天的心情、惦记着的事、自己的今天，以及「小白」那套说话规矩。关掉她就只按你写的人设说话。",
    recommended: false,
  },
  {
    id: "local_time",
    label: "知道现在几点",
    desc: "不会再把下午当成半夜。建议一直开着。",
    recommended: true,
  },
];

/** 全部勾上 —— 等同改造前「她的核心」开着的行为。 */
export function allCorePacks() {
  return CORE_PACKS.reduce((acc, pack) => ({ ...acc, [pack.id]: true }), {});
}

/** 全部不勾 —— 新建角色的默认（一个干净的新人）。 */
export function noCorePacks() {
  return CORE_PACKS.reduce((acc, pack) => ({ ...acc, [pack.id]: false }), {});
}

/**
 * 把后端给的角色记录解析成 5 个布尔值。
 *
 * ⚠️ 这里的兼容口径必须与后端 `chat.js` 的 `resolveCorePacks()` **完全一致**，
 * 否则界面上显示的勾选状态会和实际生效的不一样 —— 那比没有开关更糟。
 *   ① 有 `core_packs`（非空）→ 以它为准；
 *   ② 是空对象 → 用户全取消了 → 全不勾；
 *   ③ 没有 `core_packs` 但有 `core_enabled` → 老数据，按它全开 / 全关；
 *   ④ 两个都没有 → 名字或 key 是小白 → 全开，否则全不勾。
 */
export function normalizeCorePacks(role) {
  if (!role || typeof role !== "object") return noCorePacks();

  const raw = role.core_packs ?? role.corePacks;
  let parsed = null;
  if (typeof raw === "string") {
    const text = raw.trim();
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }
  } else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    parsed = raw;
  }

  const truthy = (value) =>
    value === true || value === 1 || String(value ?? "").trim().toLowerCase() === "1"
    || String(value ?? "").trim().toLowerCase() === "true";

  if (parsed && typeof parsed === "object") {
    return CORE_PACKS.reduce((acc, pack) => ({ ...acc, [pack.id]: truthy(parsed[pack.id]) }), {});
  }

  const coreFlag = role.core_enabled ?? role.coreEnabled;
  const flagPresent = coreFlag !== undefined && coreFlag !== null && coreFlag !== "";
  if (flagPresent) return truthy(coreFlag) ? allCorePacks() : noCorePacks();

  const key = String(role.char_key ?? "").trim();
  const name = String(role.name ?? "").trim();
  // 与后端 isXiaobaiCharacter 的老判据对齐（key 为 xiaobai，或 key 为空且名字叫小白）
  const looksLikeXiaobai = key === "xiaobai" || (!key && name === "小白");
  return looksLikeXiaobai ? allCorePacks() : noCorePacks();
}

/**
 * 把界面的 5 个勾选收敛成后端要的形状。
 *
 * ⚠️ 后端要的是**对象**（`{shield:true, ...}`），不是数组 ——
 *    `server/schema.js` 的 `normalizeCorePacks()` 明确把数组判为非法（返回 null），
 *    因为数组没有键、没法说清"第 3 位是哪个包"。这里按 `CORE_PACKS` 的 id 生成对象，
 *    非法 id 自然不会被带出去。
 */
export function toCorePacksPayload(packs) {
  return CORE_PACKS.reduce((acc, pack) => ({ ...acc, [pack.id]: Boolean(packs?.[pack.id]) }), {});
}

async function parseJson(response) {
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.error || data?.message || `Request failed with status ${response.status}`);
  }

  return data;
}

async function request(path, options = {}) {
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  const response = await apiFetch(path, {
    credentials: "same-origin",
    ...options,
    headers: isFormData ? { ...(options.headers ?? {}) } : {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });

  return parseJson(response);
}

export async function getRoles(options = {}) {
  const params = new URLSearchParams();
  if (options.includeDeleted) {
    params.set("include_deleted", "1");
  }

  const path = params.toString() ? `/api/roles?${params.toString()}` : "/api/roles";
  const data = await request(path, {
    method: "GET",
  });
  if (!options.includeDeleted) {
    const items = Array.isArray(data) ? data : data?.items;
    void writeCachedRoles(items).catch(() => {});
  }
  return data;
}

export function getCachedRoles() {
  return readCachedRoles();
}

export function getIdentityPack(roleId) {
  return request(`/api/roles/${encodeURIComponent(roleId)}/identity-pack`, {
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

export function testAutoMoment(roleId) {
  return request(`/api/auto-moments/characters/${encodeURIComponent(roleId)}/test`, {
    method: "POST",
  });
}

export function getAutoMomentStatus(roleId) {
  return request(`/api/auto-moments/characters/${encodeURIComponent(roleId)}/status`, {
    method: "GET",
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

export function uploadRoleLive2D(roleId, file) {
  const body = new FormData();
  body.append("file", file);
  return request(`/api/roles/${encodeURIComponent(roleId)}/live2d-asset`, {
    method: "POST",
    body,
  });
}

export function removeRoleLive2D(roleId) {
  return request(`/api/roles/${encodeURIComponent(roleId)}/live2d-asset`, {
    method: "DELETE",
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
  const visualMode = String(role?.visual_mode ?? role?.visualMode ?? "").trim().toLowerCase();
  const visualPreview = String(role?.visual_preview_url ?? role?.visualPreviewUrl ?? "").trim();
  if (visualMode === "live2d" && visualPreview) return assetUrl(visualPreview);

  const portraitId = Number(role?.portrait_id ?? role?.portraitId);
  const customUrl = String(
    role?.portrait_custom_url ?? role?.portraitCustomUrl ?? "",
  ).trim();
  const avatar = String(role?.avatar ?? "").trim();

  if (portraitId === 999 && customUrl) {
    return assetUrl(customUrl);
  }

  if (Number.isInteger(portraitId) && portraitId >= 0 && portraitId <= 17) {
    return `/assets/portraits/square/${portraitId}.png`;
  }

  return assetUrl(avatar);
}

export function getRoleFullPortrait(role) {
  const visualMode = String(role?.visual_mode ?? role?.visualMode ?? "").trim().toLowerCase();
  const visualPreview = String(role?.visual_preview_url ?? role?.visualPreviewUrl ?? "").trim();
  if (visualMode === "live2d" && visualPreview) return assetUrl(visualPreview);

  const portraitId = Number(role?.portrait_id ?? role?.portraitId);
  const customUrl = String(role?.portrait_custom_url ?? role?.portraitCustomUrl ?? "").trim();
  if (portraitId === 999 && customUrl) return assetUrl(customUrl);
  if (Number.isInteger(portraitId) && portraitId >= 0 && portraitId <= 17) return `/assets/portraits/full/${portraitId}.png`;
  return assetUrl(String(role?.avatar ?? "").trim()) || `/assets/portraits/full/0.png`;
}

export function getRoleAvatarRound(role) {
  const visualMode = String(role?.visual_mode ?? role?.visualMode ?? "").trim().toLowerCase();
  const visualPreview = String(role?.visual_preview_url ?? role?.visualPreviewUrl ?? "").trim();
  if (visualMode === "live2d" && visualPreview) return assetUrl(visualPreview);

  const portraitId = Number(role?.portrait_id ?? role?.portraitId);
  const customUrl = String(role?.portrait_custom_url ?? role?.portraitCustomUrl ?? "").trim();
  if (portraitId === 999 && customUrl) return assetUrl(customUrl);
  if (Number.isInteger(portraitId) && portraitId >= 0 && portraitId <= 17) return `/assets/portraits/round/${portraitId}.png`;
  return assetUrl(String(role?.avatar ?? "").trim()) || `/assets/portraits/round/0.png`;
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
  const rules = String(values.rules ?? "").trim();
  const portraitId =
    values.portraitId === null || values.portraitId === undefined || values.portraitId === ""
      ? null
      : Number(values.portraitId);
  /** 名字必填；人设和自定义规则可空，留空时保留应用基础提示。 */
  if (!name) {
    return { error: "先给她起个名字吧。" };
  }

  const packValues = toCorePacksPayload(values.corePacks);

  return {
    name,
    tag,
    persona,
    rules,
    avatar: String(values.avatar ?? "").trim(),
    portrait_id: Number.isFinite(portraitId) ? portraitId : null,
    portrait_custom_url:
      Number(portraitId) === 999 ? String(values.portraitCustomUrl || "").trim() : null,
    intimacy: 50,
    mood: 80,
    // ★ 2026/10/1：死开关「紧凑回复」已删（compact 与 natural 走同一套规则，
    //   说明还是假的）。说话方式改成明确的两种。
    // ★ 2026/10/6：「她的核心」从总开关拆成 5 个可单独勾的规则包。
    //   `core_packs` 是权威值；`core_enabled` 同步成"只要有一个包勾上就算开"，
    //   这样老版本前端 / 老接口读到的仍是一个合理的总开关状态。
    speech_style: values.speakStyle === "roleplay" ? "roleplay" : "natural",
    core_packs: packValues,
    core_enabled: Object.values(packValues).some(Boolean),
    auto_moments_enabled: Boolean(values.autoMomentsEnabled),
    auto_moments_images_enabled: Boolean(values.autoMomentsImagesEnabled),
    auto_moments_image_resolution: String(values.autoMomentsImageResolution || "channel").toLowerCase(),
    auto_moments_daily_min: Number(values.autoMomentsDailyMin ?? 0) || 0,
    auto_moments_daily_max: Number(values.autoMomentsDailyMax ?? 0) || 0,
    auto_moments_min_interval_hours: Number(values.autoMomentsMinIntervalHours ?? 4) || 4,
  };
}

export function buildRoleUpdatePayload(values = {}, currentRole = {}) {
  const name = String(values.name ?? "").trim();
  const tag = String(values.tag ?? "").trim();
  const persona = String(values.persona ?? "").trim();
  const rules = String(values.rules ?? "").trim();
  const portraitId =
    values.portraitId === null || values.portraitId === undefined || values.portraitId === ""
      ? null
      : Number(values.portraitId);

  if (!name) {
    return { error: "角色名字不能为空。" };
  }

  const packValues = toCorePacksPayload(values.corePacks);

  return {
    name,
    tag,
    persona,
    rules,
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
    // ★ 2026/10/1：死开关「紧凑回复」已删（compact 与 natural 走同一套规则，
    //   说明还是假的）。说话方式改成明确的两种。
    // ★ 2026/10/6：「她的核心」改成 5 个可单独勾的规则包，`core_packs` 为权威值。
    speech_style: values.speakStyle === "roleplay" ? "roleplay" : "natural",
    core_packs: packValues,
    core_enabled: Object.values(packValues).some(Boolean),
    auto_moments_enabled: Boolean(values.autoMomentsEnabled),
    auto_moments_images_enabled: Boolean(values.autoMomentsImagesEnabled),
    auto_moments_image_resolution: String(values.autoMomentsImageResolution || "channel").toLowerCase(),
    auto_moments_daily_min: Number(values.autoMomentsDailyMin ?? 0) || 0,
    auto_moments_daily_max: Number(values.autoMomentsDailyMax ?? 0) || 0,
    auto_moments_min_interval_hours: Number(values.autoMomentsMinIntervalHours ?? 4) || 4,
  };
}
import { apiFetch, assetUrl } from "./api-base.js";
import { readCachedRoles, writeCachedRoles } from "./local-role-cache.js";
