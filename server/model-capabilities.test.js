import test from 'node:test';
import assert from 'node:assert/strict';
import { guessModelCapabilities } from './model-capabilities.js';

test('GPT-5 models are available for image understanding', () => {
  assert.deepEqual(guessModelCapabilities('gpt-5.6-terra'), ['chat', 'vision']);
});

test('text-only and image-generation models keep their appropriate capabilities', () => {
  assert.deepEqual(guessModelCapabilities('deepseek-chat'), ['chat']);
  assert.deepEqual(guessModelCapabilities('doubao-seed-image'), ['image']);
});
