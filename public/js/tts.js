import { getModelSettings, state } from './store.js';

export function getBrowserVoices() {
  if (!('speechSynthesis' in window)) return [];
  return window.speechSynthesis.getVoices().filter(voice => voice.lang.toLowerCase().startsWith('zh'));
}

export function speakBrowser(text) {
  if (!('speechSynthesis' in window) || !text.trim()) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'zh-CN';
  utterance.rate = Number(state.settings.ttsRate || 0.9);
  utterance.pitch = 1.1;
  const voices = getBrowserVoices();
  const selected = voices.find(voice => voice.voiceURI === state.settings.ttsVoiceURI);
  if (selected) utterance.voice = selected;
  window.speechSynthesis.speak(utterance);
}

export async function speakQwen(text) {
  if (!text.trim()) return;
  const settings = getModelSettings();
  const dashscope = settings.providers.dashscope;
  if (!dashscope?.apiKey) throw new Error('请先填写阿里云(DashScope) API Key。');

  const res = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${dashscope.apiKey}`
    },
    body: JSON.stringify({
      model: 'qwen-tts',
      input: { text },
      voice: state.settings.qwenVoiceId || 'qwen-tts-vd-bailian-voice-20260511143305690-0d51'
    })
  });
  if (!res.ok) throw new Error(await res.text().catch(() => '千问 TTS 请求失败'));
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.onended = () => URL.revokeObjectURL(url);
  await audio.play();
}

export async function speak(text) {
  if (!state.settings.ttsEnabled) return;
  if (state.settings.ttsEngine === 'qwen') return speakQwen(text);
  return speakBrowser(text);
}

export async function testSpeak() {
  await speak('我在呢。今天也会好好陪着你。');
}
