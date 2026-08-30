import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CHAT_CANDIDATE_SOURCE_TYPE,
  CHAT_CONFIRMED_SOURCE_TYPE,
  getEffectiveMemoryReviewStatus,
  isConfirmedMemory,
  resolveMemoryReviewUpdate,
} from './memory-review.js';
import { mapMemory } from './memory.js';

test('legacy active chat candidates are exposed as unconfirmed without changing their stored row', () => {
  const row = {
    id: 17,
    content: '我喜欢下班后安静地听歌。',
    source_type: CHAT_CANDIDATE_SOURCE_TYPE,
    review_status: 'active',
    is_important: 1,
    is_deleted: 0,
  };

  const mapped = mapMemory(row);
  assert.equal(getEffectiveMemoryReviewStatus(row), 'candidate');
  assert.equal(mapped.review_status, 'candidate');
  assert.equal(mapped.requires_confirmation, true);
  assert.equal(mapped.candidate_origin, 'legacy_auto_detected');
  assert.equal(mapped.is_important, false);
  assert.equal(row.review_status, 'active');
  assert.equal(row.source_type, CHAT_CANDIDATE_SOURCE_TYPE);
  assert.equal(isConfirmedMemory(row), false);
});

test('editing an unconfirmed candidate without review_status keeps it isolated', () => {
  const update = resolveMemoryReviewUpdate(
    { source_type: CHAT_CANDIDATE_SOURCE_TYPE, review_status: 'active', is_important: 0 },
    { content: '改过的表述', is_important: true },
    { is_important: 1 },
  );

  assert.deepEqual(update, {
    review_status: 'candidate',
    source_type: CHAT_CANDIDATE_SOURCE_TYPE,
    is_important: 0,
  });
});

test('explicit confirmation migrates the source and makes the memory available', () => {
  const update = resolveMemoryReviewUpdate(
    { source_type: CHAT_CANDIDATE_SOURCE_TYPE, review_status: 'candidate', is_important: 0 },
    { review_status: 'active' },
    { is_important: 0 },
  );

  assert.deepEqual(update, {
    review_status: 'active',
    source_type: CHAT_CONFIRMED_SOURCE_TYPE,
    is_important: 0,
  });
  assert.equal(isConfirmedMemory({
    source_type: update.source_type,
    review_status: update.review_status,
    is_deleted: 0,
  }), true);
});
