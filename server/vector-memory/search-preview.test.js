import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatPreviewResults,
  parsePreviewArgs,
  refineSearchResults
} from './search-preview.js';

test('parsePreviewArgs requires user id, character id, and query', () => {
  assert.throws(() => parsePreviewArgs(['--user-id', '1', '--character-id', '7']), /query/);
  assert.deepEqual(
    parsePreviewArgs(['--user-id', '1', '--character-id', '7', '--query', '想你', '--top', '3']),
    {
      userId: 1,
      characterId: 7,
      query: '想你',
      top: 3,
      qdrantUrl: 'http://127.0.0.1:6333',
      collection: 'ruobai_memories_local',
      credentialId: null,
      model: '',
      vectorSize: null,
      hashEmbedding: false
    }
  );
});

test('refineSearchResults filters by score and removes duplicate time windows', () => {
  const results = refineSearchResults([
    {
      score: 0.91,
      payload: { start_date: '2026-05-22 17:02:44', text: '用户：想你\n小白：我也想你' }
    },
    {
      score: 0.88,
      payload: { start_date: '2026-05-22 17:02:50', text: '用户：想你\n小白：我也想你呀' }
    },
    {
      score: 0.3,
      payload: { start_date: '2026-05-23 10:00:00', text: '低分结果' }
    },
    {
      score: 0.82,
      payload: { start_date: '2026-05-24 10:00:00', text: '用户：今天天气真好' }
    }
  ], { minScore: 0.5, top: 5 });

  assert.equal(results.length, 2);
  assert.equal(results[0].score, 0.91);
  assert.equal(results[1].payload.text, '用户：今天天气真好');
});

test('formatPreviewResults prints score, date, source, and text', () => {
  const output = formatPreviewResults([
    {
      score: 0.91,
      payload: {
        character_name: '小白',
        start_date: '2026-05-22 17:02:44',
        end_date: '2026-05-22 17:02:49',
        source: '服务器',
        text: '用户：想你\n小白：我也想你'
      }
    }
  ]);

  assert.match(output, /1\. 分数 0\.910/);
  assert.match(output, /小白/);
  assert.match(output, /2026-05-22 17:02:44/);
  assert.match(output, /服务器/);
  assert.match(output, /用户：想你/);
});
