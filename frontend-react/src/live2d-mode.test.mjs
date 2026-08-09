import test from "node:test";
import assert from "node:assert/strict";
import { detectLive2DMode } from "./lib/live2d.js";

const runtime = { mount() {} };

test("Live2D display mode keeps runtime, static fallback, and pseudo fallback distinct", () => {
  assert.equal(detectLive2DMode({ modelUrl: "/model.model3.json", staticSrc: "/preview.png", runtime }), "live2d");
  assert.equal(detectLive2DMode({ modelUrl: "/model.model3.json", staticSrc: "/preview.png", runtime: null }), "static");
  assert.equal(detectLive2DMode({ modelUrl: "", staticSrc: "", runtime: null }), "pseudo");
});
