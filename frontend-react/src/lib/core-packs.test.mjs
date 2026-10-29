import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CORE_PACKS,
  allCorePacks,
  noCorePacks,
  normalizeCorePacks,
  buildRolePayload,
  buildRoleUpdatePayload,
  toCorePacksPayload,
} from './roles.js';

/**
 * ═══ 「她的核心」规则包 · 前端契约（2026/10/6）═══
 *
 * 前端这份兼容口径必须与后端 `chat.js` 的 `resolveCorePacks()` 完全一致。
 * 一旦两边不一致，界面上显示的勾选状态会和实际生效的不一样 —— 那比没有开关更糟。
 */

const PACK_IDS = ['shield', 'companion', 'nickname', 'xiaobai_state', 'local_time'];

test('★ 包 id 是前后端契约：就是约定的这 5 个', () => {
  // 改 id 会让已存进库的勾选状态全部失效，也会让后端 filter 找不到对应的行
  assert.deepEqual(CORE_PACKS.map((p) => p.id), PACK_IDS);
});

test('★ 每个包都有给人看的名字和说明', () => {
  for (const pack of CORE_PACKS) {
    assert.ok(pack.label && pack.label.length > 0, `${pack.id} 要有 label`);
    assert.ok(pack.desc && pack.desc.length > 0, `${pack.id} 要有 desc`);
  }
});

test('★ 护身符必须能被单独勾上 —— 这是整次改造的理由', () => {
  // 用户最需要的那条保护，以前锁在总开关里，一关就一起丢
  const shield = CORE_PACKS.find((p) => p.id === 'shield');
  assert.ok(shield, '必须有 shield 包');
  assert.equal(shield.recommended, true, '护身符建议默认推荐');
});

test('★ normalizeCorePacks：老数据 core_enabled=1 → 全开（不能静默丢护身符）', () => {
  const packs = normalizeCorePacks({ char_key: 'xiaobai', name: '小白', core_enabled: 1 });
  assert.deepEqual(packs, allCorePacks());
});

test('★ normalizeCorePacks：老数据 core_enabled=0 → 全关', () => {
  const packs = normalizeCorePacks({ char_key: 'role-abc', name: '晚晚', core_enabled: 0 });
  assert.deepEqual(packs, noCorePacks());
});

test('★ normalizeCorePacks：有 core_packs 就以它为准', () => {
  const packs = normalizeCorePacks({
    char_key: 'xiaobai',
    name: '小白',
    core_enabled: 1,
    core_packs: { shield: true },
  });
  assert.deepEqual(packs, { shield: true, companion: false, nickname: false, xiaobai_state: false, local_time: false });
});

test('★ normalizeCorePacks：空对象 = 用户全取消，与"没这个字段"不同', () => {
  const packs = normalizeCorePacks({ char_key: 'xiaobai', name: '小白', core_enabled: 1, core_packs: {} });
  assert.deepEqual(packs, noCorePacks());
});

test('★ normalizeCorePacks：JSON 字符串也能读（数据库驱动可能给字符串）', () => {
  const packs = normalizeCorePacks({ core_packs: '{"shield":true,"companion":"true"}' });
  assert.equal(packs.shield, true);
  assert.equal(packs.companion, true);
  assert.equal(packs.nickname, false);
});

test('★ normalizeCorePacks：坏 JSON 不抛错，落到老数据兜底', () => {
  assert.doesNotThrow(() => normalizeCorePacks({ core_packs: '{坏' }));
  assert.equal(normalizeCorePacks({ char_key: 'xiaobai', core_packs: '{坏' }).shield, true);
});

test('★ normalizeCorePacks：null / 非对象安全返回全关', () => {
  for (const bad of [null, undefined, 'x', 42]) {
    assert.doesNotThrow(() => normalizeCorePacks(bad));
    assert.deepEqual(normalizeCorePacks(bad), noCorePacks());
  }
});

