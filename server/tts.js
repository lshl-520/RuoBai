import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { pool as defaultPool } from './db.js';
import { parseInteger } from './helpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const userTtsDir = path.join(projectRoot, 'user_assets', 'tts');
const VOLC_VOICE_PROVIDER = 'volc-realtime';
const VOLC_TTS_MODEL = 'seed-tts-2.0';
const VOLC_TTS_URL = 'https://openspeech.bytedance.com/api/v3/tts/unidirectional';
const DEFAULT_VOLC_SPEAKER = 'saturn_zh_female_wenrouwenya_tob';
const PREVIEW_TEXT = '我在呢。今天也会好好陪着你。';

function normalizeExtras(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value;
}

function buildSpeechUrl(apiBase) {
  const base = String(apiBase || '').trim().replace(/\/+$/, '');
  if (!base) {
    return '/v1/audio/speech';
  }
  if (/\/audio\/speech$/i.test(base)) {
    return base;
  }
  if (/\/v\d+(?:\/[^/]+)*$/i.test(base)) {
    return `${base}/audio/speech`;
  }
  return `${base}/v1/audio/speech`;
}

export function isQwenDashscopeTts(model, apiBase) {
  const m = String(model || '').toLowerCase();
  const b = String(apiBase || '').toLowerCase();
  return m.includes('qwen-tts') || m.includes('qwen3-tts') || b.includes('dashscope');
}

export function isVolcDoubaoTts(config = {}) {
  const provider = String(config.provider_type || '').toLowerCase();
  const model = String(config.model || '').toLowerCase();
  const base = String(config.api_base || '').toLowerCase();
  return provider === VOLC_VOICE_PROVIDER || model.startsWith('seed-tts') || base.includes('openspeech.bytedance.com');
}

function buildQwenTtsUrl() {
  return 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';
}

