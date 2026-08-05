import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./pages/chat.jsx", import.meta.url), "utf8");

test("聊天室保留清爽的模型入口和心情展示", () => {
  assert.match(source, /className="ct-model"/);
  assert.match(source, /function ModelPanel/);
  assert.match(source, /🌱 心情展示/);
  assert.match(source, /关闭/);
  assert.match(source, /简短/);
  assert.match(source, /细腻/);
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

test("发送失败重试时把缺失的图片附件归一为空数组", () => {
  assert.match(source, /Array\.isArray\(retryPayload\.images\)/);
  assert.match(source, /Array\.isArray\(atts\)/);
});

test("发送按钮不把鼠标事件对象误当成重试参数", () => {
  assert.match(source, /onClick=\{\(\) => send\(\)\}/);
  assert.doesNotMatch(source, /onClick=\{send\}/);
});
