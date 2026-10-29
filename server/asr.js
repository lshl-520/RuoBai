/**
 * 语音识别（把用户说的话变成文字）—— 2026/9/19
 *
 * 为什么要加这一层：
 *   浏览器自带的语音识别（Web Speech API）走的是 Google 服务器，
 *   在国内网络下**根本连不上** —— 用户实测发语音总是"未识别到文字内容"。
 *
 * 三层识别通道（按可靠性排序）：
 *   1. Android App   → 手机系统识别（可离线，不经过服务器）—— 见 NativeSpeechRecognitionPlugin
 *   2. 网页/桌面     → 本文件：走已配置的千问 key（国内可用的可靠通道）
 *   3. 兜底          → 浏览器识别（能用就用）
 *
 * 注意：录音本身不经过服务器；只有"网页端识别"这一步会把音频交给千问。
 *      App 端走设备识别，音频不出手机。
 */
import express from 'express';
import { asyncHandler } from './helpers.js';

const DASHSCOPE_URL = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';
/** 当前可用的千问识别模型（multimodal-generation 接口下的 ASR）。 */
const ASR_MODEL = process.env.QWEN_ASR_MODEL || 'qwen3-asr-flash';

export function isAsrConfigured() {
  return Boolean(String(process.env.QWEN_TTS_KEY || '').trim());
}

/**
 * 调千问识别一段音频。
 * @param {string} dataUrl  形如 data:audio/webm;base64,xxxx
 * @param {object} options  { fetchImpl }
 * @returns {Promise<{ text: string, model: string }>}
 */
export async function transcribeAudio(dataUrl, { fetchImpl = fetch } = {}) {
  const key = String(process.env.QWEN_TTS_KEY || '').trim();
  if (!key) throw new Error('没有配置语音识别凭证');
  const audio = String(dataUrl || '').trim();
  if (!/^data:audio\//i.test(audio)) throw new Error('音频格式不对');

  const response = await fetchImpl(DASHSCOPE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: ASR_MODEL,
      input: { messages: [{ role: 'user', content: [{ audio }] }] },
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.message || payload?.error?.message || `识别服务返回 ${response.status}`;
    throw new Error(message);
  }
  const content = payload?.output?.choices?.[0]?.message?.content;
  const text = Array.isArray(content)
    ? content.map((item) => String(item?.text || '')).join('').trim()
    : String(content || '').trim();
  return { text, model: ASR_MODEL };
}

export function createAsrRouter({ fetchImpl = fetch } = {}) {
  const router = express.Router();

  /** 网页端识别：把录音发上来，换成文字。 */
  router.post('/transcribe', asyncHandler(async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ success: false, error: '请先登录' });
    }
    if (!isAsrConfigured()) {
      return res.status(503).json({ success: false, error: '服务器没有配置语音识别凭证' });
    }
    const audioData = String(req.body?.audio_data || '').trim();
    if (!audioData) {
      return res.status(400).json({ success: false, error: '没有收到音频' });
    }
    try {
      const result = await transcribeAudio(audioData, { fetchImpl });
      return res.json({ success: true, text: result.text, model: result.model });
    } catch (error) {
      return res.status(502).json({ success: false, error: error.message });
    }
  }));

  /** 前端用来判断要不要走服务端识别。 */
  router.get('/status', (req, res) => {
    res.set('Cache-Control', 'no-store');
    return res.json({ success: true, configured: isAsrConfigured(), model: ASR_MODEL });
  });

  return router;
}

export default createAsrRouter();