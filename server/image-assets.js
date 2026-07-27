import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
export const userChatImageDir = path.join(projectRoot, 'user_assets', 'chat');

const HIGH_MAX_EDGE = 1600;
const THUMB_MAX_EDGE = 640;
const inflightVariants = new Map();
let imageVariantQueue = Promise.resolve();

sharp.concurrency(1);

function detectImageExtension(buffer) {
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png';
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return '.jpg';
  if (buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a') return '.gif';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return '.webp';
  return '.png';
}

export function thumbnailFilename(filename) {
  const parsed = path.parse(String(filename || ''));
  return `${parsed.name}.thumb.webp`;
}

export function previewFilename(filename) {
  const parsed = path.parse(String(filename || ''));
  return `${parsed.name}.preview.webp`;
}

export function resolveChatImagePath(publicPath) {
  const prefix = '/user_assets/chat/';
  const value = String(publicPath || '').trim().split(/[?#]/, 1)[0];
  if (!value.startsWith(prefix)) return null;

  const filename = value.slice(prefix.length);
  if (!filename || filename !== path.basename(filename) || !/^[a-zA-Z0-9._-]+\.(?:png|jpe?g|webp|gif|avif)$/i.test(filename)) {
    return null;
  }

  return {
    filename,
    sourcePath: path.join(userChatImageDir, filename),
    thumbnailName: thumbnailFilename(filename),
    thumbnailPath: path.join(userChatImageDir, thumbnailFilename(filename)),
    previewName: previewFilename(filename),
    previewPath: path.join(userChatImageDir, previewFilename(filename))
  };
}

function enqueueVariant(targetPath, create) {
  if (inflightVariants.has(targetPath)) return inflightVariants.get(targetPath);
  const conversion = imageVariantQueue.then(create);
  imageVariantQueue = conversion.catch(() => {});
  const task = conversion.finally(() => inflightVariants.delete(targetPath));
  inflightVariants.set(targetPath, task);
  return task;
}

export async function saveOptimizedImage(buffer, baseName, options = {}) {
  const fileStorage = options.fileStorage || fs;
  const imageSharp = options.sharpImpl || sharp;
  const safeBase = String(baseName || '').replace(/[^a-zA-Z0-9_-]/g, '') || `draw-${Date.now()}`;
  await fileStorage.mkdir(userChatImageDir, { recursive: true });

  try {
    const highBuffer = await imageSharp(buffer)
      .rotate()
      .resize({ width: HIGH_MAX_EDGE, height: HIGH_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82, effort: 4 })
      .toBuffer();
    const highName = `${safeBase}.webp`;
    const thumbName = `${safeBase}.thumb.webp`;
    const thumbBuffer = await imageSharp(highBuffer)
      .resize({ width: THUMB_MAX_EDGE, height: THUMB_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 70, effort: 3 })
      .toBuffer();

    await Promise.all([
      fileStorage.writeFile(path.join(userChatImageDir, highName), highBuffer),
      fileStorage.writeFile(path.join(userChatImageDir, thumbName), thumbBuffer)
    ]);
    return `/user_assets/chat/${highName}`;
  } catch (error) {
    const fallbackName = `${safeBase}${detectImageExtension(buffer)}`;
    await fileStorage.writeFile(path.join(userChatImageDir, fallbackName), buffer);
    console.warn('[image-assets] 图片压缩失败，已保留原图：', error?.message || error);
    return `/user_assets/chat/${fallbackName}`;
  }
}

export async function ensureThumbnail(publicPath, options = {}) {
  const resolved = resolveChatImagePath(publicPath);
  if (!resolved) {
    const error = new Error('图片地址不合法');
    error.statusCode = 400;
    throw error;
  }

  const fileStorage = options.fileStorage || fs;
  const imageSharp = options.sharpImpl || sharp;
  try {
    await fileStorage.access(resolved.thumbnailPath);
    return resolved.thumbnailPath;
  } catch {}

  return enqueueVariant(resolved.thumbnailPath, async () => {
    try {
      await fileStorage.access(resolved.thumbnailPath);
      return resolved.thumbnailPath;
    } catch {}
    await fileStorage.access(resolved.sourcePath);
    await imageSharp(resolved.sourcePath)
      .rotate()
      .resize({ width: THUMB_MAX_EDGE, height: THUMB_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 70, effort: 3 })
      .toFile(resolved.thumbnailPath);
    return resolved.thumbnailPath;
  });
}

export async function ensurePreview(publicPath, options = {}) {
  const resolved = resolveChatImagePath(publicPath);
  if (!resolved) {
    const error = new Error('图片地址不合法');
    error.statusCode = 400;
    throw error;
  }

  const fileStorage = options.fileStorage || fs;
  const imageSharp = options.sharpImpl || sharp;
  if (/\.webp$/i.test(resolved.filename) && !/\.(?:thumb|preview)\.webp$/i.test(resolved.filename)) {
    await fileStorage.access(resolved.sourcePath);
    return resolved.sourcePath;
  }

  try {
    await fileStorage.access(resolved.previewPath);
    return resolved.previewPath;
  } catch {}

  return enqueueVariant(resolved.previewPath, async () => {
    try {
      await fileStorage.access(resolved.previewPath);
      return resolved.previewPath;
    } catch {}
    await fileStorage.access(resolved.sourcePath);
    await imageSharp(resolved.sourcePath)
      .rotate()
      .resize({ width: HIGH_MAX_EDGE, height: HIGH_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82, effort: 3 })
      .toFile(resolved.previewPath);
    return resolved.previewPath;
  });
}
