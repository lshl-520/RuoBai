export function guessModelCapabilities(modelId) {
  const name = String(modelId || '').trim().toLowerCase();
  const result = new Set();

  const pureGeneration =
    name.includes('tts') ||
    name.includes('dall-e') ||
    name.includes('image') ||
    name.includes('wanx') ||
    name.includes('万相');

  if (!pureGeneration) {
    result.add('chat');
  }

  if (
    name.includes('vl') ||
    name.includes('vision') ||
    name.includes('omni') ||
    name.includes('multimodal') ||
    name.includes('4o') ||
    name.includes('5o') ||
    name.includes('gpt-4') ||
    name.includes('gpt-5') ||
    name.includes('claude-3') ||
    name.includes('claude-4') ||
    name.includes('claude-opus') ||
    name.includes('claude-sonnet') ||
    name.includes('claude-haiku')
  ) {
    result.add('vision');
  }

  if (
    name.includes('image') ||
    name.includes('dall-e') ||
    name.includes('万相') ||
    name.includes('wanx') ||
    name.includes('sd') ||
    name.includes('flux') ||
    name.includes('midjourney') ||
    name.includes('doubao-seed-image')
  ) {
    result.add('image');
  }

  if (
    name.includes('tts') ||
    name.includes('voice') ||
    name.includes('speech') ||
    name.includes('音色')
  ) {
    result.add('tts');
  }

  if (
    name.includes('realtime') ||
    name.includes('omni') ||
    name.includes('live')
  ) {
    result.add('realtime');
  }

  return [...result];
}
