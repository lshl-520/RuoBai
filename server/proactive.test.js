import test from 'node:test';
import assert from 'node:assert/strict';

import { runProactiveScan } from './proactive.js';

function createRepo({ candidateOverrides = {}, existingEvents = [] } = {}) {
  const events = [...existingEvents];
  const messages = [];
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
