import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildChatHistoryHref,
  buildMemoryPayload,
  buildMemoryViewModel,
  formatMemoryDate
} from './memory-page-utils.mjs';

test('buildMemoryViewModel normalizes backend memories and sorts important first', () => {
  const memories = buildMemoryViewModel([
    {
      id: 2,
      content: '普通记忆',
      tag: '习惯',
      category: '',
      is_important: 0,
      created_at: '2026-05-24T10:00:00.000Z'
    },
    {
      id: 1,
      content: '重要记忆',
      tag: '',
      category: '生日',
      is_important: 1,
      created_at: '2026-05-23T10:00:00.000Z'
    }
  ]);

  assert.equal(memories[0].id, 1);
  assert.equal(memories[0].tag, '普通记忆');
  assert.equal(memories[0].category, '生日');
  assert.equal(memories[0].isImportant, true);
  assert.equal(memories[1].id, 2);
  assert.equal(memories[1].isImportant, false);
});

test('formatMemoryDate keeps invalid dates readable', () => {
  assert.equal(formatMemoryDate('not-a-date'), 'not-a-date');
  assert.match(formatMemoryDate('2026-05-24T10:00:00.000Z'), /2026/);
});

test('buildChatHistoryHref points to the selected real role', () => {
  assert.equal(
    buildChatHistoryHref({ id: 7, name: '小白 & 糖糖' }),
    'chat-room.html?id=7&name=%E5%B0%8F%E7%99%BD%20%26%20%E7%B3%96%E7%B3%96'
  );
});

test('buildMemoryPayload trims form values and keeps important flag explicit', () => {
  const payload = buildMemoryPayload({
    content: '  记住我喜欢蓝莓蛋糕  ',
    tag: '  喜好  ',
    category: '  甜点  ',
    isImportant: true
  });

  assert.deepEqual(payload, {
    content: '记住我喜欢蓝莓蛋糕',
    tag: '喜好',
    category: '甜点',
    is_important: true
  });
});

test('buildMemoryPayload reports missing content and fills default tag', () => {
  const payload = buildMemoryPayload({
    content: ' ',
    tag: ' ',
    category: '',
    isImportant: false
  });

  assert.equal(payload.error, '记忆内容不能为空');
  assert.equal(payload.tag, '普通记忆');
  assert.equal(payload.is_important, false);
});
