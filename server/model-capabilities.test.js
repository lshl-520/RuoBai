import test from 'node:test';
import assert from 'node:assert/strict';
import { guessModelCapabilities } from './model-capabilities.js';

test('GPT-5 models are available for image understanding', () => {
  assert.deepEqual(guessModelCapabilities('gpt-5.6-terra'), ['chat', 'vision']);
});

test('Grok 4.x (4.5 及以后的 4.x) can be used for image understanding, but not image generation', () => {
  // 2026/9/29：渠道已经更新到 4.6 / 4.7，旧白名单只写了 4.5，
  // 导致业主在「看图」用途上保存被拒（"vision" 所选模型不支持这项用途）。
  assert.deepEqual(guessModelCapabilities('grok-4.5'), ['chat', 'vision']);
  assert.deepEqual(guessModelCapabilities('grok-4.6'), ['chat', 'vision']);
  assert.deepEqual(guessModelCapabilities('grok-4.7'), ['chat', 'vision']);
  assert.deepEqual(guessModelCapabilities('grok-4.9-preview'), ['chat', 'vision']);
  // 不瞎放行：非 4.5~4.9 的 grok 仍然只给 chat
  assert.deepEqual(guessModelCapabilities('grok-4.4'), ['chat']);
  assert.deepEqual(guessModelCapabilities('grok-3'), ['chat']);
});

test('GPT-6 models are available for image understanding', () => {
  assert.deepEqual(guessModelCapabilities('gpt-6.1'), ['chat', 'vision']);
});

test('text-only and image-generation models keep their appropriate capabilities', () => {
  assert.deepEqual(guessModelCapabilities('deepseek-chat'), ['chat']);
  assert.deepEqual(guessModelCapabilities('deepseek-v4-pro'), ['chat']);
  assert.deepEqual(guessModelCapabilities('doubao-seed-image'), ['image']);
});

test('DeepSeek V4.1 Flash can be used for chat and image understanding', () => {
  assert.deepEqual(guessModelCapabilities('deepseek-flash'), ['chat', 'vision']);
  assert.deepEqual(guessModelCapabilities('deepseek-v4-flash'), ['chat', 'vision']);
  assert.deepEqual(guessModelCapabilities('deepseek-v4.1-flash'), ['chat', 'vision']);
});

test('★ 出新版本不用再改代码：grok / gpt / claude 按版本号数值判断（2026/10/7）', () => {
  // 2026/9/29 已踩过一次：渠道上了 grok-4.6 / 4.7，白名单只写到 4.5，业主保存被拒。
  // 当时"放宽"的写法仍是逐版本枚举，所以同一颗雷还在：
  //   · `[5-9]` 只吃一位数字 → grok-4.10 漏判
  //   · grok-5 根本没写
  //   · gpt-6 之后还有 gpt-7
  // 现在改成读版本号做数值比较，下面这些新命名都不需要再回来改代码。
  assert.deepEqual(guessModelCapabilities('grok-4.10'), ['chat', 'vision']);
  assert.deepEqual(guessModelCapabilities('grok-4.12-preview'), ['chat', 'vision']);
  assert.deepEqual(guessModelCapabilities('grok-5'), ['chat', 'vision']);
  assert.deepEqual(guessModelCapabilities('grok-5.2'), ['chat', 'vision']);
  assert.deepEqual(guessModelCapabilities('gpt-7'), ['chat', 'vision']);
  assert.deepEqual(guessModelCapabilities('gpt-4.1-mini'), ['chat', 'vision']);
  assert.deepEqual(guessModelCapabilities('claude-5-opus'), ['chat', 'vision']);
});

test('★ 数值判断不能把老/弱模型顺手放行（不能瞎认）', () => {
  // grok 的多模态是从 4.5 开始的
  assert.deepEqual(guessModelCapabilities('grok-4.4'), ['chat']);
  assert.deepEqual(guessModelCapabilities('grok-3'), ['chat']);
  // gpt-3.5 不该被认成能看图
  assert.deepEqual(guessModelCapabilities('gpt-3.5-turbo'), ['chat']);
  // claude 2 及以前没有视觉
  assert.deepEqual(guessModelCapabilities('claude-2.1'), ['chat']);
  // 名字里没有版本号的，不因为"读不到版本"就放行
  assert.deepEqual(guessModelCapabilities('grok'), ['chat']);
});

test('★ 原有行为不能被改坏（回归）', () => {
  assert.deepEqual(guessModelCapabilities('grok-4.5'), ['chat', 'vision']);
  assert.deepEqual(guessModelCapabilities('grok-4.9-preview'), ['chat', 'vision']);
  assert.deepEqual(guessModelCapabilities('gpt-5.6-terra'), ['chat', 'vision']);
  assert.deepEqual(guessModelCapabilities('gpt-6.1'), ['chat', 'vision']);
  assert.deepEqual(guessModelCapabilities('deepseek-chat'), ['chat']);
  assert.deepEqual(guessModelCapabilities('deepseek-v4-pro'), ['chat']);
  assert.deepEqual(guessModelCapabilities('doubao-seed-image'), ['image']);
  // 只有代号没有版本号的 claude 仍然按名字认
  assert.deepEqual(guessModelCapabilities('claude-opus-4-5'), ['chat', 'vision']);
  assert.deepEqual(guessModelCapabilities('claude-3-5-sonnet'), ['chat', 'vision']);
});