test('★ normalizeCorePacks：返回值 5 个键永远都在，且都是布尔', () => {
  const cases = [{}, { core_enabled: 1 }, { core_packs: {} }, { core_packs: { shield: 1 } }];
  for (const c of cases) {
    const packs = normalizeCorePacks(c);
    for (const id of PACK_IDS) assert.equal(typeof packs[id], 'boolean', `${id} 必须是布尔`);
  }
});

test('★ buildRolePayload：新建角色只要求名字（人设可以留空）', () => {
  const ok = buildRolePayload({ name: '小满' });
  assert.equal(ok.error, undefined);
  assert.equal(ok.name, '小满');
  assert.equal(ok.persona, '');
  assert.equal(ok.rules, '');
});

test('buildRolePayload trims optional persona and rules independently', () => {
  const p = buildRolePayload({ name: '小满', persona: '  温柔  ', rules: '  先听她说完  ' });
  assert.equal(p.persona, '温柔');
  assert.equal(p.rules, '先听她说完');
});

test('★ buildRolePayload：没名字要报错', () => {
  assert.ok(buildRolePayload({ name: '   ' }).error);
});

test('★ buildRolePayload：core_packs 与 core_enabled 同步（有一个勾上就算开）', () => {
  const on = buildRolePayload({ name: '小满', corePacks: { shield: true } });
  assert.deepEqual(on.core_packs, { shield: true, companion: false, nickname: false, xiaobai_state: false, local_time: false });
  assert.equal(on.core_enabled, true);

  const off = buildRolePayload({ name: '小满', corePacks: noCorePacks() });
  assert.equal(off.core_enabled, false, '一个都不勾时总开关也要跟着关');
});

test('★ buildRolePayload：不传 corePacks 时默认全不勾（干净的新人）', () => {
  const p = buildRolePayload({ name: '小满' });
  assert.deepEqual(p.core_packs, noCorePacks());
  assert.equal(p.core_enabled, false);
});

test('★ buildRoleUpdatePayload：改角色同样带上 core_packs', () => {
  const p = buildRoleUpdatePayload(
    { name: '小白', corePacks: { ...noCorePacks(), shield: true, nickname: true } },
    { intimacy: 70, mood: 60 }
  );
  assert.deepEqual(p.core_packs, { shield: true, companion: false, nickname: true, xiaobai_state: false, local_time: false });
  assert.equal(p.core_enabled, true);
  assert.equal(p.intimacy, 70, '不该覆盖已有的亲密度');
  assert.equal(p.mood, 60);
  assert.equal(p.rules, '');
});

test('★ core_packs 必须是对象而不是数组 —— 后端明确拒绝数组', () => {
  // server/schema.js 的 normalizeCorePacks() 里 `Array.isArray(source) => null`：
  // 数组没有键，说不清"第 3 位是哪个包"。发数组过去会被判为非法、整份勾选丢失。
  const p = buildRolePayload({
    name: '小满',
    corePacks: { local_time: true, shield: true },
  });
  assert.ok(!Array.isArray(p.core_packs), 'core_packs 不能是数组');
  assert.deepEqual(Object.keys(p.core_packs).sort(), [...PACK_IDS].sort());
  assert.equal(p.core_packs.shield, true);
  assert.equal(p.core_packs.local_time, true);
  assert.equal(p.core_packs.nickname, false);
});

test('★ toCorePacksPayload：只带合法 id，多余的键被丢掉', () => {
  // 手工构造 / 旧版本前端可能塞进乱七八糟的键，不能让它们进库
  const payload = toCorePacksPayload({ shield: true, 乱写的: true, local_time: 1 });
  assert.deepEqual(Object.keys(payload).sort(), [...PACK_IDS].sort());
  assert.equal(payload.shield, true);
  assert.equal(payload.local_time, true);
  assert.equal(payload['乱写的'], undefined);
});

test('★ toCorePacksPayload：传空 / 传垃圾都不抛错，得到全 false', () => {
  for (const bad of [undefined, null, {}, 'x', 42]) {
    assert.doesNotThrow(() => toCorePacksPayload(bad));
    assert.deepEqual(toCorePacksPayload(bad), noCorePacks());
  }
});
