import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { pool as defaultPool } from './db.js';
import { requireCharacterForUser as defaultRequireCharacterForUser } from './helpers.js';

export const VOLC_REALTIME_URL = 'wss://openspeech.bytedance.com/api/v3/realtime/dialogue';
export const VOLC_RESOURCE_ID = 'volc.speech.dialog';
export const VOLC_APP_KEY = 'PlgvMymc7f3tQnJ6';
export const DEFAULT_REALTIME_MODEL = '2.2.0.0';
export const DEFAULT_REALTIME_SPEAKER = 'saturn_zh_female_wenrouwenya_tob';

const CONNECT_EVENTS = new Set([1, 2, 50, 51, 52]);
const SERVER_EVENT_NAMES = new Map([
  [50, 'connection_started'],
  [51, 'connection_failed'],
  [52, 'connection_finished'],
  [150, 'session_started'],
  [152, 'session_finished'],
  [153, 'session_failed'],
  [154, 'usage'],
  [251, 'config_updated'],
  [350, 'tts_start'],
  [351, 'tts_sentence_end'],
  [352, 'tts_audio'],
  [359, 'tts_end'],
  [450, 'asr_info'],
  [451, 'asr'],
  [459, 'asr_end'],
  [550, 'assistant_text'],
  [553, 'text_confirmed'],
  [559, 'assistant_text_end'],
  [599, 'dialog_error']
]);

