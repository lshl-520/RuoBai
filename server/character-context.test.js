import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCharacterContextPrompt,
  buildCharacterContextSnapshot,
  buildMemoryLayers,
  loadRecentLifeEvents,
} from './character-context.js';

test('character context separates immediate, recent, and confirmed long-term memory', () => {
  const layers = buildMemoryLayers({
    recentMessages: [
      { role: 'user', content: '我们约好下周一起看电影。' },
      { role: 'assistant', content: '我记下啦。' }
    ],
    memories: [
      {
        id: 1,
        content: '用户喜欢猫',
        memory_type: 'core',
        review_status: 'active',
        is_important: 1,
        source_type: 'chat',
        source_id: 9
      },
      {
        id: 2,
        content: '用户可能喜欢深夜散步',
        memory_type: 'life',
        review_status: 'candidate'
      },
      {
        id: 3,
        content: '历史自动识别的偏好',
        memory_type: 'life',
        review_status: 'active',
        source_type: 'chat_candidate'
      }
    ],
    recentLifeEvents: [{
      id: 5,
      title: '和小师约好下周看电影',
      event_type: 'appointment',
      status: 'active',
      source_refs: 'chat:9'
    }]
  });

  assert.equal(layers.immediate.length, 2);
  assert.equal(layers.longTerm.length, 1);
  assert.equal(layers.longTerm[0].content, '用户喜欢猫');
  assert.equal(layers.recentLife.some(item => item.content === '用户可能喜欢深夜散步'), false);
  assert.equal(layers.recentLife.some(item => item.content === '历史自动识别的偏好'), false);
  assert.equal(layers.recentLife.some(item => item.title === '和小师约好下周看电影'), true);
});

test('character context projects current emotion without overwriting the saved baseline', () => {
  const snapshot = buildCharacterContextSnapshot({
    character: { id: 22, name: '小师', persona: '温柔、认真' },
    personaRuntime: {
      state: { mode: 'calm', warmth: 65, energy: 60, concern: 20 },
      relationship: { familiarity: 52, trust: 55, safety: 60, tacit: 48, rituals: [] }
    },
    currentContent: '今天领导批评我了，有点委屈。',
    recentMessages: [{ role: 'user', content: '今天领导批评我了，有点委屈。' }]
  });

  assert.equal(snapshot.version, 'ruobai-context-v2.0.3');
  assert.equal(snapshot.turn.scene, 'emotion');
  assert.equal(snapshot.state.mode, 'concerned');
  assert.equal(snapshot.state.source, 'current_turn_projection');
  assert.equal(snapshot.relationship.trust, 55);
});

test('deep OS context exposes at most one confirmed continuity fact and never a candidate', () => {
  const snapshot = buildCharacterContextSnapshot({
    character: { name: '小师' },
    currentContent: '你还记得我们约好的电影吗？',
    personaRuntime: {},
    memories: [
      { content: '我们约好下周一起看电影', memory_type: 'appointment', review_status: 'active' },
      { content: '用户可能喜欢深夜散步', memory_type: 'life', review_status: 'candidate' }
    ]
  });

  const prompt = buildCharacterContextPrompt(snapshot, { consumer: 'os' });
  assert.match(prompt, /连续性事实/);
  assert.match(prompt, /约好下周一起看电影/);
  assert.doesNotMatch(prompt, /深夜散步/);
});

test('chat context identifies a role moment as the character\'s own recent dynamic', () => {
  const snapshot = buildCharacterContextSnapshot({
    character: { id: 7, name: '学习老师', persona: '' },
    recentLifeEvents: [{
      id: 12,
      title: '路上遇到一只慢悠悠的猫，心情也亮起来了。',
      event_type: 'life',
      status: 'active',
      source_refs: 'moment:76',
      character_moment_refs: 'moment:76'
    }],
    currentContent: '你发完那条动态之后，心情是不是好了一点？'
  });

  const prompt = buildCharacterContextPrompt(snapshot, { consumer: 'chat' });
  assert.match(prompt, /角色最近发布的动态/);
  assert.match(prompt, /慢悠悠的猫/);
});

test('chat context does not mislabel a shared user moment as the character\'s own dynamic', () => {
  const snapshot = buildCharacterContextSnapshot({
    character: { id: 7, name: '学习老师', persona: '' },
    recentLifeEvents: [{
      id: 13,
      title: '今天路上遇到一只慢悠悠的猫。',
      event_type: 'life',
      status: 'active',
      source_refs: 'moment:77'
    }],
    currentContent: '你看到我发的那条动态了吗？'
  });

  const prompt = buildCharacterContextPrompt(snapshot, { consumer: 'chat' });
  assert.match(prompt, /近期生活/);
  assert.doesNotMatch(prompt, /角色最近发布的动态/);
});

test('deep OS context does not fall back to an unrelated recent event', () => {
  const snapshot = buildCharacterContextSnapshot({
    character: { name: '学习老师' },
    currentContent: '今天突然想听一首歌。',
    recentLifeEvents: [{
      id: 14,
      title: '我们约好周末一起看电影。',
      event_type: 'appointment',
      status: 'active',
      source_refs: 'chat:88'
    }]
  });

  const prompt = buildCharacterContextPrompt(snapshot, { consumer: 'os' });
  assert.match(prompt, /没有足够可靠的连续性事实/);
  assert.doesNotMatch(prompt, /周末一起看电影/);
});

test('recent life event loading requires live source records and returns role moment metadata', async () => {
  const calls = [];
  const events = await loadRecentLifeEvents({
    query: async (sql, params) => {
      calls.push({ sql, params });
      return [[{
        id: 17,
        title: '学习老师发了一条动态',
        event_type: 'life',
        status: 'active',
        source_refs: 'moment:91,comment:92',
        character_moment_refs: 'moment:91'
      }]];
    }
  }, { userId: 19, characterId: 53, limit: 8 });

  assert.equal(events.length, 1);
  assert.equal(events[0].source_refs, 'moment:91,comment:92');
  assert.equal(events[0].character_moment_refs, 'moment:91');
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /msg\.is_active = 1/);
  assert.match(calls[0].sql, /candidate_mem\.source_type = 'chat_candidate'/);
  assert.match(calls[0].sql, /candidate_mem\.source_id = s\.source_id/);
  assert.match(calls[0].sql, /m\.is_deleted = 0/);
  assert.match(calls[0].sql, /moment_audiences/);
  assert.match(calls[0].sql, /mem\.is_deleted = 0/);
  assert.match(calls[0].sql, /COALESCE\(mem\.review_status, 'active'\) IN \('active', 'important'\)/);
  assert.match(calls[0].sql, /COALESCE\(mem\.source_type, 'manual'\) <> 'chat_candidate'/);
  assert.deepEqual(calls[0].params, [19, 19, 53, 8]);
});

test('recent life event loading degrades to an empty list when the legacy table is unavailable', async () => {
  const events = await loadRecentLifeEvents({ query: async () => { throw new Error('table unavailable'); } }, {
    userId: 1,
    characterId: 2
  });
  assert.deepEqual(events, []);
});
