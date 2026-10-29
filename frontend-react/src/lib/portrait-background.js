/*
 * 立绘"有没有背景"的判定 —— 2026/10/14 用户拍板：有背景的图铺满，透明剪影保持完整显示。
 *
 * 为什么要判：自带立绘是抠过底的透明剪影（四角 alpha=0），摆在纸色聊天室里"完整显示"才服帖；
 * 用户自己传的整幅图（阳台照 1024×1536、脸部特写）没有透明通道，同一套摆法会四周留白、
 * 边缘是一条硬直线，看着像贴了张图。两种摆法只能靠"图本身有没有透明像素"来区分。
 *
 * 怎么做：把图缩进一张 ${SAMPLE_SIZE}×${SAMPLE_SIZE} 的小画布，看四角 + 整体透明像素比例。
 *   · 四角都不透明、几乎没有透明像素 → "opaque"（整幅图，走铺满）
 *   · 四角透明，或透明像素够多        → "transparent"（剪影，保持现在的完整显示）
 *   · 两者都不像 / 读不到像素         → "unknown"（退回完整显示，宁可保守）
 * 读不到像素的常见原因：跨域图片污染了画布（App 里图在另一个域名）、图坏了、环境没有 canvas。
 *
 * 结果按图片地址缓存（内存 + localStorage），同一张图只算一次。
 * 纯函数 classifyPortraitBackground 单独导出，方便单测（见 src/portrait-background.test.mjs）。
 */

export const PORTRAIT_BACKGROUND_UNKNOWN = "unknown";
export const PORTRAIT_BACKGROUND_TRANSPARENT = "transparent";
export const PORTRAIT_BACKGROUND_OPAQUE = "opaque";

const SAMPLE_SIZE = 32;
const CORNER_BOX = 3;
const ALPHA_TRANSPARENT = 16;
const CORNER_TRANSPARENT_AVG = 64;
const CORNER_OPAQUE_AVG = 240;
// 阈值是拿真实图定出来的（2026/10/14 用 18 张自带立绘 + 3 张用户上传的图跑过）：
// 自带剪影的透明像素占 16%~33.5%，用户上传的整幅图是 0%，中间留一段"拿不准"的缓冲区。
const TRANSPARENT_RATIO_MIN = 0.1;
const OPAQUE_RATIO_MAX = 0.02;
const CACHE_STORAGE_KEY = "ruobai:portrait-background:v1";

const memoryCache = new Map();