function parseExtras(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function cleanText(value, maxLength = 4000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function normalizeWsUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return VOLC_REALTIME_URL;
  if (/^wss:\/\//i.test(raw)) return raw;
  if (/^https:\/\//i.test(raw)) return raw.replace(/^https:/i, 'wss:');
  return VOLC_REALTIME_URL;
}

/**
 * 豆包端到端实时语音（新版）握手必须带 App ID + Access Token。
 * 历史版本误把 API Key 放在 x-api-key，火山网关不会识别这个请求头。
 * 为兼容现有表结构：api_key 保存 Access Token，api_aux_base 保存 App ID。
 */
export function buildVolcRealtimeHeaders(config, { connectId = randomUUID() } = {}) {
  const extras = parseExtras(config?.extras);
  const appId = cleanText(extras.app_id || extras.appId || config?.api_aux_base, 120);
  const accessKey = cleanText(extras.access_key || extras.accessKey || config?.api_key, 512);
  if (!appId) throw new Error('豆包语音缺少 App ID。请打开“我的 → 添加接口渠道 → 豆包语音”，填写火山控制台里的 APP ID 后重新获取模型。');
  if (!accessKey) throw new Error('豆包语音缺少 Access Token。请在渠道里粘贴火山控制台的 Access Token 后重新获取模型。');

  return {
    'X-Api-App-ID': appId,
    'X-Api-Access-Key': accessKey,
    'X-Api-Resource-Id': cleanText(extras.resource_id, 120) || VOLC_RESOURCE_ID,
    'X-Api-App-Key': cleanText(extras.app_key, 120) || VOLC_APP_KEY,
    'X-Api-Connect-Id': connectId
  };
}

export function buildVolcEventPacket(event, payload = {}, { sessionId = '', audio = false } = {}) {
  const payloadBuffer = Buffer.isBuffer(payload)
    ? payload
    : payload instanceof Uint8Array
      ? Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength)
      : Buffer.from(JSON.stringify(payload ?? {}), 'utf8');

  const messageType = audio ? 0x2 : 0x1;
  const serialization = audio ? 0x0 : 0x1;
  const parts = [
    Buffer.from([0x11, (messageType << 4) | 0x4, serialization << 4, 0]),
    uint32(event)
  ];

  if (!CONNECT_EVENTS.has(event)) {
    const sessionBuffer = Buffer.from(String(sessionId), 'utf8');
    parts.push(uint32(sessionBuffer.length), sessionBuffer);
  }

  parts.push(uint32(payloadBuffer.length), payloadBuffer);
  return Buffer.concat(parts);
}

export function parseVolcFrame(input) {
  const frame = Buffer.isBuffer(input)
    ? input
    : Buffer.from(input.buffer || input, input.byteOffset || 0, input.byteLength || undefined);

  if (frame.length < 8) {
    throw new Error(`火山实时语音返回了过短数据帧：${frame.length}`);
  }

  const headerBytes = (frame[0] & 0x0f) * 4;
  const messageType = frame[1] >> 4;
  const flags = frame[1] & 0x0f;
  const serialization = frame[2] >> 4;
  const compression = frame[2] & 0x0f;
  let offset = headerBytes;
  let errorCode = null;
  let sequence = null;
  let event = null;
  let sessionId = '';

  if (messageType === 0x0f) {
    errorCode = frame.readUInt32BE(offset);
    offset += 4;
  }

  if (flags === 0x1 || flags === 0x3) {
    sequence = frame.readInt32BE(offset);
    offset += 4;
  }

  if (flags & 0x4) {
    event = frame.readUInt32BE(offset);
    offset += 4;

    if (!CONNECT_EVENTS.has(event)) {
      const sessionLength = frame.readUInt32BE(offset);
      offset += 4;
      sessionId = frame.subarray(offset, offset + sessionLength).toString('utf8');
      offset += sessionLength;
    }
  }

  if (offset + 4 > frame.length) {
    throw new Error('火山实时语音数据帧缺少 payload 长度');
  }

  const payloadLength = frame.readUInt32BE(offset);
  offset += 4;
  const payloadBuffer = frame.subarray(offset, offset + payloadLength);
  let payload = payloadBuffer;

  if (serialization === 0x1) {
    const text = payloadBuffer.toString('utf8');
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  return {
    messageType,
    flags,
    serialization,
    compression,
    errorCode,
    sequence,
    event,
    eventName: SERVER_EVENT_NAMES.get(event) || `event_${event ?? 'unknown'}`,
    sessionId,
    payload,
    payloadBuffer
  };
}

function uint32(value) {
  const buffer = Buffer.allocUnsafe(4);
  buffer.writeUInt32BE(Number(value) >>> 0, 0);
  return buffer;
}

export function buildRealtimeCharacterPrompt(character) {
  const name = cleanText(character?.name, 40) || '若白';
  const persona = cleanText(character?.persona, 3000);
  const speechStyle = String(character?.speech_style || 'natural');
  const style = speechStyle === 'roleplay'
    ? '自然地扮演角色，可以有少量动作和情绪表达，但不要长篇旁白。'
    : '像亲密关系中的自然通话一样说话：口语、自然、简短，通常一到三句；知道自己是 AI，不冒充现实人类，不要客服腔，不要反复套用固定安慰话。';

  return [
    `你叫${name}，正在和用户进行一对一实时语音通话。`,
    persona,
    style,
    '先接住用户当前这句话，再自然延续话题。允许亲近和暧昧的日常表达，保持人设和前后文一致。'
  ].filter(Boolean).join('\n');
}

export function buildVolcStartSessionPayload({ character, config, context = [] }) {
  const extras = parseExtras(config?.extras);
  const model = cleanText(config?.model_id || config?.model || extras.model, 40) || DEFAULT_REALTIME_MODEL;
  const speaker = cleanText(extras.speaker || extras.voice || config?.speaker, 120) || DEFAULT_REALTIME_SPEAKER;
  const prompt = buildRealtimeCharacterPrompt(character);
  const isStrongCharacter = model === '2.2.0.0' || /^2\./.test(model);
  const dialog = {
    dialog_context: context,
    extra: {
      model,
      enable_loudness_norm: extras.enable_loudness_norm !== false,
      enable_conversation_truncate: true,
      enable_user_query_exit: true
    }
  };

  if (isStrongCharacter) {
    dialog.character_manifest = prompt;
  } else {
    dialog.bot_name = cleanText(character?.name, 20) || '若白';
    dialog.system_role = prompt;
    dialog.speaking_style = '自然、亲近、口语化、简短，像真实电话交流。';
  }

  return {
    asr: {
      audio_info: {
        format: 'pcm',
        sample_rate: 16000,
        channel: 1
      },
      extra: {
        end_smooth_window_ms: Number(extras.end_smooth_window_ms) || 700,
        enable_custom_vad: true,
        enable_asr_twopass: Boolean(extras.enable_asr_twopass)
      }
    },
    dialog,
    tts: {
      speaker,
      audio_config: {
        channel: 1,
        format: 'pcm_s16le',
        sample_rate: 24000,
        speech_rate: Number(extras.speech_rate) || 0,
        loudness_rate: Number(extras.loudness_rate) || 0
      }
    }
  };
}

export function buildDialogContext(messages = []) {
  const normalized = messages
    .map(item => ({ role: item?.role, text: cleanText(item?.content, 1200) }))
    .filter(item => ['user', 'assistant'].includes(item.role) && item.text);
  const pairs = [];

  for (let index = 0; index < normalized.length - 1; index += 1) {
    const user = normalized[index];
    const assistant = normalized[index + 1];
    if (user.role === 'user' && assistant.role === 'assistant') {
      pairs.push(user, assistant);
      index += 1;
    }
  }

  return pairs.slice(-20);
}

async function loadRecentDialogContext(pool, userId, characterId) {
  try {
    const [rows] = await pool.query(
      `
        SELECT role, content
        FROM messages
        WHERE user_id = ? AND character_id = ? AND is_active = 1
        ORDER BY id DESC
        LIMIT 24
      `,
      [userId, characterId]
    );
    return buildDialogContext(rows.reverse());
  } catch {
    return [];
  }
}

export async function loadRealtimeConfig(pool, userId) {
  const [rows] = await pool.query(
    `
      SELECT
        ca.model_id,
        ca.extras,
        c.name,
        c.provider_type,
        c.api_base,
        c.api_aux_base,
        c.api_key
      FROM capability_assignments ca
      INNER JOIN credentials c ON c.id = ca.credential_id
      WHERE ca.user_id = ? AND ca.capability = 'realtime' AND ca.enabled = 1 AND c.is_enabled = 1
      ORDER BY ca.id DESC
      LIMIT 1
    `,
    [userId]
  );

  if (rows[0]?.api_key) {
    return rows[0];
  }

  if (process.env.VOLC_REALTIME_API_KEY) {
    return {
      name: '火山端到端实时语音',
      provider_type: 'volcengine_realtime',
      api_base: process.env.VOLC_REALTIME_URL || VOLC_REALTIME_URL,
      api_aux_base: process.env.VOLC_REALTIME_APP_ID || '',
      api_key: process.env.VOLC_REALTIME_API_KEY,
      model_id: process.env.VOLC_REALTIME_MODEL || DEFAULT_REALTIME_MODEL,
      extras: {
        speaker: process.env.VOLC_REALTIME_SPEAKER || DEFAULT_REALTIME_SPEAKER
      }
    };
  }

  return null;
}

function formatVolcPayload(payload) {
  if (Buffer.isBuffer(payload)) return payload.toString('utf8').slice(0, 500);
  if (typeof payload === 'string') return payload.slice(0, 500);
  try {
    return JSON.stringify(payload ?? {}).slice(0, 500);
  } catch {
    return String(payload).slice(0, 500);
  }
}

function buildVolcFrameError(frame) {
  return new Error(`火山实时语音错误 ${frame.errorCode ?? 'unknown'}: ${formatVolcPayload(frame.payload)}`);
}

function redactVolcErrorDetail(value) {
  return String(value || '')
    .replace(/(?:x-api-key|api[_ -]?key|authorization|token)\s*[:=]\s*[^\s,;]+/gi, secret => {
      const separator = Math.max(secret.lastIndexOf(':'), secret.lastIndexOf('='));
      return separator >= 0 ? `${secret.slice(0, separator + 1)} [已隐藏]` : '[已隐藏]';
    })
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[已隐藏]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

function readHandshakeErrorBody(response) {
  return new Promise(resolve => {
    if (!response?.on) {
      resolve('');
      return;
    }

    const chunks = [];
    let total = 0;
    const finish = () => resolve(redactVolcErrorDetail(Buffer.concat(chunks).toString('utf8')));
    response.on('data', chunk => {
      if (total >= 2048) return;
      const buffer = Buffer.from(chunk);
      const remaining = 2048 - total;
      chunks.push(buffer.subarray(0, remaining));
      total += Math.min(buffer.length, remaining);
    });
    response.once('end', finish);
    response.once('error', finish);
    response.once('close', finish);
    response.resume?.();
  });
}

export function testVolcRealtimeCredential(config, { WebSocketImpl = WebSocket, timeoutMs = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    const sessionId = randomUUID();
    const socket = new WebSocketImpl(normalizeWsUrl(config?.api_base), {
      headers: buildVolcRealtimeHeaders(config)
    });
    let settled = false;
    const timeout = setTimeout(() => {
      try { socket.terminate?.(); } catch {}
      finish(new Error('连接火山实时语音超时'));
    }, timeoutMs);

    const finish = (error = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.removeAllListeners?.();
      if (error) reject(error);
      else resolve(true);
    };

    const send = (event, payload = {}) => {
      socket.send(buildVolcEventPacket(event, payload, { sessionId }));
    };

    socket.once('open', () => send(1, {}));
    socket.on('message', data => {
      let frame;
      try {
        frame = parseVolcFrame(data);
      } catch (error) {
        finish(error);
        return;
      }

      if (frame.messageType === 0x0f) {
        finish(buildVolcFrameError(frame));
        return;
      }

      if (frame.event === 50) {
        send(100, buildVolcStartSessionPayload({
          character: { name: '若白', persona: '自然、简短地回应。', speech_style: 'natural' },
          config,
          context: []
        }));
        return;
      }

      if (frame.event === 150) {
        try {
          send(102, {});
          send(2, {});
          socket.close?.(1000, 'session test passed');
        } catch {}
        finish();
        return;
      }

      if (frame.event === 51 || frame.event === 153 || frame.event === 599) {
        finish(new Error(frame.payload?.error || frame.payload?.message || `火山实时语音事件 ${frame.event} 失败`));
      }
    });
    socket.once('error', finish);
    socket.once('close', (code, reason) => {
      if (!settled) finish(new Error(Buffer.from(reason || '').toString('utf8') || `火山实时语音提前断开：${code}`));
    });
    socket.once('unexpected-response', async (_request, response) => {
      const detail = await readHandshakeErrorBody(response);
      finish(new Error(
        `火山实时语音握手失败：HTTP ${response?.statusCode || 'unknown'}${detail ? `：${detail}` : ''}`
      ));
    });
  });
}

function socketIsOpen(socket) {
  return socket?.readyState === WebSocket.OPEN;
}

function sendJson(socket, payload) {
  if (!socketIsOpen(socket)) return;
  socket.send(JSON.stringify(payload));
}

function safeClientError(error) {
  const message = String(error?.message || error || '实时通话连接失败');
  if (/401|access[_ -]?key|access token/i.test(message)) return '火山豆包语音的 Access Token 不对或已经失效';
  if (/app[ _-]?id|缺少 App ID/i.test(message)) return '火山豆包语音缺少或填写错了 App ID';
  if (/403/i.test(message)) return '火山实时通话服务还没开通，或当前 Access Token 没有权限';
  if (/HTTP 400/i.test(message)) {
    return '火山实时通话配置没有通过（HTTP 400）。请检查 App ID 和 Access Token 后，再点“获取模型列表”。';
  }
  if (/实时通话渠道/.test(message)) return message;
  return `实时通话暂时没有接通：${message.slice(0, 160)}`;
}

class RealtimeCallBridge {
  constructor({ client, userId, characterId, pool, requireCharacterForUser, WebSocketImpl }) {
    this.client = client;
    this.userId = userId;
    this.characterId = characterId;
    this.pool = pool;
    this.requireCharacterForUser = requireCharacterForUser;
    this.WebSocketImpl = WebSocketImpl;
    this.upstream = null;
    this.sessionId = randomUUID();
    this.ready = false;
    this.closing = false;
    this.character = null;
    this.config = null;
    this.context = [];
    this.pendingAudio = [];
    this.interrupting = false;
  }

  async start() {
    this.character = await this.requireCharacterForUser(this.userId, this.characterId, this.pool);
    this.config = await loadRealtimeConfig(this.pool, this.userId);
    if (!this.config) {
      throw new Error('请先在“我的 → 她的能力”里添加火山实时通话渠道，并启用“实时通话”');
    }

    this.context = await loadRecentDialogContext(this.pool, this.userId, this.characterId);
    const upstreamUrl = normalizeWsUrl(this.config.api_base);
    const headers = buildVolcRealtimeHeaders(this.config);

    this.upstream = new this.WebSocketImpl(upstreamUrl, { headers });
    this.upstream.binaryType = 'arraybuffer';
    this.upstream.on('open', () => {
      this.sendUpstream(1, {});
      sendJson(this.client, { type: 'connecting', message: '正在接通火山实时语音' });
    });
    this.upstream.on('message', data => this.handleUpstreamMessage(data));
    this.upstream.on('error', error => this.fail(error));
    this.upstream.on('close', (code, reason) => {
      if (!this.closing && socketIsOpen(this.client)) {
        sendJson(this.client, {
          type: 'closed',
          code,
          message: Buffer.from(reason || '').toString('utf8') || '实时通话已断开'
        });
        this.client.close(1011, 'upstream closed');
      }
    });

    this.client.on('message', (data, isBinary) => this.handleClientMessage(data, isBinary));
    this.client.on('close', () => this.close());
    this.client.on('error', () => this.close());
  }

  sendUpstream(event, payload = {}, options = {}) {
    if (!socketIsOpen(this.upstream)) return false;
    this.upstream.send(buildVolcEventPacket(event, payload, {
      sessionId: this.sessionId,
      ...options
    }));
    return true;
  }

  handleClientMessage(data, isBinary) {
    if (isBinary) {
      const audio = Buffer.from(data);
      if (!audio.length) return;
      if (!this.ready) {
        if (this.pendingAudio.length < 50) this.pendingAudio.push(audio);
        return;
      }
      if (this.upstream?.bufferedAmount < 2 * 1024 * 1024) {
        this.sendUpstream(200, audio, { audio: true });
      }
      return;
    }

    let message;
    try {
      message = JSON.parse(Buffer.from(data).toString('utf8'));
    } catch {
      return;
    }

    if (message.type === 'interrupt') {
      this.interrupting = true;
      this.sendUpstream(515, {});
      sendJson(this.client, { type: 'interrupted' });
      return;
    }

    if (message.type === 'text') {
      const content = cleanText(message.content, 2000);
      if (content && this.ready) this.sendUpstream(501, { content });
      return;
    }

    if (message.type === 'hello') {
      const content = cleanText(message.content, 500);
      if (content && this.ready) this.sendUpstream(300, { content });
      return;
    }

    if (message.type === 'finish') {
      this.close();
    }
  }

  handleUpstreamMessage(data) {
    let frame;
    try {
      frame = parseVolcFrame(data);
    } catch (error) {
      this.fail(error);
      return;
    }

    const { event, payload, payloadBuffer, messageType, errorCode } = frame;
    if (messageType === 0x0f) {
      this.fail(buildVolcFrameError({ errorCode, payload }));
      return;
    }

    if (event === 50) {
      this.sendUpstream(100, buildVolcStartSessionPayload({
        character: this.character,
        config: this.config,
        context: this.context
      }));
      return;
    }

    if (event === 150) {
      this.ready = true;
      sendJson(this.client, {
        type: 'session_started',
        dialog_id: payload?.dialog_id || '',
        input_sample_rate: 16000,
        output_sample_rate: 24000,
        speaker: parseExtras(this.config.extras).speaker || DEFAULT_REALTIME_SPEAKER
      });
      for (const audio of this.pendingAudio.splice(0)) {
        this.sendUpstream(200, audio, { audio: true });
      }
      return;
    }

    if (event === 352) {
      // 用户的有效语音已确认并请求打断时，丢弃上一个回答残留的音频帧，
      // 避免出现“明明被打断了又继续自顾自说”的感觉。
      if (!this.interrupting && socketIsOpen(this.client)) this.client.send(payloadBuffer, { binary: true });
      return;
    }

    if (event === 450) {
      sendJson(this.client, { type: 'user_speaking', question_id: payload?.question_id || '' });
      return;
    }

    if (event === 451) {
      const result = payload?.results?.[0] || {};
      sendJson(this.client, {
        type: 'asr',
        text: result.text || '',
        interim: Boolean(result.is_interim)
      });
      return;
    }

    if (event === 459) {
      sendJson(this.client, { type: 'asr_end' });
      return;
    }

    if (event === 550) {
      sendJson(this.client, {
        type: 'assistant_text',
        delta: payload?.content || '',
        question_id: payload?.question_id || '',
        reply_id: payload?.reply_id || ''
      });
      return;
    }

    if (event === 350) {
      // 新一轮 TTS 开始，说明火山已经处理完上次打断。
      this.interrupting = false;
      sendJson(this.client, {
        type: 'tts_start',
        text: payload?.text || '',
        question_id: payload?.question_id || '',
        reply_id: payload?.reply_id || ''
      });
      return;
    }

    if (event === 351) {
      sendJson(this.client, {
        type: 'tts_sentence_end',
        text: payload?.text || '',
        duration: payload?.sentence_duration || null
      });
      return;
    }

    if (event === 359) {
      sendJson(this.client, {
        type: 'tts_end',
        status_code: payload?.status_code || '',
        question_id: payload?.question_id || '',
        reply_id: payload?.reply_id || ''
      });
      return;
    }

    if (event === 154) {
      sendJson(this.client, { type: 'usage', usage: payload?.usage || {} });
      return;
    }

    if (event === 51 || event === 153 || event === 599) {
      this.fail(new Error(payload?.error || payload?.message || `火山实时语音事件 ${event} 失败`));
      return;
    }

    if (event === 152 || event === 52) {
      if (socketIsOpen(this.client)) this.client.close(1000, 'call finished');
    }
  }

  fail(error) {
    if (this.closing) return;
    sendJson(this.client, { type: 'error', message: safeClientError(error) });
    this.close(1011);
  }

  close(code = 1000) {
    if (this.closing) return;
    this.closing = true;

    if (socketIsOpen(this.upstream)) {
      if (this.ready) this.sendUpstream(102, {});
      this.sendUpstream(2, {});
      const upstream = this.upstream;
      setTimeout(() => {
        if (socketIsOpen(upstream)) upstream.close(1000, 'client finished');
      }, 300);
    }

    if (socketIsOpen(this.client)) {
      setTimeout(() => {
        if (socketIsOpen(this.client)) this.client.close(code, 'call finished');
      }, 350);
    }
  }
}

function rejectUpgrade(socket, statusCode, message) {
  const text = String(message || 'WebSocket upgrade rejected');
  socket.write(
    `HTTP/1.1 ${statusCode} ${statusCode === 401 ? 'Unauthorized' : 'Bad Request'}\r\n` +
    'Connection: close\r\n' +
    'Content-Type: text/plain; charset=utf-8\r\n' +
    `Content-Length: ${Buffer.byteLength(text)}\r\n\r\n` +
    text
  );
  socket.destroy();
}

function applySession(sessionMiddleware, request) {
  return new Promise((resolve, reject) => {
    const headers = new Map();
    const response = {
      getHeader(name) { return headers.get(String(name).toLowerCase()); },
      setHeader(name, value) { headers.set(String(name).toLowerCase(), value); },
      removeHeader(name) { headers.delete(String(name).toLowerCase()); },
      writeHead() {},
      end() {},
      on() { return this; },
      once() { return this; },
      emit() { return false; }
    };
    sessionMiddleware(request, response, error => error ? reject(error) : resolve());
  });
}

export function attachRealtimeCallServer({
  server,
  sessionMiddleware,
  pool = defaultPool,
  requireCharacterForUser = defaultRequireCharacterForUser,
  WebSocketImpl = WebSocket
}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });

  wss.on('connection', (client, request, context) => {
    const bridge = new RealtimeCallBridge({
      client,
      userId: context.userId,
      characterId: context.characterId,
      pool,
      requireCharacterForUser,
      WebSocketImpl
    });
    bridge.start().catch(error => bridge.fail(error));
  });

  server.on('upgrade', async (request, socket, head) => {
    let url;
    try {
      url = new URL(request.url, 'http://localhost');
    } catch {
      return;
    }

    if (url.pathname !== '/api/realtime-call') return;

    try {
      await applySession(sessionMiddleware, request);
      const userId = Number(request.session?.userId);
      const characterId = Number(url.searchParams.get('character_id'));
      if (!userId) {
        rejectUpgrade(socket, 401, '请先登录');
        return;
      }
      if (!characterId) {
        rejectUpgrade(socket, 400, '缺少 character_id');
        return;
      }

      wss.handleUpgrade(request, socket, head, client => {
        wss.emit('connection', client, request, { userId, characterId });
      });
    } catch (error) {
      rejectUpgrade(socket, 400, safeClientError(error));
    }
  });

  return wss;
}
