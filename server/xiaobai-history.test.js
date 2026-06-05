import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMessageKey,
  mergeCanonicalMessages,
  normalizeMessage,
  renderSummaryReport,
  summarizeMessages
} from './xiaobai-history.js';

test('normalizeMessage fills defaults and keeps iso timestamps stable', () => {
  const normalized = normalizeMessage({
    role: 'user',
    content: '想你',
    created_at: '2026-05-29 09:13:07'
  });

  assert.deepEqual(normalized, {
    role: 'user',
    content: '想你',
    message_type: 'text',
    media_url: null,
    created_at: '2026-05-29T09:13:07.000Z'
  });
});

test('normalizeMessage preserves Date inputs without timezone drift', () => {
  const normalized = normalizeMessage({
    role: 'assistant',
    content: '我在',
    created_at: new Date('2026-05-29T01:13:13.000Z')
  });

  assert.equal(normalized.created_at, '2026-05-29T01:13:13.000Z');
});

test('buildMessageKey treats equivalent message defaults as the same record', () => {
  const fromDb = {
    role: 'assistant',
    content: '我在',
    message_type: 'text',
    media_url: null,
    created_at: '2026-05-29T09:13:13.000Z'
  };
  const fromJson = {
    role: 'assistant',
    content: '我在',
    created_at: '2026-05-29 09:13:13'
  };

  assert.equal(buildMessageKey(fromDb), buildMessageKey(fromJson));
});

test('mergeCanonicalMessages keeps local latest messages and baseline-only history', () => {
  const localMessages = [
    {
      role: 'user',
      content: '早安',
      created_at: '2026-05-29T09:13:07.000Z'
    },
    {
      role: 'assistant',
      content: '早安。你连着说了两次，我听着呢。',
      created_at: '2026-05-29T09:13:13.000Z'
    }
  ];
  const baselineMessages = [
    {
      role: 'assistant',
      content: '早安。你连着说了两次，我听着呢。',
      created_at: '2026-05-29 09:13:13'
    },
    {
      role: 'user',
      content: '爱你',
      created_at: '2026-05-22T22:53:22.000Z'
    }
  ];

  const merged = mergeCanonicalMessages({
    localMessages,
    baselineMessages
  });

  assert.equal(merged.localCount, 2);
  assert.equal(merged.baselineCount, 2);
  assert.equal(merged.addedFromBaseline, 1);
  assert.equal(merged.skippedBaselineDuplicates, 1);
  assert.deepEqual(
    merged.messages.map(item => item.content),
    ['爱你', '早安', '早安。你连着说了两次，我听着呢。']
  );
});

test('summarizeMessages reports totals, roles and daily buckets', () => {
  const summary = summarizeMessages([
    {
      role: 'user',
      content: 'A',
      created_at: '2026-05-28T21:49:29.000Z'
    },
    {
      role: 'assistant',
      content: 'B',
      created_at: '2026-05-28T21:49:35.000Z'
    },
    {
      role: 'user',
      content: 'C',
      created_at: '2026-05-29T01:13:07.000Z'
    }
  ]);

  assert.equal(summary.total, 3);
  assert.equal(summary.first_created_at, '2026-05-28T21:49:29.000Z');
  assert.equal(summary.last_created_at, '2026-05-29T01:13:07.000Z');
  assert.deepEqual(summary.by_role, {
    assistant: 1,
    user: 2
  });
  assert.deepEqual(summary.by_day, [
    { day: '2026-05-28', total: 2 },
    { day: '2026-05-29', total: 1 }
  ]);
});

test('summarizeMessages can bucket by Asia/Shanghai calendar day', () => {
  const summary = summarizeMessages(
    [
      {
        role: 'user',
        content: 'A',
        created_at: '2026-05-28T16:32:21.000Z'
      },
      {
        role: 'assistant',
        content: 'B',
        created_at: '2026-05-29T01:13:13.000Z'
      }
    ],
    { timeZone: 'Asia/Shanghai' }
  );

  assert.deepEqual(summary.by_day, [
    { day: '2026-05-29', total: 2 }
  ]);
});

test('renderSummaryReport emits a readable daily inventory', () => {
  const text = renderSummaryReport({
    summary: {
      total: 3,
      first_created_at: '2026-05-28T21:49:29.000Z',
      last_created_at: '2026-05-29T01:13:07.000Z',
      by_role: { assistant: 1, user: 2 },
      by_day: [
        { day: '2026-05-28', total: 2 },
        { day: '2026-05-29', total: 1 }
      ]
    },
    localCount: 2,
    baselineCount: 2,
    addedFromBaseline: 1,
    skippedBaselineDuplicates: 1
  });

  assert.match(text, /total_messages: 3/);
  assert.match(text, /added_from_baseline: 1/);
  assert.match(text, /## By Day/);
  assert.match(text, /2026-05-28: 2/);
});
