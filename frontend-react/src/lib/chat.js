async function parseJson(response) {
  const data = await response.json().catch(() => null);

  if (!response.ok && (!data || typeof data !== "object")) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return data;
}

import { recordDiagnostic } from "./diagnostics.js";

// 网络半断时浏览器不会自动结束 fetch，手机端就会一直显示“正在回复”。
// 给普通请求和流式回复设上限，确保 UI 能回到可重试状态。
const CHAT_REQUEST_TIMEOUT_MS = 45_000;
const CHAT_STREAM_IDLE_TIMEOUT_MS = 45_000;

function requestTimeoutError(stream = false) {
  return new Error(stream
    ? "聊天渠道等待太久没有回应，已自动结束这轮，请稍后重试。"
    : "聊天服务等待太久没有回应，请稍后重试。");
}

export function friendlyChatNetworkError(error) {
  const message = String(error instanceof Error ? error.message : error || "").trim();
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(message)) {
    return "网络连接刚刚断开，消息没有发完。请检查网络后重新发送。";
  }
  return message || "发送失败，请检查后端和模型配置。";
}

function diagnosticAction(path) {
  if (path.includes("upload-image")) return "upload-image";
  if (path.includes("upload-voice")) return "upload-voice";
  if (path.includes("/tts/")) return "text-to-speech";
  if (path.includes("/draw")) return "draw-image";
  return "request";
}

