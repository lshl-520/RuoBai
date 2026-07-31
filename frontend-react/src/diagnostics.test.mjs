import test from "node:test";
import assert from "node:assert/strict";
import {
  clearDiagnosticEvents,
  describeDiagnosticEvent,
  formatDiagnosticReport,
  getDiagnosticEvents,
  recordDiagnostic,
  sanitizeDiagnosticText,
  withDiagnosticId,
} from "./lib/diagnostics.js";

function createStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test("diagnostics redact credential-like values before local persistence", () => {
  const previous = globalThis.localStorage;
  globalThis.localStorage = createStorage();
  try {
    const id = recordDiagnostic({
      area: "auth",
      action: "login",
      error: "Bearer secret-token password=hunter2 access_token=abc123",
    });
    const event = getDiagnosticEvents().find((item) => item.id === id);
    assert.ok(event);
    assert.doesNotMatch(event.message, /secret-token|hunter2|abc123/);
    assert.match(event.message, /REDACTED/);
  } finally {
    clearDiagnosticEvents();
    globalThis.localStorage = previous;
  }
});

test("diagnostics expose a copyable ID without storing chat content", () => {
  const previous = globalThis.localStorage;
  globalThis.localStorage = createStorage();
  try {
    const id = recordDiagnostic({ area: "chat", action: "stream-reply", error: "HTTP 503" });
    assert.match(id, /^RB-/);
    assert.match(withDiagnosticId("发送失败", id), new RegExp(id));
    const event = getDiagnosticEvents()[0];
    assert.equal(event.area, "chat");
    assert.equal(event.action, "stream-reply");
    assert.equal(event.message, "HTTP 503");
    assert.equal(Object.hasOwn(event, "content"), false);
  } finally {
    clearDiagnosticEvents();
    globalThis.localStorage = previous;
  }
});

test("role failures are returned to the UI with a diagnostic ID", async () => {
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const path = await import("node:path");
  const source = await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), "App.jsx"), "utf8");
  assert.match(source, /withDiagnosticId\("删除角色失败，请稍后重试。", id\)/);
  assert.match(source, /withDiagnosticId\("设置主陪伴失败，请稍后重试。", id\)/);
});

test("diagnostic report uses friendly labels and contains only safe fields", () => {
  const report = formatDiagnosticReport([{
    id: "RB-TEST-123",
    at: Date.now(),
    area: "chat",
    action: "stream-reply",
    status: 503,
    message: "Bearer secret-token",
    content: "不能出现在报告里的聊天内容",
  }]);
  assert.deepEqual(describeDiagnosticEvent({ area: "chat", action: "stream-reply" }), { area: "聊天", action: "等待回复" });
  assert.match(report, /聊天·等待回复/);
  assert.match(report, /RB-TEST-123/);
  assert.doesNotMatch(report, /secret-token|不能出现在报告里的聊天内容/);
  assert.match(report, /REDACTED/);
});

test("profile exposes local diagnostics inside privacy settings with copy and confirmed clearing", async () => {
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const path = await import("node:path");
  const source = await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), "pages", "profile.jsx"), "utf8");
  assert.match(source, /本机排障信息/);
  assert.match(source, /一键复制排障摘要/);
  assert.match(source, /再点一次，确认清空这些本机记录/);
  assert.match(source, /formatDiagnosticReport/);
});
