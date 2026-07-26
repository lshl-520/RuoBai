import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPersonaRuntimePrompt,
  classifyConversationScene,
  deriveNextPersonaRuntime,
  normalizePersonaRuntime,
} from './persona-runtime.js';

test('classifies a watermelon photo as a short life share', () => {
  assert.equal(classifyConversationScene({ content: '看看这个西瓜', messageType: 'image' }), 'share');
  assert.match(buildPersonaRuntimePrompt({}, { content: '看看这个西瓜', messageType: 'image' }), /先回应这件具体小事/);
});

test('classifies a short pet name and emotional complaint without forcing a long reply', () => {
  assert.equal(classifyConversationScene({ content: '宝' }), 'affection');
  assert.equal(classifyConversationScene({ content: '今天真的好累' }), 'emotion');
  assert.match(buildPersonaRuntimePrompt({}, { content: '今天真的好累' }), /先接住情绪/);
});

test('runtime state changes gently and keeps relationship dimensions intact', () => {
  const runtime = normalizePersonaRuntime({
    state_json: JSON.stringify({ mode: 'calm', warmth: 60, energy: 55, concern: 15 }),
    relationship_json: JSON.stringify({ familiarity: 70, trust: 76, safety: 82, tacit: 64, rituals: ['晚安'] }),
  });
  const next = deriveNextPersonaRuntime(runtime, { content: '今天有点难受' });

  assert.equal(next.state.mode, 'concerned');
  assert.ok(next.state.concern > runtime.state.concern);
  assert.equal(next.relationship.trust, 76);
  assert.deepEqual(next.relationship.rituals, ['晚安']);
});
