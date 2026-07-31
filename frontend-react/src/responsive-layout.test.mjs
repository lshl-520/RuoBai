import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const components = await readFile(new URL("./styles/components.css", import.meta.url), "utf8");
const components2 = await readFile(new URL("./styles/components2.css", import.meta.url), "utf8");

test("大窗口聊天室顶部仍按应用容器留白", () => {
  assert.match(components, /\.chat-top \{ padding-left: 14px; padding-right: 14px; \}/);
  assert.doesNotMatch(components, /\.chat-top \{[^}]*100vw/);
});

test("动态和记忆角色栏按自身容器而不是整块屏幕排版", () => {
  assert.match(components2, /\.mem-role \{[\s\S]{0,100}calc\(\(100% - 5 \* 14px\) \/ 6\)/);
  assert.match(components, /\.mem-role \{ flex-basis: calc\(\(100% - 5 \* 12px\) \/ 6\); \}/);
  assert.doesNotMatch(`${components}\n${components2}`, /\.mem-role \{[^}]*100vw/);
});
