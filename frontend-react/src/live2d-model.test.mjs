import test from "node:test";
import assert from "node:assert/strict";
import { buildLive2DModelJson, toModelRelativePath } from "./lib/live2d-model.js";

test("model asset paths are converted to paths relative to model3.json", () => {
  assert.equal(
    toModelRelativePath("团子出击/待机动画.motion3.json", "团子出击/团子出击.model3.json"),
    "待机动画.motion3.json",
  );
});

test("manifest actions and expressions are injected without mutating the source", () => {
  const source = {
    Version: 3,
    FileReferences: {
      Moc: "model.moc3",
      Textures: ["texture.png"],
    },
  };
  const result = buildLive2DModelJson(source, {
    modelUrl: "/user_assets/model.model3.json",
    manifest: {
      modelPath: "model.model3.json",
      motionPaths: ["待机动画.motion3.json"],
      expressionPaths: ["脸红.exp3.json"],
    },
  });

  assert.equal(result.url, "/user_assets/model.model3.json");
  assert.deepEqual(result.FileReferences.Motions.Idle, [{ File: "待机动画.motion3.json" }]);
  assert.deepEqual(result.FileReferences.Expressions, [{ Name: "脸红", File: "脸红.exp3.json" }]);
  assert.equal(source.FileReferences.Motions, undefined);
});
