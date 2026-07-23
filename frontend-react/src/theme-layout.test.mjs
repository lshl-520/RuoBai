import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const main = await readFile(new URL("./main.jsx", import.meta.url), "utf8");
const profile = await readFile(new URL("./pages/profile.jsx", import.meta.url), "utf8");
const app = await readFile(new URL("./App.jsx", import.meta.url), "utf8");
const agents = await readFile(new URL("./pages/agents.jsx", import.meta.url), "utf8");
const moments = await readFile(new URL("./pages/moments.jsx", import.meta.url), "utf8");
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

test("八个页面共用同一套 React 功能路由，不按主题复制业务页面", () => {
  for (const path of ["/", "/auth", "/chat", "/characters", "/moments", "/memory", "/profile"]) {
    assert.ok(app.includes(`path="${path}"`), `缺少 ${path} 路由`);
  }
  assert.match(app, /<ChatRoom /);
  assert.doesNotMatch(app, /theme\s*===\s*["']classic["']\s*\?/);
});

test("原版角色页保留全部三项关系数据，并正确展开横向角色卡", () => {
  assert.match(agents, /在一起 · 天/);
  assert.match(agents, /关系温度/);
  assert.match(agents, /亲密度/);
  assert.doesNotMatch(classic, /\.hero-stats \.hs:first-child\s*\{\s*display:\s*none/);
  assert.match(classic, /grid-template-columns:\s*repeat\(3,/);
  assert.match(classic, /\.ac-photo\s*\{\s*display:\s*contents/);
});

test("原版动态装饰头像有等价筛选入口，聊天室常驻立绘不能被主题隐藏", () => {
  assert.match(moments, /filter === null/);
  assert.match(moments, /user\?\.username \|\| "我"/);
  assert.match(chat, /className="ct-avatar"[\s\S]{0,260}onClick=\{\(\) => setBig\(true\)\}/);
  assert.match(chat, /className="chat-fig-img"[\s\S]{0,180}setBig\(true\)/);
  assert.match(classic, /\.chat-figure\s*\{\s*display:\s*block/);
  assert.doesNotMatch(classic, /\.chat-figure\s*\{\s*display:\s*none/);
});

test("两套聊天室共用的图标入口具有大白话名称", () => {
  for (const label of ["返回聊天列表", "搜索聊天记录", "更多聊天操作", "开始实时通话", "选择图片", "打开表情包", "发送消息"]) {
    assert.ok(chat.includes(label), `缺少 ${label} 的可读名称`);
  }
});
