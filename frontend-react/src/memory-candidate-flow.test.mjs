import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("./", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

test("candidate memories require an explicit confirmation and retain a path to chat", async () => {
  const [memoryScreen, history, chat] = await Promise.all([
    source("pages/memory.jsx"),
    source("pages/history.jsx"),
    readFile(new URL("../../server/chat.js", import.meta.url), "utf8"),
  ]);

  assert.match(memoryScreen, /review_status: "active"/);
  assert.match(memoryScreen, />查看聊天</);
  assert.match(memoryScreen, />记住它</);
  assert.match(memoryScreen, />暂不保留</);
  assert.match(memoryScreen, /initialQuery=\{historyQuery\}/);
  assert.match(memoryScreen, /await refreshEvents\(\);/);
  assert.match(history, /initialQuery = ""/);
  assert.match(history, /useStateH\(Boolean\(initialQuery\)\)/);
  assert.match(chat, /COALESCE\(review_status, 'active'\) <> 'candidate'/);
});