function parseJsonText(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractUpstreamMessage(detail) {
  const text = String(detail || '').trim();
  if (!text) return '';

  const parsed = parseJsonText(text);
  if (!parsed) return text;

  const candidates = [
    parsed.message,
    parsed.detail,
    parsed.error?.message,
    parsed.error?.detail,
    typeof parsed.error === 'string' ? parsed.error : '',
    parsed.code
  ];

  return candidates.find(item => String(item || '').trim()) || text;
}

function truncateDetail(value, maxLength = 180) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

function qwenTtsErrorMessage(status, detail, model, voiceId) {
  if (status === 401 || status === 403) {
    return `API key 不对或没权限调用 ${model}`;
  }
  if (status === 404) {
    return `TTS 模型名拼错了，去千问后台核对：${model}`;
  }
  if (status === 400 || status === 422) {
    return `音色 ID 不对（当前用 ${voiceId}），常用千问音色：longwan / longfeifei_v3 / longxing_v3`;
  }
  if (status >= 500 && status <= 599) {
    return '千问 TTS 服务暂时挂了，过会儿再试';
  }

  const upstreamMessage = truncateDetail(extractUpstreamMessage(detail));
  return upstreamMessage ? `千问返回：${upstreamMessage}` : '千问返回：TTS 生成失败';
}

function volcTtsErrorMessage(status, detail) {
  if (status === 401) return '豆包语音 API Key 不对或已经失效';
  if (status === 403) return '豆包语音合成服务还没开通，或当前 Key 没有权限';
  if (status === 429) return '豆包语音请求太频繁，请稍后再试';
  if (status >= 500 && status <= 599) return '豆包语音服务暂时繁忙，请稍后再试';
  const message = truncateDetail(extractUpstreamMessage(detail));
  return message ? `豆包语音返回：${message}` : `豆包语音请求失败（${status || '未知状态'}）`;
}

function firstTextValue(values) {
  return values.find(value => typeof value === 'string' && value.trim());
}

function cleanBase64Audio(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const commaIndex = raw.indexOf(',');
  if (/^data:audio\//i.test(raw) && commaIndex >= 0) {
    return raw.slice(commaIndex + 1).trim();
  }
  return raw;
}

async function readQwenAudioBuffer(payload, fetchImpl) {
  const audio = payload?.output?.audio || payload?.audio || {};
  const url = firstTextValue([
    audio.url,
    payload?.output?.audio_url,
    payload?.output?.url,
    payload?.audio_url,
    payload?.url
  ]);

  if (url) {
    const audioResponse = await fetchImpl(url);
    if (!audioResponse.ok) {
      const detail = await audioResponse.text().catch(() => '');
      throw new Error(`千问音频下载失败：${truncateDetail(extractUpstreamMessage(detail) || audioResponse.status || '')}`);
    }
    return Buffer.from(await audioResponse.arrayBuffer());
  }

  const encoded = firstTextValue([
    audio.base64,
    audio.data,
    audio.content,
    payload?.output?.audio_base64,
    payload?.output?.audio_data,
    payload?.audio_base64,
    payload?.audio_data,
    payload?.base64,
    payload?.data
  ]);

  if (encoded) {
    return Buffer.from(cleanBase64Audio(encoded), 'base64');
  }

  throw new Error('千问返回里没有找到音频地址或音频内容');
}

async function generateQwenTtsAudio(fetchImpl, ttsConfig, messageContent, voiceId) {
  const response = await fetchImpl(buildQwenTtsUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ttsConfig.api_key}`
    },
    body: JSON.stringify({
      model: ttsConfig.model,
      input: {
        text: messageContent,
        voice: voiceId
      },
      parameters: {
        format: 'mp3',
        response_format: 'mp3'
      }
    })
  });

  const detail = await response.text().catch(() => '');
  if (!response.ok) {
    const error = new Error(qwenTtsErrorMessage(response.status, detail, ttsConfig.model, voiceId));
    error.isTtsUpstreamError = true;
    throw error;
  }

  const payload = parseJsonText(detail);
  if (!payload) {
    throw new Error('千问返回不是有效 JSON，无法解析音频');
  }

  return readQwenAudioBuffer(payload, fetchImpl);
}

function normalizeSpeechRate(rate) {
  const value = Number(rate);
  if (!Number.isFinite(value)) return 0;
  return Math.max(-50, Math.min(100, Math.round((value - 1) * 100)));
}

export function parseVolcTtsStream(text) {
  const chunks = [];
  let usage = null;
  let finished = false;

  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const payload = parseJsonText(trimmed);
    if (!payload) {
      throw new Error('豆包语音返回了无法解析的数据');
    }

    const code = Number(payload.code || 0);
    if (code === 20000000) {
      finished = true;
      usage = payload.usage || usage;
      continue;
    }
    if (code > 0) {
      throw new Error(`豆包语音合成失败：${payload.message || code}`);
    }
    if (payload.data) {
      chunks.push(Buffer.from(String(payload.data), 'base64'));
    }
    if (payload.usage) usage = payload.usage;
  }

  if (chunks.length === 0) {
    throw new Error('豆包语音没有返回音频内容');
  }

  return {
    audioBuffer: Buffer.concat(chunks),
    usage,
    finished
  };
}

async function generateVolcTtsAudio(fetchImpl, ttsConfig, messageContent, voiceId, rate) {
  const extras = normalizeExtras(ttsConfig.extras) || {};
  const resourceId = String(extras.resource_id || ttsConfig.model || VOLC_TTS_MODEL).trim() || VOLC_TTS_MODEL;
  const speaker = String(voiceId || extras.voice_id || DEFAULT_VOLC_SPEAKER).trim() || DEFAULT_VOLC_SPEAKER;
  const response = await fetchImpl(VOLC_TTS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': ttsConfig.api_key,
      'X-Api-Resource-Id': resourceId,
      'X-Api-Request-Id': randomUUID(),
      'X-Control-Require-Usage-Tokens-Return': '*'
    },
    body: JSON.stringify({
      req_params: {
        text: messageContent,
        speaker,
        additions: JSON.stringify({
          disable_markdown_filter: false,
          disable_emoji_filter: false,
          enable_latex_tn: true
        }),
        audio_params: {
          format: 'mp3',
          sample_rate: 24000,
          speech_rate: normalizeSpeechRate(rate),
          enable_subtitle: false
        }
      }
    })
  });

  const detail = await response.text().catch(() => '');
  if (!response.ok) {
    throw new Error(volcTtsErrorMessage(response.status, detail));
  }

  return parseVolcTtsStream(detail).audioBuffer;
}

async function generateOpenAiStyleTtsAudio(fetchImpl, ttsConfig, messageContent, voiceId) {
  const response = await fetchImpl(buildSpeechUrl(ttsConfig.api_base), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ttsConfig.api_key}`
    },
    body: JSON.stringify({
      model: ttsConfig.model,
      input: messageContent,
      voice: voiceId,
      format: 'mp3'
    })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(detail || 'TTS 生成失败');
  }

  return Buffer.from(await response.arrayBuffer());
}

async function generateTtsAudio(fetchImpl, ttsConfig, messageContent, voiceId, rate) {
  if (isVolcDoubaoTts(ttsConfig)) {
    return generateVolcTtsAudio(fetchImpl, ttsConfig, messageContent, voiceId, rate);
  }
  if (isQwenDashscopeTts(ttsConfig.model, ttsConfig.api_base)) {
    return generateQwenTtsAudio(fetchImpl, ttsConfig, messageContent, voiceId);
  }
  return generateOpenAiStyleTtsAudio(fetchImpl, ttsConfig, messageContent, voiceId);
}

async function loadMessage(queryable, messageId, userId) {
  const [rows] = await queryable.query(
    `
      SELECT id, user_id, character_id, role, content, message_type, media_url
      FROM messages
      WHERE id = ? AND user_id = ?
      LIMIT 1
    `,
    [messageId, userId]
  );

  return rows[0] || null;
}

