import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildProactiveRequest,
  buildProactivePrompt,
  createMysqlProactiveRepository,
  extractProactiveText,
  generateProactiveMessage,
  runProactiveScan,
} from './proactive.js';

function createRepo({ candidateOverrides = {}, existingEvents = [], dueAppointment = null } = {}) {
  const events = [...existingEvents];
  const messages = [];
  const appointmentLookups = [];
  const candidate = {
    userId: 7,
    characterId: 12,
    characterName: '小白',
    persona: '温柔、自然、会关心用户。',
    tokens: ['token-1'],
    proactiveEnabled: true,
    bedtimeEnabled: true,
    quietNightEnabled: false,
    lastUserMessageAt: '2026-06-21T08:00:00.000Z',
    lastSeenAt: '2026-06-21T15:25:00.000Z',
    ...candidateOverrides,
  };

  return {
    events,
    messages,
    appointmentLookups,
    async listCandidates() {
      return [candidate];
    },
    async loadRecentMessages() {
      return [
        { role: 'user', content: '今天有点累' },
        { role: 'assistant', content: '那我陪你慢慢缓一会儿。' },
      ];
    },
    async hasEventAfter({ eventType, since, dateKey }) {
      return events.some((event) => {
        if (event.eventType !== eventType) return false;
        if (dateKey) return event.dateKey === dateKey;
        return new Date(event.createdAt).getTime() >= new Date(since).getTime();
      });
    },
    async findDueAppointment(args) {
      appointmentLookups.push(args);
      return dueAppointment;
    },
    async reserveAppointmentEvent({ candidate: reservationCandidate, appointment, dateKey }) {
      const exists = events.some((event) => (
        event.eventType === 'appointment_follow_up'
          && event.sourceType === 'memory'
          && Number(event.sourceId) === Number(appointment.id)
      ));
      if (exists) return { created: false };
      const item = {
        id: events.length + 1,
        userId: reservationCandidate.userId,
        characterId: reservationCandidate.characterId,
        eventType: 'appointment_follow_up',
        sourceType: 'memory',
        sourceId: appointment.id,
        dateKey,
        status: 'processing',
      };
      events.push(item);
      return { id: item.id, created: true };
    },
    async completeReservedEvent({ eventId, messageId, content }) {
      const event = events.find((item) => item.id === eventId);
      if (event) Object.assign(event, { messageId, content, status: 'created' });
    },
    async markEventGenerationFailed(eventId, errorMessage) {
      const event = events.find((item) => item.id === eventId);
      if (event) Object.assign(event, { status: 'generation_failed', errorMessage });
    },
    async saveAssistantMessage({ content }) {
      const message = { id: 91, content };
      messages.push(message);
      return message;
    },
    async createEvent(event) {
      const item = { id: events.length + 1, ...event, status: 'created' };
      events.push(item);
      return item;
    },
    async markEventSent(eventId) {
      const event = events.find((item) => item.id === eventId);
      if (event) event.status = 'sent';
    },
    async markEventStored(eventId) {
      const event = events.find((item) => item.id === eventId);
      if (event) event.status = 'stored';
    },
    async markEventNotificationFailed(eventId, errorMessage) {
      const event = events.find((item) => item.id === eventId);
      if (event) {
        event.status = 'notification_failed';
        event.errorMessage = errorMessage;
      }
    },
  };
}

test('runProactiveScan sends one idle message after 3 hours without user chat', async () => {
  const repo = createRepo();
  const sent = [];

  const result = await runProactiveScan({
    repository: repo,
    now: new Date('2026-06-21T12:30:00.000Z'),
    generateMessage: async () => '你已经忙了好久，我在这儿等你。',
    sendPush: async (payload) => sent.push(payload),
    logger: { info() {}, warn() {}, error() {} },
  });

  assert.equal(result.created, 1);
  assert.equal(repo.messages.length, 1);
  assert.equal(repo.messages[0].content, '你已经忙了好久，我在这儿等你。');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].tokens[0], 'token-1');
  assert.equal(sent[0].data.character_id, '12');
  assert.equal(repo.events[0].status, 'sent');
});

