import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutoMomentsService, startAutoMomentsScheduler } from './auto-moments.js';

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function createFixture({
  imageEnabled = false,
  todayCount = 0,
  lastPostedAt = null,
  imageFails = false
} = {}) {
  const calls = [];
  const inserted = [];
  const character = {
    id: 61,
    user_id: 19,
    name: '林夏',
    persona: '温柔又有一点小傲娇',
    auto_moments_daily_max: 4,
    auto_moments_min_interval_hours: 6,
    auto_moments_last_posted_at: lastPostedAt
  };

  const db = {
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      if (sql.includes('FROM characters') && sql.includes('auto_moments_enabled = 1')) return [[character]];
      if (sql.includes('SELECT COUNT(*) AS cnt')) return [[{ cnt: todayCount }]];
      if (sql.includes('FROM capability_assignments') && params[1] === 'chat') {
        return [[{
          id: 1,
          capability: 'chat',
          api_base: 'https://chat.example.com/v1',
          api_key: 'CHAT_TOKEN',
          model: 'gpt-test'
        }]];
      }
      if (sql.includes('FROM capability_assignments') && params[1] === 'image') {
        return [imageEnabled ? [{
          id: 2,
          capability: 'image',
          provider_type: 'openai-compatible',
          api_base: 'https://image.example.com/v1',
          api_key: 'IMAGE_TOKEN',
          model: 'gpt-image-selected',
          extras: '{"size":"1024x1024"}'
        }] : []];
      }
      if (sql.includes('FROM messages')) {
        return [[
          { role: 'assistant', content: '今天下班早点回来。' },
          { role: 'user', content: '好，晚上陪你。' }
        ]];
      }
      if (sql.includes('FROM memories')) return [[{ tag: '约定', category: 'relationship', content: '晚上一起聊天' }]];
      if (sql.includes('INSERT INTO moments')) {
        inserted.push({ params });
        return [{ insertId: 9001 }];
      }
      if (sql.includes('UPDATE characters SET auto_moments_last_posted_at')) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected query: ${sql}`);
    }
  };

  let chatRequest = null;
  const fetchImpl = async (url, options) => {
    chatRequest = { url, options, body: JSON.parse(options.body) };
    return jsonResponse({ choices: [{ message: { content: '下班后的风有点软，等你回来一起说说话。' } }] });
  };

  const imageCalls = [];
  const generateImageImpl = async (subject, options) => {
    imageCalls.push({ subject, options });
    if (imageFails) throw new Error('图片上游暂时不可用');
    return '/user_assets/chat/auto-moment.png';
  };

  return { db, calls, inserted, fetchImpl, getChatRequest: () => chatRequest, generateImageImpl, imageCalls };
}

test('scheduler starts without legacy AGNES_AI_KEY and uses fixed scan timers', () => {
  const timers = [];
  const logger = { log() {}, warn() {}, error() {} };
  const service = startAutoMomentsScheduler({
    db: { query: async () => [[]] },
    logger,
    setTimeoutImpl: (fn, ms) => { timers.push({ type: 'timeout', fn, ms }); return { unref() {} }; },
    setIntervalImpl: (fn, ms) => { timers.push({ type: 'interval', fn, ms }); return { unref() {} }; }
  });

  assert.equal(typeof service.runScan, 'function');
  assert.deepEqual(timers.map(item => [item.type, item.ms]), [
    ['timeout', 15_000],
    ['interval', 600_000]
  ]);
});

test('enabled character reads selected chat capability plus recent chat and memories, then posts', async () => {
  const fixture = createFixture();
  const service = createAutoMomentsService({
    db: fixture.db,
    fetchImpl: fixture.fetchImpl,
    generateImageImpl: fixture.generateImageImpl,
    now: () => new Date('2026-07-21T12:00:00+08:00'),
    logger: { log() {}, warn() {}, error() {} }
  });

  const [result] = await service.runScan({ characterId: 61 });
  const request = fixture.getChatRequest();

  assert.equal(result.status, 'posted');
  assert.equal(request.url, 'https://chat.example.com/v1/chat/completions');
  assert.equal(request.body.model, 'gpt-test');
  assert.match(request.body.messages[1].content, /今天下班早点回来/);
  assert.match(request.body.messages[1].content, /晚上一起聊天/);
  assert.equal(fixture.inserted.length, 1);
  assert.equal(fixture.inserted[0].params[3], null);
  assert.ok(fixture.calls.some(call => call.sql.includes('auto_moments_last_posted_at = NOW()')));
});

test('disabled image capability publishes text without calling image generation', async () => {
  const fixture = createFixture({ imageEnabled: false });
  const service = createAutoMomentsService({
    db: fixture.db,
    fetchImpl: fixture.fetchImpl,
    generateImageImpl: fixture.generateImageImpl,
    logger: { log() {}, warn() {}, error() {} }
  });

  const [result] = await service.runScan({ characterId: 61, ignoreLimits: true });
  assert.equal(result.status, 'posted');
  assert.deepEqual(result.images, []);
  assert.equal(fixture.imageCalls.length, 0);
});

test('enabled image capability uses exactly the model selected in her capabilities', async () => {
  const fixture = createFixture({ imageEnabled: true });
  const service = createAutoMomentsService({
    db: fixture.db,
    fetchImpl: fixture.fetchImpl,
    generateImageImpl: fixture.generateImageImpl,
    logger: { log() {}, warn() {}, error() {} }
  });

  const [result] = await service.runScan({ characterId: 61, ignoreLimits: true });
  assert.equal(result.status, 'posted');
  assert.deepEqual(result.images, ['/user_assets/chat/auto-moment.png']);
  assert.equal(fixture.imageCalls.length, 1);
  assert.equal(fixture.imageCalls[0].options.providerType, 'openai-compatible');
  assert.equal(fixture.imageCalls[0].options.apiBase, 'https://image.example.com/v1');
  assert.equal(fixture.imageCalls[0].options.apiKey, 'IMAGE_TOKEN');
  assert.equal(fixture.imageCalls[0].options.model, 'gpt-image-selected');
});

test('image generation failure still publishes the text moment', async () => {
  const fixture = createFixture({ imageEnabled: true, imageFails: true });
  const service = createAutoMomentsService({
    db: fixture.db,
    fetchImpl: fixture.fetchImpl,
    generateImageImpl: fixture.generateImageImpl,
    sleepImpl: async () => {},
    logger: { log() {}, warn() {}, error() {} }
  });

  const [result] = await service.runScan({ characterId: 61, ignoreLimits: true });
  assert.equal(result.status, 'posted');
  assert.deepEqual(result.images, []);
  assert.equal(fixture.imageCalls.length, 2);
  assert.equal(fixture.inserted[0].params[3], null);
});

test('daily limit and minimum interval prevent duplicate automatic moments', async () => {
  const dailyFixture = createFixture({ todayCount: 4 });
  const dailyService = createAutoMomentsService({
    db: dailyFixture.db,
    fetchImpl: dailyFixture.fetchImpl,
    logger: { log() {}, warn() {}, error() {} }
  });
  const [dailyResult] = await dailyService.runScan({ characterId: 61 });
  assert.equal(dailyResult.status, 'skipped_daily_limit');
  assert.equal(dailyFixture.inserted.length, 0);

  const intervalFixture = createFixture({ lastPostedAt: '2026-07-21 10:00:00' });
  const intervalService = createAutoMomentsService({
    db: intervalFixture.db,
    fetchImpl: intervalFixture.fetchImpl,
    now: () => new Date('2026-07-21T12:00:00+08:00'),
    logger: { log() {}, warn() {}, error() {} }
  });
  const [intervalResult] = await intervalService.runScan({ characterId: 61 });
  assert.equal(intervalResult.status, 'skipped_interval');
  assert.equal(intervalFixture.inserted.length, 0);
});


test('automatic moment retries a failed image round and stops after success', async () => {
  const fixture = createFixture({ imageEnabled: true });
  let attempts = 0;
  const waits = [];
  const service = createAutoMomentsService({
    db: fixture.db,
    fetchImpl: fixture.fetchImpl,
    generateImageImpl: async (_subject, options) => {
      attempts += 1;
      assert.equal(options.providerType, 'openai-compatible');
      if (attempts === 1) throw new Error('中转临时 502');
      return '/user_assets/chat/retry-success.png';
    },
    sleepImpl: async ms => waits.push(ms),
    logger: { log() {}, warn() {}, error() {} }
  });

  const [result] = await service.runScan({ characterId: 61, ignoreLimits: true });
  assert.equal(result.status, 'posted');
  assert.equal(attempts, 2);
  assert.deepEqual(waits, [30_000]);
  assert.deepEqual(result.images, ['/user_assets/chat/retry-success.png']);
});
