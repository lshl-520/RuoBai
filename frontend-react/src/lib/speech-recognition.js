/**
 * 语音识别（把"你说的话"变成文字）—— 2026/9/19
 *
 * 为什么要单独一层：
 *   以前这里直接用浏览器自带的识别（window.SpeechRecognition）。
 *   它在手机 App 的 WebView 里根本不好使 —— 用户实测发语音，识别结果为空，
 *   小白只能回"我听不到，你打字吧"。
 *
 * 而且用户的路线是"脱离服务器也要能用"，所以识别必须走**设备自己**：
 *   · Android App  → 手机系统识别（Android 13+ 支持完全离线，不联网、不花钱）
 *   · 网页/电脑    → 浏览器识别（原路保留，做兜底）
 *
 * 这一层对外只暴露一个统一接口，上层（chat.jsx）不需要知道底下是谁在识别。
 */
import { Capacitor, registerPlugin } from "@capacitor/core";
import { recordDiagnostic } from "./diagnostics.js";
import { apiFetch } from "./api-base.js";

const NativeSpeechRecognition = registerPlugin("NativeSpeechRecognition");

/** 当前是不是装成了 Android App。 */
export function isNativeSpeechRecognitionAvailable() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

/** 浏览器（或 WebView）自带识别能不能用。 */
export function isBrowserSpeechRecognitionAvailable() {
  if (typeof window === "undefined") return false;
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

/** 有没有任何可用的识别通道。 */
export function isSpeechRecognitionAvailable() {
  return isNativeSpeechRecognitionAvailable() || isBrowserSpeechRecognitionAvailable();
}

/** 当前实际会走哪条通道：device / browser / none。 */
export function speechRecognitionChannel() {
  if (isNativeSpeechRecognitionAvailable()) return "device";
  if (isBrowserSpeechRecognitionAvailable()) return "browser";
  return "none";
}

/** 大白话说明当前用的是哪种识别，给设置页/提示用。 */
export function speechRecognitionChannelLabel() {
  switch (speechRecognitionChannel()) {
    case "device": return "手机自带识别（优先离线，不经过若白服务器）";
    case "browser": return "浏览器识别";
    default: return "这台设备没有可用的语音识别";
  }
}

/**
 * 创建一个识别器。
 *
 * handlers:
 *   onPartial(text) —— 边说边出的临时结果（可以拿来实时显示）
 *   onFinal(text)   —— 最终结果
 *   onError(code, message) —— 出错；code 沿用浏览器那套（no-speech / network / not-allowed …）
 *   onEnd()         —— 这次识别结束（不管成功失败）
 *
 * 返回 { start(), stop(), cancel() }
 *   stop()   = 我说完了，请给最终结果
 *   cancel() = 不要了，直接丢弃
 */
export function createSpeechRecognizer(handlers = {}) {
  const language = handlers.language || "zh-CN";
  const onPartial = handlers.onPartial || (() => {});
  const onFinal = handlers.onFinal || (() => {});
  const onError = handlers.onError || (() => {});
  const onEnd = handlers.onEnd || (() => {});

  if (isNativeSpeechRecognitionAvailable()) {
    return createNativeRecognizer({ language, onPartial, onFinal, onError, onEnd });
  }
  if (isBrowserSpeechRecognitionAvailable()) {
    return createBrowserRecognizer({ language, onPartial, onFinal, onError, onEnd });
  }

  return {
    channel: "none",
    async start() { onError("not-supported", "这台设备没有可用的语音识别"); },
    async stop() {},
    async cancel() {},
  };
}

/* ---------------- 网页/桌面：走服务端识别（国内可靠） ---------------- */
/**
 * 浏览器自带识别走的是 Google 服务器，国内连不上（用户实测一直"未识别到文字"）。
 * 所以网页端优先把录音交给服务端识别；服务端不可用时才退回浏览器识别。
 */
export async function transcribeOnServer(blob, { language = "zh-CN" } = {}) {
  if (!blob) throw new Error("没有录音");
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
  const response = await apiFetch("/api/asr/transcribe", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ audio_data: dataUrl, language }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) {
    throw new Error(payload?.error || "语音识别失败");
  }
  return String(payload.text || "").trim();
}
/* ---------------- Android App：走手机系统识别 ---------------- */
function createNativeRecognizer({ language, onPartial, onFinal, onError, onEnd }) {
  let listeners = [];
  let stopped = false;

  const removeListeners = async () => {
    const current = listeners;
    listeners = [];
    for (const listener of current) {
      try { await listener?.remove?.(); } catch { /* 忽略 */ }
    }
  };

  return {
    channel: "device",
    async start() {
      stopped = false;
      try {
        listeners.push(await NativeSpeechRecognition.addListener("partial", (event) => {
          const text = String(event?.text || "");
          if (text) onPartial(text);
        }));
        listeners.push(await NativeSpeechRecognition.addListener("final", (event) => {
          const text = String(event?.text || "");
          if (text) onFinal(text);
        }));
        listeners.push(await NativeSpeechRecognition.addListener("error", (event) => {
          onError(String(event?.code || "error"), String(event?.message || ""));
        }));
        listeners.push(await NativeSpeechRecognition.addListener("end", () => {
          removeListeners();
          if (!stopped) onEnd();
        }));
        await NativeSpeechRecognition.start({ language });
      } catch (error) {
        await removeListeners();
        recordDiagnostic({ area: "voice", action: "native-speech-recognition", error });
        onError("not-supported", String(error?.message || "手机语音识别启动失败"));
      }
    },
    async stop() {
      stopped = true;
      try { await NativeSpeechRecognition.stop(); } catch { /* 忽略 */ }
    },
    async cancel() {
      stopped = true;
      try { await NativeSpeechRecognition.cancel(); } catch { /* 忽略 */ }
      await removeListeners();
    },
  };
}

/* ---------------- 网页/电脑：浏览器识别（原路保留） ---------------- */
function createBrowserRecognizer({ language, onPartial, onFinal, onError, onEnd }) {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognition = new Recognition();
  recognition.lang = language;
  recognition.continuous = true;
  recognition.interimResults = true;

  let finalText = "";
  let partialText = "";
  let cancelled = false;

  recognition.onresult = (event) => {
    partialText = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const text = String(result?.[0]?.transcript || "");
      if (result.isFinal) finalText += text;
      else partialText += text;
    }
    const interim = (finalText + partialText).trim();
    if (interim) onPartial(interim);
  };
  recognition.onerror = (event) => {
    if (cancelled) return;
    onError(String(event?.error || "error"), "");
  };
  recognition.onend = () => {
    if (cancelled) return;
    const text = (finalText + partialText).trim();
    if (text) onFinal(text);
    onEnd();
  };

  return {
    channel: "browser",
    async start() {
      cancelled = false;
      finalText = "";
      partialText = "";
      try {
        recognition.start();
      } catch (error) {
        recordDiagnostic({ area: "voice", action: "browser-speech-recognition", error });
        onError("not-supported", String(error?.message || "浏览器语音识别启动失败"));
      }
    },
    async stop() {
      try { recognition.stop(); } catch { /* 忽略 */ }
    },
    async cancel() {
      cancelled = true;
      try { recognition.abort(); } catch { /* 忽略 */ }
    },
  };
}

export default {
  createSpeechRecognizer,
  isSpeechRecognitionAvailable,
  isNativeSpeechRecognitionAvailable,
  isBrowserSpeechRecognitionAvailable,
  speechRecognitionChannel,
  speechRecognitionChannelLabel,
};