function readLocalCache() {
  try {
    const raw = globalThis.localStorage?.getItem(CACHE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (error) {
    return null;
  }
}

function writeLocalCache(key, value) {
  try {
    const table = readLocalCache() || {};
    table[key] = value;
    globalThis.localStorage?.setItem(CACHE_STORAGE_KEY, JSON.stringify(table));
  } catch (error) {
    // 存不下就算了，内存缓存还在，最坏情况下次重新算一遍。
  }
}

function readCache(key) {
  if (memoryCache.has(key)) return memoryCache.get(key);
  const stored = readLocalCache();
  const value = stored?.[key];
  if (value === PORTRAIT_BACKGROUND_TRANSPARENT || value === PORTRAIT_BACKGROUND_OPAQUE) {
    memoryCache.set(key, value);
    return value;
  }
  return null;
}

function writeCache(key, value) {
  if (value !== PORTRAIT_BACKGROUND_TRANSPARENT && value !== PORTRAIT_BACKGROUND_OPAQUE) return;
  memoryCache.set(key, value);
  writeLocalCache(key, value);
}

function alphaAt(data, width, x, y) {
  return data[(y * width + x) * 4 + 3];
}

/**
 * 纯函数：给一张 RGBA 像素表，判断它更像"整幅有背景的图"还是"抠过底的剪影"。
 * @param {Uint8ClampedArray|Uint8Array|number[]} data RGBA 逐像素排列
 * @param {number} width
 * @param {number} height
 * @returns {"transparent"|"opaque"|"unknown"}
 */
export function classifyPortraitBackground(data, width, height) {
  const w = Number(width);
  const h = Number(height);
  if (!data || !Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) {
    return PORTRAIT_BACKGROUND_UNKNOWN;
  }
  const expected = w * h * 4;
  if (data.length < expected) return PORTRAIT_BACKGROUND_UNKNOWN;

  let transparentPixels = 0;
  for (let i = 3; i < expected; i += 4) {
    if (data[i] <= ALPHA_TRANSPARENT) transparentPixels += 1;
  }
  const transparentRatio = transparentPixels / (w * h);

  // 主判据是"透明像素占多少"：剪影一定有一大片空的，整幅图基本一个透明像素都没有。
  // 落在中间地带的（少数抠得不干净的图）再看四角的平均 alpha 兜一下。
  if (transparentRatio >= TRANSPARENT_RATIO_MIN) return PORTRAIT_BACKGROUND_TRANSPARENT;
  if (transparentRatio <= OPAQUE_RATIO_MAX) return PORTRAIT_BACKGROUND_OPAQUE;

  const box = Math.max(1, Math.min(CORNER_BOX, Math.floor(Math.min(w, h) / 2) || 1));
  const corners = [[0, 0], [w - box, 0], [0, h - box], [w - box, h - box]];
  let opaqueCorners = 0;
  let transparentCorners = 0;
  for (const [cx, cy] of corners) {
    let sum = 0;
    let count = 0;
    for (let y = cy; y < cy + box; y += 1) {
      for (let x = cx; x < cx + box; x += 1) {
        sum += alphaAt(data, w, x, y);
        count += 1;
      }
    }
    const average = count ? sum / count : 255;
    if (average >= CORNER_OPAQUE_AVG) opaqueCorners += 1;
    if (average <= CORNER_TRANSPARENT_AVG) transparentCorners += 1;
  }

  if (transparentCorners >= 3) return PORTRAIT_BACKGROUND_TRANSPARENT;
  if (opaqueCorners === 4) return PORTRAIT_BACKGROUND_OPAQUE;
  return PORTRAIT_BACKGROUND_UNKNOWN;
}

function isCrossOrigin(src) {
  try {
    const base = globalThis.location?.href || "http://localhost/";
    const resolved = new URL(src, base);
    const origin = globalThis.location?.origin;
    return Boolean(origin) && resolved.origin !== origin;
  } catch (error) {
    return false;
  }
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const ImageCtor = globalThis.Image;
    if (typeof ImageCtor !== "function") {
      reject(new Error("当前环境没有 Image"));
      return;
    }
    const image = new ImageCtor();
    if (isCrossOrigin(src)) image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("立绘加载失败"));
    image.src = src;
  });
}

/**
 * 判断某个立绘地址有没有透明背景。任何失败都返回 "unknown"（调用方退回"完整显示"）。
 * @param {string} src
 * @returns {Promise<"transparent"|"opaque"|"unknown">}
 */
export async function detectPortraitBackground(src) {
  const key = String(src || "").trim();
  if (!key) return PORTRAIT_BACKGROUND_UNKNOWN;

  const cached = readCache(key);
  if (cached) return cached;

  let result = PORTRAIT_BACKGROUND_UNKNOWN;
  try {
    const image = await loadImageElement(key);
    const documentRef = globalThis.document;
    if (!documentRef?.createElement) return PORTRAIT_BACKGROUND_UNKNOWN;
    const canvas = documentRef.createElement("canvas");
    canvas.width = SAMPLE_SIZE;
    canvas.height = SAMPLE_SIZE;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return PORTRAIT_BACKGROUND_UNKNOWN;
    context.clearRect(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    const imageData = context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    result = classifyPortraitBackground(imageData.data, SAMPLE_SIZE, SAMPLE_SIZE);
  } catch (error) {
    // 跨域污染、图坏了、没有 canvas —— 一律保守处理，保持"完整显示"。
    result = PORTRAIT_BACKGROUND_UNKNOWN;
  }

  writeCache(key, result);
  return result;
}

/** 仅供测试/排错：清掉内存缓存。 */
export function resetPortraitBackgroundCache() {
  memoryCache.clear();
}
