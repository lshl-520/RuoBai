import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { pool as defaultPool } from './db.js';
import { parseInteger } from './helpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const userTtsDir = path.join(projectRoot, 'user_assets', 'tts');

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

async function loadMessage(queryable, messageId, userId) {
  const [rows] = await queryable.query(
    `
      SELECT id, user_id, character_id, role, content
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
        c.api_base,
        c.api_key,
        ca.model_id AS model
      FROM capability_assignments ca
      INNER JOIN credentials c ON c.id = ca.credential_id
      WHERE ca.user_id = ? AND ca.capability = ? AND ca.enabled = 1
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

export function createTtsRouter({
  pool = defaultPool,
  fetchImpl = fetch,
  fileStorage = fs
} = {}) {
  const router = express.Router();

  router.post('/speak', async (req, res) => {
    try {
      const messageId = parseInteger(req.body?.message_id);
      const voiceOverride = String(req.body?.voice_override || '').trim();
      if (!messageId) {
        return res.status(400).json({ success: false, error: 'message_id 非法' });
      }

      const message = await loadMessage(pool, messageId, req.session.userId);
      if (!message) {
        return res.status(404).json({ success: false, error: '消息不存在' });
      }

      const ttsConfig = await loadTtsCapability(pool, req.session.userId);
      if (!ttsConfig) {
        return res.status(404).json({ success: false, error: 'TTS 能力还没启用' });
      }

      const extras = normalizeExtras(ttsConfig.extras) || {};
      const voiceId = voiceOverride || extras.voice_id || 'longwan';

      if (voiceId === 'browser') {
        return res.json({
          success: true,
          use_browser_tts: true,
          text: message.content,
          voice_id: 'browser'
        });
      }

      const audioFileName = `${messageId}.mp3`;
      const audioFilePath = path.join(userTtsDir, audioFileName);
      const audioUrl = `/user_assets/tts/${audioFileName}`;

      if (await ensureCachedAudio(fileStorage, audioFilePath)) {
        return res.json({
          success: true,
          audio_url: audioUrl,
          voice_id: voiceId,
          duration: null
        });
      }

      await fileStorage.mkdir(userTtsDir, { recursive: true });

      let audioBuffer;
      if (isQwenDashscopeTts(ttsConfig.model, ttsConfig.api_base)) {
        audioBuffer = await generateQwenTtsAudio(fetchImpl, ttsConfig, message.content, voiceId);
      } else {
        const response = await fetchImpl(buildSpeechUrl(ttsConfig.api_base), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${ttsConfig.api_key}`
          },
          body: JSON.stringify({
            model: ttsConfig.model,
            input: message.content,
            voice: voiceId,
            format: 'mp3'
          })
        });

        if (!response.ok) {
          const detail = await response.text().catch(() => '');
          return res.status(400).json({
            success: false,
            error: detail || 'TTS 生成失败'
          });
        }

        audioBuffer = Buffer.from(await response.arrayBuffer());
      }

      await fileStorage.writeFile(audioFilePath, audioBuffer);

      return res.json({
        success: true,
        audio_url: audioUrl,
        voice_id: voiceId,
        duration: null
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
