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

export function getMessages(roleId, limit = 50) {
  return request(
    `/api/chat?character_id=${encodeURIComponent(roleId)}&limit=${encodeURIComponent(limit)}`,
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

export async function drawImage(roleId, content) {
  const data = await request(`/api/chat/draw?character_id=${encodeURIComponent(roleId)}`, {
    method: "POST",
    body: JSON.stringify({ content }),
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

export async function streamAssistantReply(roleId, payload, handlers = {}) {
  const response = await fetch("/api/chat", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      character_id: roleId,
      skip_server_persistence: true,
      ...payload,
    }),
  });

  if (!response.ok || !response.body) {
    const data = await parseJson(response).catch(() => null);
    throw new Error(
      data?.error || `Stream request failed with status ${response.status}`,
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
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

        const token = parsed?.choices?.[0]?.delta?.content || "";
        if (token) {
          handlers.onToken?.(token);
        }
      }

      markerIndex = buffer.indexOf("\n\n");
    }
  }
}
