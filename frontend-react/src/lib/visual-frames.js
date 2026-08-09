export const VISUAL_FRAME_OPTIONS = {
  chat: [
    { value: "knee", label: "膝盖以上" },
    { value: "half", label: "半身" },
    { value: "full", label: "全身" },
  ],
  fullscreen: [
    { value: "half", label: "半身" },
    { value: "full", label: "全身" },
  ],
};

export const DEFAULT_VISUAL_FRAME = {
  chatFrame: "knee",
  fullscreenFrame: "full",
  chatZoom: 1,
  chatOffsetX: 0,
  chatOffsetY: 0,
  fullscreenZoom: 1,
  fullscreenOffsetX: 0,
  fullscreenOffsetY: 0,
};

const CHAT_FRAMES = new Set(VISUAL_FRAME_OPTIONS.chat.map((item) => item.value));
const FULLSCREEN_FRAMES = new Set(VISUAL_FRAME_OPTIONS.fullscreen.map((item) => item.value));

function sourceOf(value) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function numberInRange(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

export function normalizeVisualFrameConfig(value) {
  const source = sourceOf(value);
  const chatFrame = CHAT_FRAMES.has(String(source.chatFrame || ""))
    ? String(source.chatFrame)
    : DEFAULT_VISUAL_FRAME.chatFrame;
  const fullscreenFrame = FULLSCREEN_FRAMES.has(String(source.fullscreenFrame || ""))
    ? String(source.fullscreenFrame)
    : DEFAULT_VISUAL_FRAME.fullscreenFrame;

  return {
    chatFrame,
    fullscreenFrame,
    chatZoom: numberInRange(source.chatZoom, DEFAULT_VISUAL_FRAME.chatZoom, 0.7, 2.4),
    chatOffsetX: numberInRange(source.chatOffsetX, DEFAULT_VISUAL_FRAME.chatOffsetX, -0.35, 0.35),
    chatOffsetY: numberInRange(source.chatOffsetY, DEFAULT_VISUAL_FRAME.chatOffsetY, -0.35, 0.35),
    fullscreenZoom: numberInRange(source.fullscreenZoom, DEFAULT_VISUAL_FRAME.fullscreenZoom, 0.7, 2.4),
    fullscreenOffsetX: numberInRange(source.fullscreenOffsetX, DEFAULT_VISUAL_FRAME.fullscreenOffsetX, -0.35, 0.35),
    fullscreenOffsetY: numberInRange(source.fullscreenOffsetY, DEFAULT_VISUAL_FRAME.fullscreenOffsetY, -0.35, 0.35),
  };
}

export function getRoleVisualFrame(role) {
  return normalizeVisualFrameConfig(role?.visual_frame_config ?? role?.visualFrame);
}

export function getVisualFrameView(config, view = "chat") {
  const frame = normalizeVisualFrameConfig(config);
  const prefix = view === "fullscreen" ? "fullscreen" : "chat";
  return {
    mode: frame[`${prefix}Frame`],
    zoom: frame[`${prefix}Zoom`],
    offsetX: frame[`${prefix}OffsetX`],
    offsetY: frame[`${prefix}OffsetY`],
  };
}
