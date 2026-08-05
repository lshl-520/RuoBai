import fs from 'node:fs/promises';
import sharp from 'sharp';
import { saveOptimizedImage } from './image-assets.js';

const LEGACY_IMAGE_KEY = process.env.AGNES_AI_KEY || '';
const LEGACY_IMAGE_BASE = process.env.AGNES_AI_BASE || 'https://apihub.agnes-ai.com/v1';
const LEGACY_IMAGE_MODEL = process.env.AGNES_IMAGE_MODEL || 'agnes-image-2.0-flash';
const MAX_PROMPT_LENGTH = 4000;
const GENERATION_TIMEOUT_MS = 180000;
const GENERATION_MAX_ATTEMPTS = 3;
const RETRYABLE_GENERATION_STATUSES = new Set([429, 500, 502, 503, 504]);
const TASK_IMAGE_PROVIDER = 'image-task-no-key';
const TASK_IMAGE_DEFAULT_MODEL = 'task-image-default';
const TASK_IMAGE_DEFAULT_WIDTH = 768;
const TASK_IMAGE_DEFAULT_HEIGHT = 1280;
const TASK_IMAGE_POLL_INTERVAL_MS = 1000;
const IMAGE_DOWNLOAD_TIMEOUT_MS = 120000;

const DRAW_INTENT_PATTERNS = [
  /(?:帮我|给我|替我|为我|请)画/i,
  /画(?:一|1)?(?:个|张|幅)(?:图|画|图片|照片|自拍|画像)?/i,
  /画(?:图|画|图片|照片|自拍|画像|一下)/i,
  /(?:请|帮我|给我|替我|为我)?生成(?:一|1)?[个张幅]?[\s\S]{0,120}?(?:图片|图像|照片|自拍|画像)/i,
  /(?:做|制作|创作)(?:一|1)?[个张幅]?[\s\S]{0,80}?(?:图片|图像|照片|自拍|画像)/i,
  /(?:来|拍)(?:一|1)?[个张幅]?(?:自拍|照片)/i
];

