export const CHAT_HISTORY_INITIAL = 40;
export const CHAT_HISTORY_PAGE = 40;

export function getChatHistoryMessageCount(messages = []) {
  const items = Array.isArray(messages) ? messages : [];
  return items.reduce((count, item) => count + (item?.type === "time" ? 0 : 1), 0);
}

export function getChatHistoryWindow(messages = [], count = CHAT_HISTORY_INITIAL) {
  const items = Array.isArray(messages) ? messages : [];
  const safeCount = Math.max(1, Number(count) || CHAT_HISTORY_INITIAL);
  if (getChatHistoryMessageCount(items) <= safeCount) return items;

  let seen = 0;
  let start = 0;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index]?.type === "time") continue;
    seen += 1;
    if (seen === safeCount) {
      start = index;
      break;
    }
  }
  const visible = items.slice(start);

  // Keep the nearest preceding day marker visible without rendering the older
  // messages that belong to that day.
  if (visible[0]?.type !== "time") {
    for (let index = start - 1; index >= 0; index -= 1) {
      if (items[index]?.type === "time") return [items[index], ...visible];
    }
  }

  return visible;
}

export function getChatRenderKey(message = {}) {
  if (message.type === "time") return `time-${message.text || "divider"}`;
  if (message._clientId) return `client-${message._clientId}`;
  if (message._id !== undefined && message._id !== null) return `stream-${message._id}`;
  if (message.id !== undefined && message.id !== null) return `message-${message.id}`;

  const fallback = [
    message.who || "",
    message.type || "message",
    message.time || "",
    message.text || "",
    Array.isArray(message.images) ? message.images.join("|") : "",
  ].join("|");
  return `local-${fallback}`;
}
