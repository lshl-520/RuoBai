import assert from "node:assert/strict";
import { test } from "node:test";

const storage = new Map();
globalThis.localStorage = {
  get length() { return storage.size; },
  key(index) { return Array.from(storage.keys())[index] || null; },
  getItem(key) { return storage.has(key) ? storage.get(key) : null; },
  setItem(key, value) { storage.set(String(key), String(value)); },
  removeItem(key) { storage.delete(key); },
  clear() { storage.clear(); },
};

const lifeEventsApi = await import("./life-events.js");
const cache = await import("./local-life-event-cache.js");
const sync = await import("./local-life-event-sync.js");

function setSession(userId) {
  localStorage.setItem("ruobai_session_snapshot", JSON.stringify({ loggedIn: true, user: { id: userId, nickname: "测试用户" }, savedAt: Date.now() }));
}

test("reads cached life events when the server is unavailable", async () => {
  localStorage.clear();
  setSession(41);
  cache.writeCachedLifeEvents(12, [{ id: 7, character_id: 12, title: "一起散步" }]);
  globalThis.fetch = async () => { throw new Error("Failed to fetch"); };
  const result = await lifeEventsApi.getLifeEvents(12);
  assert.equal(result.cached, true);
  assert.equal(result.items[0].title, "一起散步");
});

test("queues an offline life event update", async () => {
  localStorage.clear();
  setSession(41);
  cache.writeCachedLifeEvents(12, [{ id: 7, title: "一起散步", status: "active" }]);
  globalThis.fetch = async () => { throw new Error("Failed to fetch"); };
  const result = await lifeEventsApi.updateLifeEvent(7, { status: "completed" }, 12);
  assert.equal(result.queued, true);
  assert.equal(sync.getPendingLifeEventActionCount(), 1);
  assert.equal(cache.readCachedLifeEvents(12).items[0].status, "completed");
});

test("queues an offline life event delete", async () => {
  localStorage.clear();
  setSession(41);
  cache.writeCachedLifeEvents(12, [{ id: 7, title: "一起散步" }]);
  globalThis.fetch = async () => { throw new Error("Failed to fetch"); };
  const result = await lifeEventsApi.deleteLifeEvent(7, 12);
  assert.equal(result.queued, true);
  assert.equal(sync.getPendingLifeEventActionCount(), 1);
  assert.equal(cache.readCachedLifeEvents(12).items.length, 0);
});

test("flushes life event actions in order after recovery", async () => {
  localStorage.clear();
  setSession(41);
  cache.writeCachedLifeEvents(12, [{ id: 7, title: "旧标题", status: "active" }]);
  globalThis.fetch = async () => { throw new Error("Failed to fetch"); };
  await lifeEventsApi.updateLifeEvent(7, { status: "completed" }, 12);
  await lifeEventsApi.updateLifeEvent(7, { title: "新标题", status_note: "已纠正" }, 12);
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, method: options?.method });
    return { ok: true, status: 200, json: async () => ({ success: true, id: 7 }) };
  };
  const result = await sync.flushPendingLifeEventActions();
  assert.deepEqual(result, { sent: 2, remaining: 0 });
  assert.deepEqual(calls.map((item) => item.method), ["PATCH", "PATCH"]);
  const item = cache.readCachedLifeEvents(12).items[0];
  assert.equal(item.status, "completed");
  assert.equal(item.title, "新标题");
  assert.equal(item.sync_state, "synced");
});
