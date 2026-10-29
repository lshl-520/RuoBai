import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  CROP_MAX_ZOOM,
  CROP_OUTPUT_WIDTH,
  PORTRAIT_ASPECT,
  clampOffset,
  coverScale,
  cropOutputSize,
  resolveCropView,
  sourceRectFromView,
  zoomAroundCenter,
} from './lib/portrait-crop.js';

/*
 * 上传立绘的「选框」（2026/10/14 用户拍板的第 2 步）。
 * 目标：横图 / 方图 / 细长竖图裁完都是 3:4，摆进聊天室不再"铺满整屏"或"缩成一小条"。
 * 这里测的是几何计算本身；接线（弹层真的挂在角色编辑页上）在文件末尾用源码断言钉住。
 */

const FRAME = { w: 240, h: 320 };            // 240×320 正好是 3:4
const LANDSCAPE = { w: 1672, h: 941 };       // 用户实测用的那张横图 16:9
const TALL = { w: 1080, h: 1920 };           // 手机屏那种细长竖图 9:16
const SQUARE = { w: 1024, h: 1024 };
const PORTRAIT_2_3 = { w: 1024, h: 1536 };   // 用户那张"宝"的 2:3

test('选框是 3:4，导出尺寸也跟着是 3:4 且不超过 768 宽', () => {
  assert.equal(PORTRAIT_ASPECT, 3 / 4);
  const out = cropOutputSize(1672, 2229);
  assert.equal(out.width, CROP_OUTPUT_WIDTH);
  assert.equal(out.height, Math.round(CROP_OUTPUT_WIDTH / PORTRAIT_ASPECT));
  assert.ok(Math.abs(out.width / out.height - PORTRAIT_ASPECT) < 0.01, '导出比例应为 3:4');
});

test('盖满选框的最小缩放：横图按高度、竖图按宽度', () => {
  const land = coverScale(FRAME.w, FRAME.h, LANDSCAPE.w, LANDSCAPE.h);
  assert.ok(Math.abs(land * LANDSCAPE.h - FRAME.h) < 1e-6, '横图应恰好按高度盖满');
  assert.ok(land * LANDSCAPE.w > FRAME.w, '横图盖满后宽度必然超出');

  const tall = coverScale(FRAME.w, FRAME.h, TALL.w, TALL.h);
  assert.ok(Math.abs(tall * TALL.w - FRAME.w) < 1e-6, '竖图应恰好按宽度盖满');
  assert.ok(tall * TALL.h > FRAME.h, '竖图盖满后高度必然超出');
});

test('偏移永远被夹在"图盖满框"的范围内，不会露出空白', () => {
  const cases = [LANDSCAPE, TALL, SQUARE, PORTRAIT_2_3];
  for (const img of cases) {
    for (const zoom of [1, 1.7, 3.5]) {
      for (const raw of [-9999, -50, 0, 9999]) {
        const view = resolveCropView({
          frameW: FRAME.w, frameH: FRAME.h,
          imageW: img.w, imageH: img.h,
          zoom, offsetX: raw, offsetY: raw,
        });
        assert.ok(view.displayW >= FRAME.w - 1e-6, `${img.w}x${img.h} 宽度必须盖满`);
        assert.ok(view.displayH >= FRAME.h - 1e-6, `${img.w}x${img.h} 高度必须盖满`);
        assert.ok(view.offsetX <= 1e-6 && view.offsetX >= FRAME.w - view.displayW - 1e-6, 'offsetX 越界');
        assert.ok(view.offsetY <= 1e-6 && view.offsetY >= FRAME.h - view.displayH - 1e-6, 'offsetY 越界');
      }
    }
  }
});

test('缩放下限是 1（不能再缩小露白），上限是 4', () => {
  const tooSmall = resolveCropView({ frameW: FRAME.w, frameH: FRAME.h, imageW: SQUARE.w, imageH: SQUARE.h, zoom: 0.2 });
  assert.equal(tooSmall.zoom, 1);
  const tooBig = resolveCropView({ frameW: FRAME.w, frameH: FRAME.h, imageW: SQUARE.w, imageH: SQUARE.h, zoom: 99 });
  assert.equal(tooBig.zoom, CROP_MAX_ZOOM);
});

test('图片比框小的那一维会被居中（不会被夹到边上）', () => {
  assert.equal(clampOffset(999, 200, 240), 20, '图比框窄时应居中');
  assert.equal(clampOffset(-999, 200, 240), 20);
});

