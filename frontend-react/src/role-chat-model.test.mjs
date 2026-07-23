import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./pages/chat.jsx", import.meta.url), "utf8");

test("chat room model selection is saved to the current role instead of the global capability", () => {
  assert.match(source, /updateRole\(roleId, \{/);
  assert.match(source, /chat_credential_id:/);
  assert.match(source, /chat_model_id:/);
  assert.match(source, /chat_thinking_level:/);
  assert.doesNotMatch(source, /updateCapability\("chat"/);
  assert.doesNotMatch(source, /ruobai_model_/);
});

test("chat model panel can follow the default and explains role isolation", () => {
  assert.match(source, /跟随“我的”默认模型/);
  assert.match(source, /这里的选择仅用于/);
  assert.match(source, /不会改变其他角色/);
  assert.match(source, /modelChoice\.modelId \? `\$\{modelChoice\.modelId\} · 仅\$\{agent\.name\}` : "跟随默认"/);
});
