import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDialogContext,
  buildRealtimeCharacterPrompt,
  buildVolcEventPacket,
  buildVolcStartSessionPayload,
  parseVolcFrame
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
