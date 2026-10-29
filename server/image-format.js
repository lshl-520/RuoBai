/**
 * 图片"真实格式"识别 + 模型能看懂的格式白名单。
 *
 * 为什么需要这个：
 *   1. 上传接口原来只信 data URL 里的 MIME。手机相册/浏览器偶尔会把 HEIC（手机
 *      "高效图片"格式）当 png/jpeg 交上来，结果服务器把 HEIC 字节存成 .png：
 *      - 浏览器 <img> 打不开 → 聊天里是裂图；
 *      - DeepSeek 官方接口按"文件真实内容"判格式 → 直接 400 整轮请求失败；
 *      - 而历史里的旧图会被一起带给模型，所以一张坏图会让这个角色之后每次发图都失败。
 *   2. 所以上传时按字节判断真实格式；模型看图前也再判一次，坏图只降级成文字占位，
 *      绝不把无法解析的图片发给上游。
 */

const HEIF_BRANDS = new Set([
  'heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs',
  'mif1', 'msf1'
]);

const AVIF_BRANDS = new Set(['avif', 'avis']);

/** 模型（OpenAI 兼容接口 / DeepSeek）能直接理解的图片格式。 */
export const SUPPORTED_VISION_IMAGE_FORMATS = Object.freeze(['png', 'jpeg', 'webp', 'gif']);

export function isSupportedVisionImageFormat(format) {
  return SUPPORTED_VISION_IMAGE_FORMATS.includes(String(format || '').toLowerCase());
}

/** 按文件头判断真实图片格式；认不出返回 null。 */
export function sniffImageFormat(buffer) {
  if (!buffer || typeof buffer.length !== 'number' || buffer.length < 12) return null;

  const b = buffer;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
    && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    return 'png';
  }
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38
    && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) {
    return 'gif';
  }
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    return 'webp';
  }
  if (b.toString('ascii', 4, 8) === 'ftyp') {
    const brand = b.toString('ascii', 8, 12).toLowerCase();
    if (HEIF_BRANDS.has(brand)) return 'heif';
    if (AVIF_BRANDS.has(brand)) return 'avif';
  }
  return null;
}

/** 存盘用的扩展名（与真实格式一致，不再相信上传方声明的 MIME）。 */
export function extensionForImageFormat(format) {
  switch (String(format || '').toLowerCase()) {
    case 'png': return 'png';
    case 'jpeg': return 'jpg';
    case 'webp': return 'webp';
    case 'gif': return 'gif';
    default: return null;
  }
}
