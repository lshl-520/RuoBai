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
