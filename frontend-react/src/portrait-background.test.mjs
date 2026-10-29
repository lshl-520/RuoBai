import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  classifyPortraitBackground,
  PORTRAIT_BACKGROUND_OPAQUE,
  PORTRAIT_BACKGROUND_TRANSPARENT,
  PORTRAIT_BACKGROUND_UNKNOWN,
} from './lib/portrait-background.js';

/*
 * 立绘"有没有透明背景"的判定（2026/10/14 用户拍板：有背景就铺满）。
 * 判错两边的代价不一样：把剪影判成"有背景"会让透明图被拉去铺满（很难看），
 * 所以拿不准一律返回 unknown（调用方保持"完整显示"）。
 *
 * 阈值是拿真实图定出来的：18 张自带立绘的透明像素占 16%~33.5%，
 * 用户上传的整幅图（阳台照/脸部特写）是 0%。这里用合成像素复现那几种形状。
 */
const SIZE = 32;

function makePixels(paint) {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const i = (y * SIZE + x) * 4;
      const [r, g, b, a] = paint(x, y);
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return data;
}

const solid = () => [120, 140, 160, 255];
const clear = () => [0, 0, 0, 0];
// 中间一个人形色块，四周留空 —— 自带立绘就是这种
const cutout = (x, y) => (x >= 8 && x <= 23 && y >= 4 && y <= 31 ? [200, 180, 190, 255] : [0, 0, 0, 0]);

test('整幅照片（没有透明像素）判为 opaque', () => {
  assert.equal(classifyPortraitBackground(makePixels(solid), SIZE, SIZE), PORTRAIT_BACKGROUND_OPAQUE);
});

test('中间有人物、四周透明（自带剪影）判为 transparent', () => {
  assert.equal(classifyPortraitBackground(makePixels(cutout), SIZE, SIZE), PORTRAIT_BACKGROUND_TRANSPARENT);
});

test('整张全透明也判为 transparent（不会去铺满）', () => {
  assert.equal(classifyPortraitBackground(makePixels(clear), SIZE, SIZE), PORTRAIT_BACKGROUND_TRANSPARENT);
});

test('人物几乎占满、只留一圈透明边 —— 仍算剪影', () => {
  const data = makePixels((x, y) => {
    const edge = x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1;
    return edge ? [0, 0, 0, 0] : [200, 180, 190, 255];
  });
  assert.equal(classifyPortraitBackground(data, SIZE, SIZE), PORTRAIT_BACKGROUND_TRANSPARENT);
});

test('透明像素不多、四角也不一致 —— 拿不准就返回 unknown（保持完整显示）', () => {
  const data = makePixels((x, y) => {
    if (x <= 2 && y <= 2) return [120, 140, 160, 100];       // 一个半透明的角
    if (y === 14 || y === 15) return [0, 0, 0, 0];            // 一条很窄的透明带（6.25%）
    return solid();
  });
  assert.equal(classifyPortraitBackground(data, SIZE, SIZE), PORTRAIT_BACKGROUND_UNKNOWN);
});

test('像素数据不合法时返回 unknown，不抛异常', () => {
  assert.equal(classifyPortraitBackground(null, SIZE, SIZE), PORTRAIT_BACKGROUND_UNKNOWN);
  assert.equal(classifyPortraitBackground(new Uint8ClampedArray(4), SIZE, SIZE), PORTRAIT_BACKGROUND_UNKNOWN);
  assert.equal(classifyPortraitBackground(makePixels(solid), 0, SIZE), PORTRAIT_BACKGROUND_UNKNOWN);
});

test('聊天室按判定结果挂 data-portrait-bg，CSS 里铺满分支齐全', () => {
  const chat = fs.readFileSync(new URL('./pages/chat.jsx', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('./styles/components2.css', import.meta.url), 'utf8');

  assert.ok(chat.includes('from "../lib/portrait-background.js"'), 'chat.jsx 应引入判定模块');
  assert.ok(chat.includes('detectPortraitBackground(figSrc)'), '应按立绘地址做判定');
  assert.ok(chat.includes('data-portrait-bg={portraitBackground}'), '应把结果写到 data-portrait-bg');
  assert.ok(chat.includes('const isLive2DRole = Boolean(agent.live2dModelUrl)'), 'Live2D 角色要单独识别');
  assert.ok(chat.includes('if (!figSrc || isLive2DRole)'), 'Live2D 角色不参与背景判定（模型预览图会误伤）');

  assert.ok(css.includes('.chat-figure[data-portrait-bg="opaque"]'), 'CSS 应有铺满分支');
  const idx = css.indexOf('.chat-figure[data-portrait-bg="opaque"]');
  const block = css.slice(idx, idx + 700);
  assert.ok(block.includes('object-fit: cover'), '铺满分支要用 cover');
  assert.ok(block.includes('height: 100%'), '铺满分支要占满整块聊天区');
  assert.ok(block.includes('animation: none'), '铺满时不该再飘');
  assert.ok(css.includes('.chat-figure[data-portrait-bg="opaque"] .chat-fig-fade'), '铺满时要关掉上下渐变');

  // 透明剪影那条不能被动到：限高 78% 仍在，且只作用于非全屏
  assert.ok(css.includes('.chat-figure:not(.is-expanded) .chat-figure-stage .live2d-stage-static > img'), '限高规则要保留');
});