function normalizeExtras(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function detectDrawIntent(text) {
  const content = String(text || '').trim();
  if (!content) return null;
  return DRAW_INTENT_PATTERNS.some(pattern => pattern.test(content))
    ? content.slice(0, MAX_PROMPT_LENGTH)
    : null;
}

export function buildImagePrompt(subject, character = null) {
  const content = String(subject || '').trim().slice(0, MAX_PROMPT_LENGTH);
  if (!content) return '';

  const name = String(character?.name || '').trim();
  const persona = String(character?.persona || '').trim();
  const context = [];

  if (name) {
    context.push(`图片中的人物是角色“${name}”本人。`);
  }
  if (persona) {
    context.push(`她给人的气质是：${persona.slice(0, 300)}。`);
  }
  if (/(自拍|照片|写实|真实|iPhone|手机|快照)/i.test(content)) {
    context.push('严格按真实摄影照片处理，保留随手拍、运动模糊、曝光和构图等要求，不要改成动漫、插画或二次元风格。');
  }

  return [...context, content].join('\n').slice(0, MAX_PROMPT_LENGTH);
}

export function buildImageGenerationsUrl(apiBase) {
  const base = String(apiBase || '').trim().replace(/\/+$/, '');
  if (!base) return '/v1/images/generations';
  if (/\/images\/generations$/i.test(base)) return base;
  if (/\/v\d+(?:\/[^/]+)*$/i.test(base)) return `${base}/images/generations`;
  return `${base}/v1/images/generations`;
}

const IMAGE_RESOLUTIONS = new Set(['channel', '1k', '2k', '4k']);
const DEFAULT_RESOLUTION_SIZES = {
  '1k': '1024x1024',
  '2k': '1536x1024',
  '4k': '2048x2048'
};

function normalizeImageResolution(value) {
  const resolution = String(value || 'channel').trim().toLowerCase();
  return IMAGE_RESOLUTIONS.has(resolution) ? resolution : 'channel';
}

function parseResolutionSizeMap(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function resolveImageSize({ resolution, model, extras }) {
  const selected = normalizeImageResolution(resolution);
  if (selected === 'channel') return String(extras.size || '1024x1024');

  const configured = parseResolutionSizeMap(extras.resolution_size_map || extras.resolutionSizeMap);
  if (configured[selected]) return String(configured[selected]);

  // 中转站通常要求 WIDTHxHEIGHT；只有明确声明 label 时才发送 1k/2k/4k 原始标签。
  if (extras.resolution_format === 'label') {
    return selected;
  }

  return DEFAULT_RESOLUTION_SIZES[selected];
}

function luminance(red, green, blue) {
  return (red * 0.2126) + (green * 0.7152) + (blue * 0.0722);
}

function findNearWhiteSeam(raw, info, axis, expectedRatio) {
  const width = info.width;
  const height = info.height;
  const expected = Math.round((axis === 'x' ? width : height) * expectedRatio);
  const radius = Math.max(3, Math.round((axis === 'x' ? width : height) * 0.045));
  let bestScore = 0;
  let bestPoint = expected;

  for (let point = Math.max(0, expected - radius); point <= Math.min((axis === 'x' ? width : height) - 1, expected + radius); point += 1) {
    let nearWhite = 0;
    const span = axis === 'x' ? height : width;
    for (let offset = 0; offset < span; offset += 1) {
      const x = axis === 'x' ? point : offset;
      const y = axis === 'x' ? offset : point;
      const index = ((y * width) + x) * info.channels;
      const red = raw[index] || 0;
      const green = raw[index + 1] || 0;
      const blue = raw[index + 2] || 0;
      if (luminance(red, green, blue) >= 230 && Math.max(red, green, blue) - Math.min(red, green, blue) <= 30) nearWhite += 1;
    }
    const score = nearWhite / span;
    if (score > bestScore) {
      bestScore = score;
      bestPoint = point;
    }
  }

  return { score: bestScore, point: bestPoint };
}

function findStrongEdgeSeam(raw, info, axis, expectedRatio) {
  const width = info.width;
  const height = info.height;
  const expected = Math.round((axis === 'x' ? width : height) * expectedRatio);
  const radius = Math.max(3, Math.round((axis === 'x' ? width : height) * 0.045));
  let bestScore = 0;
  let bestPoint = expected;

  for (let point = Math.max(1, expected - radius); point <= Math.min((axis === 'x' ? width : height) - 1, expected + radius); point += 1) {
    let difference = 0;
    const span = axis === 'x' ? height : width;
    for (let offset = 0; offset < span; offset += 1) {
      const beforeX = axis === 'x' ? point - 1 : offset;
      const beforeY = axis === 'x' ? offset : point - 1;
      const afterX = axis === 'x' ? point : offset;
      const afterY = axis === 'x' ? offset : point;
      const before = ((beforeY * width) + beforeX) * info.channels;
      const after = ((afterY * width) + afterX) * info.channels;
      difference += Math.abs((raw[before] || 0) - (raw[after] || 0));
      difference += Math.abs((raw[before + 1] || 0) - (raw[after + 1] || 0));
      difference += Math.abs((raw[before + 2] || 0) - (raw[after + 2] || 0));
    }
    const score = difference / span;
    if (score > bestScore) {
      bestScore = score;
      bestPoint = point;
    }
  }

  return { score: bestScore, point: bestPoint };
}

async function analyzeThreeByThreeContactSheet(buffer, sharpImpl = sharp) {
  try {
    const { data, info } = await sharpImpl(buffer)
      .ensureAlpha()
      .resize({ width: 300, height: 300, fit: 'fill', withoutEnlargement: false })
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (!info?.width || !info?.height || !data?.length) return null;

    let nonWhitePixels = 0;
    const pixelCount = info.width * info.height;
    for (let index = 0; index < data.length; index += info.channels) {
      if (luminance(data[index], data[index + 1], data[index + 2]) < 225) nonWhitePixels += 1;
    }
    if (nonWhitePixels / pixelCount < 0.08) return null;

    const positions = [
      ['x', 1 / 3], ['x', 2 / 3], ['y', 1 / 3], ['y', 2 / 3]
    ];
    const seams = positions.map(([axis, ratio]) => {
      const light = findNearWhiteSeam(data, info, axis, ratio);
      const edge = findStrongEdgeSeam(data, info, axis, ratio);
      return light.score >= 0.82 ? light : (edge.score >= 100 ? edge : null);
    });
    if (seams.some(seam => !seam)) return null;

    const metadata = await sharpImpl(buffer).metadata();
    if (!metadata?.width || !metadata?.height) return null;
    return { seams, width: metadata.width, height: metadata.height };
  } catch {
    // 图片无法解码时交给既有保存流程报错，不能把检测器本身变成新的失败来源。
    return null;
  }
}

// 某些免费渠道会在一张图里返回 3×3 候选表。普通动态只需要一张，默认取中间候选。
export async function isThreeByThreeContactSheet(buffer, sharpImpl = sharp) {
  return Boolean(await analyzeThreeByThreeContactSheet(buffer, sharpImpl));
}

export async function extractContactSheetCenter(buffer, sharpImpl = sharp) {
  const analysis = await analyzeThreeByThreeContactSheet(buffer, sharpImpl);
  if (!analysis) return null;

  const [left, right, top, bottom] = analysis.seams;
  const scaleX = analysis.width / 300;
  const scaleY = analysis.height / 300;
  const gutterX = Math.max(1, Math.round(scaleX * 2));
  const gutterY = Math.max(1, Math.round(scaleY * 2));
  const cropLeft = Math.round(left.point * scaleX) + gutterX;
  const cropTop = Math.round(top.point * scaleY) + gutterY;
  const cropRight = Math.round(right.point * scaleX) - gutterX;
  const cropBottom = Math.round(bottom.point * scaleY) - gutterY;
  const width = cropRight - cropLeft;
  const height = cropBottom - cropTop;
  if (width < 96 || height < 96) return null;

  return sharpImpl(buffer)
    .extract({ left: cropLeft, top: cropTop, width, height })
    .webp({ quality: 88, effort: 4 })
    .toBuffer();
}

async function prepareSingleImage(buffer, options) {
  if (!options?.expectedSingleImage) return { buffer, outputHandling: 'single' };
  const inspectImage = options.inspectImageImpl || isThreeByThreeContactSheet;
  if (!(await inspectImage(buffer))) return { buffer, outputHandling: 'single' };

  if (options.contactSheetStrategy === 'extract-center') {
    const extract = options.extractContactSheetImpl || extractContactSheetCenter;
    const extracted = await extract(buffer);
    if (extracted?.length) return { buffer: extracted, outputHandling: 'contact_sheet_center' };
  }
  throw new Error('图片渠道返回的是九宫格候选图，不能作为一条动态配图。请在“动态发图”里换一个单图模型后再试。');
}

function withImageResult(url, outputHandling, options) {
  return options?.returnResult ? { url, outputHandling } : url;
}

async function saveBase64Image(rawValue, baseName, fileStorage, optimizeImage, imageOptions) {
  const value = String(rawValue || '').trim();
  const base64 = value.includes(',') && /^data:image\//i.test(value)
    ? value.slice(value.indexOf(',') + 1)
    : value;
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) throw new Error('图片接口返回了空图片');
  const prepared = await prepareSingleImage(buffer, imageOptions);
  const url = await optimizeImage(prepared.buffer, baseName, { fileStorage });
  return withImageResult(url, prepared.outputHandling, imageOptions);
}

async function downloadAndSaveImage(imageUrl, baseName, fetchImpl, fileStorage, optimizeImage, imageOptions) {
  let lastError = null;
  const downloadTimeoutMs = Math.max(
    60000,
    Number(imageOptions?.imageDownloadTimeoutMs) || IMAGE_DOWNLOAD_TIMEOUT_MS
  );

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetchImpl(imageUrl, {
        headers: { Accept: 'image/*' },
        signal: AbortSignal.timeout(downloadTimeoutMs)
      });
      if (!response.ok) {
        throw new Error(`图片下载失败: ${response.status}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      if (!buffer.length) throw new Error('下载到的图片是空的');
      const prepared = await prepareSingleImage(buffer, imageOptions);
      const savedUrl = await optimizeImage(prepared.buffer, baseName, { fileStorage });
      return withImageResult(savedUrl, prepared.outputHandling, imageOptions);
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await new Promise(resolve => setTimeout(resolve, attempt * 1000));
      }
    }
  }

  const detail = lastError?.cause?.message || lastError?.message || '未知网络错误';
  throw new Error(`图片已经生成，但下载到本地失败：${detail}`);
}

function parseProviderError(detail, status) {
  let message = `图片生成失败 (${status})`;
  try {
    const parsed = JSON.parse(detail);
    const error = parsed?.error;
    message = (typeof error === 'string' ? error : error?.message)
      || parsed?.message
      || parsed?.detail
      || message;
  } catch {}
  return String(message || `图片生成失败 (${status})`).trim().slice(0, 500);
}

function presentGenerationError(status, message, attempts) {
  if (status === 429) {
    return `图片渠道请求太频繁，已自动重试 ${attempts} 次，请稍后再试`;
  }
  if (RETRYABLE_GENERATION_STATUSES.has(status)
    || /service\s*(?:busy|unavailable)|temporarily unavailable|服务繁忙|上游.*不可用/i.test(message)) {
    return `图片渠道上游暂时繁忙，已自动重试 ${attempts} 次，请稍后再试（中转站返回 ${status}）`;
  }
  if (status === 400 && /安全|policy|不适合.*图像|cannot be used to generate/i.test(message)) {
    return '图片渠道的安全规则拒绝了本次图片；请确认角色是成年、场景是日常安全内容后再试';
  }
  return message;
}

async function requestImageGeneration({
  url,
  apiKey,
  requestBody,
  fetchImpl,
  sleepImpl,
  timeoutMs,
  maxAttempts = GENERATION_MAX_ATTEMPTS
}) {
  let lastNetworkError = null;

  const attemptsLimit = Math.max(1, Math.min(5, Number(maxAttempts) || GENERATION_MAX_ATTEMPTS));
  for (let attempt = 1; attempt <= attemptsLimit; attempt += 1) {
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      lastNetworkError = error;
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        throw new Error(`图片生成等待超过 ${Math.round(timeoutMs / 60000)} 分钟，中转站一直没有返回结果，请稍后再试`);
      }
      if (attempt < attemptsLimit) {
        await sleepImpl(attempt === 1 ? 5000 : attempt === 2 ? 15000 : 30000);
        continue;
      }

      const detail = error?.cause?.message || error?.message || '未知网络错误';
      throw new Error(`图片渠道连接中断，已自动重试 ${attemptsLimit} 次：${detail}`);
    }

    const detail = await response.text().catch(() => '');
    if (response.ok) return detail;

    const message = parseProviderError(detail, response.status);
    if (RETRYABLE_GENERATION_STATUSES.has(response.status) && attempt < attemptsLimit) {
      await sleepImpl(attempt === 1 ? 5000 : attempt === 2 ? 15000 : 30000);
      continue;
    }

    throw new Error(presentGenerationError(response.status, message, attempt));
  }

  const detail = lastNetworkError?.cause?.message || lastNetworkError?.message || '未知网络错误';
  throw new Error(`图片渠道连接中断：${detail}`);
}

function readImageResult(payload) {
  const first = payload?.data?.[0] || payload?.images?.[0] || payload?.output?.[0] || null;
  if (typeof first === 'string') {
    return /^https?:\/\//i.test(first) ? { url: first } : { base64: first };
  }

  const url = first?.url || first?.image_url || payload?.url || payload?.image_url;
  if (url) return { url: String(url) };

  const base64 = first?.b64_json || first?.base64 || payload?.b64_json || payload?.base64;
  if (base64) return { base64: String(base64) };

  return null;
}


function buildTaskImageBases(apiBase, taskApiBase, extras = {}) {
  const submitBase = String(apiBase || '').trim().replace(/\/+$/, '');
  const taskBase = String(taskApiBase || extras.task_api_base || extras.taskApiBase || '').trim().replace(/\/+$/, '');
  return { submitBase, taskBase };
}

function readTaskImageExecutionError(entry) {
  const messages = Array.isArray(entry?.status?.messages) ? entry.status.messages : [];
  for (const item of messages) {
    if (!Array.isArray(item) || item[0] !== 'execution_error') continue;
    const detail = item[1] || {};
    return String(detail.exception_message || detail.exception_type || detail.node_type || '任务执行失败').trim();
  }
  return '';
}

function readTaskImageOutput(entry, outputNode) {
  const expected = entry?.outputs?.[outputNode]?.images;
  if (Array.isArray(expected) && expected[0]) return expected[0];
  const outputs = Object.values(entry?.outputs || {});
  const fallback = outputs.flatMap(output => Array.isArray(output?.images) ? output.images : [])
    .filter(image => image?.type === 'output');
  return fallback.at(-1) || null;
}

async function generateTaskImage({
  prompt,
  apiBase,
  taskApiBase,
  extras,
  imageOptions,
  fetchImpl,
  fileStorage,
  optimizeImage,
  sleepImpl,
  timeoutMs
}) {
  const { submitBase, taskBase } = buildTaskImageBases(apiBase, taskApiBase, extras);
  if (!submitBase || !taskBase) throw new Error('任务式图片渠道需要填写“提交地址”和“任务查询地址”');

  if (normalizeImageResolution(imageOptions?.resolution) !== 'channel') {
    throw new Error('任务式图片渠道暂不支持 1K/2K/4K 覆盖，请改为“跟随渠道”');
  }

  const width = Number(extras.width) || TASK_IMAGE_DEFAULT_WIDTH;
  const height = Number(extras.height) || TASK_IMAGE_DEFAULT_HEIGHT;
  const clientId = String(extras.client_id || extras.clientId || globalThis.crypto?.randomUUID?.()
    || `ruobai-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
  const submitResponse = await fetchImpl(`${submitBase}/api/prompt/initial`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ prompt, width, height, client_id: clientId }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const submitRaw = await submitResponse.text().catch(() => '');
  if (!submitResponse.ok) {
    throw new Error(`任务式图片接口提交失败（${submitResponse.status}）：${parseProviderError(submitRaw, submitResponse.status)}`);
  }

  let submitted;
  try {
    submitted = submitRaw ? JSON.parse(submitRaw) : {};
  } catch {
    throw new Error('任务式图片接口提交结果无法识别');
  }
  const promptId = String(submitted?.prompt_id || '').trim();
  const outputNode = String(submitted?.output_node || '').trim();
  if (!promptId) throw new Error('任务式图片接口没有返回任务编号');

  const pollIntervalMs = Math.max(100, Number(extras.poll_interval_ms || extras.pollIntervalMs) || TASK_IMAGE_POLL_INTERVAL_MS);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const historyResponse = await fetchImpl(`${taskBase}/history/${encodeURIComponent(promptId)}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(Math.min(60000, timeoutMs))
    });
    const historyRaw = await historyResponse.text().catch(() => '');
    if (!historyResponse.ok) {
      throw new Error(`任务式图片接口查询失败（${historyResponse.status}）：${parseProviderError(historyRaw, historyResponse.status)}`);
    }

    let history;
    try {
      history = historyRaw ? JSON.parse(historyRaw) : {};
    } catch {
      throw new Error('任务式图片接口状态无法识别');
    }
    const entry = history?.[promptId];
    if (entry) {
      const image = readTaskImageOutput(entry, outputNode);
      if (image?.filename) {
        const query = new URLSearchParams({
          filename: String(image.filename),
          subfolder: String(image.subfolder || ''),
          type: String(image.type || 'output')
        });
        const imageUrl = `${taskBase}/view?${query.toString()}&t=${Date.now()}`;
        const baseName = `draw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        return downloadAndSaveImage(imageUrl, baseName, fetchImpl, fileStorage, optimizeImage, imageOptions);
      }
      if (entry?.status?.completed) {
        const error = readTaskImageExecutionError(entry);
        throw new Error(error ? `任务式图片生成失败：${error}` : '任务式图片任务已结束，但没有返回图片');
      }
    }
    await sleepImpl(pollIntervalMs);
  }

  throw new Error(`任务式图片生成等待超过 ${Math.round(timeoutMs / 60000)} 分钟，请稍后再试`);
}

export async function generateImage(subject, options = {}) {
  const normalizedOptions = typeof options === 'function'
    ? { fetchImpl: options }
    : (options || {});
  const providerType = String(normalizedOptions.providerType || normalizedOptions.provider_type || 'openai-compatible').trim();
  const apiKey = String(normalizedOptions.apiKey || (providerType === TASK_IMAGE_PROVIDER ? '' : LEGACY_IMAGE_KEY) || '').trim();
  const apiBase = String(normalizedOptions.apiBase || LEGACY_IMAGE_BASE || '').trim();
  const taskApiBase = String(normalizedOptions.taskApiBase || normalizedOptions.apiAuxBase || '').trim();
  const model = String(normalizedOptions.model || (providerType === TASK_IMAGE_PROVIDER ? TASK_IMAGE_DEFAULT_MODEL : LEGACY_IMAGE_MODEL) || '').trim();
  const fetchImpl = normalizedOptions.fetchImpl || fetch;
  const fileStorage = normalizedOptions.fileStorage || fs;
  const sleepImpl = normalizedOptions.sleepImpl || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const generationTimeoutMs = Number(normalizedOptions.generationTimeoutMs) || GENERATION_TIMEOUT_MS;
  const generationMaxAttempts = Number(normalizedOptions.generationMaxAttempts) || GENERATION_MAX_ATTEMPTS;
  const extras = normalizeExtras(normalizedOptions.extras);
  const optimizeImage = normalizedOptions.optimizeImage || saveOptimizedImage;

  const needsApiKey = providerType !== TASK_IMAGE_PROVIDER;
  if ((needsApiKey && !apiKey) || !apiBase || !model) {
    throw new Error('请先在“我的 → 她的能力”里启用并选择“画图发图”模型');
  }

  const prompt = buildImagePrompt(subject, normalizedOptions.character);
  if (!prompt) throw new Error('请告诉我你想画什么');

  if (providerType === TASK_IMAGE_PROVIDER) {
    return generateTaskImage({
      prompt,
      apiBase,
      taskApiBase,
      extras,
      fetchImpl,
      fileStorage,
      optimizeImage,
      imageOptions: normalizedOptions,
      sleepImpl,
      timeoutMs: generationTimeoutMs
    });
  }

  const requestBody = {
    model,
    prompt,
    n: 1,
    size: resolveImageSize({ resolution: normalizedOptions.resolution, model, extras })
  };
  if (extras.response_format) {
    requestBody.response_format = String(extras.response_format);
  }

  const detail = await requestImageGeneration({
    url: buildImageGenerationsUrl(apiBase),
    apiKey,
    requestBody,
    fetchImpl,
    sleepImpl,
    timeoutMs: generationTimeoutMs,
    maxAttempts: generationMaxAttempts
  });

  let payload;
  try {
    payload = JSON.parse(detail);
  } catch {
    throw new Error('图片接口返回的内容无法识别');
  }

  const result = readImageResult(payload);
  if (!result) throw new Error('接口返回里没有图片地址或图片内容');

  const baseName = `draw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  if (result.url) {
    return downloadAndSaveImage(result.url, baseName, fetchImpl, fileStorage, optimizeImage, normalizedOptions);
  }
  return saveBase64Image(result.base64, baseName, fileStorage, optimizeImage, normalizedOptions);
}
