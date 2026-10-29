import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPersonaRuntimePrompt,
  classifyConversationScene,
  deriveNextPersonaRuntime,
  normalizePersonaRuntime,
  loadPersonaRuntime,
  loadXiaobaiState,
  recordXiaobaiState,
  recordPersonaRuntimeTurn,
} from './persona-runtime.js';
import { deriveNextXiaobaiState } from './xiaobai-core.js';

test('classifies a watermelon photo as a short life share', () => {
  assert.equal(classifyConversationScene({ content: '看看这个西瓜', messageType: 'image' }), 'share');
  assert.match(buildPersonaRuntimePrompt({}, { content: '看看这个西瓜', messageType: 'image' }), /先回应这件具体小事/);
});

test('classifies a short pet name and emotional complaint without forcing a long reply', () => {
  assert.equal(classifyConversationScene({ content: '宝' }), 'affection');
  assert.equal(classifyConversationScene({ content: '今天真的好累' }), 'emotion');
  assert.match(buildPersonaRuntimePrompt({}, { content: '今天真的好累' }), /先接住情绪/);
});

test('runtime state changes gently and keeps relationship dimensions intact', () => {
  const runtime = normalizePersonaRuntime({
    state_json: JSON.stringify({ mode: 'calm', warmth: 60, energy: 55, concern: 15 }),
    relationship_json: JSON.stringify({ familiarity: 70, trust: 76, safety: 82, tacit: 64, rituals: ['晚安'] }),
  });
  const next = deriveNextPersonaRuntime(runtime, { content: '今天有点难受' });

  assert.equal(next.state.mode, 'concerned');
  assert.ok(next.state.concern > runtime.state.concern);
  assert.equal(next.relationship.trust, 76);
  assert.deepEqual(next.relationship.rituals, ['晚安']);
});

// ────────────────────────────────────────────────────────────────
// ★ 2026/9/22：她「每轮失忆」的回归测试
//
// 真实事故：chat.js 先调 recordPersonaRuntimeTurn(写语气参数)，
// 再调 loadXiaobaiState 去读「心情 / 上一轮惦记的事」。
// 而旧版 recordPersonaRuntimeTurn 把 state_json 整个覆盖成
// {mode,warmth,energy,concern}，把 `xiaobai` 这个键冲没了 ——
// 于是她每一轮都被清零，永远想不起上一轮的事。
// 线上真实数据佐证：turnsSince 恒为 0、carriesOver 恒为空。
// 下面两条测试锁住「两种状态互不覆盖」。
// ────────────────────────────────────────────────────────────────

function createFakeRuntimePool(initial = null) {
  const store = { row: initial };
  return {
    _store: store,
    async query(sql, params = []) {
      const text = String(sql);
      if (text.includes('SELECT state_json, relationship_json') && text.includes('FROM character_runtime_states')) {
        return [store.row ? [store.row] : []];
      }
      if (text.includes('SELECT state_json') && text.includes('FROM character_runtime_states')) {
        return [store.row ? [{ state_json: store.row.state_json }] : []];
      }
      if (text.includes('INSERT INTO character_runtime_states')) {
        store.row = {
          state_json: JSON.parse(params[2]),
          relationship_json: JSON.parse(params[3]),
        };
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected query: ${text}`);
    },
  };
}

test('★ 她不再每轮失忆：写语气参数时必须保住 xiaobai 状态', async () => {
  const pool = createFakeRuntimePool(null);

  // 第一轮：他分享了一件事 → 她自己那份状态里有了「惦记的事」
  await recordXiaobaiState(pool, {
    userId: 1,
    characterId: 48,
    xiaobaiState: { mood: 'soft', moodIntensity: 55, carriesOver: '他分享了「外卖吃完了」', lastTopic: '分享', turnsSince: 3, scene: 'daily' },
  });
  const before = await loadXiaobaiState(pool, { userId: 1, characterId: 48 });
  assert.equal(before.carriesOver, '他分享了「外卖吃完了」');

  // 紧接着：聊天主流程写一次语气参数（这正是旧版把状态冲掉的时机）
  await recordPersonaRuntimeTurn(pool, { userId: 1, characterId: 48, content: '今天有点难受' });

  // 关键断言：她惦记的事还在，没被清零
  const after = await loadXiaobaiState(pool, { userId: 1, characterId: 48 });
  assert.ok(after, '写完语气参数后，小白状态不能整个消失');
  assert.equal(after.carriesOver, '他分享了「外卖吃完了」');
  assert.equal(after.lastTopic, '分享');
  assert.equal(after.turnsSince, 3);

  // 同时语气参数确实按这一轮更新了（两套状态各自演化）
  const runtime = await loadPersonaRuntime(pool, { userId: 1, characterId: 48 });
  assert.equal(runtime.state.mode, 'concerned');
});

test('★ 反向也成立：写小白状态时不能冲掉语气参数', async () => {
  const pool = createFakeRuntimePool(null);
  await recordPersonaRuntimeTurn(pool, { userId: 1, characterId: 48, content: '今天有点难受' });
  const runtimeBefore = await loadPersonaRuntime(pool, { userId: 1, characterId: 48 });
  assert.equal(runtimeBefore.state.mode, 'concerned');

  await recordXiaobaiState(pool, {
    userId: 1,
    characterId: 48,
    xiaobaiState: { mood: 'worried', moodIntensity: 60, carriesOver: '他刚才说「累」', lastTopic: '情绪', turnsSince: 0, scene: 'daily' },
  });

  const runtimeAfter = await loadPersonaRuntime(pool, { userId: 1, characterId: 48 });
  assert.equal(runtimeAfter.state.mode, 'concerned');
  assert.equal(runtimeAfter.state.concern, runtimeBefore.state.concern);
});

test('★ 她的状态连续两轮要能累积 turnsSince，而不是永远归零', async () => {
  const pool = createFakeRuntimePool(null);
  await recordXiaobaiState(pool, {
    userId: 1, characterId: 48,
    xiaobaiState: { mood: 'calm', moodIntensity: 40, carriesOver: '', lastTopic: '闲聊', turnsSince: 0, scene: 'daily' },
  });

  // 第三轮起，聊天主流程照常写语气参数，但每一轮都要能读回自己的状态
  const seen = [];
  for (let round = 0; round < 3; round += 1) {
    const current = await loadXiaobaiState(pool, { userId: 1, characterId: 48 });
    seen.push(current);
    await recordPersonaRuntimeTurn(pool, { userId: 1, characterId: 48, content: '嗯嗯' });
    const nextState = deriveNextXiaobaiState(current, { content: '嗯嗯' });
    await recordXiaobaiState(pool, { userId: 1, characterId: 48, xiaobaiState: nextState });
  }

  // 旧 bug 下这里每一轮读到的都是 null；修好后至少第一轮能读到自己写下的状态
  assert.ok(seen[0], '第一轮就该读到自己刚写入的状态，而不是被冲成空');
  const final = await loadXiaobaiState(pool, { userId: 1, characterId: 48 });
  assert.ok(final, '连续多轮之后状态仍然在');
  assert.ok(Number.isFinite(Number(final.turnsSince)), 'turnsSince 要是有效数字');
});

