import test from "node:test";
import assert from "node:assert/strict";
import {
  CHAT_HISTORY_INITIAL,
  CHAT_HISTORY_PAGE,
  getChatHistoryMessageCount,
  getChatRenderKey,
  getChatHistoryWindow,
} from "./lib/chat-history-window.js";

test("chat history window keeps the newest messages and nearest day marker", () => {
  const messages = [
    { type: "time", text: "昨天" },
    { id: 1, text: "旧消息" },
    { type: "time", text: "今天" },
    { id: 2, text: "较新消息" },
    { id: 3, text: "最新消息" },
  ];

  assert.deepEqual(getChatHistoryWindow(messages, 2), [
    { type: "time", text: "今天" },
    { id: 2, text: "较新消息" },
    { id: 3, text: "最新消息" },
  ]);
  assert.equal(getChatHistoryMessageCount(messages), 3);
  assert.equal(messages.length, 5);
});

test("history window constants leave room for one upward page", () => {
  assert.equal(CHAT_HISTORY_INITIAL, 40);
  assert.equal(CHAT_HISTORY_PAGE, 40);
  assert.deepEqual(getChatHistoryWindow([{ id: 1 }], CHAT_HISTORY_INITIAL), [{ id: 1 }]);
});

test("render keys stay with their chat item when older history is prepended", () => {
  assert.equal(getChatRenderKey({ type: "time", text: "今天" }), "time-今天");
  assert.equal(getChatRenderKey({ id: 12 }), "message-12");
  assert.equal(getChatRenderKey({ _clientId: "local-12", id: 12 }), "client-local-12");
  assert.equal(getChatRenderKey({ _id: 42, text: "流式回复" }), "stream-42");
});
