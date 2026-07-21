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
    const draft = await generateMomentDraft(characterId);
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
