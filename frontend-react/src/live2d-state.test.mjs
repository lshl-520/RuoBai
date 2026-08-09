import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyChatLive2DScene,
  getLive2DExpressionIndex,
  getChatLive2DState,
  resolveLive2DExpression,
} from "./lib/live2d-state.js";

const manifest = {
  expressionPaths: ["团子出击/爱心眼.exp3.json", "团子出击/脸红.exp3.json"],
};

test("only explicit intimacy and praise wording opt into a Live2D scene", () => {
  assert.equal(classifyChatLive2DScene("小师，我想你了，抱抱"), "affection");
  assert.equal(classifyChatLive2DScene("你今天真可爱"), "praise");
  assert.equal(classifyChatLive2DScene("今天服务器修好了"), "idle");
});

test("a scene is active only while the character is responding", () => {
  const messages = [{ who: "me", text: "老婆，想你了" }];
  assert.deepEqual(getChatLive2DState(messages), { scene: "idle" });
  assert.deepEqual(getChatLive2DState(messages, { isResponding: true }), { scene: "affection" });
  assert.deepEqual(getChatLive2DState([...messages, { who: "her", _streaming: true }]), { scene: "affection" });
});

test("scene mapping only uses expressions that the uploaded package actually contains", () => {
  assert.equal(resolveLive2DExpression({ scene: "affection" }, manifest), "爱心眼");
  assert.equal(resolveLive2DExpression({ scene: "praise" }, manifest), "脸红");
  assert.equal(getLive2DExpressionIndex("脸红", manifest), 1);
  assert.equal(getLive2DExpressionIndex("不存在", manifest), -1);
  assert.equal(resolveLive2DExpression({ scene: "praise" }, { expressionPaths: [] }), "");
  assert.equal(resolveLive2DExpression({ scene: "idle" }, manifest), "");
});
