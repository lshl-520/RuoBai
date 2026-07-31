import { Capacitor, registerPlugin } from "@capacitor/core";
import { recordDiagnostic } from "./diagnostics.js";

const NativeTextToSpeech = registerPlugin("NativeTextToSpeech");

function cleanText(text) {
  return String(text || "").replace(/<[^>]+>/g, "").trim();
}

export function isNativeTextToSpeechAvailable() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

export async function speakNativeText(text, options = {}) {
  const content = cleanText(text);
  if (!content) throw new Error("没有可以朗读的文字");
  if (!isNativeTextToSpeechAvailable()) throw new Error("当前不是 Android APP");

  return NativeTextToSpeech.speak({
    text: content,
    language: options.language || "zh-CN",
    rate: Number(options.rate) || 0.95,
    pitch: Number(options.pitch) || 1.05,
  });
}

export async function stopNativeText() {
  if (!isNativeTextToSpeechAvailable()) return;
  await NativeTextToSpeech.stop();
}

export function speakBrowserText(text, options = {}) {
  return new Promise((resolve, reject) => {
    const content = cleanText(text);
    if (!content) { reject(new Error("没有可以朗读的文字")); return; }
    if (!("speechSynthesis" in window)) { reject(new Error("当前设备不支持网页朗读")); return; }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(content);
    utterance.lang = options.language || "zh-CN";
    utterance.rate = Number(options.rate) || 0.95;
    utterance.pitch = Number(options.pitch) || 1.05;
    if (options.browserVoiceURI) {
      const selected = window.speechSynthesis.getVoices().find((voice) => voice.voiceURI === options.browserVoiceURI);
      if (selected) utterance.voice = selected;
    }
    utterance.onend = () => resolve({ state: "done", engine: "browser" });
    utterance.onerror = () => reject(new Error("网页朗读失败"));
    window.speechSynthesis.speak(utterance);
  });
}

export async function speakTextWithSystemVoice(text, options = {}) {
  let nativeError = null;
  if (isNativeTextToSpeechAvailable()) {
    try {
      const result = await speakNativeText(text, options);
      return { ...result, engine: "android" };
    } catch (error) {
      nativeError = error;
    }
  }

  try {
    return await speakBrowserText(text, options);
  } catch (browserError) {
    const error = nativeError || browserError;
    recordDiagnostic({ area: "voice", action: "system-text-to-speech", error });
    throw error;
  }
}

export async function stopSystemTextSpeech() {
  await stopNativeText().catch(() => {});
  window.speechSynthesis?.cancel();
}
