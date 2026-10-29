import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("./App.jsx", import.meta.url), "utf8");
const shell = await readFile(new URL("./components/ShellV2.jsx", import.meta.url), "utf8");
const css = await readFile(new URL("./styles/shell-v2.css", import.meta.url), "utf8");
const main = await readFile(new URL("./main.jsx", import.meta.url), "utf8");

test("轻语是默认外观，?ui=classic 才回到旧界面", () => {
  // 默认走轻语；显式 classic 才摘掉，并把选择记下来
  assert.match(app, /localStorage\.getItem\("ruobai_shell"\) !== "classic"/);
  assert.match(app, /localStorage\.setItem\("ruobai_shell", "classic"\)/);
  assert.match(app, /query\.get\("ui"\)/);
  // 启动时也要和 App 判断一致，避免首屏闪一下旧皮肤
  assert.match(main, /localStorage\.getItem\("ruobai_shell"\) !== "classic"/);
});

test("新骨架只在 v2 附着，旧界面结构保持不变", () => {
  assert.match(app, /data-ui=\{shellV2 \? "v2" : undefined\}/);
  assert.match(app, /<ShellV2[\s\S]{0,200}agents=\{agents\}/);
  // 八个路由仍然共用同一套页面
  for (const path of ["/chat", "/characters", "/moments", "/memory", "/profile", "/usage"]) {
    assert.ok(app.includes(`path="${path}"`), `缺少 ${path} 路由`);
  }
});

test("电脑三栏 + 手机五 Tab：手机不显示左右两栏", () => {
  assert.match(css, /grid-template-columns: var\(--rb-rail-w\) minmax\(0, 1fr\) var\(--rb-her-w\)/);
  assert.match(css, /@media \(max-width: 1023px\)[\s\S]{0,220}\.rb-shell-rail,[\s\S]{0,80}\.rb-shell-her \{ display: none; \}/);
  assert.match(css, /@media \(min-width: 1024px\)[\s\S]{0,400}\.tabbar \{ display: none; \}/);
});

test("右栏只展示真实内容：立绘、名字、签名、她记下的事", () => {
  assert.match(shell, /rb-shell-her/);
  assert.match(shell, /getRoles\(\)/);
  assert.match(shell, /getRoleFullPortrait\(agent\)/);
  assert.match(shell, /getLifeEvents\(agentId, \{ limit: 3 \}\)/);
  assert.match(shell, /她最近记下的事/);
  // 不许把关系数据伪装成"她此刻"
  assert.doesNotMatch(shell, /亲密度|关系温度|在一起\s*\d+\s*天|在线|正在输入/);
});

test("新骨架不引入新色板，颜色只复用微光令牌", () => {
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,6}\b/);
  assert.match(css, /var\(--rose\)/);
  assert.match(css, /var\(--card\)/);
});

test("骨架样式最后加载，能覆盖旧布局但不改旧文件", () => {
  assert.match(main, /import "\.\/styles\/shell-v2\.css";/);
  assert.ok(main.indexOf("shell-v2.css") > main.indexOf("classic-theme.css"));
});