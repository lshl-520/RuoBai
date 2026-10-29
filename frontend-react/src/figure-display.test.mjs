import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

/*
 * 立绘显示规则（2026/10/14 用户确认的两条）：
 *
 * ① 聊天室里的立绘限高 78% 并贴底 —— 超高比例的图不再铺满整块聊天区；
 *    全屏视图不加限高，保持「整张完整显示」。
 * ② Live2D 挂载期间先显示静态立绘（不再空白等最多 12 秒），就绪后淡出。
 */
const stage = fs.readFileSync(new URL('./components/Live2DStage.jsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('./styles/components2.css', import.meta.url), 'utf8');
const loader = fs.readFileSync(new URL('./lib/live2d-loader.js', import.meta.url), 'utf8');
const runtime = fs.readFileSync(new URL('./lib/live2d-runtime.js', import.meta.url), 'utf8');
const chat = fs.readFileSync(new URL('./pages/chat.jsx', import.meta.url), 'utf8');

test('聊天室立绘限高 78% 且只在非全屏视图生效', () => {
  assert.ok(css.includes('.chat-figure:not(.is-expanded) .chat-figure-stage .live2d-stage-static > img'), '应有非全屏限高规则');
  const idx = css.indexOf('.chat-figure:not(.is-expanded) .chat-figure-stage .live2d-stage-static > img');
  const block = css.slice(idx, idx + 320);
  assert.ok(block.includes('height: 78%'), '限高应为 78%');
  assert.ok(block.includes('bottom: 0'), '应贴底对齐');
});

test('Live2D 加载期间不摆占位图（用户选择：宁缺勿滥）', () => {
  assert.ok(!stage.includes('live2d-stage-loading-preview'), '加载期间不应渲染占位图');
  assert.ok(stage.includes('data-live2d-status={runtimeReady ? "ready" : "loading"}'), '仍要标记加载状态');
  assert.ok(stage.includes('mode === "live2d" && !runtimeFailed'), '加载失败时仍走静态兜底');
});

test('进聊天室之前会预热 Live2D（运行库 + Cubism 核心库 + 模型入口）', () => {
  assert.ok(loader.includes('export async function preloadLive2DRuntime'), 'loader 应导出预热函数');
  assert.ok(loader.includes('runtime?.preload?.()'), '应调用运行库的预热');
  assert.ok(runtime.includes('preload: ensureCubismCore'), '运行库应暴露 preload');
  assert.ok(chat.includes('preloadLive2DRuntime({ modelUrl: withLive2D.live2dModelUrl })'), '聊天列表应提前预热');
});
