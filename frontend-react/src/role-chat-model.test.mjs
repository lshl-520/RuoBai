import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./pages/chat.jsx", import.meta.url), "utf8");

test("聊天室顶部恢复清爽状态，不显示复杂模型入口", () => {
  assert.match(source, /className="ct-status"/);
  assert.doesNotMatch(source, /className="ct-model"/);
  assert.doesNotMatch(source, /function ModelPanel/);
  assert.doesNotMatch(source, /跟随“我的”默认模型/);
});

test("聊天请求交给后端选择模型", () => {
  assert.match(source, /const streamPayload = basePayload/);
  assert.match(source, /streamAssistantReply\(roleId, streamPayload/);
  assert.doesNotMatch(source, /modelChoice\.credentialId/);
  assert.doesNotMatch(source, /modelChoice\.modelId/);
});
