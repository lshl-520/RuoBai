import test from 'node:test';
import assert from 'node:assert/strict';
import { recordConfirmedCandidateLifeEvent } from './memory.js';

test('confirming a chat candidate adds its memory to the existing chat life event', async () => {
  const calls = [];
  const db = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('FROM life_event_sources')) {
        if (params[1] === 'memory') return [[]];
        if (params[1] === 'chat') {
          return [[{
            id: 41,
            event_id: 41,
            character_id: 6,
            title: '我喜欢下班后安静地听歌。',
            event_type: 'life',
            status: 'active',
            expires_at: null,
            event_key: null
          }]];
        }
      }
      if (sql.includes('INSERT IGNORE INTO life_event_sources')) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected query: ${sql}`);
    }
  };

  const result = await recordConfirmedCandidateLifeEvent(db, {
    userId: 1,
    previousReviewStatus: 'candidate',
    memory: {
      id: 9,
      character_id: 6,
      content: '我喜欢下班后安静地听歌。',
      memory_type: 'life',
      source_type: 'chat_candidate',
      source_id: 33,
      review_status: 'active'
    }
  });

  assert.deepEqual(result, { id: 41, reused: false, merged: true });
  assert.deepEqual(calls.at(-1).params, [41, 1, 'memory', 9]);
});

test('editing an unconfirmed candidate does not create a life event source', async () => {
  let called = false;
  const result = await recordConfirmedCandidateLifeEvent({ query: async () => { called = true; } }, {
    userId: 1,
    previousReviewStatus: 'candidate',
    memory: {
      id: 9,
      character_id: 6,
      content: '我喜欢下班后安静地听歌。',
      source_type: 'chat_candidate',
      source_id: 33,
      review_status: 'candidate'
    }
  });

  assert.equal(result, null);
  assert.equal(called, false);
});
