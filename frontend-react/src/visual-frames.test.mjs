import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_VISUAL_FRAME,
  getVisualFrameView,
  normalizeVisualFrameConfig,
} from "./lib/visual-frames.js";

test("visual frame config falls back to the novice-friendly defaults", () => {
  assert.deepEqual(normalizeVisualFrameConfig(null), DEFAULT_VISUAL_FRAME);
  // 2026/10/14 用户要求聊天室里"看得更完整"，默认聊天取景由 knee 改为 full。
  // 角色自己存过取景设置的话，以角色设置为准（见下面的 per-role 用例）。
  assert.deepEqual(getVisualFrameView(null, "chat"), {
    mode: "full",
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
