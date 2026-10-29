import assert from "node:assert/strict";
import { test } from "node:test";

const storage = new Map();
globalThis.localStorage = {
  getItem(key) { return storage.has(key) ? storage.get(key) : null; },
  setItem(key, value) { storage.set(String(key), String(value)); },
  removeItem(key) { storage.delete(String(key)); },
  clear() { storage.clear(); },
};

const { readCachedMessages } = await import("./local-message-cache.js");
const { enqueuePendingMessage, flushPendingMessages, getPendingMessageCount } = await import("./local-message-sync.js");

function setSession(userId) {
  localStorage.setItem("ruobai_session_snapshot", JSON.stringify({
    loggedIn: true,
    user: { id: userId },
    savedAt: Date.now(),
  }));
}

function response(data, status = 201) {
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}

test("queues an offline message and replaces it after recovery", async () => {
  localStorage.clear();
  setSession(9);
  globalThis.fetch = async () => { throw new Error("Failed to fetch"); };

  const queued = await enqueuePendingMessage(12, {
    role: "user",
    content: "离线也要记住这句",
    message_type: "text",
  });
  assert.equal(queued?.queued, true);
  assert.equal(getPendingMessageCount(), 1);

  const pending = await readCachedMessages(12);
  assert.equal(pending?.items[0]?.sync_state, "pending");

  globalThis.fetch = async () => response({
    success: true,
    item: {
      id: 901,
      character_id: 12,
      role: "user",
      content: "离线也要记住这句",
      message_type: "text",
      created_at: "2026-09-22T12:00:00.000Z",
    },
  });
  const flushed = await flushPendingMessages();
  assert.deepEqual(flushed, { sent: 1, remaining: 0 });
  assert.equal(getPendingMessageCount(), 0);

  const synced = await readCachedMessages(12);
  assert.deepEqual(synced?.items.map(item => [item.id, item.sync_state]), [[901, "synced"]]);
});

test("keeps later messages queued when the first retry fails", async () => {
  localStorage.clear();
  setSession(10);
  await enqueuePendingMessage(12, { role: "user", content: "第一条", message_type: "text" });
  await enqueuePendingMessage(12, { role: "user", content: "第二条", message_type: "text" });

  const calls = [];
  globalThis.fetch = async (_path, options) => {
    calls.push(JSON.parse(options.body).content);
    throw new Error("Failed to fetch");
  };
  const result = await flushPendingMessages();
  assert.equal(result.sent, 0);
  assert.equal(result.remaining, 2);
  assert.deepEqual(calls, ["第一条"]);
});
