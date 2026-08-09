import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_VISUAL_FRAME,
  getVisualFrameView,
  normalizeVisualFrameConfig,
} from "./lib/visual-frames.js";

test("visual frame config falls back to the novice-friendly defaults", () => {
  assert.deepEqual(normalizeVisualFrameConfig(null), DEFAULT_VISUAL_FRAME);
  assert.deepEqual(getVisualFrameView(null, "chat"), {
    mode: "knee",
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
  });
});

test("visual frame config keeps per-role view choices and clamps unsafe values", () => {
  const config = normalizeVisualFrameConfig({
    chatFrame: "half",
    fullscreenFrame: "half",
    chatZoom: 99,
    fullscreenOffsetX: -99,
  });

  assert.equal(config.chatFrame, "half");
  assert.equal(config.fullscreenFrame, "half");
  assert.equal(config.chatZoom, 2.4);
  assert.equal(config.fullscreenOffsetX, -0.35);
  assert.deepEqual(getVisualFrameView(config, "fullscreen"), {
    mode: "half",
    zoom: 1,
    offsetX: -0.35,
    offsetY: 0,
  });
});
