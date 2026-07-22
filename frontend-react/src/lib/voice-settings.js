export const VOICE_SETTINGS_KEY = "ruobai_voice_v2";

export const DEFAULT_VOICE_SETTINGS = {
  enabled: true,
  engine: "browser",
  rate: 0.9,
  voiceId: "",
  browserVoiceURI: "",
  volcVoice: "saturn_zh_female_wenrouwenya_tob",
};

export function normalizeVoiceSettings(value) {
  const source = value && typeof value === "object" ? value : {};
  const savedVolcVoice = String(source.volcVoice || "").trim();
  const volcVoice = !savedVolcVoice || savedVolcVoice === "zh_female_wennuan"
    ? DEFAULT_VOICE_SETTINGS.volcVoice
    : savedVolcVoice;
  return {
    ...DEFAULT_VOICE_SETTINGS,
    ...source,
    enabled: source.enabled !== false,
    rate: Number.isFinite(Number(source.rate)) ? Number(source.rate) : DEFAULT_VOICE_SETTINGS.rate,
    volcVoice,
  };
}

export function loadVoiceSettings() {
  try {
    return normalizeVoiceSettings(JSON.parse(localStorage.getItem(VOICE_SETTINGS_KEY) || "null"));
  } catch {
    return { ...DEFAULT_VOICE_SETTINGS };
  }
}

export function saveVoiceSettings(value) {
  const settings = normalizeVoiceSettings(value);
  try { localStorage.setItem(VOICE_SETTINGS_KEY, JSON.stringify(settings)); } catch {}
  window.dispatchEvent(new CustomEvent("ruobai:voice-settings", { detail: settings }));
  return settings;
}

export function speechRecognitionErrorMessage(code) {
  switch (String(code || "")) {
    case "no-speech":
      return "没有检测到说话声，请说完后停半秒再点完成";
    case "audio-capture":
      return "麦克风正被其他程序占用，请关闭占用后重试";
    case "not-allowed":
    case "service-not-allowed":
      return "浏览器没有语音识别权限，请允许麦克风权限";
    case "network":
      return "浏览器语音识别服务连接失败，请检查网络后重试";
    case "aborted":
      return "";
    default:
      return "没有识别到文字，请稍后重试";
  }
}