async function request(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHAT_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(path, {
      credentials: "same-origin",
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers ?? {}),
      },
    });
    if (!response.ok) recordDiagnostic({ area: "chat", action: diagnosticAction(path), status: response.status, error: `HTTP ${response.status}` });
    return parseJson(response);
  } catch (error) {
    recordDiagnostic({ area: "chat", action: diagnosticAction(path), error });
    if (error?.name === "AbortError") throw requestTimeoutError();
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function getMessages(roleId, limit = 50, { beforeId = null } = {}) {
  const query = new URLSearchParams({
    character_id: String(roleId),
    limit: String(limit),
  });
  if (beforeId !== null && beforeId !== undefined && beforeId !== "") {
    query.set("before_id", String(beforeId));
  }
  return request(
    `/api/chat?${query.toString()}`,
    { method: "GET" },
  );
}

export function saveMessage(roleId, payload) {
  return request(`/api/chat/save?character_id=${encodeURIComponent(roleId)}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function saveUserMessage(roleId, payload) {
  return request("/api/chat", {
    method: "POST",
    body: JSON.stringify({
      character_id: roleId,
      defer_side_effects: true,
      ...payload,
    }),
  });
}

export function clearChat(roleId) {
  return request(`/api/chat?character_id=${encodeURIComponent(roleId)}`, {
    method: "DELETE",
  });
}

export function speakMessage(messageId, options = {}) {
  return request("/api/tts/speak", {
    method: "POST",
    body: JSON.stringify({
      message_id: messageId,
      voice_override: options.voiceOverride || "",
      rate: options.rate,
      convert_to_voice: Boolean(options.convertToVoice),
    }),
  });
}

export function previewTts(options = {}) {
  return request("/api/tts/preview", {
    method: "POST",
    body: JSON.stringify({
      text: options.text || "我在呢。今天也会好好陪着你。",
      voice_override: options.voiceOverride || "",
      rate: options.rate,
    }),
  });
}

export function deleteMessage(messageId) {
  return request(`/api/messages/${encodeURIComponent(messageId)}`, {
    method: "DELETE",
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

export async function uploadChatImage(file) {
  const imageData = await readFileAsDataUrl(file);
  const data = await request("/api/chat/upload-image", {
    method: "POST",
    body: JSON.stringify({ image_data: imageData }),
  });
  if (!data?.success || !data.media_url) throw new Error(data?.error || "上传图片失败");
  return data.media_url;
}

export async function uploadVoice(blob) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
  const data = await request("/api/chat/upload-voice", {
    method: "POST",
    body: JSON.stringify({ audio_data: dataUrl }),
  });
  if (!data?.success || !data.audio_url) throw new Error(data?.error || "上传语音失败");
  return data.audio_url;
}

export function deleteAllMessages(roleId) {
  return request(`/api/chat?character_id=${encodeURIComponent(roleId)}`, { method: "DELETE" });
}

// 检测绘画关键词（与后端 detectDrawIntent 保持一致）
export function detectDrawKeywords(text) {
  if (!text) return false;
  return /(?:帮我|给我|替我|为我|请)画|画(?:一|1)?(?:个|张|幅)(?:图|画|图片|照片|自拍|画像)?|画(?:图|画|图片|照片|自拍|画像|一下)|(?:请|帮我|给我|替我|为我)?生成(?:一|1)?[个张幅]?[\s\S]{0,120}?(?:图片|图像|照片|自拍|画像)|(?:做|制作|创作)(?:一|1)?[个张幅]?[\s\S]{0,80}?(?:图片|图像|照片|自拍|画像)|(?:来|拍)(?:一|1)?[个张幅]?(?:自拍|照片)/i.test(text);
}

export async function drawImage(roleId, content, displayContent = "", options = {}) {
  const data = await request(`/api/chat/draw?character_id=${encodeURIComponent(roleId)}`, {
    method: "POST",
    body: JSON.stringify({
      content,
      ...(displayContent ? { display_content: displayContent } : {}),
      resolution: options.resolution || "channel",
    }),
  });
  if (!data?.success) throw new Error(data?.error || "图片生成失败");
  return data;
}

export async function callReply(roleId, text) {
  const data = await request(`/api/chat/call-reply?character_id=${encodeURIComponent(roleId)}`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
  if (!data?.success) throw new Error(data?.error || "通话失败");
  return data; // { reply, audio_url }
}

export function friendlyStreamHttpError(status) {
  // 202 = 后端识别出"这句话刚刚已经发过一次"，正在处理中。
  // 这不是故障，别把它显示成"接口异常"，免得用户以为又说错话了。
  if (status === 202) {
    return '这句话刚刚已经发出去了，她正在回你，稍等一下就好。';
  }
  if (status === 504) {
    return '聊天渠道等太久没有返回（504）。不是你消息发错了，也不是她故意不理你，等一会儿再试或换个模型。';
  }
  if (status === 502 || status === 503) {
    return `聊天中转暂时没接通（${status}），稍后再试或换个模型。`;
  }
  return `聊天请求暂时失败（${status}），请稍后重试。`;
}

// 自动重试只在“还没收到任何回复内容”时的网络类失败上触发。
// 判断标准：连接没建立 / 请求被中断 / 上游 502·503·504 抖动。
// 一旦已经开始吐出回复内容，就不再自动重试（避免内容重复），交给用户手动“重新发送”。
function isRetryableStreamError(error, status) {
  if (status && (status === 502 || status === 503 || status === 504)) return true;
  const message = String(error instanceof Error ? error.message : error || "").trim();
  return /failed to fetch|networkerror|load failed|network request failed/i.test(message)
    || (error instanceof Error && error.name === "AbortError");
}

const STREAM_RETRY_DELAY_MS = 1200;

export async function streamAssistantReply(roleId, payload, handlers = {}) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt === 2) await new Promise((resolve) => setTimeout(resolve, STREAM_RETRY_DELAY_MS));
    try {
      return await streamAssistantReplyOnce(roleId, payload, handlers);
    } catch (error) {
      // 已经产生过回复内容时，不再自动重试（避免内容重复），把原始错误交给上层。
      if (handlers.producedAnyContent) throw error;
      const status = error?.status || null;
      if (attempt < 2 && isRetryableStreamError(error, status)) continue;
      throw error;
    }
  }
  throw new Error("聊天请求重试后仍失败");
}

async function streamAssistantReplyOnce(roleId, payload, handlers = {}) {
  let response;
  const controller = new AbortController();
  let idleTimeout;
  const armIdleTimeout = () => {
    clearTimeout(idleTimeout);
    idleTimeout = setTimeout(() => controller.abort(), CHAT_STREAM_IDLE_TIMEOUT_MS);
  };
  armIdleTimeout();
  try {
    response = await fetch("/api/chat", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    signal: controller.signal,
    body: JSON.stringify({
      character_id: roleId,
      skip_server_persistence: true,
      ...payload,
    }),
    });
  } catch (error) {
    recordDiagnostic({ area: "chat", action: "stream-reply", error });
    clearTimeout(idleTimeout);
    if (error?.name === "AbortError") throw requestTimeoutError(true);
    throw error;
  }

  if (!response.ok || !response.body) {
    clearTimeout(idleTimeout);
    recordDiagnostic({ area: "chat", action: "stream-reply", status: response.status, error: `HTTP ${response.status}` });
    const data = await parseJson(response).catch(() => null);
    const httpError = new Error(
      data?.error || friendlyStreamHttpError(response.status),
    );
    httpError.status = response.status;
    throw httpError;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    let result;
    try {
      result = await reader.read();
    } catch (error) {
      clearTimeout(idleTimeout);
      recordDiagnostic({ area: "chat", action: "stream-reply", error });
      if (error?.name === "AbortError") throw requestTimeoutError(true);
      throw error;
    }
    armIdleTimeout();
    const { value, done } = result;
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    let markerIndex = buffer.indexOf("\n\n");
    while (markerIndex !== -1) {
      const chunk = buffer.slice(0, markerIndex);
      buffer = buffer.slice(markerIndex + 2);

      for (const line of chunk.split("\n")) {
        if (!line.startsWith("data:")) {
          continue;
        }

        const eventData = line.slice(5).trim();
        if (!eventData || eventData === "[DONE]") {
          continue;
        }

        let parsed;
        try {
          parsed = JSON.parse(eventData);
        } catch {
          continue;
        }

        if (parsed?.type === "error") {
          handlers.onError?.(parsed.message || "她暂时没反应，稍后再试好吗");
          continue;
        }

        if (parsed?.type === "reasoning" && parsed?.delta) {
          handlers.producedAnyContent = true;
          handlers.onReasoning?.(String(parsed.delta));
          continue;
        }

        if (parsed?.type === "inner_os" && parsed?.content) {
          handlers.producedAnyContent = true;
          handlers.onInnerOs?.(String(parsed.content), String(parsed.source || ""));
          continue;
        }

        if (parsed?.type === "inner_os_error") {
          handlers.onInnerOsError?.(String(parsed.message || "这一轮的小心思暂时没有写出来。"));
          continue;
        }

        const token = parsed?.choices?.[0]?.delta?.content || "";
        if (token) {
          handlers.producedAnyContent = true;
          handlers.onToken?.(token);
        }
      }

      markerIndex = buffer.indexOf("\n\n");
    }
  }
  clearTimeout(idleTimeout);
}
