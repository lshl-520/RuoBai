import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const userChatImageDir = path.join(projectRoot, 'user_assets', 'chat');

const AGNES_AI_KEY = process.env.AGNES_AI_KEY || '';
const AGNES_AI_BASE = (process.env.AGNES_AI_BASE || 'https://apihub.agnes-ai.com/v1').replace(/\/+$/, '');

// 检测消息是否包含绘画意图
export function detectDrawIntent(text) {
  if (!text) return null;
  const drawKeywords = [
    /帮我画(一?[个张幅]?.{1,30})/,
    /画(一?[个张幅]?.{1,30})/,
    /给我画(一?[个张幅]?.{1,30})/,
    /画张(.{1,30})/,
    /生成.{0,4}图片[：:]?(.{0,30})/,
    /画幅(.{1,30})/,
    /画一下(.{1,30})/,
  ];
  for (const re of drawKeywords) {
    const m = text.match(re);
    if (m) {
      return (m[1] || text).trim().slice(0, 100);
    }
  }
  return null;
}

// 把用户描述翻译成适合图片生成的英文提示词
function buildImagePrompt(subject) {
  // 如果已经是英文就直接用
  if (/^[\x00-\x7F]+$/.test(subject)) return subject;
  // 中文描述加上风格词
  return `anime style illustration of ${subject}, soft colors, high quality`;
}

// 下载远程图片并保存到本地，返回本地 URL 路径
async function downloadAndSaveImage(imageUrl, filename) {
  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error(`图片下载失败: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.mkdir(userChatImageDir, { recursive: true });
  const filepath = path.join(userChatImageDir, filename);
  await fs.writeFile(filepath, buffer);
  return `/user_assets/chat/${filename}`;
}

// 调 Agnes AI 图片生成接口，返回本地保存后的图片路径
export async function generateImage(subject, fetchImpl = fetch) {
  if (!AGNES_AI_KEY) throw new Error('未配置 AGNES_AI_KEY，请在 .env 里添加');

  const prompt = buildImagePrompt(subject);
  const url = `${AGNES_AI_BASE}/images/generations`;

  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${AGNES_AI_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt,
      n: 1,
      size: '1024x1024',
      response_format: 'url',
    }),
  });

  const detail = await response.text().catch(() => '');
  if (!response.ok) {
    let msg = `图片生成失败 (${response.status})`;
    try {
      const parsed = JSON.parse(detail);
      if (parsed?.error?.message) msg = parsed.error.message;
    } catch {}
    throw new Error(msg);
  }

  const payload = JSON.parse(detail);
  const imageUrl = payload?.data?.[0]?.url || payload?.data?.[0]?.b64_json;
  if (!imageUrl) throw new Error('接口返回里没有图片地址');

  // 如果是 base64
  if (!imageUrl.startsWith('http')) {
    const filename = `draw-${Date.now()}.png`;
    await fs.mkdir(userChatImageDir, { recursive: true });
    const buffer = Buffer.from(imageUrl, 'base64');
    const filepath = path.join(userChatImageDir, filename);
    await fs.writeFile(filepath, buffer);
    return `/user_assets/chat/${filename}`;
  }

  // 下载并保存
  const filename = `draw-${Date.now()}.png`;
  return downloadAndSaveImage(imageUrl, filename);
}
