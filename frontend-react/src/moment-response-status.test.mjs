import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { getMomentResponseStatus } from "./lib/moment-response-status.js";

const agentsSource = fs.readFileSync(new URL("./pages/agents.jsx", import.meta.url), "utf8");
const componentsSource = fs.readFileSync(new URL("./styles/components.css", import.meta.url), "utf8");

test("动态回应状态默认关闭，不把没有记录伪装成失败", () => {
  assert.deepEqual(getMomentResponseStatus(), {
    tone: "off",
    label: "默认关闭",
    description: "保存后才会生效",
  });
  assert.deepEqual(getMomentResponseStatus({ enabled: true }), {
    tone: "ready",
    label: "已开启",
    description: "等待首次回应",
  });
});

test("动态回应只根据该类型最近审计显示跳过、失败和已回应", () => {
  assert.equal(getMomentResponseStatus({
    enabled: true,
    events: [{ event_type: "appointment", status: "generation_failed" }, { event_type: "moment_response", status: "skipped" }],
  }).tone, "skip");
  assert.equal(getMomentResponseStatus({
    enabled: true,
    events: [{ event_type: "moment_response", status: "generation_failed" }],
  }).tone, "failure");
  assert.equal(getMomentResponseStatus({
    enabled: true,
    events: [{ event_type: "moment_response", status: "created" }],
  }).tone, "created");
});

test("角色详情的动态回应入口复用真实舞台和审计，不依赖主动发动态", () => {
  assert.match(agentsSource, /<Live2DStage/);
  assert.match(agentsSource, /getProactiveEvents\(\{ characterId: agent\.id, limit: 20 \}\)/);
  assert.match(agentsSource, /moment_response_enabled: enabled/);
  assert.match(agentsSource, /只回应你明确分享给她的动态/);
  assert.doesNotMatch(agentsSource, /auto && .*MomentResponseSettingsSheet/);
});

test("动态回应舞台只占用浮层上方，静态和伪动态立绘不裁切放大", () => {
  assert.match(componentsSource, /--mrs-sheet-height:\s*min\(60%, 500px\)/);
  assert.match(componentsSource, /\.mrs-live2d-stage\s*\{[^}]*inset:\s*0 0 var\(--mrs-sheet-height\)/);
  assert.match(componentsSource, /\.mrs-live2d-stage\.live2d-stage-static > img,[\s\S]*?object-fit:\s*contain/);
  assert.match(componentsSource, /\.mrs-live2d-stage\.live2d-stage-pseudo > img[\s\S]*?transform:\s*none/);
  assert.doesNotMatch(componentsSource, /\.mrs-live2d-stage img\s*\{[^}]*scale\(1\.32\)/);
});