test('runProactiveScan stores the message when no FCM device or sender exists', async () => {
  const repo = createRepo({ candidateOverrides: { tokens: [] } });

  const result = await runProactiveScan({
    repository: repo,
    now: new Date('2026-06-21T12:30:00.000Z'),
    generateMessage: async () => '我先给你留句话，忙完再看也没关系。',
    logger: { info() {}, warn() {}, error() {} },
  });

  assert.equal(result.created, 1);
  assert.equal(result.notified, 0);
  assert.equal(repo.messages.length, 1);
  assert.equal(repo.events[0].status, 'stored');
});

test('runProactiveScan does not duplicate idle message after same user silence window', async () => {
  const repo = createRepo({
    existingEvents: [{ eventType: 'idle_check', createdAt: '2026-06-21T11:30:00.000Z' }],
  });

  const result = await runProactiveScan({
    repository: repo,
    now: new Date('2026-06-21T12:30:00.000Z'),
    generateMessage: async () => '我又来啦。',
    sendPush: async () => {},
    logger: { info() {}, warn() {}, error() {} },
  });

  assert.equal(result.created, 0);
  assert.equal(repo.messages.length, 0);
});

test('runProactiveScan sends bedtime reminder once when user is online at 23:30', async () => {
  const repo = createRepo({
    candidateOverrides: {
      lastUserMessageAt: '2026-06-21T22:20:00.000Z',
      lastSeenAt: '2026-06-21T15:33:00.000Z',
    },
  });
  const sent = [];

  const result = await runProactiveScan({
    repository: repo,
    now: new Date('2026-06-21T15:35:00.000Z'),
    generateMessage: async ({ reason }) => reason === 'bedtime' ? '很晚啦，先睡觉好不好。' : '想你了。',
    sendPush: async (payload) => sent.push(payload),
    logger: { info() {}, warn() {}, error() {} },
  });

  assert.equal(result.created, 1);
  assert.equal(repo.events[0].eventType, 'bedtime');
  assert.equal(repo.events[0].dateKey, '2026-06-21');
  assert.equal(repo.messages[0].content, '很晚啦，先睡觉好不好。');
  assert.equal(sent.length, 1);
});

test('runProactiveScan keeps saved message when push delivery fails', async () => {
  const repo = createRepo();

  const result = await runProactiveScan({
    repository: repo,
    now: new Date('2026-06-21T12:30:00.000Z'),
    generateMessage: async () => '我给你留了一句话。',
    sendPush: async () => { throw new Error('FCM unavailable'); },
    logger: { info() {}, warn() {}, error() {} },
  });

  assert.equal(result.created, 1);
  assert.equal(repo.messages.length, 1);
  assert.equal(repo.events[0].status, 'notification_failed');
  assert.equal(repo.events[0].errorMessage, 'FCM unavailable');
});

test('a due appointment takes priority and creates one role-scoped follow-up', async () => {
  const repo = createRepo({
    candidateOverrides: { isActive: false },
    dueAppointment: {
      id: 77,
      content: '约好今天晚上一起看电影。',
      appointmentAt: '2026-06-21T11:00:00.000Z',
    },
  });
  let generated = 0;

  const options = {
    repository: repo,
    now: new Date('2026-06-21T12:30:00.000Z'),
    generateMessage: async ({ reason, appointment }) => {
      generated += 1;
      assert.equal(reason, 'appointment');
      assert.equal(appointment.id, 77);
      return '电影时间到啦，今天还想一起看吗？';
    },
    logger: { info() {}, warn() {}, error() {} },
  };

  const first = await runProactiveScan(options);
  const second = await runProactiveScan(options);

  assert.equal(first.created, 1);
  assert.equal(second.created, 0);
  assert.equal(generated, 1);
  assert.deepEqual(repo.appointmentLookups[0], { userId: 7, characterId: 12, now: options.now });
  assert.equal(repo.events[0].eventType, 'appointment_follow_up');
  assert.equal(repo.events[0].sourceType, 'memory');
  assert.equal(repo.events[0].sourceId, 77);
  assert.equal(repo.events[0].status, 'stored');
});

