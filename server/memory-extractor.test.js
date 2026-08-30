import test from 'node:test';
import assert from 'node:assert/strict';
import { extractExplicitMemory, isLikelyTechnicalChat, recordAutoMemoryCandidate, recordExplicitChatMemory } from './memory-extractor.js';

test('only extracts an explicit remember request', () => {
  assert.equal(extractExplicitMemory('今天吃了西瓜，真甜'), null);
  const memory = extractExplicitMemory('你要记得我不喜欢被催。');
  assert.equal(memory.memory_type, 'important_event');
  assert.equal(memory.source_type, 'chat');
});

test('turns an explicit dated agreement into a pending appointment', () => {
  const memory = extractExplicitMemory('我们约好8月10日一起看电影，你要记得。', { now: new Date('2026-07-26T10:00:00') });
  assert.equal(memory.memory_type, 'appointment');
  assert.equal(memory.appointment_at, '2026-08-10 20:00:00');
  assert.equal(memory.appointment_status, 'pending');
});

test('records one explicit chat memory per source message', async () => {
  const calls = [];
  const pool = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('SELECT id FROM memories')) return [[]];
      return [{ insertId: 45 }];
    }
  };
  const result = await recordExplicitChatMemory(pool, {
    userId: 1, characterId: 2, messageId: 3, content: '我们约好8月10日一起看电影。', now: new Date('2026-07-26T10:00:00'),
  });
  assert.equal(result.id, 45);
  assert.ok(calls.some(call => call.sql.includes("source_type = 'chat'")));
  assert.ok(calls.some(call => call.sql.includes('INSERT INTO memories')));
});

test('records personal statements as low-priority candidates without treating likes as memory', async () => {
  const calls = [];
  const pool = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('SELECT id FROM memories')) return [[]];
      return [{ insertId: 46 }];
    }
  };

  const candidate = await recordAutoMemoryCandidate(pool, {
    userId: 1, characterId: 2, messageId: 4, content: '我喜欢下班后安静地听歌。'
  });
  assert.equal(candidate.id, 46);
  assert.equal(candidate.review_status, 'candidate');
  assert.equal(candidate.is_important, 0);
  assert.equal(recordAutoMemoryCandidate.length > 0, true);
  assert.equal(await recordAutoMemoryCandidate(pool, {
    userId: 1, characterId: 2, messageId: 5, content: '这条动态我点了赞。'
  }), null);
  assert.ok(calls.some(call => call.sql.includes('review_status')));
  assert.ok(calls.some(call => call.sql.includes("source_type IN ('chat_candidate', 'chat_confirmed')")));
});

test('technical project chat is not promoted to a candidate memory', async () => {
  assert.equal(isLikelyTechnicalChat('我希望把 React 前端部署到服务器上'), true);
  let called = false;
  const candidate = await recordAutoMemoryCandidate({
    query: async () => { called = true; return [[]]; }
  }, {
    userId: 1,
    characterId: 2,
    messageId: 33,
    content: '我希望把 React 前端部署到服务器上'
  });
  assert.equal(candidate, null);
  assert.equal(called, false);
});
