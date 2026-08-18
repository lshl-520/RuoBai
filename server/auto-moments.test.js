import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAutoImagePrompt, createAutoMomentsService, parseGeneratedMomentPlan, resolveDynamicImageTemplate, sanitizeGeneratedMoment, startAutoMomentsScheduler } from './auto-moments.js';

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
  nextPlannerRetryAt = null
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
    auto_moments_daily_max: 4,
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
      if (sql.includes('FROM moments') && sql.includes('ORDER BY created_at DESC')) return [[]];
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
  assert.equal(fixture.inserted[0].params[2], '下班后的风有点软，等你回来一起说说话。');
  assert.equal(fixture.inserted[0].params[3], null);
  assert.equal(fixture.inserted[0].params[4], 'disabled');
  assert.match(fixture.calls.find(call => call.sql.includes('INSERT INTO moments')).sql, /publisher/);
  assert.ok(fixture.calls.some(call => call.sql.includes('auto_moments_last_posted_at = NOW()')));
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

test('manual image capability does not authorise automatic moment images', async () => {
  const fixture = createFixture({ imageEnabled: true });
  const service = createAutoMomentsService({
    db: fixture.db,
    fetchImpl: fixture.fetchImpl,
    generateImageImpl: fixture.generateImageImpl,
    logger: { log() {}, warn() {}, error() {} }
  });

  const [result] = await service.runScan({ characterId: 61, ignoreLimits: true });
  assert.equal(result.status, 'posted');
  assert.equal(result.imageStatus, 'dynamic_unconfigured');
  assert.equal(fixture.imageCalls.length, 0);
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
  assert.match(fixture.imageCalls[0].subject, /男性的手/);
  assert.equal(fixture.inserted[0].params[4], 'generated');
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

test('image generation failure still publishes the text moment', async () => {
  const fixture = createFixture({ imageEnabled: true, dynamicEnabled: true, imageFails: true });
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
  assert.equal(fixture.inserted[0].params[2], '下班后的风有点软，等你回来一起说说话。');
  assert.equal(fixture.inserted[0].params[3], null);
  assert.equal(fixture.inserted[0].params[4], 'failed');
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
  assert.match(fixture.imageCalls[0].subject, /场景：镜子自拍；姿势：回眸；心情：放松/);
  assert.match(fixture.imageCalls[0].subject, /只生成一张完整的单幅照片/);
  assert.doesNotMatch(fixture.imageCalls[0].subject, /做饭自拍/);
});

test('image prompt keeps facial identity fixed and forbids grids while clothing remains scene-based', () => {
  const character = {
    name: '小白',
    auto_moments_image_profile: JSON.stringify({ name: '小白', age_feel: '20岁左右', face: ['小巧鹅蛋脸'], eyes: ['眼神温柔'], hair: ['白银色'] }),
    auto_moments_templates: JSON.stringify({ selfie_scenes: ['阳台自拍', '抱猫自拍'], poses: ['回眸'], moods: ['放松'] })
  };
  const plan = { imageMode: 'selfie', imageBrief: '' };
  const resolved = resolveDynamicImageTemplate(character, plan, () => 0);
  const prompt = buildAutoImagePrompt(character, '今天晒晒太阳。', plan, resolved);

  assert.deepEqual(resolved, { scene: '阳台自拍', pose: '回眸', mood: '放松', isSelfie: true });
  assert.match(prompt, /九宫格、拼贴、分镜/);
  assert.match(prompt, /衣服只可随本次场景自然变化/);
  assert.match(prompt, /场景：阳台自拍；姿势：回眸；心情：放松/);
  assert.doesNotMatch(prompt, /抱猫自拍/);
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
