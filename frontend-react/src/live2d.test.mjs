import test from "node:test";
import assert from "node:assert/strict";
import { detectLive2DMode, getLive2DRuntime, runWithTimeout } from "./lib/live2d.js";

test("Live2D only enters real playback when an adapter can mount", () => {
  assert.equal(detectLive2DMode({ modelUrl: "/model.model3.json", staticSrc: "/preview.png" }), "static");
  assert.equal(detectLive2DMode({ modelUrl: "/model.model3.json", staticSrc: "/preview.png", runtime: { mount() {} } }), "live2d");
  assert.equal(detectLive2DMode({}), "pseudo");
});

test("global Live2D runtime must expose mount", () => {
  assert.equal(getLive2DRuntime({ __RUOBAI_LIVE2D_RUNTIME__: { load() {} } }), null);
  const runtime = { mount() {} };
  assert.equal(getLive2DRuntime({ __RUOBAI_LIVE2D_RUNTIME__: runtime }), runtime);
});

test("Live2D mount timeout rejects promptly and cleans up a late controller", async () => {
  let cleaned = false;
  await assert.rejects(
    runWithTimeout(
      () => new Promise((resolve) => setTimeout(() => resolve(() => { cleaned = true; }), 30)),
      5,
    ),
    /Live2D 模型加载超时/,
  );
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(cleaned, true);
});