async function loadTtsCapability(queryable, userId) {
  const [rows] = await queryable.query(
    `
      SELECT
        ca.capability,
        ca.enabled,
        ca.extras,
        c.provider_type,
        c.api_base,
        c.api_key,
        ca.model_id AS model
      FROM capability_assignments ca
      INNER JOIN credentials c ON c.id = ca.credential_id
      WHERE ca.user_id = ? AND ca.capability = ? AND ca.enabled = 1 AND c.is_enabled = 1
      LIMIT 1
    `,
    [userId, 'tts']
  );

  return rows[0] || null;
}

async function ensureCachedAudio(fileStorage, filePath) {
  try {
    await fileStorage.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function cacheHash(ttsConfig, voiceId, rate, text = '') {
  return createHash('sha256')
    .update(JSON.stringify({
      provider: ttsConfig.provider_type || '',
      model: ttsConfig.model || '',
      voiceId,
      rate: Number(rate) || 1,
      text
    }))
    .digest('hex')
    .slice(0, 14);
}

async function updateAssistantMessageToVoice(queryable, messageId, userId, audioUrl) {
  await queryable.query(
    `
      UPDATE messages
      SET message_type = 'voice', media_url = ?
      WHERE id = ? AND user_id = ? AND role = 'assistant'
    `,
    [audioUrl, messageId, userId]
  );
}

async function createOrLoadAudio({
  fileStorage,
  fetchImpl,
  ttsConfig,
  text,
  voiceId,
  rate,
  fileName
}) {
  const audioFilePath = path.join(userTtsDir, fileName);
  const audioUrl = `/user_assets/tts/${fileName}`;

  if (!(await ensureCachedAudio(fileStorage, audioFilePath))) {
    await fileStorage.mkdir(userTtsDir, { recursive: true });
    const audioBuffer = await generateTtsAudio(fetchImpl, ttsConfig, text, voiceId, rate);
    await fileStorage.writeFile(audioFilePath, audioBuffer);
  }

  return audioUrl;
}

export function createTtsRouter({
  pool = defaultPool,
  fetchImpl = fetch,
  fileStorage = fs
} = {}) {
  const router = express.Router();

  router.post('/preview', async (req, res) => {
    try {
      const text = String(req.body?.text || PREVIEW_TEXT).trim().slice(0, 180) || PREVIEW_TEXT;
      const voiceOverride = String(req.body?.voice_override || '').trim();
      const rate = Number(req.body?.rate) || 0.9;
      const ttsConfig = await loadTtsCapability(pool, req.session.userId);
      if (!ttsConfig) {
        return res.status(400).json({ success: false, error: '请先保存一个云端语音渠道' });
      }

      const extras = normalizeExtras(ttsConfig.extras) || {};
      const voiceId = voiceOverride || extras.voice_id || (isVolcDoubaoTts(ttsConfig) ? DEFAULT_VOLC_SPEAKER : 'longwan');
      const fileName = `preview-${req.session.userId}-${cacheHash(ttsConfig, voiceId, rate, text)}.mp3`;
      const audioUrl = await createOrLoadAudio({ fileStorage, fetchImpl, ttsConfig, text, voiceId, rate, fileName });

      return res.json({ success: true, audio_url: audioUrl, voice_id: voiceId, duration: null });
    } catch (error) {
      return res.status(400).json({ success: false, error: error.message });
    }
  });

  router.post('/speak', async (req, res) => {
    try {
      const messageId = parseInteger(req.body?.message_id);
      const voiceOverride = String(req.body?.voice_override || '').trim();
      const convertToVoice = Boolean(req.body?.convert_to_voice);
      const rate = Number(req.body?.rate) || 0.9;
      if (!messageId) {
        return res.status(400).json({ success: false, error: 'message_id 非法' });
      }

      const message = await loadMessage(pool, messageId, req.session.userId);
      if (!message) {
        return res.status(404).json({ success: false, error: '消息不存在' });
      }

      const ttsConfig = await loadTtsCapability(pool, req.session.userId);
      if (!ttsConfig) {
        return res.json({
          success: true,
          use_browser_tts: true,
          text: message.content,
          voice_id: 'browser'
        });
      }

      const extras = normalizeExtras(ttsConfig.extras) || {};
      const voiceId = voiceOverride || extras.voice_id || (isVolcDoubaoTts(ttsConfig) ? DEFAULT_VOLC_SPEAKER : 'longwan');

      if (voiceId === 'browser') {
        return res.json({
          success: true,
          use_browser_tts: true,
          text: message.content,
          voice_id: 'browser'
        });
      }

      const audioFileName = `${messageId}-${cacheHash(ttsConfig, voiceId, rate)}.mp3`;
      const audioUrl = await createOrLoadAudio({
        fileStorage,
        fetchImpl,
        ttsConfig,
        text: message.content,
        voiceId,
        rate,
        fileName: audioFileName
      });

      if (convertToVoice && message.role === 'assistant') {
        await updateAssistantMessageToVoice(pool, messageId, req.session.userId, audioUrl);
      }

      return res.json({
        success: true,
        audio_url: audioUrl,
        voice_id: voiceId,
        duration: null,
        converted_to_voice: convertToVoice && message.role === 'assistant'
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }
  });

  return router;
}

export default createTtsRouter();
