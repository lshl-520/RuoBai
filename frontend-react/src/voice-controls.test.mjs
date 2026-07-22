import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  normalizeVoiceSettings,
  speechRecognitionErrorMessage,
} from './lib/voice-settings.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('browser TTS defaults to enabled and preserves an explicit off switch', () => {
  assert.equal(normalizeVoiceSettings(null).enabled, true);
  assert.equal(normalizeVoiceSettings({ enabled: false }).enabled, false);
  assert.equal(normalizeVoiceSettings({ volcVoice: 'zh_female_wennuan' }).volcVoice, 'saturn_zh_female_wenrouwenya_tob');
});

test('speech recognition errors are translated into useful Chinese messages', () => {
  assert.match(speechRecognitionErrorMessage('no-speech'), /没有检测到说话声/);
  assert.match(speechRecognitionErrorMessage('network'), /连接失败/);
  assert.equal(speechRecognitionErrorMessage('aborted'), '');
});

test('voice controls use local TTS settings and wait for recognition to finish', async () => {
  const models = await readFile(path.join(__dirname, 'pages', 'models.jsx'), 'utf8');
  const chat = await readFile(path.join(__dirname, 'pages', 'chat.jsx'), 'utf8');

  assert.match(models, /<Toggle on=\{voiceConfig\.enabled\}/);
  assert.match(models, /previewTts\(/);
  assert.match(models, /VOLC_TTS_MODEL = "seed-tts-2\.0"/);
  assert.match(models, /saveVoiceSettings\(\{ \.\.\.voiceConfig, enabled: nextEnabled \}\)/);
  assert.match(chat, /secondsRef\.current/);
  assert.match(chat, /convertToVoice: true/);
  assert.match(chat, /type: "voice"/);
  assert.match(chat, /她的文字回复已经保留，但生成语音失败/);
});
