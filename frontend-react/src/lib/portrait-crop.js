/**
 * 立绘裁剪选框的几何计算（2026/10/14 用户拍板的第 2 步）。
 *
 * 问题：用户上传的立绘什么形状都有（横图 16:9、方图、细长竖图 9:16），
 * 而 App 自带的立绘是 3:4 竖图，摆放规则按它定的 —— 所以横图会缩成
 * "一小条"，细长竖图会"铺满整屏"。用户给的解法：上传时给一个固定 3:4
 * 的选框，自己拖、自己放大缩小，裁出来的图统一成 3:4。
 *
 * 这里只放纯计算（不碰 DOM / canvas），所以能用 node --test 直接测。
 * 真正的画布裁剪在 components/PortraitCropDialog.jsx 里。
 */

/** 选框宽高比（宽 / 高）。和 App 自带立绘一致，3:4 竖图。 */
export const PORTRAIT_ASPECT = 3 / 4;

/** 缩放范围：1 = 刚好盖满选框，不能再小（小了会露出空白）。 */
export const CROP_MIN_ZOOM = 1;
export const CROP_MAX_ZOOM = 4;

/** 导出宽度（高度按 3:4 推）。768×1024 够手机看，也不会让上传包过大。 */
export const CROP_OUTPUT_WIDTH = 768;

/**
 * 让图片刚好盖满选框所需的最小缩放（图片像素 → 框内 CSS 像素）。
 * 取宽高两个方向的较大值，保证两个方向都不留空。
 */
export function coverScale(frameW, frameH, imageW, imageH) {
  const fw = Number(frameW);
  const fh = Number(frameH);
  const iw = Number(imageW);
  const ih = Number(imageH);
  if (!(fw > 0) || !(fh > 0) || !(iw > 0) || !(ih > 0)) return 0;
  return Math.max(fw / iw, fh / ih);
}

/**
 * 把偏移夹在"图片始终盖满框"的范围内。
 * 偏移是图片左上角相对选框左上角的位置，最大只能是 0，
 * 最小是 框边长 - 图片显示边长（再往左/往上就露白了）。
 */
export function clampOffset(offset, displaySize, frameSize) {
  const value = Number(offset) || 0;
  const disp = Number(displaySize) || 0;
  const frame = Number(frameSize) || 0;
  if (disp <= frame) return (frame - disp) / 2;
  return Math.min(0, Math.max(frame - disp, value));
}

/**
 * 给定选框、原图尺寸和当前缩放 / 偏移，算出实际渲染参数。
 * 返回的 offsetX / offsetY 一定是夹好的，调用方不用再判一次。
 */
export function resolveCropView({ frameW, frameH, imageW, imageH, zoom = 1, offsetX = 0, offsetY = 0 } = {}) {
  const base = coverScale(frameW, frameH, imageW, imageH);
  const safeZoom = Math.min(CROP_MAX_ZOOM, Math.max(CROP_MIN_ZOOM, Number(zoom) || CROP_MIN_ZOOM));
  const scale = base * safeZoom;
  const displayW = imageW * scale;
  const displayH = imageH * scale;
  return {
    scale,
    zoom: safeZoom,
    displayW,
    displayH,
    offsetX: clampOffset(offsetX, displayW, frameW),
    offsetY: clampOffset(offsetY, displayH, frameH),
    // 带上原始参数：sourceRectFromView / zoomAroundCenter 都靠它们。
    frameW: Number(frameW) || 0,
    frameH: Number(frameH) || 0,
    imageW: Number(imageW) || 0,
    imageH: Number(imageH) || 0,
  };
}

/**
 * 由渲染参数反推"选框里这一块"在原图上的像素矩形 —— 就是 canvas.drawImage 的源区域。
 */
export function sourceRectFromView(view) {
  if (!view || !(view.scale > 0)) return { sx: 0, sy: 0, sw: 0, sh: 0 };
  return {
    sx: -view.offsetX / view.scale,
    sy: -view.offsetY / view.scale,
    sw: view.frameW / view.scale,
    sh: view.frameH / view.scale,
  };
}

/**
 * 导出尺寸：恒定 3:4。源区域小的时候不放大（避免糊），大的时候收到 768 宽。
 */
export function cropOutputSize(sourceW, sourceH) {
  const sw = Number(sourceW);
  const sh = Number(sourceH);
  if (!(sw > 0) || !(sh > 0)) {
    return { width: CROP_OUTPUT_WIDTH, height: Math.round(CROP_OUTPUT_WIDTH / PORTRAIT_ASPECT) };
  }
  const width = Math.max(1, Math.round(Math.min(CROP_OUTPUT_WIDTH, sw)));
  const height = Math.max(1, Math.round(width / PORTRAIT_ASPECT));
  return { width, height };
}

/**
 * 换缩放时保持"选框中心对着原图上的同一个点"，否则手一放大图就跳走。
 * 返回夹好的新偏移。
 */
export function zoomAroundCenter(view, nextZoom) {
  const before = view || {};
  const scaleBefore = before.scale > 0 ? before.scale : 1;
  const frameW = Number(before.frameW) || 0;
  const frameH = Number(before.frameH) || 0;
  const target = resolveCropView({
    frameW,
    frameH,
    imageW: Number(before.imageW) || 0,
    imageH: Number(before.imageH) || 0,
    zoom: nextZoom,
    offsetX: before.offsetX,
    offsetY: before.offsetY,
  });
  if (!(target.scale > 0)) return target;
  // 选框中心点在原图上的坐标（改缩放前后应当是同一个点）。
  const centerX = (frameW / 2 - (Number(before.offsetX) || 0)) / scaleBefore;
  const centerY = (frameH / 2 - (Number(before.offsetY) || 0)) / scaleBefore;
  target.offsetX = clampOffset(frameW / 2 - centerX * target.scale, target.displayW, frameW);
  target.offsetY = clampOffset(frameH / 2 - centerY * target.scale, target.displayH, frameH);
  return target;
}