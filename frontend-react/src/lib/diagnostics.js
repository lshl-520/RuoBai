const STORAGE_KEY = "ruobai_private_diagnostics_v1";
const MAX_EVENTS = 80;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function getStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function randomPart() {
  try {
    const bytes = new Uint32Array(1);
    globalThis.crypto.getRandomValues(bytes);
    return bytes[0].toString(36).slice(-5).toUpperCase();
  } catch {
    return Math.random().toString(36).slice(2, 7).toUpperCase();
  }
}

function isFreshEvent(event, now) {
  return event && typeof event === "object" && Number.isFinite(event.at) && now - event.at <= RETENTION_MS;
}

function readEvents() {
  const storage = getStorage();
  if (!storage) return [];

  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) || "[]");
    const now = Date.now();
    return Array.isArray(parsed) ? parsed.filter((event) => isFreshEvent(event, now)).slice(-MAX_EVENTS) : [];
  } catch {
    return [];
  }
}

function writeEvents(events) {
  const storage = getStorage();
  if (!storage) return;

  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(events.slice(-MAX_EVENTS)));
  } catch {
    // Diagnostics must never affect normal app use when browser storage is unavailable.
  }
}

export function sanitizeDiagnosticText(value) {
  return String(value || "")
    .replace(/(bearer\s+)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/\b(api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|authorization)\b\s*([:=])\s*[^\s,;]+/gi, "$1$2[REDACTED]")
    .replace(/([?&](?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/data:[^\s]+/gi, "[REDACTED_DATA]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

export function createDiagnosticId() {
  return `RB-${Date.now().toString(36).toUpperCase()}-${randomPart()}`;
}

export function recordDiagnostic({ area = "app", action = "unknown", error, status } = {}) {
  const id = createDiagnosticId();
  const message = sanitizeDiagnosticText(error instanceof Error ? error.message : error);
  const event = {
    id,
    at: Date.now(),
    area: String(area).slice(0, 32),
    action: String(action).slice(0, 48),
    kind: error instanceof Error ? error.name : "Error",
    ...(Number.isInteger(status) ? { status } : {}),
    ...(message ? { message } : {}),
  };
  const events = readEvents();
  events.push(event);
  writeEvents(events);
  return id;
}

export function getDiagnosticEvents() {
  return readEvents();
}

export function clearDiagnosticEvents() {
  const storage = getStorage();
  try {
    storage?.removeItem(STORAGE_KEY);
  } catch {}
}

export function withDiagnosticId(message, id) {
  return `${String(message || "操作暂时没有完成，请稍后重试。")}（错误编号：${id}）`;
}
