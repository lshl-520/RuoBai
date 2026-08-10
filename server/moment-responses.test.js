import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMomentResponsePrompt,
  createMomentResponseService,
  parseMomentResponsePlan
} from './moment-responses.js';

const candidate = {
  userId: 1,
  momentId: 11,
  momentContent: '今天路过了一家很安静的小店，忽然想和你分享。',
  characterId: 6,
  characterName: '小白',
  persona: '温柔但克制的陪伴者'
};

test('动态回应决策只接受 comment 或 skip，并限制评论长度', () => {
  assert.deepEqual(parseMomentResponsePlan('{"action":"skip"}'), { action: 'skip' });
  assert.deepEqual(parseMomentResponsePlan('```json\n{"action":"comment","content":"听起来像是一个很适合慢慢走一会儿的地方。"}\n```'), {
    action: 'comment',
    content: '听起来像是一个很适合慢慢走一会儿的地方。'
  });
  assert.throws(() => parseMomentResponsePlan('{"action":"comment"}'), /没有提供内容/);
  assert.throws(() => parseMomentResponsePlan('不是 JSON'), /JSON/);
});

test('动态回应提示词明确允许不回应，且只使用被分享动态的内容', () => {
  const prompt = buildMomentResponsePrompt(candidate);
  assert.match(prompt, /明确把一条私人动态分享给你/);
  assert.match(prompt, /选择 skip/);
  assert.match(prompt, /今天路过了一家很安静的小店/);
  assert.doesNotMatch(prompt, /最近聊天/);
});

test('扫描每轮最多处理每个角色一条动态，并将角色评论关联回生活事件', async () => {
  const calls = { models: [], events: [], comments: [], lifeEvents: [] };
  const repository = {
    listCandidates: async () => [
      candidate,
      { ...candidate, momentId: 12, momentContent: '同一轮的第二条动态' },
      { ...candidate, characterId: 7, characterName: '小师', momentId: 13 }
    ],
    getModelConfig: async (userId, characterId) => {
      calls.models.push({ userId, characterId });
      return { api_base: 'https://api.example.test', api_key: 'test-key', provider_type: 'openai', model: 'test-chat' };
    },
    reserveEvent: async item => {
      const event = { id: 100 + item.momentId, momentId: item.momentId };
      calls.events.push(event);
      return { created: true, id: event.id };
    },
    markEventSkipped: async () => { throw new Error('这次模型没有选择跳过'); },
    markEventGenerationFailed: async () => { throw new Error('这次模型不应失败'); },
    saveCommentAndCompleteEvent: async ({ eventId, candidate: item, content }) => {
      calls.comments.push({ eventId, momentId: item.momentId, characterId: item.characterId, content });
      return { id: eventId + 1000, content };
    }
  };
  const service = createMomentResponseService({
    db: {},
    repository,
    fetchImpl: async (_url, options) => {
      const request = JSON.parse(options.body);
      assert.equal(request.model, 'test-chat');
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: '{"action":"comment","content":"这个画面听起来很安静，我喜欢你想到我。"}' } }] })
      };
    },
    recordLifeEvent: async (_db, event) => calls.lifeEvents.push(event)
  });

  const summary = await service.runScan();

  assert.equal(summary.scanned, 3);
  assert.equal(summary.commented, 2);
  assert.equal(calls.models.length, 2);
  assert.deepEqual(calls.comments.map(item => item.momentId), [11, 13]);
  assert.deepEqual(calls.lifeEvents.map(item => item.relatedSourceId), [11, 13]);
  assert.ok(calls.lifeEvents.every(item => item.sourceType === 'comment'));
});

test('模型明确选择 skip 时保留审计，但不写角色评论', async () => {
  const skipped = [];
  const repository = {
    listCandidates: async () => [candidate],
    getModelConfig: async () => ({ api_base: 'https://api.example.test', api_key: 'test-key', provider_type: 'openai', model: 'test-chat' }),
    reserveEvent: async () => ({ created: true, id: 101 }),
    markEventSkipped: async id => skipped.push(id),
    markEventGenerationFailed: async () => { throw new Error('不应记录生成失败'); },
    saveCommentAndCompleteEvent: async () => { throw new Error('skip 不应写评论'); }
  };
  const service = createMomentResponseService({
    db: {},
    repository,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"action":"skip"}' } }] })
    }),
    recordLifeEvent: async () => { throw new Error('skip 不应写生活事件'); }
  });

  const summary = await service.runScan();

  assert.equal(summary.commented, 0);
  assert.equal(summary.skipped, 1);
  assert.deepEqual(skipped, [101]);
});

test('模型返回异常时记录 generation_failed，且不会写评论', async () => {
  const failures = [];
  const repository = {
    listCandidates: async () => [candidate],
    getModelConfig: async () => ({ api_base: 'https://api.example.test', api_key: 'test-key', provider_type: 'openai', model: 'test-chat' }),
    reserveEvent: async () => ({ created: true, id: 101 }),
    markEventSkipped: async () => { throw new Error('不应选择跳过'); },
    markEventGenerationFailed: async (id, error) => failures.push({ id, error }),
    saveCommentAndCompleteEvent: async () => { throw new Error('异常结果不应写评论'); }
  };
  const service = createMomentResponseService({
    db: {},
    repository,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '不是 JSON' } }] })
    }),
    recordLifeEvent: async () => { throw new Error('异常结果不应写生活事件'); }
  });

  const summary = await service.runScan();

  assert.equal(summary.failed, 1);
  assert.equal(failures.length, 1);
  assert.match(failures[0].error, /JSON/);
});
