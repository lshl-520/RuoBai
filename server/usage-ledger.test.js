import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyUsageError,
  extractUsageFromPayload,
  listUsageEvents,
  normalizeUsageEvent,
  recordUsageEvent
} from './usage-ledger.js';

test('extractUsageFromPayload supports OpenAI and Anthropic token fields', () => {
  assert.deepEqual(
    extractUsageFromPayload({
      usage: {
        prompt_tokens: 12,
        completion_tokens: 8,
        total_tokens: 20,
        prompt_tokens_details: { cached_tokens: 4 },
        cost: 0.0012,
        currency: 'usd'
      }
    }),
    {
      inputTokens: 12,
      outputTokens: 8,
      cacheReadTokens: 4,
      cacheWriteTokens: null,
      totalTokens: 20,
      actualCost: 0.0012,
      costCurrency: 'USD',
      costSource: 'provider',
      protocol: 'chat-completions'
    }
  );

  const anthropic = extractUsageFromPayload({
    usage: {
      input_tokens: 30,
      output_tokens: 10,
      cache_read_input_tokens: 5,
      cache_creation_input_tokens: 2
    }
  }, 'anthropic-messages');
  assert.equal(anthropic.totalTokens, 40);
  assert.equal(anthropic.cacheReadTokens, 5);
  assert.equal(anthropic.cacheWriteTokens, 2);
});

test('normalizeUsageEvent keeps only bounded metadata and no content fields', () => {
  const event = normalizeUsageEvent({
    userId: 7,
    characterId: 3,
    purpose: 'chat',
    providerName: ' Example '.repeat(100),
    model: 'deepseek-chat',
    inputTokens: '20',
    status: 'success',
    prompt: 'should never be returned',
    content: 'private message'
  });

  assert.equal(event.userId, 7);
  assert.equal(event.inputTokens, 20);
  assert.equal(event.providerName.length, 160);
  assert.equal('prompt' in event, false);
  assert.equal('content' in event, false);
});

test('classifyUsageError returns readable stable categories', () => {
  assert.equal(classifyUsageError(401), 'auth');
  assert.equal(classifyUsageError(429), 'rate_limit');
  assert.equal(classifyUsageError(new Error('连接中断')), 'network');
  assert.equal(classifyUsageError(new Error('等待超过 30 秒')), 'timeout');
});

test('recordUsageEvent writes a metadata-only insert and listUsageEvents reads normalized rows', async () => {
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('INSERT INTO usage_events')) return [{ insertId: 19 }];
      return [[{
        id: 19,
        character_id: 3,
        purpose: 'chat',
        provider_name: 'DeepSeek',
        provider_type: 'official',
        model: 'deepseek-chat',
        input_tokens: 20,
        output_tokens: 8,
        cache_read_tokens: null,
        cache_write_tokens: null,
        total_tokens: 28,
        duration_ms: 420,
        status: 'success',
        error_category: null,
        actual_cost: null,
        cost_currency: null,
        cost_source: null,
        created_at: '2026-08-11 12:00:00'
      }]];
    }
  };

  assert.equal(await recordUsageEvent(db, {
    userId: 7,
    characterId: 3,
    purpose: 'chat',
    providerName: 'DeepSeek',
    model: 'deepseek-chat',
    inputTokens: 20,
    outputTokens: 8,
    totalTokens: 28,
    status: 'success',
    content: 'must not be persisted'
  }), 19);
  assert.equal(calls[0].params.includes('must not be persisted'), false);

  const rows = await listUsageEvents(db, 7, { days: 7, purpose: 'chat', limit: 20 });
  assert.equal(rows[0].total_tokens, 28);
  assert.equal(rows[0].provider_name, 'DeepSeek');
  assert.equal(calls[1].params.at(-1), 20);
});
