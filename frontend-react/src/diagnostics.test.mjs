import test from "node:test";
import assert from "node:assert/strict";
import {
  clearDiagnosticEvents,
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
