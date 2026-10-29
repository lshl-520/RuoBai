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

const { appendCachedMomentCommentAcrossCaches, patchCachedMomentAcrossCaches, readCachedMoments, writeCachedMoments } = await import("./local-moment-cache.js");
const { enqueueMomentAction, flushPendingMomentActions, getPendingMomentActionCount } = await import("./local-moment-sync.js");

function setSession(userId) {
  localStorage.setItem("ruobai_session_snapshot", JSON.stringify({
    loggedIn: true,
    user: { id: userId },
    savedAt: Date.now(),
  }));
}

function seedMoment(id = 1) {
  writeCachedMoments({ scope: "all" }, {
    success: true,
    has_more: false,
    items: [{ id, character_id: 12, content: "今天也在这里", likes_count: 0, liked: false, comments: [] }],
  });
}

test("caches moments and updates like/comment state across local filters", () => {
  localStorage.clear();
  setSession(20);
  seedMoment(1);

  patchCachedMomentAcrossCaches(1, { liked: true, likes_count: 1 });
  appendCachedMomentCommentAcrossCaches(1, {
    id: "pending-comment-1",
    local_id: "pending-comment-1",
    content: "我看见啦",
    pending: true,
  });

  const cached = readCachedMoments({ scope: "all" });
  assert.equal(cached?.items[0]?.liked, true);
  assert.equal(cached?.items[0]?.likes_count, 1);
  assert.deepEqual(cached?.items[0]?.comments.map(item => item.content), ["我看见啦"]);
});

test("flushes queued like and comment actions in order", async () => {
  localStorage.clear();
  setSession(20);
  seedMoment(2);

  await enqueueMomentAction({
    momentId: 2,
    kind: "like",
    optimisticPatch: { liked: true, likes_count: 1 },
  });
  await enqueueMomentAction({
    momentId: 2,
    kind: "comment",
    payload: { content: "晚安" },
    optimisticComment: {
      id: "pending-comment-2",
      local_id: "pending-comment-2",
      content: "晚安",
      pending: true,
    },
  });
  assert.equal(getPendingMomentActionCount(), 2);

  const paths = [];
  globalThis.fetch = async (path) => {
    paths.push(path);
    if (path.endsWith("/like")) return { ok: true, status: 200, json: async () => ({ success: true, liked: true, likes_count: 1 }) };
    return { ok: true, status: 201, json: async () => ({ success: true, item: { id: 77, content: "晚安", character_id: null } }) };
  };

  const result = await flushPendingMomentActions();
  assert.deepEqual(result, { sent: 2, remaining: 0 });
  assert.deepEqual(paths.map(path => path.endsWith("/like") ? "like" : "comment"), ["like", "comment"]);

  const cached = readCachedMoments({ scope: "all" });
  assert.equal(cached?.items[0]?.liked, true);
  assert.deepEqual(cached?.items[0]?.comments.map(item => [item.id, item.pending]), [[77, false]]);
});
