import test from "node:test";
import assert from "node:assert/strict";
import { buildGuidedImageSubject } from "./lib/guided-image.js";

test("guided image subject stays beginner-friendly and preserves identity boundaries", () => {
  const text = buildGuidedImageSubject({
    characterName: "小白",
    scene: "看书",
    style: "手机随手拍",
    place: "卧室",
    state: "喜欢发呆",
    outfit: "白色针织衫",
  });

  assert.match(text, /角色“小白”/);
  assert.match(text, /卧室看书/);
  assert.match(text, /保持角色本人的固定年龄感/);
  assert.match(text, /第一人称视角/);
  assert.match(text, /男性的手或身体/);
  assert.doesNotMatch(text, /上传用户照片/);
});
