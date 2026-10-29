import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMomentResponsePrompt,
  createMomentResponseService,
  createMysqlMomentResponseRepository,
  parseMomentResponsePlan,
  startMomentResponseScheduler
} from './moment-responses.js';

const candidate = {
  userId: 1,
  momentId: 11,
  commentContent: '这家店我也去过，下次一起吗？',
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

test('动态回应提示词：回应的是他留的评论，且明确允许不回应', () => {
  const prompt = buildMomentResponsePrompt(candidate);
  assert.match(prompt, /留了一条评论给你/);
  assert.match(prompt, /选择 skip/);
  // 动态作为上下文，评论才是回应对象 —— 两个都要在，不能丢
  assert.match(prompt, /今天路过了一家很安静的小店/);
  assert.match(prompt, /这家店我也去过/);
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

// ────────────────────────────────────────────────────────────────
// ★ 2026/9/22：她自己的动态 + 你的评论 = 她能收到并回应
//   （旧查询写死 m.character_id IS NULL，她自己发的动态永远进不了候选）
// ────────────────────────────────────────────────────────────────

test('★ 候选查询不再把「角色自己的动态」排除在外', async () => {
  const queries = [];
  const repository = createMysqlMomentResponseRepository({
    query: async (sql, params) => {
      queries.push({ sql: String(sql), params });
      return [[]];
    }
  });
  await repository.listCandidates();

  const sql = queries[0].sql;
  // 不能有"只取用户动态"的硬条件
  assert.doesNotMatch(sql, /m\.character_id IS NULL/);
  // 必须覆盖两种情况：她自己的动态、以及用户分享给她的动态
  assert.match(sql, /c\.id = m\.character_id/);
  assert.match(sql, /moment_audiences/);
  // 候选对象改成评论
  assert.match(sql, /FROM moment_comments mc/);
  assert.match(sql, /mc\.character_id IS NULL/);
});

test('★ 你自己动态下的评论，也会成为她的候选（不是只有分享给她的）', async () => {
  const queries = [];
  const repository = createMysqlMomentResponseRepository({
    query: async (sql, params) => {
      queries.push({ sql: String(sql), params });
      if (String(sql).includes('FROM moment_comments mc')) {
        return [[{
          comment_id: 900,
          user_id: 1,
          comment_content: '这家店我也去过，下次一起吗？',
          comment_created_at: '2026-09-22 01:00:00',
          moment_id: 231,
          moment_content: '等你忙完的时候，灯还亮着，我也还在。',
          moment_character_id: 48,
          character_id: 48,
          character_name: '小白',
          persona: '温柔'
        }]];
      }
      return [[]];
    }
  });
  const candidates = await repository.listCandidates();
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].commentId, 900);
  assert.equal(candidates[0].commentContent, '这家店我也去过，下次一起吗？');
  assert.equal(candidates[0].momentContent, '等你忙完的时候，灯还亮着，我也还在。');
  assert.equal(candidates[0].characterId, 48);
});

test('动态回应调度器默认由角色页开关控制，不再要求环境变量必须为 true', () => {
  const previous = process.env.MOMENT_RESPONSES_ENABLED;
  delete process.env.MOMENT_RESPONSES_ENABLED;
  const timers = [];
  try {
    const scheduler = startMomentResponseScheduler({
      service: { runScan: async () => {} },
      setTimeoutImpl: callback => { timers.push({ type: 'timeout', callback }); },
      setIntervalImpl: callback => { timers.push({ type: 'interval', callback }); },
      logger: { info() {}, error() {} }
    });
    assert.equal(timers.length, 2);
    scheduler.stop();
  } finally {
    if (previous === undefined) delete process.env.MOMENT_RESPONSES_ENABLED;
    else process.env.MOMENT_RESPONSES_ENABLED = previous;
  }
});

test('动态回应调度器支持环境变量紧急关闭', () => {
  const previous = process.env.MOMENT_RESPONSES_ENABLED;
  const values = ['false', '0', 'off', 'no'];
  try {
    for (const value of values) {
      process.env.MOMENT_RESPONSES_ENABLED = value;
      let timerCount = 0;
      const scheduler = startMomentResponseScheduler({
        service: { runScan: async () => {} },
        setTimeoutImpl: () => { timerCount += 1; },
        setIntervalImpl: () => { timerCount += 1; },
        logger: { info() {}, error() {} }
      });
      assert.equal(timerCount, 0, '环境变量 ' + value + ' 应关闭调度器');
      scheduler.stop();
    }
  } finally {
    if (previous === undefined) delete process.env.MOMENT_RESPONSES_ENABLED;
    else process.env.MOMENT_RESPONSES_ENABLED = previous;
  }
});
