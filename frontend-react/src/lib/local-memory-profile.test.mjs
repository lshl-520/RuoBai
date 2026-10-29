import assert from "node:assert/strict";
import { test } from "node:test";

const storage = new Map();
globalThis.localStorage = {
  get length() { return storage.size; },
  key(index) { return Array.from(storage.keys())[index] || null; },
  getItem(key) { return storage.has(key) ? storage.get(key) : null; },
  setItem(key, value) { storage.set(String(key), String(value)); },
  removeItem(key) { storage.delete(String(key)); },
  clear() { storage.clear(); },
};

const memoryApi = await import("./memory.js");
const memoryCache = await import("./local-memory-cache.js");
const memorySync = await import("./local-memory-sync.js");
const profileApi = await import("./profile.js");
const profileCache = await import("./local-profile-cache.js");
const profileSync = await import("./local-profile-sync.js");

function setSession(userId) {
  localStorage.setItem("ruobai_session_snapshot", JSON.stringify({
    loggedIn: true,
    user: { id: userId, nickname: "原昵称", username: "tester" },
    savedAt: Date.now(),
  }));
}

test("reads cached memories when the server is unavailable", async () => {
  localStorage.clear();
  setSession(31);
  memoryCache.writeCachedMemories(12, [{ id: 1, character_id: 12, content: "记住这句" }]);
  globalThis.fetch = async () => { throw new Error("Failed to fetch"); };

  const result = await memoryApi.getMemories(12);
  assert.equal(result.cached, true);
  assert.equal(result.data[0].content, "记住这句");
});

test("queues a memory create and syncs it after recovery", async () => {
  localStorage.clear();
  setSession(31);
  const queued = await memorySync.enqueueMemoryAction({
    characterId: 12,
    kind: "create",
    payload: { content: "离线记忆", memory_type: "life" },
    optimisticMemory: { id: "pending-memory-1", local_id: "pending-memory-1", character_id: 12, content: "离线记忆", memory_type: "life" },
  });
  assert.equal(queued.queued, true);
  assert.equal(memorySync.getPendingMemoryActionCount(), 1);

  globalThis.fetch = async () => ({
    ok: true,
    status: 201,
    json: async () => ({ success: true, data: { id: 501, character_id: 12, content: "离线记忆", memory_type: "life" } }),
  });
  const result = await memorySync.flushPendingMemoryActions();
  assert.deepEqual(result, { sent: 1, remaining: 0 });
  const cached = memoryCache.readCachedMemories(12);
  assert.equal(cached.data[0].id, 501);
});

test("shows cached profile changes immediately and syncs them later", async () => {
  localStorage.clear();
  setSession(32);
  profileCache.writeCachedProfile({ id: 32, nickname: "原昵称", username: "tester" });
  globalThis.fetch = async () => { throw new Error("Failed to fetch"); };

  const queued = await profileApi.updateNickname({ nickname: "新昵称" });
  assert.equal(queued.queued, true);
  assert.equal(queued.user.nickname, "新昵称");
  assert.equal(profileSync.getPendingProfileActionCount(), 1);

  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ success: true, user: { id: 32, nickname: "新昵称", username: "tester" } }),
  });
  const result = await profileSync.flushPendingProfileActions();
  assert.deepEqual(result, { sent: 1, remaining: 0 });
  assert.equal(profileCache.readCachedProfile().user.nickname, "新昵称");
});
