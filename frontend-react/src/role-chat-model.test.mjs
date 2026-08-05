import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./pages/chat.jsx", import.meta.url), "utf8");

test("聊天室保留清爽的模型入口和推理深度", () => {
  assert.match(source, /className="ct-model"/);
  assert.match(source, /function ModelPanel/);
  assert.match(source, /推理深度/);
  assert.match(source, /关闭/);
  assert.match(source, /深入/);
  assert.doesNotMatch(source, /这里的选择仅用于/);
  assert.doesNotMatch(source, /跟随“我的”默认模型/);
  assert.doesNotMatch(source, /· 仅\$\{agent\.name\}/);
});

test("角色模型选择仍保存到当前角色", () => {
  assert.match(source, /updateRole\(roleId, \{/);
  assert.match(source, /chat_credential_id:/);
  assert.match(source, /chat_model_id:/);
  assert.match(source, /chat_thinking_level:/);
  assert.doesNotMatch(source, /updateCapability\("chat"/);
  assert.doesNotMatch(source, /ruobai_model_/);
});

test("聊天请求继续支持当前角色模型和推理深度", () => {
  assert.match(source, /modelChoice\.credentialId/);
  assert.match(source, /modelChoice\.modelId/);
  assert.match(source, /modelChoice\.thinkLevel/);
  assert.match(source, /streamAssistantReply\(roleId, streamPayload/);
});
