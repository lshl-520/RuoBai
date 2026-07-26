import test from 'node:test';
import assert from 'node:assert/strict';
import { extractExplicitMemory, recordExplicitChatMemory } from './memory-extractor.js';

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