test('反推的源矩形始终落在原图内，且比例是 3:4', () => {
  for (const img of [LANDSCAPE, TALL, SQUARE, PORTRAIT_2_3]) {
    const view = resolveCropView({
      frameW: FRAME.w, frameH: FRAME.h,
      imageW: img.w, imageH: img.h,
      zoom: 1, offsetX: -30, offsetY: -30,
    });
    const rect = sourceRectFromView(view);
    assert.ok(rect.sx >= -1e-6 && rect.sy >= -1e-6, '起点不能出图');
    assert.ok(rect.sx + rect.sw <= img.w + 1e-6, '右边界不能出图');
    assert.ok(rect.sy + rect.sh <= img.h + 1e-6, '下边界不能出图');
    assert.ok(Math.abs(rect.sw / rect.sh - PORTRAIT_ASPECT) < 1e-3, '源矩形比例应为 3:4');
  }
});

test('改缩放时，选框中心对着的还是原图上同一个点（图不会跳走）', () => {
  const view = resolveCropView({
    frameW: FRAME.w, frameH: FRAME.h,
    imageW: LANDSCAPE.w, imageH: LANDSCAPE.h,
    zoom: 1, offsetX: -100, offsetY: 0,
  });
  const centerOf = (v) => ({
    x: (FRAME.w / 2 - v.offsetX) / v.scale,
    y: (FRAME.h / 2 - v.offsetY) / v.scale,
  });
  const before = centerOf(view);
  const after = centerOf(zoomAroundCenter(view, 2));
  assert.ok(Math.abs(before.x - after.x) < 1e-6, `中心 x 应不变：${before.x} → ${after.x}`);
  assert.ok(Math.abs(before.y - after.y) < 1e-6, `中心 y 应不变：${before.y} → ${after.y}`);
});

/* ---------------- 接线：别把这一步又摘掉 ---------------- */

const editor = fs.readFileSync(new URL('./pages/agents.jsx', import.meta.url), 'utf8');
const dialog = fs.readFileSync(new URL('./components/PortraitCropDialog.jsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('./styles/components2.css', import.meta.url), 'utf8');

test('选完文件先进裁剪弹层，而不是直接上传', () => {
  assert.ok(editor.includes('import PortraitCropDialog from "../components/PortraitCropDialog.jsx";'), '应引入裁剪弹层');
  const uploadStart = editor.indexOf('const onUpload = (e) => {');
  const uploadEnd = editor.indexOf('const applyCroppedPortrait');
  assert.ok(uploadStart > 0, '应还有 onUpload');
  assert.ok(uploadEnd > uploadStart, 'onUpload 后面应跟着裁剪后的上传函数');
  const uploadBody = editor.slice(uploadStart, uploadEnd);
  assert.ok(uploadBody.includes('setCropSrc('), '选完文件应打开裁剪弹层');
  assert.ok(!uploadBody.includes('uploadRolePortrait('), 'onUpload 里不该再直接上传原图');
  assert.ok(editor.includes('onConfirm={applyCroppedPortrait}'), '弹层确认应走裁剪后的上传');
});

test('裁剪结果走原有的上传接口，且不动原始数据口径', () => {
  const start = editor.indexOf('const applyCroppedPortrait');
  assert.ok(start > 0, '应有 applyCroppedPortrait');
  const body = editor.slice(start, start + 1200);
  assert.ok(body.includes('uploadRolePortrait(agent._raw.id, croppedDataUrl)'), '应上传裁好的新图');
  assert.ok(body.includes('portrait_custom_url: url'), '仍写自定义立绘地址');
  assert.ok(body.includes('visual_mode: "image"'), '仍切到自定义图片模式');
});

test('裁剪弹层：3:4 固定框 + 拖动 + 双指缩放 + 输出 PNG', () => {
  assert.ok(dialog.includes('zoomAroundCenter'), '双指/滑杆缩放要围绕选框中心');
  assert.ok(dialog.includes('setPointerCapture'), '要支持拖动');
  assert.ok(dialog.includes('toDataURL("image/png")'), '导出 PNG（保留透明背景）');
  assert.ok(dialog.includes('event.stopPropagation()'), '弹层不能把下面的编辑页一起关掉');
  assert.ok(css.includes('.pc-frame'), '选框样式应在 components2.css');
  assert.ok(dialog.includes('pill pill-primary grow'), '主按钮要用项目自己的 pill 样式（.btn 在项目里不存在）');
  assert.ok(!dialog.includes('className="btn'), '不要用项目里不存在的 .btn 类');
  assert.ok(css.includes('touch-action: none'), '手机上必须禁用默认手势，否则拖不动');
});