test('an appointment generation failure is recorded and is not charged again automatically', async () => {
  const repo = createRepo({
    dueAppointment: {
      id: 78,
      content: '约好今天晚上一起聊天。',
      appointmentAt: '2026-06-21T11:00:00.000Z',
    },
  });
  let generated = 0;
  const options = {
    repository: repo,
    now: new Date('2026-06-21T12:30:00.000Z'),
    generateMessage: async () => {
      generated += 1;
      return '';
    },
    logger: { info() {}, warn() {}, error() {} },
  };

  const first = await runProactiveScan(options);
  const second = await runProactiveScan(options);

  assert.equal(first.created, 0);
  assert.equal(second.created, 0);
  assert.equal(generated, 1);
  assert.equal(repo.events[0].status, 'generation_failed');
});

test('generateProactiveMessage follows the selected role model and provider protocol', async () => {
  let selectedModelArgs;
  let request;
  const result = await generateProactiveMessage({
    repository: {
      async getModelConfig(...args) {
        selectedModelArgs = args;
        return {
          api_base: 'https://models.example/v1',
          api_key: 'test-key',
          provider_type: 'anthropic',
          model: 'claude-sonnet-5',
        };
      },
    },
    candidate: { userId: 7, characterId: 12, characterName: '小白', persona: '' },
    reason: 'idle',
    recentMessages: [],
    now: new Date('2026-06-21T12:30:00.000Z'),
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        async json() {
          return { content: [{ type: 'text', text: '我在这儿，忙完记得回来。' }] };
        },
      };
    },
  });

  assert.deepEqual(selectedModelArgs, [7, 12]);
  assert.equal(result, '我在这儿，忙完记得回来。');
  assert.equal(request.url, 'https://models.example/v1/messages');
  const body = JSON.parse(request.options.body);
  assert.equal(body.model, 'claude-sonnet-5');
  assert.equal(body.max_tokens, 256);
  assert.equal(body.thinking, undefined);
});

test('proactive provider helpers keep Responses output and model routing separate', () => {
  const request = buildProactiveRequest({
    modelConfig: {
      api_base: 'https://models.example/v1',
      api_key: 'test-key',
      model: 'gpt-5.6-luna',
    },
    systemPrompt: '系统提示',
    userPrompt: '主动说一句话',
  });

  assert.equal(request.protocol, 'responses');
  assert.equal(request.url, 'https://models.example/v1/responses');
  const body = JSON.parse(request.options.body);
  assert.equal(body.messages, undefined);
  assert.equal(body.input.at(-1).content, '主动说一句话');
  assert.equal(extractProactiveText('responses', { output_text: '回来了。' }), '回来了。');
});

test('appointment prompt keeps the source appointment specific but non-pressuring', () => {
  const prompt = buildProactivePrompt({
    candidate: { characterName: '小白', persona: '' },
    reason: 'appointment',
    appointment: { content: '今晚一起看电影。' },
    recentMessages: [],
  });
  assert.match(prompt, /之前约定的时间/);
  assert.match(prompt, /今晚一起看电影/);
  assert.match(prompt, /不催促、不指责/);
});

test('reasoning chat-completions models get room for a final proactive sentence', () => {
  const reasoningRequest = buildProactiveRequest({
    modelConfig: {
      api_base: 'https://models.example/v1',
      api_key: 'test-key',
      model: 'deepseek-v4-flash',
    },
    systemPrompt: '系统提示',
    userPrompt: '主动说一句话',
  });
  const normalRequest = buildProactiveRequest({
    modelConfig: {
      api_base: 'https://models.example/v1',
      api_key: 'test-key',
      model: 'companion-model',
    },
    systemPrompt: '系统提示',
    userPrompt: '主动说一句话',
  });

  assert.equal(JSON.parse(reasoningRequest.options.body).max_tokens, 512);
  assert.equal(JSON.parse(normalRequest.options.body).max_tokens, 120);
});

test('stored proactive messages carry a dedicated message type', async () => {
  let insert;
  const repository = createMysqlProactiveRepository({
    async query(sql, params) {
      insert = { sql, params };
      return [{ insertId: 42 }];
    },
  });

  const saved = await repository.saveAssistantMessage({
    candidate: { userId: 7, characterId: 12 },
    content: '我在这儿。',
  });

  assert.equal(saved.id, 42);
  assert.match(insert.sql, /'proactive'/);
  assert.deepEqual(insert.params, [7, 12, '我在这儿。']);
});
