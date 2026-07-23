import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const main = await readFile(new URL("./main.jsx", import.meta.url), "utf8");
const profile = await readFile(new URL("./pages/profile.jsx", import.meta.url), "utf8");
const chat = await readFile(new URL("./pages/chat.jsx", import.meta.url), "utf8");
const classic = await readFile(new URL("./styles/classic-theme.css", import.meta.url), "utf8");

test("原版主题在首次绘制前恢复并最后加载覆盖样式", () => {
  assert.match(main, /ruobai_theme/);
  assert.match(main, /dataset\.theme = "classic"/);
  assert.match(main, /import "\.\/styles\/classic-theme\.css"/);
});

test("主题面板明确说明两套完整外观", () => {
  assert.match(profile, /原版 3\.13/);
  assert.match(profile, /两套完整外观/);
  assert.match(profile, /布局、卡片、标题、背景、间距和导航/);
});

test("原版主题覆盖五个主页面和聊天室布局", () => {
  for (const selector of [
    ".cl-card", ".hero", ".agent-card", ".moments-cover", ".moment",
    ".history-entry", ".mem-card", ".me-hero", ".cap-card", ".chat-top", ".her-bubble"
  ]) {
    assert.ok(classic.includes(`html[data-theme="classic"] ${selector}`), `缺少 ${selector} 的原版样式`);
  }
});

test("聊天列表原版具有独立亲密度条结构", () => {
  assert.match(chat, /cl-classic-meter/);
  assert.match(classic, /\.cl-classic-meter/);
});
