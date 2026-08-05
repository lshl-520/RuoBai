import { recordDiagnostic } from "./diagnostics.js";

async function parseJson(response, path = "") {
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    if (path) {
      recordDiagnostic({
        area: path.includes("upload-image") ? "image" : "app",
        action: path.includes("upload-image") ? "upload-image" : "request",
        status: response.status,
        error: data?.error || `HTTP ${response.status}`,
      });
    }
    throw new Error(data?.error || `请求失败（HTTP ${response.status}）`);
  }

  return data;
}

async function request(path, options = {}) {
  try {
    const response = await fetch(path, {
      credentials: "same-origin",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers ?? {}),
      },
    });

    return parseJson(response, path);
  } catch (error) {
    if (!(error instanceof Error && /HTTP \d+/.test(error.message))) {
      recordDiagnostic({
        area: path.includes("upload-image") ? "image" : "app",
        action: path.includes("upload-image") ? "upload-image" : "request",
        error,
      });
    }
    throw error;
  }
}

export function getMoments({ characterId = "", scope = "all", viewerCharacterId = "", limit = 20, offset = 0 } = {}) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (scope) params.set("scope", String(scope));
  if (characterId) {
    params.set("character_id", String(characterId));
  }
  if (viewerCharacterId) params.set("viewer_character_id", String(viewerCharacterId));
  if (offset) params.set("offset", String(offset));

  return request(`/api/moments?${params.toString()}`, {
    method: "GET",
  });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}

export async function uploadMomentImage(file) {
  if (!file || !String(file.type || "").startsWith("image/")) {
    throw new Error("这里只能添加图片");
  }
  const imageData = await readFileAsDataUrl(file);
  const data = await request("/api/chat/upload-image", {
    method: "POST",
    body: JSON.stringify({ image_data: imageData }),
  });
  if (!data?.success || !data.media_url) throw new Error(data?.error || "图片上传失败");
  return data.media_url;
}

export function createMoment(payload) {
  return request("/api/moments", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function generateMomentDraft(characterId, mediaUrl = "") {
  return request("/api/moments/draft", {
    method: "POST",
    body: JSON.stringify({
      character_id: characterId,
      media_url: mediaUrl,
    }),
  });
}

const GENERATED_SELFIE_FALLBACK = "刚刚随手拍了一张，光线和角度都有点乱，但还是想发给你看看。";

export function shouldPublishGeneratedSelfie(text) {
  const value = String(text || "").replace(/\s+/g, "");
  if (!value) return false;

  const asksForHerSelfie = [
    /(?:你|妳|她)(?:自己)?[^。！？]{0,24}(?:自拍|自拍照)/,
    /(?:想看|看看|看一看|给我看)[^。！？]{0,12}(?:你|妳|她)(?:自己)?(?:的)?(?:样子|照片|相片|自拍)/,
    /(?:生成|画|拍|来|发)[^。！？]{0,12}(?:一张)?(?:你|妳|她)(?:自己)?(?:的)?(?:自拍|照片|相片|样子)/,
  ].some((pattern) => pattern.test(value));

  if (!asksForHerSelfie) return false;

  const onlyAsksForUserSelfie = /(?:我|我的|本人)[^。！？]{0,8}(?:自拍|自拍照)/.test(value)
    && !/(?:你|妳|她)(?:自己)?[^。！？]{0,24}(?:自拍|自拍照)/.test(value);
  return !onlyAsksForUserSelfie;
}

export async function publishGeneratedSelfieMoment({ characterId, mediaUrl }) {
  if (!characterId || !mediaUrl) {
    throw new Error("缺少角色或图片，暂时发不了动态");
  }

  let content = GENERATED_SELFIE_FALLBACK;
  try {
    const draft = await generateMomentDraft(characterId, mediaUrl);
    const generated = String(draft?.item?.content || "").trim();
    if (draft?.success && generated) content = generated;
  } catch {
    // 文案生成失败时仍发布同一张自拍，避免图片成功却丢掉动态。
  }

  const created = await createMoment({
    character_id: characterId,
    content,
    images: [mediaUrl],
    mood: "随手自拍",
  });

  if (!created?.success) {
    throw new Error(created?.error || "动态发布失败");
  }

  return {
    ...created,
    content,
    media_url: mediaUrl,
  };
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

export function shareMoment(momentId, characterIds = []) {
  return request(`/api/moments/${encodeURIComponent(momentId)}/share`, {
    method: "POST",
    body: JSON.stringify({ character_ids: characterIds }),
  });
}

export function unshareMoment(momentId, characterId) {
  return request(`/api/moments/${encodeURIComponent(momentId)}/share/${encodeURIComponent(characterId)}`, {
    method: "DELETE",
  });
}
