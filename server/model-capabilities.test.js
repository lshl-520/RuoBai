import test from 'node:test';
import assert from 'node:assert/strict';
import { guessModelCapabilities } from './model-capabilities.js';

test('GPT-5 models are available for image understanding', () => {
  assert.deepEqual(guessModelCapabilities('gpt-5.6-terra'), ['chat', 'vision']);
});

test('Grok 4.5 is available for image understanding but not image generation', () => {
  assert.deepEqual(guessModelCapabilities('grok-4.5'), ['chat', 'vision']);
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
