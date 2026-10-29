import test from "node:test";
import assert from "node:assert/strict";
import { getFraming } from "./lib/live2d-runtime.js";

test("live2d crop distance is stable across viewport heights", () => {
  const framing = getFraming({ mode: "knee" });
  const width = 336;
  const narrowHeight = 520;
  const tallHeight = 600;

  const cropOffset = width * framing.anchorOffset;
  assert.equal(framing.zoom, 1);
  assert.equal(framing.fit, "width");
  assert.ok(Math.abs(cropOffset - 47.04) < 0.000001);
  assert.equal(tallHeight + cropOffset - (narrowHeight + cropOffset), 80);
});
import fs from "node:fs";

/*
 * 2026/10/14 真机事故：模型包里的贴图/动作是相对路径，pixi-live2d-display 拿
 * settings.url 当基准去拼。App 本地壳跑在 https://localhost，传相对地址会去本机
 * 找贴图 → Network error → Live2D 静默退回静态预览（看着像立绘被放大）。
 * 基准地址必须过 apiUrl()，由它给 App 补服务器域名。
 */
test("Live2D 模型基准地址走 apiUrl，App 里才能找到贴图", () => {
  const source = fs.readFileSync(new URL("./lib/live2d-runtime.js", import.meta.url), "utf8");
  assert.ok(source.includes('import { apiFetch, apiUrl } from "./api-base.js";'), "要引入 apiUrl");
  assert.ok(
    source.includes("buildLive2DModelJson(source, { modelUrl: apiUrl(modelUrl), manifest })"),
    "settings.url 必须是绝对地址",
  );
  assert.ok(!/buildLive2DModelJson\(source, \{ modelUrl, manifest \}\)/.test(source), "不能再用裸的相对地址");
});