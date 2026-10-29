function isDeepSeekFlashVision(name) {
  // DeepSeek V4.1 Flash (2026-09-10) has native multimodal vision.
  // Official id is deepseek-flash; older flash aliases may still be routed there.
  return name === 'deepseek-flash'
    || name.startsWith('deepseek-flash-')
    || /^deepseek-v4(?:\.1)?-flash(?:$|[-._])/i.test(name);
}

/**
 * 从模型名里读「家族 + 版本号」。
 *
 * ★ 2026/10/7：原来这里是对着模型名**逐版本枚举**白名单
 *   （`includes('gpt-4')`、`includes('gpt-5')`、`/^grok-4\.[5-9]/` …），
 *   结果是**每出一个新版本都要回来改一次代码**，漏一次业主就倒霉一次：
 *   · 2026/9/29 已踩过一次 —— 渠道上了 grok-4.6 / 4.7，白名单只写到 4.5，
 *     业主勾「看图」保存直接被拒。
 *   · 同一颗雷当时还留着：`[5-9]` 只吃一位数字 → `grok-4.10` 漏判；
 *     `includes('gpt-6')` 之后还有 `gpt-7`；`grok-5` 根本没写。
 *   所以改成**读出版本号再做数值比较**，新版本自动被认出来。
 *
 * @returns {{major:number, minor:number}|null} 例：'grok-4.10-preview' → {major:4, minor:10}
 */
function readFamilyVersion(name, family) {
  const match = new RegExp(`${family}-(\\d+)(?:\\.(\\d+))?`).exec(name);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: match[2] === undefined ? 0 : Number(match[2]),
  };
}

/** version >= major.minor（版本号缺失 → 不认，避免瞎放行）。 */
function isAtLeast(version, major, minor = 0) {
  if (!version) return false;
  if (version.major !== major) return version.major > major;
  return version.minor >= minor;
}

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
    // ── 数值化版本判断：新版本自动认出来，不用再回来改代码 ──
    // gpt-4 起都是多模态（gpt-4o / 4.1 / 5 / 6.1 / 7 …）；gpt-3.5 不认。
    isAtLeast(readFamilyVersion(name, 'gpt'), 4) ||
    // grok 的多模态是从 4.5 开始的 —— 4.4 及以前不认，不瞎放行。
    // 4.10 这种"两位小数"也认（旧写法 `[5-9]` 只吃一位数字，正好漏掉）。
    isAtLeast(readFamilyVersion(name, 'grok'), 4, 5) ||
    // claude 3 起都带视觉。
    isAtLeast(readFamilyVersion(name, 'claude'), 3) ||
    // 只有代号、没有版本号的，仍按名字认。
    name.includes('claude-opus') ||
    name.includes('claude-sonnet') ||
    name.includes('claude-haiku') ||
    isDeepSeekFlashVision(name)
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
