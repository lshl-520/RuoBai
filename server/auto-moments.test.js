import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAutoImagePrompt, buildFallbackDailyContent, calculateMomentSimilarity, createAutoMomentsService, hasRecentSimilarMoment, normalizeDailyMax, normalizeDailyMin, parseConversationMomentSummary, parseGeneratedMomentPlan, resolveDynamicImageTemplate, sanitizeGeneratedMoment, sanitizeConversationMomentSummary, startAutoMomentsScheduler } from './auto-moments.js';

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
  imageFails = false,
  dynamicEnabled = false,
  dynamicModel = 'gpt-image-dynamic',
  imageResolution = 'channel',
  imageProfile = null,
  templates = null,
  roleChatEnabled = false,
  plannerAttemptCount = 0,
  nextPlannerRetryAt = null,
  dailyMin = 0,
  dailyMax = 4,
  recentMoments = [],
  xiaobaiState = null
} = {}) {
  const calls = [];
  const inserted = [];
  const character = {
    id: 61,
    user_id: 19,
    name: '林夏',
    persona: '温柔又有一点小傲娇',
    chat_credential_id: roleChatEnabled ? 77 : null,
    chat_model_id: roleChatEnabled ? 'deepseek-role-model' : null,
    auto_moments_daily_min: dailyMin,
    auto_moments_daily_max: dailyMax,
    auto_moments_min_interval_hours: 6,
    auto_moments_last_posted_at: lastPostedAt,
    auto_moments_images_enabled: imageEnabled ? 1 : 0,
    auto_moments_image_resolution: imageResolution,
    auto_moments_image_profile: imageProfile,
    auto_moments_templates: templates
  };

  const db = {
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      if (sql.includes('FROM characters') && sql.includes('auto_moments_enabled = 1')) return [[character]];
      if (sql.includes('FROM auto_moment_attempts') && sql.includes('MAX(next_retry_at)')) {
        return [[{ cnt: plannerAttemptCount, next_retry_at: nextPlannerRetryAt }]];
      }
      if (sql.includes('SELECT COUNT(*) AS cnt')) return [[{ cnt: todayCount }]];
      if (sql.includes('INSERT INTO auto_moment_attempts')) return [{ insertId: 7001 }];
      if (sql.includes('UPDATE auto_moment_attempts')) return [{ affectedRows: 1 }];
      if (sql.includes('FROM credentials c') && sql.includes('INNER JOIN credential_models')) {
        return [roleChatEnabled ? [{
          id: 77,
          name: '角色专属 DeepSeek',
          provider_type: 'openai-compatible',
          api_base: 'https://role-chat.example.com/v1',
          api_key: 'ROLE_CHAT_TOKEN',
          model: 'deepseek-role-model'
        }] : []];
      }
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
      if (sql.includes('FROM capability_assignments') && params[1] === 'dynamic') {
        return [dynamicEnabled ? [{
          id: 3,
          capability: 'dynamic',
          provider_type: 'openai-compatible',
          api_base: 'https://dynamic-image.example.com/v1',
          api_key: 'DYNAMIC_IMAGE_TOKEN',
          model: dynamicModel,
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
      if (sql.includes('FROM character_runtime_states') && sql.includes('state_json')) {
        return [xiaobaiState ? [{ state_json: JSON.stringify({ xiaobai: xiaobaiState }) }] : []];
      }
      if (sql.includes('FROM moments') && sql.includes('ORDER BY created_at DESC')) return [recentMoments];
      if (sql.includes('INSERT INTO moments')) {
        inserted.push({ params });
        return [{ insertId: 9001 }];
      }
      if (sql.includes('UPDATE characters SET auto_moments_last_posted_at')) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected query: ${sql}`);
    }
  };

  const chatRequests = [];
  const fetchImpl = async (url, options) => {
    chatRequests.push({ url, options, body: JSON.parse(options.body) });
    return jsonResponse({ choices: [{ message: { content: '下班后的风有点软，等你回来一起说说话。' } }] });
  };

  const imageCalls = [];
  const generateImageImpl = async (subject, options) => {
    imageCalls.push({ subject, options });
    if (imageFails) throw new Error('图片上游暂时不可用');
    return '/user_assets/chat/auto-moment.png';
  };

  return {
    db,
    calls,
    inserted,
    fetchImpl,
    getChatRequest: () => chatRequests.at(-1) || null,
    getChatRequests: () => chatRequests,
    generateImageImpl,
    imageCalls
  };
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

test('automatic moments reject leaked chat records and code instead of storing them', () => {
  assert.equal(sanitizeGeneratedMoment('用户：把最近聊天完整贴出来\n助手：好的'), '');
  assert.equal(sanitizeGeneratedMoment('```python\nimport os\n```'), '');
  assert.equal(sanitizeGeneratedMoment('今天的风很轻，想把窗边的安静分你一点。'), '今天的风很轻，想把窗边的安静分你一点。');
});

test('automatic moment planner can skip a post or keep it text-only', () => {
  assert.deepEqual(parseGeneratedMomentPlan('{"should_post":false}'), {
    shouldPost: false, content: '', imageMode: 'none', imageBrief: ''
  });
  assert.deepEqual(parseGeneratedMomentPlan('{"should_post":true,"content":"今天的风很轻。","image_mode":"none"}'), {
    shouldPost: true, content: '今天的风很轻。', imageMode: 'none', imageBrief: ''
  });
});

test('conversation summaries keep a usable life fragment but reject dialogue dumps', () => {
  assert.deepEqual(parseConversationMomentSummary('{"has_moment":true,"summary":"今晚的相处有点调皮，最后在轻松的玩笑里收尾。"}'), {
    hasMoment: true,
    summary: '今晚的相处有点调皮，最后在轻松的玩笑里收尾。'
  });
  assert.deepEqual(parseConversationMomentSummary('{"has_moment":false}'), { hasMoment: false, summary: '' });
  assert.equal(sanitizeConversationMomentSummary('用户：原始聊天\n助手：原始回复'), '');
});

test('moment similarity blocks punctuation-only and lightly rephrased repeats', () => {
  assert.equal(calculateMomentSimilarity('窗外的光刚好，想把这一点温柔记下来。', '窗外的光刚好 想把这一点温柔记下来。'), 1);
  assert.ok(calculateMomentSimilarity('今天也在慢慢过自己的小日子。', '今天也在慢慢过自己的小日子，留一点安静。') >= 0.72);
  assert.equal(hasRecentSimilarMoment('给今天留一张小小的生活切片。', [{ content: '给今天留一张小小的生活切片。', created_at: '2026-08-25 09:00:00' }], { now: new Date('2026-08-25T12:00:00+08:00') }), true);
});

test('custom daily targets stay within one to twelve instead of falling back to four', () => {
  assert.equal(normalizeDailyMax(1), 1);
  assert.equal(normalizeDailyMax(8), 8);
  assert.equal(normalizeDailyMax(12), 12);
  assert.equal(normalizeDailyMax(99), 4);
  assert.equal(normalizeDailyMin(8, 6), 6);
  assert.equal(normalizeDailyMin(0, 6), 0);
});

test('fixed daily target asks for a safe ordinary post while system mode may skip', async () => {
  const targetFixture = createFixture({ dailyMin: 2, dailyMax: 2 });
  const targetService = createAutoMomentsService({
    db: targetFixture.db,
    fetchImpl: targetFixture.fetchImpl,
    generateImageImpl: targetFixture.generateImageImpl,
    logger: { log() {}, warn() {}, error() {} }
  });
  await targetService.runScan({ characterId: 61 });
  const targetPrompt = targetFixture.getChatRequest().body.messages[0].content;
  assert.match(targetPrompt, /每日发布目标/);
  assert.match(targetPrompt, /改从人设和生活模板写一条普通日常/);

  const systemFixture = createFixture({ dailyMin: 0, dailyMax: 6 });
  const systemService = createAutoMomentsService({
    db: systemFixture.db,
    fetchImpl: systemFixture.fetchImpl,
    generateImageImpl: systemFixture.generateImageImpl,
    logger: { log() {}, warn() {}, error() {} }
  });
  await systemService.runScan({ characterId: 61 });
  assert.doesNotMatch(systemFixture.getChatRequest().body.messages[0].content, /每日发布目标/);
});

test('automatic moment planner skips publishing and image generation when there is nothing worth posting', async () => {
  const fixture = createFixture({ imageEnabled: true, dynamicEnabled: true });
  const service = createAutoMomentsService({
    db: fixture.db,
    fetchImpl: async () => jsonResponse({ choices: [{ message: { content: '{"should_post":false}' } }] }),
    generateImageImpl: fixture.generateImageImpl,
    logger: { log() {}, warn() {}, error() {} }
  });

  const [result] = await service.runScan({ characterId: 61, ignoreLimits: true });
  assert.equal(result.status, 'skipped_planner');
  assert.equal(fixture.inserted.length, 0);
  assert.equal(fixture.imageCalls.length, 0);
});

test('automatic moments summarize recent chat first and keep raw chat out of the publication request', async () => {
  const fixture = createFixture();
  const service = createAutoMomentsService({
    db: fixture.db,
    fetchImpl: fixture.fetchImpl,
    generateImageImpl: fixture.generateImageImpl,
    now: () => new Date('2026-07-21T12:00:00+08:00'),
    logger: { log() {}, warn() {}, error() {} }
  });

  const [result] = await service.runScan({ characterId: 61 });
  const [summaryRequest, publicationRequest] = fixture.getChatRequests();

  assert.equal(result.status, 'posted');
  assert.equal(summaryRequest.url, 'https://chat.example.com/v1/chat/completions');
  assert.equal(publicationRequest.body.model, 'gpt-test');
  assert.match(summaryRequest.body.messages[1].content, /今天下班早点回来/);
  assert.match(publicationRequest.body.messages[1].content, /聊天生活摘要/);
  assert.doesNotMatch(publicationRequest.body.messages[1].content, /今天下班早点回来/);
  assert.doesNotMatch(publicationRequest.body.messages[1].content, /晚上一起聊天/);
  assert.match(publicationRequest.body.messages[1].content, /已确认记忆标签/);
  assert.equal(fixture.inserted.length, 1);
  assert.equal(fixture.inserted[0].params[2], '下班后的风有点软，等你回来一起说说话。');
  assert.equal(fixture.inserted[0].params[3], null);
  assert.equal(fixture.inserted[0].params[4], 'disabled');
  assert.match(fixture.calls.find(call => call.sql.includes('INSERT INTO moments')).sql, /publisher/);
  assert.ok(fixture.calls.some(call => call.sql.includes('auto_moments_last_posted_at = NOW()')));
});

test('a close conversation becomes an indirect life moment instead of ending the dynamic flow', async () => {
  const fixture = createFixture();
  const replies = [
    '{"has_moment":true,"summary":"今晚的相处有点调皮，最后在轻松的玩笑里收尾。"}',
    '{"should_post":true,"content":"今晚的空气有点甜，笑着闹着就把一天收好了。","image_mode":"none"}'
  ];
  const requests = [];
  const service = createAutoMomentsService({
    db: fixture.db,
    fetchImpl: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return jsonResponse({ choices: [{ message: { content: replies.shift() } }] });
    },
    logger: { log() {}, warn() {}, error() {} }
  });

  const [result] = await service.runScan({ characterId: 61 });
  const publicationInput = requests[1].body.messages[1].content;
  assert.equal(result.status, 'posted');
  assert.match(publicationInput, /今晚的相处有点调皮/);
  assert.doesNotMatch(publicationInput, /今天下班早点回来/);
  assert.equal(fixture.inserted[0].params[2], '今晚的空气有点甜，笑着闹着就把一天收好了。');
});

test('automatic moments exclude unconfirmed memory candidates from their context', async () => {
  const fixture = createFixture();
  const service = createAutoMomentsService({
    db: fixture.db,
    fetchImpl: fixture.fetchImpl,
    logger: { log() {}, warn() {}, error() {} }
  });

  await service.runScan({ characterId: 61 });
  const memoryQuery = fixture.calls.find(call => call.sql.includes('FROM memories'));
  assert.match(memoryQuery.sql, /COALESCE\(review_status, 'active'\) IN \('active', 'important'\)/);
  assert.match(memoryQuery.sql, /COALESCE\(source_type, 'manual'\) <> 'chat_candidate'/);
});

test('automatic moments skip a repeated post before image generation or publishing', async () => {
  const repeated = '窗外的光刚好，想把这一点温柔记下来。';
  const fixture = createFixture({ recentMoments: [{ content: repeated, created_at: '2026-07-21 11:00:00' }] });
  const service = createAutoMomentsService({
    db: fixture.db,
    fetchImpl: async () => jsonResponse({ choices: [{ message: { content: JSON.stringify({ should_post: true, content: repeated, image_mode: 'none' }) } }] }),
    generateImageImpl: fixture.generateImageImpl,
    now: () => new Date('2026-07-21T12:00:00+08:00'),
    logger: { log() {}, warn() {}, error() {} }
  });
  const [result] = await service.runScan({ characterId: 61 });
  assert.equal(result.status, 'skipped_duplicate');
  assert.equal(fixture.inserted.length, 0);
  assert.equal(fixture.imageCalls.length, 0);
  const auditUpdate = fixture.calls.find(call => call.sql.includes('UPDATE auto_moment_attempts'));
  assert.equal(auditUpdate.params[0], 'duplicate_skipped');
});

test('automatic moments prefer the character selected chat model over the user default', async () => {
  const fixture = createFixture({ roleChatEnabled: true });
  const service = createAutoMomentsService({
    db: fixture.db,
    fetchImpl: fixture.fetchImpl,
    generateImageImpl: fixture.generateImageImpl,
    logger: { log() {}, warn() {}, error() {} }
  });

  const [result] = await service.runScan({ characterId: 61 });
  const request = fixture.getChatRequest();
  assert.equal(result.status, 'posted');
  assert.equal(request.url, 'https://role-chat.example.com/v1/chat/completions');
  assert.equal(request.body.model, 'deepseek-role-model');
  assert.equal(fixture.calls.some(call => call.sql.includes('FROM capability_assignments') && call.params[1] === 'chat'), false);
  const attemptInsert = fixture.calls.find(call => call.sql.includes('INSERT INTO auto_moment_attempts'));
  assert.equal(attemptInsert.params[2], '角色专属 DeepSeek');
  assert.equal(attemptInsert.params[4], 'deepseek-role-model');
});

test('planner skip is audited and a recent paid attempt enters cooldown', async () => {
  const skippedFixture = createFixture();
  const skippedService = createAutoMomentsService({
    db: skippedFixture.db,
    fetchImpl: async () => jsonResponse({ choices: [{ message: { content: '{"should_post":false}' } }] }),
    logger: { log() {}, warn() {}, error() {} }
  });
  const [skipped] = await skippedService.runScan({ characterId: 61 });
  assert.equal(skipped.status, 'skipped_planner');
  const auditUpdate = skippedFixture.calls.find(call => call.sql.includes('UPDATE auto_moment_attempts'));
  assert.equal(auditUpdate.params[0], 'planner_skipped');

  const cooldownFixture = createFixture({ nextPlannerRetryAt: '2026-07-21 12:30:00' });
  const cooldownService = createAutoMomentsService({
    db: cooldownFixture.db,
    fetchImpl: cooldownFixture.fetchImpl,
    now: () => new Date('2026-07-21T12:00:00+08:00'),
    logger: { log() {}, warn() {}, error() {} }
  });
  const [cooldown] = await cooldownService.runScan({ characterId: 61 });
  assert.equal(cooldown.status, 'skipped_planner_cooldown');
  assert.equal(cooldownFixture.getChatRequest(), null);
});

test('automatic moments stop after six paid planner attempts in one day', async () => {
  const fixture = createFixture({ plannerAttemptCount: 6 });
  const service = createAutoMomentsService({
    db: fixture.db,
    fetchImpl: fixture.fetchImpl,
    logger: { log() {}, warn() {}, error() {} }
  });
  const [result] = await service.runScan({ characterId: 61 });
  assert.equal(result.status, 'skipped_planner_daily_limit');
  assert.equal(fixture.getChatRequest(), null);
});

test('a fixed target of six reserves additional planner attempts for image retries', async () => {
  const fixture = createFixture({ dailyMin: 6, dailyMax: 6, plannerAttemptCount: 8 });
  const service = createAutoMomentsService({
    db: fixture.db,
    fetchImpl: fixture.fetchImpl,
    generateImageImpl: fixture.generateImageImpl,
    logger: { log() {}, warn() {}, error() {} }
  });

  const [result] = await service.runScan({ characterId: 61 });
  assert.equal(result.status, 'posted');
  assert.equal(fixture.getChatRequests().length, 2);
});

test('planner upstream failure is audited without storing response text', async () => {
  const fixture = createFixture();
  const service = createAutoMomentsService({
    db: fixture.db,
    fetchImpl: async () => new Response('temporary provider detail', { status: 503 }),
    logger: { log() {}, warn() {}, error() {} }
  });

  const [result] = await service.runScan({ characterId: 61 });
  assert.equal(result.status, 'failed');
  const auditUpdate = fixture.calls.find(call => call.sql.includes('UPDATE auto_moment_attempts'));
  assert.equal(auditUpdate.params[0], 'planner_failed');
  assert.equal(auditUpdate.params[2], 'upstream');
  assert.equal(auditUpdate.params.some(value => String(value).includes('temporary provider detail')), false);
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

test('manual dynamic-channel testing never creates a text-only moment when image posting is disabled', async () => {
  const fixture = createFixture({ imageEnabled: false });
  const service = createAutoMomentsService({
    db: fixture.db,
    fetchImpl: fixture.fetchImpl,
    generateImageImpl: fixture.generateImageImpl,
    logger: { log() {}, warn() {}, error() {} }
  });

  const [result] = await service.runScan({ characterId: 61, ignoreLimits: true, forceChannelTest: true });
  assert.equal(result.status, 'skipped_image_disabled');
  assert.equal(fixture.imageCalls.length, 0);
  assert.equal(fixture.inserted.length, 0);
});

test('automatic moments do not publish text when their dedicated dynamic image capability is unavailable', async () => {
  const fixture = createFixture({ imageEnabled: true });
  const service = createAutoMomentsService({
    db: fixture.db,
    fetchImpl: fixture.fetchImpl,
    generateImageImpl: fixture.generateImageImpl,
    logger: { log() {}, warn() {}, error() {} }
  });

  const [result] = await service.runScan({ characterId: 61, ignoreLimits: true });
  assert.equal(result.status, 'skipped_image_unconfigured');
  assert.equal(result.imageStatus, 'dynamic_unconfigured');
  assert.equal(fixture.imageCalls.length, 0);
  assert.equal(fixture.inserted.length, 0);
});

test('enabled dynamic capability uses exactly the model selected for automatic moments', async () => {
  const fixture = createFixture({ imageEnabled: true, dynamicEnabled: true });
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
  assert.equal(fixture.imageCalls[0].options.apiBase, 'https://dynamic-image.example.com/v1');
  assert.equal(fixture.imageCalls[0].options.apiKey, 'DYNAMIC_IMAGE_TOKEN');
  assert.equal(fixture.imageCalls[0].options.model, 'gpt-image-dynamic');
  assert.match(fixture.imageCalls[0].subject, /第一人称/);
  assert.match(fixture.imageCalls[0].subject, /不要出现任何第二个人/);
  assert.match(fixture.imageCalls[0].subject, /尤其不要陌生男性/);
  assert.match(fixture.imageCalls[0].subject, /不要要求用户上传自己的照片/);
  assert.equal(fixture.inserted[0].params[4], 'generated');
});

test('a fixed image target overrides a planner text-only choice and keeps private text out of the image request', async () => {
  const fixture = createFixture({ imageEnabled: true, dynamicEnabled: true, dailyMin: 6, dailyMax: 6 });
  const replies = [
    '{"has_moment":true,"summary":"今天的相处很轻松，适合留下一点日常感。"}',
    '{"should_post":true,"content":"今天想把这点轻松藏进晚风里。","image_mode":"none","image_brief":"来自聊天的私人细节"}'
  ];
  const service = createAutoMomentsService({
    db: fixture.db,
    fetchImpl: async (url, options) => {
      fixture.getChatRequests().push({ url, options, body: JSON.parse(options.body) });
      return jsonResponse({ choices: [{ message: { content: replies.shift() } }] });
    },
    generateImageImpl: fixture.generateImageImpl,
    logger: { log() {}, warn() {}, error() {} }
  });

  const [result] = await service.runScan({ characterId: 61 });
  const plannerPrompt = fixture.getChatRequest().body.messages[0].content;
  const imagePrompt = fixture.imageCalls[0].subject;

  assert.equal(result.status, 'posted');
  assert.equal(result.imageStatus, 'generated');
  assert.match(plannerPrompt, /image_mode 必须为 selfie 或 third_person/);
  assert.equal(fixture.imageCalls.length, 1);
  assert.doesNotMatch(imagePrompt, /今天想把这点轻松藏进晚风里/);
  assert.doesNotMatch(imagePrompt, /来自聊天的私人细节/);
});

test('automatic moments pass the saved image resolution preference to the dynamic channel', async () => {
  const fixture = createFixture({ imageEnabled: true, dynamicEnabled: true, dynamicModel: 'gpt-image-2', imageResolution: '2k' });
  const service = createAutoMomentsService({
    db: fixture.db,
    fetchImpl: fixture.fetchImpl,
    generateImageImpl: fixture.generateImageImpl,
    logger: { log() {}, warn() {}, error() {} }
  });

  const [result] = await service.runScan({ characterId: 61, ignoreLimits: true });
  assert.equal(result.status, 'posted');
  assert.equal(fixture.imageCalls[0].options.resolution, '2k');
  assert.match(fixture.inserted[0].params[7], /"resolution":"2k"/);
});

test('image generation failure is retried but never publishes a text-only automatic moment', async () => {
  const fixture = createFixture({ imageEnabled: true, dynamicEnabled: true, imageFails: true });
  const service = createAutoMomentsService({
    db: fixture.db,
    fetchImpl: fixture.fetchImpl,
    generateImageImpl: fixture.generateImageImpl,
    sleepImpl: async () => {},
    logger: { log() {}, warn() {}, error() {} }
  });

  const [result] = await service.runScan({ characterId: 61, ignoreLimits: true });
  assert.equal(result.status, 'skipped_image_failed');
  assert.deepEqual(result.images, []);
  assert.equal(fixture.imageCalls.length, 2);
  assert.equal(fixture.inserted.length, 0);
  assert.equal(result.imageStatus, 'failed');
});

test('automatic moment keeps fixed identity but resolves one allowed life template for each image', async () => {
  const fixture = createFixture({
    imageEnabled: true,
    dynamicEnabled: true,
    imageProfile: JSON.stringify({
      name: '小白', age_feel: '20岁左右', temperament: ['温柔', '安静'], hair: ['白银色']
    }),
    templates: JSON.stringify({
      categories: ['自拍'], selfie_scenes: ['镜子自拍', '做饭自拍'], poses: ['回眸'], moods: ['放松'], custom: ['雨天撑伞']
    })
  });
  const service = createAutoMomentsService({
    db: fixture.db,
    fetchImpl: fixture.fetchImpl,
    generateImageImpl: fixture.generateImageImpl,
    random: () => 0,
    logger: { log() {}, warn() {}, error() {} }
  });

  const [result] = await service.runScan({ characterId: 61, ignoreLimits: true });
  const plannerPrompt = fixture.getChatRequest().body.messages[0].content;
  assert.equal(result.imageStatus, 'generated');
  assert.match(plannerPrompt, /固定形象：姓名：小白/);
  assert.match(plannerPrompt, /自拍场景：镜子自拍、做饭自拍/);
  assert.match(fixture.imageCalls[0].subject, /角色固定形象：姓名：小白/);
  assert.match(fixture.imageCalls[0].subject, /场景：镜子自拍；姿势：自然地转过头看向镜头；心情：放松/);
  assert.match(fixture.imageCalls[0].subject, /只生成一张完整的单幅照片/);
  assert.doesNotMatch(fixture.imageCalls[0].subject, /做饭自拍/);
});

test('image prompt carries real-person body/镜头/pose constraints', () => {
  const character = {
    name: '小白',
    auto_moments_templates: JSON.stringify({ selfie_scenes: ['阳台自拍'], poses: ['双手托脸'], moods: ['生病'] })
  };
  const plan = { imageMode: 'selfie' };
  const resolved = resolveDynamicImageTemplate(character, plan, () => 0, []);
  const prompt = buildAutoImagePrompt(character, '今天想你了。', plan, resolved);

  // 真人硬约束：正常头身比 + 不要日漫脸 + 不要病态道具
  assert.match(prompt, /约 7 到 7\.5 个头高/);
  assert.match(prompt, /严禁大头、宽脸/);
  assert.match(prompt, /创可贴、退烧贴、纸巾/);
  assert.match(prompt, /不是二次元角色/);
  assert.match(prompt, /不要回眸定格、双手托脸/);
  // 画面里只能有她一个人：不存在拍照的人（第三人称一律走支架/定时拍摄）
  assert.match(prompt, /画面里只有她一个人/);
  assert.match(prompt, /不存在给她拍照的人/);
  // 姿势词被翻译成生活动作，原始日漫词不再直接进图片提示词
  assert.match(prompt, /姿势：手轻轻搭在脸颊旁边，随意放松/);
  assert.doesNotMatch(prompt, /姿势：双手托脸/);
});

test('third-person shots say the phone was on a tripod so no photographer exists', () => {
  const character = { name: '小白', auto_moments_templates: JSON.stringify({ selfie_scenes: ['阳台自拍'], moods: ['放松'] }) };
  const plan = { imageMode: 'third_person' };
  const resolved = resolveDynamicImageTemplate(character, plan, () => 0, []);
  const prompt = buildAutoImagePrompt(character, '今天天气很好。', plan, resolved);
  assert.equal(resolved.isSelfie, false);
  assert.match(prompt, /手机架在支架或桌面上定时拍/);
  assert.match(prompt, /画面里没有拍照的人，也没有第二个人/);
  assert.doesNotMatch(prompt, /不要要求用户上传自己的照片.*上传/);
});
test('★ 她自己的时间线会进动态规划器：没聊天也能按自己的时段写（2026/9/22 新增）', async () => {
  const fixture = createFixture({
    dynamicEnabled: true,
    imageEnabled: true,
    dailyMin: 1,
    xiaobaiState: {
      mood: 'calm', moodIntensity: 40, carriesOver: '', lastTopic: '闲聊', turnsSince: 0, scene: 'daily',
      life: { activity: '出门走一走', dayPart: '下午', energy: 62, sleeping: false, tickAt: '2026-09-22T15:00:00.000Z' }
    }
  });
  const service = createAutoMomentsService({
    db: fixture.db,
    fetchImpl: fixture.fetchImpl,
    generateImageImpl: fixture.generateImageImpl,
    random: () => 0,
    logger: { log() {}, warn() {}, error() {} }
  });
  await service.runScan({ characterId: 61, ignoreLimits: true });
  const plannerPrompt = fixture.getChatRequest().body.messages[0].content;
  assert.match(plannerPrompt, /【她自己的今天】/);
  // 时间线永远按「现在」重算，所以不能断言某个写死的时段。
  assert.match(plannerPrompt, /现在是(深夜|早上|上午|中午|下午|傍晚|晚上)，她/);
  assert.match(plannerPrompt, /她自己的精力大概 \d+\/100/);
});
test('★ 第三人称场景不再抽到「日常片段」这类分类词（2026/9/22 修复）', () => {
  const character = {
    name: '小白',
    auto_moments_templates: JSON.stringify({
      categories: ['日常片段', '和你有关'],
      selfie_scenes: ['镜子自拍', '做饭自拍', '阳台自拍'],
      custom: ['雨天撑伞'],
      moods: ['放松']
    })
  };
  const seen = new Set();
  for (let i = 0; i < 60; i++) {
    seen.add(resolveDynamicImageTemplate(character, { imageMode: 'third_person' }, Math.random, []).scene);
  }
  // 只允许出现真正的场景词
  for (const scene of seen) {
    assert.ok(!scene.includes('日常片段'), '分类词混进了第三人称场景：' + scene);
    assert.ok(!scene.includes('和你有关'), '分类词混进了第三人称场景：' + scene);
    assert.ok(!scene.includes('自拍'), '构图词混进了第三人称场景：' + scene);
  }
  // 分类词全被过滤、只剩真场景时，仍然有可用的场景
  const onlyCategory = {
    name: '小白',
    auto_moments_templates: JSON.stringify({ categories: ['日常片段'], selfie_scenes: ['日常片段'], moods: ['放松'] })
  };
  const fallback = resolveDynamicImageTemplate(onlyCategory, { imageMode: 'third_person' }, () => 0, []);
  assert.ok(fallback.scene && !fallback.scene.includes('日常片段'));
});


test('image composition alternates between selfie and third-person instead of being 98% selfies', () => {
  const character = { name: '小白', auto_moments_templates: JSON.stringify({ selfie_scenes: ['阳台自拍'], moods: ['放松'] }) };
  const selfieMeta = JSON.stringify({ composition: 'selfie' });
  const thirdMeta = JSON.stringify({ composition: 'third_person' });

  // 上一次是第三人称 → 这次回到自拍
  const backToSelfie = resolveDynamicImageTemplate(character, { imageMode: 'selfie' }, () => 0,
    [{ content: '上一次', image_generation_metadata: thirdMeta }]);
  assert.equal(backToSelfie.isSelfie, true);

  // 上一次是自拍 → 这次自动转成第三人称生活抓拍
  const toThird = resolveDynamicImageTemplate(character, { imageMode: 'selfie' }, () => 0,
    [{ content: '上一次', image_generation_metadata: selfieMeta }]);
  assert.equal(toThird.isSelfie, false);

  // 模型明确要第三人称时，始终尊重
  const explicit = resolveDynamicImageTemplate(character, { imageMode: 'third_person' }, () => 0, []);
  assert.equal(explicit.isSelfie, false);

  // 渠道测试不受轮换影响
  const testPlan = resolveDynamicImageTemplate(character, { imageMode: 'selfie', forceChannelTest: true }, () => 0,
    [{ content: '上一次', image_generation_metadata: selfieMeta }]);
  assert.equal(testPlan.isSelfie, true);
});

test('image prompt keeps facial identity fixed and forbids grids while clothing remains scene-based', () => {
  const character = {
    name: '小白',
    auto_moments_image_profile: JSON.stringify({ name: '小白', age_feel: '20岁左右', face: ['小巧鹅蛋脸'], eyes: ['眼神温柔'], hair: ['白银色'] }),
    auto_moments_templates: JSON.stringify({ selfie_scenes: ['阳台自拍', '抱猫自拍'], poses: ['回眸'], moods: ['放松'] })
  };
  const plan = { imageMode: 'selfie', imageBrief: '来自聊天的私人细节' };
  const resolved = resolveDynamicImageTemplate(character, plan, () => 0);
  const prompt = buildAutoImagePrompt(character, '今天晒晒太阳。', plan, resolved);

  assert.deepEqual(resolved, { scene: '阳台自拍', pose: '回眸', mood: '放松', isSelfie: true });
  assert.match(prompt, /九宫格、拼贴、分镜/);
  assert.match(prompt, /衣服只可随本次场景自然变化/);
  assert.match(prompt, /场景：阳台自拍；姿势：自然地转过头看向镜头；心情：放松/);
  assert.doesNotMatch(prompt, /抱猫自拍/);
  assert.doesNotMatch(prompt, /今天晒晒太阳/);
  assert.doesNotMatch(prompt, /来自聊天的私人细节/);
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
  const fixture = createFixture({ imageEnabled: true, dynamicEnabled: true });
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

test('fallback daily content draws from the character scene pool instead of four fixed lines', () => {
  const character = {
    name: '林夏',
    auto_moments_templates: JSON.stringify({
      categories: ['日常片段', '和你有关'],
      selfie_scenes: ['床上自拍', '做饭自拍', '抱猫自拍', '阳台自拍'],
      moods: ['开心', '困困', '想你']
    })
  };
  const pool = new Set();
  for (let i = 0; i < 400; i++) pool.add(buildFallbackDailyContent(character, []));
  assert.ok(pool.size > 20, 'expected a varied pool, got ' + pool.size);
  assert.ok([...pool].every(line => !line.includes('在日常片段') && !line.includes('在和你有关')));
  assert.ok([...pool].some(line => line.includes('厨房里') || line.includes('阳台')));
});

test('fallback daily content stays varied and within the length limit near a recent post', () => {
  const character = {
    name: '小林',
    auto_moments_templates: JSON.stringify({
      selfie_scenes: ['阳台自拍', '做饭自拍'],
      moods: ['放松']
    })
  };
  const recent = [{ content: '小林在阳台上待了一会儿，整个人都松下来了。', created_at: '2026-09-21 09:00:00' }];
  const picks = new Set();
  for (let i = 0; i < 200; i++) picks.add(buildFallbackDailyContent(character, recent));
  assert.ok(picks.size > 1, 'fallback should offer more than one line when the pool is large');
  for (const line of picks) assert.ok(line.length <= 120, 'line too long: ' + line);
});

test('a repeated planner line falls back to a fresh pool line instead of skipping the post', async () => {
  const fixture = createFixture({ dailyMin: 2, dailyMax: 2, todayCount: 0, recentMoments: [{"content":"下班后的风有点软，等你回来一起说说话。","created_at":"2026-07-20 09:00:00"},{"content":"最近第 2 条旧动态，用来确认提示词窗口。","created_at":"2026-07-20 09:00:00"},{"content":"最近第 3 条旧动态，用来确认提示词窗口。","created_at":"2026-07-20 09:00:00"},{"content":"最近第 4 条旧动态，用来确认提示词窗口。","created_at":"2026-07-20 09:00:00"},{"content":"最近第 5 条旧动态，用来确认提示词窗口。","created_at":"2026-07-20 09:00:00"},{"content":"最近第 6 条旧动态，用来确认提示词窗口。","created_at":"2026-07-20 09:00:00"},{"content":"最近第 7 条旧动态，用来确认提示词窗口。","created_at":"2026-07-20 09:00:00"},{"content":"最近第 8 条旧动态，用来确认提示词窗口。","created_at":"2026-07-20 09:00:00"},{"content":"最近第 9 条旧动态，用来确认提示词窗口。","created_at":"2026-07-20 09:00:00"},{"content":"最近第 10 条旧动态，用来确认提示词窗口。","created_at":"2026-07-20 09:00:00"},{"content":"最近第 11 条旧动态，用来确认提示词窗口。","created_at":"2026-07-20 09:00:00"},{"content":"最近第 12 条旧动态，用来确认提示词窗口。","created_at":"2026-07-20 09:00:00"}] });
  const service = createAutoMomentsService({
    db: fixture.db,
    fetchImpl: fixture.fetchImpl,
    generateImageImpl: fixture.generateImageImpl,
    now: () => new Date('2026-07-21T12:00:00+08:00'),
    logger: { log() {}, warn() {}, error() {} }
  });

  const [result] = await service.runScan({ characterId: 61 });
  assert.equal(result.status, 'posted');
  assert.equal(fixture.inserted.length, 1);
  const published = fixture.inserted[0].params[2];
  assert.notEqual(published, "下班后的风有点软，等你回来一起说说话。");

  // 规划器现在能看到去重闸门实际比对的整段窗口，而不是只看最近 4 条
  const publicationPrompt = fixture.getChatRequest().body.messages[1].content;
  assert.match(publicationPrompt, /最近第 12 条旧动态/);
});
