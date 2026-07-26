import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import {
  buildDialogContext,
  buildRealtimeCharacterPrompt,
  buildVolcEventPacket,
  buildVolcStartSessionPayload,
  parseVolcFrame,
  testVolcRealtimeCredential
} from './realtime-call.js';

test('火山实时事件封包和解析可以往返', () => {
  const packet = buildVolcEventPacket(100, { dialog: { extra: { model: '2.2.0.0' } } }, { sessionId: 'session-1' });
  const parsed = parseVolcFrame(packet);
  assert.equal(parsed.event, 100);
  assert.equal(parsed.sessionId, 'session-1');
  assert.equal(parsed.payload.dialog.extra.model, '2.2.0.0');
});

test('实时通话上下文只保留完整问答对', () => {
  const context = buildDialogContext([
    { role: 'user', content: '第一句' },
    { role: 'assistant', content: '第一答' },
    { role: 'user', content: '第二句' }
  ]);
  assert.deepEqual(context, [
    { role: 'user', text: '第一句' },
    { role: 'assistant', text: '第一答' }
  ]);
});

test('SC2.0 会话带角色描述、音色和 PCM 输出配置', () => {
  const payload = buildVolcStartSessionPayload({
    character: { name: '林夏', persona: '温柔、自然', speech_style: 'natural' },
    config: { model_id: '2.2.0.0', extras: { speaker: 'saturn_zh_female_wenrouwenya_tob' } },
    context: []
  });
  assert.equal(payload.dialog.extra.model, '2.2.0.0');
  assert.match(payload.dialog.character_manifest, /林夏/);
  assert.equal(payload.tts.speaker, 'saturn_zh_female_wenrouwenya_tob');
  assert.equal(payload.tts.audio_config.format, 'pcm_s16le');
});

test('实时人设提示词包含短句和角色约束', () => {
  const prompt = buildRealtimeCharacterPrompt({ name: '林夏', persona: '喜欢分享日常' });
  assert.match(prompt, /林夏/);
  assert.match(prompt, /口语/);
});


class SuccessfulRealtimeSocket extends EventEmitter {
  static instances = [];

  constructor(_url, options) {
    super();
    this.readyState = 1;
    this.options = options;
    this.sentEvents = [];
    SuccessfulRealtimeSocket.instances.push(this);
    queueMicrotask(() => this.emit('open'));
  }

  send(data) {
    const frame = parseVolcFrame(data);
    this.sentEvents.push(frame.event);
    if (frame.event === 1) {
      queueMicrotask(() => this.emit('message', buildVolcEventPacket(50, 'connection-1')));
    } else if (frame.event === 100) {
      queueMicrotask(() => this.emit('message', buildVolcEventPacket(150, { dialog_id: 'dialog-1' }, { sessionId: frame.sessionId })));
    }
  }

  close() {
    this.readyState = 3;
    queueMicrotask(() => this.emit('close', 1000, Buffer.from('ok')));
  }

  terminate() {
    this.readyState = 3;
  }
}

function buildErrorFrame(errorCode, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const code = Buffer.alloc(4);
  code.writeUInt32BE(errorCode);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  return Buffer.concat([Buffer.from([0x11, 0xf0, 0x10, 0]), code, length, body]);
}

class FailedRealtimeSocket extends SuccessfulRealtimeSocket {
  send(data) {
    const frame = parseVolcFrame(data);
    this.sentEvents.push(frame.event);
    if (frame.event === 1) {
      queueMicrotask(() => this.emit('message', buildErrorFrame(55000001, { error: 'bad key or session' })));
    }
  }
}


class HandshakeFailureSocket extends SuccessfulRealtimeSocket {
  send(data) {
    const frame = parseVolcFrame(data);
    this.sentEvents.push(frame.event);
    if (frame.event === 1) {
      const response = Readable.from([Buffer.from('invalid request: app_key does not match')]);
      response.statusCode = 400;
      queueMicrotask(() => this.emit('unexpected-response', {}, response));
    }
  }
}

test('实时语音握手失败会保留火山的安全错误说明', async () => {
  SuccessfulRealtimeSocket.instances = [];
  await assert.rejects(
    testVolcRealtimeCredential({
      api_base: 'wss://example.test/realtime',
      api_key: 'test-key'
    }, { WebSocketImpl: HandshakeFailureSocket, timeoutMs: 1000 }),
    /HTTP 400：invalid request: app_key does not match/
  );
});

test('实时语音凭证测试会建立完整会话而不只检查 WebSocket 握手', async () => {
  SuccessfulRealtimeSocket.instances = [];
  await testVolcRealtimeCredential({
    api_base: 'wss://example.test/realtime',
    api_key: 'test-key',
    model_id: '2.2.0.0'
  }, { WebSocketImpl: SuccessfulRealtimeSocket, timeoutMs: 1000 });

  assert.deepEqual(SuccessfulRealtimeSocket.instances[0].sentEvents.slice(0, 2), [1, 100]);
});

test('实时语音对象错误会显示具体 JSON 而不是 object Object', async () => {
  SuccessfulRealtimeSocket.instances = [];
  await assert.rejects(
    testVolcRealtimeCredential({
      api_base: 'wss://example.test/realtime',
      api_key: 'bad-key'
    }, { WebSocketImpl: FailedRealtimeSocket, timeoutMs: 1000 }),
    /"error":"bad key or session"/
  );
});
