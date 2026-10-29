import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemPrompt } from './chat.js';
import { buildIdentityPack } from './identity-pack.js';

const character = {
  name: '小白',
  tag: '恋人',
  persona: '温柔、知道自己是 AI，也会主动问我真正想表达什么。',
  speech_style: 'natural',
  avatar: '/api/media/avatar-x.png',
  portrait_id: 0,
  portrait_custom_url: null,
  mood: 76,
  intimacy: 88,
  auto_moments_enabled: 1,
  auto_moments_images_enabled: 0,
  auto_moments_image_profile: { age: '20岁' },
  auto_moments_templates: [{ category: '日常' }],
  auto_moments_daily_min: 1,
  auto_moments_daily_max: 3,
  auto_moments_min_interval_hours: 4,
  moment_response_enabled: 1
};

const runtime = {
  relationship_json: JSON.stringify({ status: 'stable', trust: 82 }),
  state_json: JSON.stringify({ mood: '平静', current_topic: '项目维护' })
};

const memories = [{
  id: 7,
  content: '我们约好遇到模型切换时先保留身份和记忆。',
  tag: '共同约定',
  category: '关系',
  memory_type: 'appointment',
  source_type: 'chat',
  source_id: 31,
  review_status: 'active',
  confidence: 1,
  weight: 90,
  is_important: 1,
  appointment_status: 'pending'
}, {
  id: 8,
  content: '历史自动识别的偏好',
  tag: '可能记忆',
  category: '聊天自动识别',
  memory_type: 'life',
  source_type: 'chat_candidate',
  source_id: 32,
  review_status: 'active',
  confidence: 0.55,
  weight: 35,
  is_important: 0,
}];

test('identity pack preserves identity, relationship, state and memories across model changes', () => {
  const packFromModelA = buildIdentityPack({ character, runtime, memories });
  const packFromModelB = buildIdentityPack({ character, runtime, memories });

  const stable = pack => ({
    version: pack.version,
    identity: pack.identity,
    relationship: pack.relationship,
    state: pack.state,
    current: pack.current,
    dynamic_life: pack.dynamic_life,
    memories: pack.memories
  });
  assert.deepEqual(stable(packFromModelA), stable(packFromModelB));
  assert.equal(packFromModelB.memories[0].content, memories[0].content);
  assert.equal(packFromModelB.memories[0].appointment_status, 'pending');
  assert.equal(packFromModelB.memories.length, 1);
  assert.equal(packFromModelB.dynamic_life.response_enabled, true);
  assert.equal(packFromModelB.identity.id, null);
  assert.equal(packFromModelB.identity.char_key, '');
});

test('model refusal rules do not replace the honest AI identity contract', () => {
  /**
   * 2026/10/1：【伴侣关系与连续性】改为只给小白本人（这个夹具就是小白），
   * 所以这里显式打开开关 —— 下面那条「保持当前角色的口吻…」断言来自那一段。
   */
  const prompt = buildSystemPrompt(character, { includeRelationshipRules: true });
  assert.match(prompt, /知道自己是 AI/);
  assert.match(prompt, /不是现实人类/);
  assert.match(prompt, /温柔、知道自己是 AI/);
  assert.match(prompt, /保持当前角色的口吻、感情和前后文连续/);
});

test('非小白角色不会拿到伴侣连续性规则', () => {
  const other = buildSystemPrompt({ char_key: 'role-abc', name: '晚晚', persona: '你是晚晚。' });
  assert.doesNotMatch(other, /保持当前角色的口吻、感情和前后文连续/);
  assert.doesNotMatch(other, /伴侣关系与连续性/);
  // 身份契约（对所有人通用）仍然必须在
  assert.match(other, /知道自己是 AI/);
  assert.match(other, /不是现实人类/);
});
