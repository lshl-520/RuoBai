import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTtsCapabilityPayload,
  buildTtsPresetPayload,
  getSelectedTtsPreset,
  normalizeVoiceId,
  shouldPersistTtsVoice
} from './profile-tts-utils.mjs';

test('normalizeVoiceId trims the typed value and falls back to longwan', () => {
  assert.equal(normalizeVoiceId('  longfeifei_v3  '), 'longfeifei_v3');
  assert.equal(normalizeVoiceId('   '), 'longwan');
});

test('shouldPersistTtsVoice only saves when the voice actually changed', () => {
  assert.equal(shouldPersistTtsVoice(' longwan ', { voice_id: 'longwan' }), false);
  assert.equal(shouldPersistTtsVoice('longxing_v3', { voice_id: 'longwan' }), true);
});

test('buildTtsCapabilityPayload keeps other extras and overwrites the voice_id', () => {
  assert.deepEqual(
    buildTtsCapabilityPayload({
      credentialId: 4,
      modelId: 'qwen-tts-v1',
      voiceId: ' longxing_v3 ',
      currentExtras: { style: 'warm', voice_id: 'longwan' }
    }),
    {
      credential_id: 4,
      model_id: 'qwen-tts-v1',
      enabled: true,
      extras: {
        style: 'warm',
        voice_id: 'longxing_v3'
      }
    }
  );
});

test('getSelectedTtsPreset identifies xiaobai, browser, and custom voices', () => {
  assert.equal(
    getSelectedTtsPreset({
      current: {
        model_id: 'qwen3-tts-vd-2026-01-26',
        extras: { voice_id: 'qwen-tts-vd-bailian-voice-20260511143305690-0d51' }
      }
    }),
    'xiaobai'
  );
  assert.equal(getSelectedTtsPreset({ current: { extras: { voice_id: 'browser' } } }), 'browser');
  assert.equal(getSelectedTtsPreset({ current: { model_id: 'qwen3-tts-flash', extras: { voice_id: 'longwan' } } }), 'custom');
});

test('buildTtsPresetPayload builds fixed xiaobai and browser payloads', () => {
  const item = {
    current: {
      credential_id: 4,
      model_id: 'qwen3-tts-flash',
      extras: { style: 'warm', voice_id: 'longwan' }
    },
    options: [
      { credential_id: 4, credential_name: '千问', model_id: 'qwen3-tts-flash' },
      { credential_id: 4, credential_name: '千问', model_id: 'qwen3-tts-vd-2026-01-26' }
    ]
  };

  assert.deepEqual(buildTtsPresetPayload(item, 'xiaobai'), {
    credential_id: 4,
    model_id: 'qwen3-tts-vd-2026-01-26',
    enabled: true,
    extras: {
      style: 'warm',
      voice_id: 'qwen-tts-vd-bailian-voice-20260511143305690-0d51'
    }
  });

  assert.deepEqual(buildTtsPresetPayload(item, 'browser'), {
    credential_id: 4,
    model_id: 'qwen3-tts-flash',
    enabled: true,
    extras: {
      style: 'warm',
      voice_id: 'browser'
    }
  });
});
