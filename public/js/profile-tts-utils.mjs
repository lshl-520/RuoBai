export const TTS_PRESETS = {
  xiaobai: {
    id: 'xiaobai',
    label: '小白专属',
    modelId: 'qwen3-tts-vd-2026-01-26',
    voiceId: 'qwen-tts-vd-bailian-voice-20260511143305690-0d51'
  },
  browser: {
    id: 'browser',
    label: '浏览器免费',
    voiceId: 'browser'
  },
  custom: {
    id: 'custom',
    label: '自定义'
  }
};

export function normalizeVoiceId(value, fallback = 'longwan') {
  const trimmed = String(value ?? '').trim();
  return trimmed || fallback;
}

export function shouldPersistTtsVoice(nextVoiceId, currentExtras) {
  return normalizeVoiceId(nextVoiceId) !== normalizeVoiceId(currentExtras?.voice_id);
}

export function buildTtsCapabilityPayload({
  credentialId,
  modelId,
  enabled = true,
  voiceId,
  currentExtras
}) {
  const extras = currentExtras && typeof currentExtras === 'object'
    ? { ...currentExtras }
    : {};

  extras.voice_id = normalizeVoiceId(voiceId);

  return {
    credential_id: credentialId,
    model_id: modelId,
    enabled,
    extras
  };
}

export function getSelectedTtsPreset(item) {
  const current = item?.current || item || {};
  const modelId = String(current.model_id || current.modelId || '').trim();
  const voiceId = normalizeVoiceId(current.extras?.voice_id, '');

  if (modelId === TTS_PRESETS.xiaobai.modelId && voiceId === TTS_PRESETS.xiaobai.voiceId) {
    return TTS_PRESETS.xiaobai.id;
  }
  if (voiceId === TTS_PRESETS.browser.voiceId) {
    return TTS_PRESETS.browser.id;
  }
  return TTS_PRESETS.custom.id;
}

function findModelOption(item, modelId) {
  const options = Array.isArray(item?.options) ? item.options : [];
  return options.find(option => option.model_id === modelId) || null;
}

function firstTtsTarget(item) {
  const current = item?.current || {};
  if (current.credential_id && current.model_id) {
    return {
      credentialId: current.credential_id,
      modelId: current.model_id
    };
  }

  const first = Array.isArray(item?.options) ? item.options[0] : null;
  return first
    ? {
        credentialId: first.credential_id,
        modelId: first.model_id
      }
    : null;
}

export function buildTtsPresetPayload(item, presetId, customVoiceId) {
  const currentExtras = item?.current?.extras || {};
  const extras = currentExtras && typeof currentExtras === 'object' ? { ...currentExtras } : {};

  if (presetId === TTS_PRESETS.xiaobai.id) {
    const target = findModelOption(item, TTS_PRESETS.xiaobai.modelId);
    if (!target) {
      throw new Error('当前千问凭证里没有小白专属 TTS 模型');
    }
    extras.voice_id = TTS_PRESETS.xiaobai.voiceId;
    return {
      credential_id: target.credential_id,
      model_id: target.model_id,
      enabled: true,
      extras
    };
  }

  const target = firstTtsTarget(item);
  if (!target) {
    throw new Error('还没有可用的 TTS 模型');
  }

  extras.voice_id = presetId === TTS_PRESETS.browser.id
    ? TTS_PRESETS.browser.voiceId
    : normalizeVoiceId(customVoiceId ?? currentExtras.voice_id);

  return {
    credential_id: target.credentialId,
    model_id: target.modelId,
    enabled: true,
    extras
  };
}
