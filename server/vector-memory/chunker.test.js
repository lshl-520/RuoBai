import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chunkCharacterMessages,
  chunkMergedChatExport,
  normalizeMergedMessage
} from './chunker.js';

test('normalizeMergedMessage keeps only supported fields with trimmed content', () => {
  const message = normalizeMergedMessage({
    role: 'user',
    content: '  你好  ',
    type: 'text',
    date: '2026-06-01 10:00:00',
    source: '本地',
    ignored: true
  });

  assert.deepEqual(message, {
    role: 'user',
    content: '你好',
    type: 'text',
    date: '2026-06-01 10:00:00',
    source: '本地'
  });
});

test('chunkCharacterMessages groups a user message with following assistant replies', () => {
  const chunks = chunkCharacterMessages({
    userId: 1,
    characterId: 7,
    characterName: '小白',
    messages: [
      { role: 'user', content: '想你', type: 'text', date: '2026-05-22 17:02:44', source: '服务器' },
      { role: 'assistant', content: '我也想你', type: 'text', date: '2026-05-22 17:02:49', source: '服务器' },
      { role: 'user', content: '今天天气真好', type: 'text', date: '2026-05-22 17:49:18', source: '服务器' }
    ],
    targetChars: 300,
    maxChars: 1200
  });

  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].chunk_type, 'turn_pair');
  assert.equal(chunks[0].start_date, '2026-05-22 17:02:44');
  assert.equal(chunks[0].end_date, '2026-05-22 17:02:49');
  assert.deepEqual(chunks[0].roles, ['user', 'assistant']);
  assert.match(chunks[0].text, /用户：想你/);
  assert.match(chunks[0].text, /小白：我也想你/);
  assert.equal(chunks[1].chunk_type, 'user_only');
});

test('chunkCharacterMessages keeps assistant-only messages and splits oversized chunks', () => {
  const longReply = '很长的回复。'.repeat(180);
  const chunks = chunkCharacterMessages({
    userId: 1,
    characterId: 7,
    characterName: '小白',
    messages: [
      { role: 'assistant', content: longReply, type: 'text', date: '2026-05-22 17:02:49', source: '服务器' }
    ],
    targetChars: 300,
    maxChars: 500
  });

  assert.ok(chunks.length > 1);
  assert.ok(chunks.every(chunk => chunk.chunk_type === 'assistant_only'));
  assert.ok(chunks.every(chunk => chunk.text.length <= 560));
  assert.ok(chunks.every(chunk => chunk.character_id === 7));
});

test('chunkMergedChatExport requires explicit user id and known character mapping', () => {
  assert.throws(
    () => chunkMergedChatExport({
      exportData: { characters: [{ name: '小白', messages: [] }] },
      characterMap: new Map([['小白', 7]])
    }),
    /userId/
  );

  assert.throws(
    () => chunkMergedChatExport({
      userId: 1,
      exportData: { characters: [{ name: '未知角色', messages: [] }] },
      characterMap: new Map([['小白', 7]])
    }),
    /找不到角色映射：未知角色/
  );
});

test('chunkMergedChatExport returns chunks and import statistics', () => {
  const result = chunkMergedChatExport({
    userId: 1,
    exportData: {
      total_messages: 2,
      characters: [
        {
          name: '小白',
          message_count: 2,
          messages: [
            { role: 'user', content: '你好呀', type: 'text', date: '2026-05-22 17:02:44', source: '服务器' },
            { role: 'assistant', content: '你好', type: 'text', date: '2026-05-22 17:02:49', source: '服务器' }
          ]
        }
      ]
    },
    characterMap: new Map([['小白', 7]])
  });

  assert.equal(result.stats.totalMessages, 2);
  assert.equal(result.stats.characters.length, 1);
  assert.equal(result.stats.characters[0].chunk_count, 1);
  assert.equal(result.chunks.length, 1);
});
