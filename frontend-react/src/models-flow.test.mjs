import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./pages/models.jsx", import.meta.url), "utf8");

test("channel sheet gets models before choosing model purposes", () => {
  const modelIndex = source.indexOf('>模型 <span className="lbl-hint">先获取，再选择</span>');
  const purposeIndex = source.indexOf('>这个模型用来做什么 <span className="lbl-hint">先选模型，再选用途</span>');
  assert.ok(modelIndex > 0);
  assert.ok(purposeIndex > modelIndex);
});

test("model retrieval is the only connection check action", () => {
  assert.match(source, /获取模型列表/);
  assert.doesNotMatch(source, />测试密钥和连接</);
  assert.doesNotMatch(source, /runTest/);
});

test("saved keys show only a fingerprint and require explicit replacement", () => {
  assert.match(source, /channel\.apiKeyMasked/);
  assert.match(source, />更换密钥</);
  assert.match(source, /粘贴新的 API Key/);
  assert.match(source, /!replacingKey && channel\?\.keyConfigured/);
});


test("new or connection-edited channels must retrieve models before purposes and save", () => {
  assert.match(source, /const connectionReady = fetchState === "done" \|\| \(!isNew && !connectionChanged\)/);
  assert.match(source, /disabled=\{!canChoosePurpose\}/);
  assert.match(source, /&& connectionReady\s*&& model\.trim\(\)/);
  assert.match(source, /请先获取模型列表并确认连接/);
});
