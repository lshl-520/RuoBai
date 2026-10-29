import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BALANCE_CACHE_TTL_MS,
  MANUAL_REFRESH_COOLDOWN_MS,
  buildProbeUrl,
  buildWalletKey,
  hasNoBalanceConcept,
  latestProbedAt,
  normalizeBillingUsed,
  probeCredentialBalance,
  readWallets,
  refreshBalances,
  registrableDomain,
  stripVersionSuffix
} from './credential-balance.js';

/* ── 假 DB：只认这几条 SQL，并把写库参数记下来供断言 ───────────────── */
function createFakeDb({ credentials = [], balances = [] } = {}) {
  const state = { credentials: [...credentials], balances: [...balances], inserts: [] };
  return {
    state,
    async query(sql, params = []) {
      const text = String(sql);
      if (text.includes('FROM credentials')) return [state.credentials];
      if (text.includes('FROM credential_balances')) return [state.balances];
      if (text.includes('INSERT INTO credential_balances')) {
        state.inserts.push(params);
        return [{ affectedRows: 1 }];
      }
      return [[]];
    }
  };
}

function jsonResponse(status, payload) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() {
      return payload;
    }
  };
}

const CRED = {
  id: 8,
  name: 'cc',
  provider_type: 'openai-compatible',
  api_base: 'https://vip.ai98pro.xyz',
  api_key: 'secret-key-must-not-leak'
};

/* ── 地址拼接 ─────────────────────────────────────────────────────── */

test('stripVersionSuffix 去掉结尾斜杠与 /v1', () => {
  assert.equal(stripVersionSuffix('https://api.deepseek.com/v1'), 'https://api.deepseek.com');
  assert.equal(stripVersionSuffix('https://api.deepseek.com/v1/'), 'https://api.deepseek.com');
  assert.equal(stripVersionSuffix('https://api.deepseek.com/'), 'https://api.deepseek.com');
  assert.equal(stripVersionSuffix(''), '');
});

test('buildProbeUrl：三种端点都指向该凭据自己的 api_base', () => {
  assert.equal(buildProbeUrl('usage', 'https://vip.ai98pro.xyz'), 'https://vip.ai98pro.xyz/v1/usage');
  // DeepSeek 官方余额要去掉 /v1
  assert.equal(buildProbeUrl('balance', 'https://api.deepseek.com/v1'), 'https://api.deepseek.com/user/balance');
  assert.equal(
    buildProbeUrl('billing', 'https://apihub.agnes-ai.com/v1'),
    'https://apihub.agnes-ai.com/v1/dashboard/billing/usage'
  );
  assert.equal(buildProbeUrl('unknown', 'https://x.example'), null);
});

/* ── 不该问的别问 ─────────────────────────────────────────────────── */

test('hasNoBalanceConcept：本地 / 实时语音 / 非 http 一律不问', () => {
  assert.equal(hasNoBalanceConcept({ api_base: 'wss://openspeech.bytedance.com/api/v3', provider_type: 'x' }), true);
  assert.equal(hasNoBalanceConcept({ api_base: 'http://127.0.0.1:1234/v1', provider_type: 'local' }), true);
  assert.equal(hasNoBalanceConcept({ api_base: 'http://localhost:8000/v1', provider_type: 'local' }), true);
  assert.equal(hasNoBalanceConcept({ api_base: 'https://x.example', provider_type: 'realtime-voice' }), true);
  assert.equal(hasNoBalanceConcept({ api_base: '', provider_type: 'openai' }), true);
  assert.equal(hasNoBalanceConcept({ api_base: 'https://vip.ai98pro.xyz', provider_type: 'openai-compatible' }), false);
});

/* ── 归并键 ───────────────────────────────────────────────────────── */

test('buildWalletKey：同服务同余额同币种 = 同一个钱包', () => {
  const a = buildWalletKey('https://vip.ai98pro.xyz', 43.42, 'USD');
  const b = buildWalletKey('https://vip.ai98pro.xyz/v1', 43.42, 'USD');
  assert.equal(a, b, '同一站的不同写法要归到同一个钱包');
  assert.notEqual(a, buildWalletKey('https://vip.ai98pro.xyz', 43.41, 'USD'));
  assert.notEqual(a, buildWalletKey('https://other.example', 43.42, 'USD'));
});

test('★ 回归（2026/10/7 实探）：同一服务的子域要合成一个钱包', () => {
  // 实探发现 ai98pro.xyz（cc）与 vip.ai98pro.xyz（gpt5x/img生图/dp渠道）
  // 是同一个服务、同一个余额。按完整主机名归并会把一个钱包拆成两个，
  // 页面上出现两块一模一样的余额。
  const a = buildWalletKey('https://ai98pro.xyz', 21.27445286, 'USD');
  const b = buildWalletKey('https://vip.ai98pro.xyz', 21.27445286, 'USD');
  assert.equal(a, b);
  // 真正不同的服务不能误合
  assert.notEqual(a, buildWalletKey('https://apihub.agnes-ai.com', 21.27445286, 'USD'));
});

test('registrableDomain：常见两级后缀也要取对', () => {
  assert.equal(registrableDomain('https://vip.ai98pro.xyz/v1'), 'ai98pro.xyz');
  assert.equal(registrableDomain('https://api.deepseek.com'), 'deepseek.com');
  assert.equal(registrableDomain('https://api.example.com.cn'), 'example.com.cn');
  assert.equal(registrableDomain('https://a.b.example.co.uk'), 'example.co.uk');
  assert.equal(registrableDomain('https://127.0.0.1:11434'), '127.0.0.1');
});

/* ── 各种响应形状 ─────────────────────────────────────────────────── */

test('★ 回归（2026/10/7 实探）：billing 的 total_usage 原样存，绝不除以 100', () => {
  // 免费 agnes 实测原值 9.4256 就是 $9.43（板上 9/26 的记录）。
  // 照 OpenAI 的"分"惯例除以 100 会变成 $0.094 —— 差 100 倍且看着很正常。
  assert.equal(normalizeBillingUsed(9.4256), 9.4256);
  assert.equal(normalizeBillingUsed(943), 943, '不做任何单位猜测');
  assert.equal(normalizeBillingUsed(null), null);
});

test('probeCredentialBalance：/v1/usage 中转站形状', async () => {
  const fetchImpl = async (url) => {
    assert.equal(url, 'https://vip.ai98pro.xyz/v1/usage');
    return jsonResponse(200, {
      is_valid: true,
      remaining: 43.42,
      unit: 'USD',
      usage: {
        today: { cost: 0.5, actual_cost: 0.42 },
        total: { cost: 12.0, actual_cost: 11.5 }
      }
    });
  };
  const result = await probeCredentialBalance(CRED, { fetchImpl });
  assert.equal(result.status, 'ok');
  assert.equal(result.kind, 'usage');
  assert.equal(result.remaining, 43.42);
  assert.equal(result.currency, 'USD');
  // 实扣优先于标价
  assert.equal(result.usedTotal, 11.5);
  assert.equal(result.usedToday, 0.42);
});

test('probeCredentialBalance：DeepSeek 官方 /user/balance 形状', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/v1/usage')) return jsonResponse(404, {});
    assert.equal(url, 'https://api.deepseek.com/user/balance');
    return jsonResponse(200, {
      is_available: true,
      balance_infos: [
        { currency: 'USD', total_balance: '2.50' },
        { currency: 'CNY', total_balance: '18.20', granted_balance: '0', topped_up_balance: '18.20' }
      ]
    });
  };
  const result = await probeCredentialBalance(
    { ...CRED, id: 3, api_base: 'https://api.deepseek.com' },
    { fetchImpl }
  );
  assert.equal(result.status, 'ok');
  assert.equal(result.kind, 'balance');
  assert.equal(result.remaining, 18.2, '多币种优先人民币');
  assert.equal(result.currency, 'CNY');
});

test('probeCredentialBalance：只有"已用"的免费渠道', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/v1/usage')) return jsonResponse(404, {});
    if (url.endsWith('/user/balance')) return jsonResponse(404, {});
    return jsonResponse(200, { total_usage: 9.4256 });
  };
  const result = await probeCredentialBalance(
    { ...CRED, id: 16, api_base: 'https://apihub.agnes-ai.com/v1' },
    { fetchImpl }
  );
  assert.equal(result.status, 'used_only');
  assert.equal(result.kind, 'billing');
  assert.equal(result.usedTotal, 9.4256);
  assert.equal(result.currency, null, '端点不给币种就不替它认一个');
});

/* ── 不猜：失败一律 unavailable ───────────────────────────────────── */

test('★ 回归（2026/10/7 实探）：中间端点回 401 不能中止，后面的端点还能救回来', async () => {
  // 免费 agnes 实测：/v1/usage 404 → /user/balance 401 → /v1/dashboard/billing/usage 200。
  // 旧写法在 401 处直接 return，于是这个渠道永远只能显示"未提供"，
  // 拿不到它其实能给的"只显示已用"。
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    if (url.endsWith('/v1/usage')) return jsonResponse(404, {});
    if (url.endsWith('/user/balance')) return jsonResponse(401, {});
    return jsonResponse(200, { total_usage: 9.4256 });
  };
  const result = await probeCredentialBalance(
    { ...CRED, id: 16, api_base: 'https://apihub.agnes-ai.com/v1' },
    { fetchImpl }
  );
  assert.equal(seen.length, 3, '三个端点都要试到');
  assert.equal(result.status, 'used_only');
  assert.equal(result.usedTotal, 9.4256);
});

test('probeCredentialBalance：全部端点都无权限时仍如实报 unauthorized', async () => {
  const fetchImpl = async () => jsonResponse(401, {});
  const result = await probeCredentialBalance({ ...CRED, id: 17 }, { fetchImpl });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.reason, 'unauthorized');
});

test('probeCredentialBalance：401 记 unauthorized（该分组不开放查询）', async () => {
  const fetchImpl = async () => jsonResponse(401, { error: 'INVALID_API_KEY' });
  const result = await probeCredentialBalance({ ...CRED, id: 17 }, { fetchImpl });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.reason, 'unauthorized');
  assert.equal(result.remaining, undefined, '不许编一个余额出来');
});

test('probeCredentialBalance：三个端点都 404 → not_supported', async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    return jsonResponse(404, {});
  };
  const result = await probeCredentialBalance(CRED, { fetchImpl });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.reason, 'not_supported');
  assert.equal(seen.length, 3, '三个端点都要试过');
});

test('probeCredentialBalance：超时记 timeout，且不抛异常', async () => {
  const fetchImpl = async () => {
    const error = new Error('aborted');
    error.name = 'AbortError';
    throw error;
  };
  const result = await probeCredentialBalance(CRED, { fetchImpl, timeoutMs: 10 });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.reason, 'timeout');
});

test('probeCredentialBalance：网络异常记 network', async () => {
  const fetchImpl = async () => {
    throw new Error('ECONNREFUSED');
  };
  const result = await probeCredentialBalance(CRED, { fetchImpl });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.reason, 'network');
});

test('probeCredentialBalance：本地渠道根本不发请求', async () => {
  let called = 0;
  const fetchImpl = async () => {
    called += 1;
    return jsonResponse(200, {});
  };
  const result = await probeCredentialBalance(
    { ...CRED, id: 10, api_base: 'http://127.0.0.1:11434/v1', provider_type: 'local' },
    { fetchImpl }
  );
  assert.equal(result.status, 'none');
  assert.equal(result.reason, 'no_balance_concept');
  assert.equal(called, 0);
});

test('probeCredentialBalance：记住类型后先试那一种', async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    return jsonResponse(200, { balance_infos: [{ currency: 'CNY', total_balance: 18.2 }] });
  };
  const result = await probeCredentialBalance(
    { ...CRED, id: 3, api_base: 'https://api.deepseek.com' },
    { fetchImpl, preferredKind: 'balance' }
  );
  assert.equal(result.kind, 'balance');
  assert.equal(seen[0], 'https://api.deepseek.com/user/balance', '记住的类型要排第一');
});

/* ── 写库：只写数字，绝不带密钥 ───────────────────────────────────── */

test('refreshBalances：写库参数里没有 api_key，只有数字和状态', async () => {
  const db = createFakeDb({ credentials: [CRED], balances: [] });
  const fetchImpl = async () => jsonResponse(200, { remaining: 43.42, unit: 'USD' });
  await refreshBalances(db, 19, { fetchImpl, force: true });

  assert.equal(db.state.inserts.length, 1);
  const flat = JSON.stringify(db.state.inserts[0]);
  assert.ok(!flat.includes('secret-key-must-not-leak'), '密钥绝不能进库');
  assert.ok(!flat.includes('api_key'));
  assert.ok(flat.includes('43.42'));
});

test('refreshBalances：快照还新鲜时一个请求都不发（省渠道）', async () => {
  const now = new Date('2026-10-07T12:00:00Z');
  const db = createFakeDb({
    credentials: [CRED],
    balances: [{
      credential_id: 8,
      status: 'ok',
      remaining: 43.42,
      currency: 'USD',
      wallet_key: buildWalletKey(CRED.api_base, 43.42, 'USD'),
      probed_at: new Date(now.getTime() - 60 * 1000)
    }]
  });
  let called = 0;
  const fetchImpl = async () => {
    called += 1;
    return jsonResponse(200, {});
  };
  const result = await refreshBalances(db, 19, { fetchImpl, force: false, now });
  assert.equal(result.skipped, true);
  assert.equal(called, 0, 'TTL 内不该再打扰渠道');
});

test('refreshBalances：快照过期了就重新问', async () => {
  const now = new Date('2026-10-07T12:00:00Z');
  const db = createFakeDb({
    credentials: [CRED],
    balances: [{
      credential_id: 8,
      status: 'ok',
      probed_at: new Date(now.getTime() - BALANCE_CACHE_TTL_MS - 1000)
    }]
  });
  let called = 0;
  const fetchImpl = async () => {
    called += 1;
    return jsonResponse(200, { remaining: 40, unit: 'USD' });
  };
  const result = await refreshBalances(db, 19, { fetchImpl, force: false, now });
  assert.equal(result.skipped, false);
  assert.ok(called > 0);
});

/* ── 归并：4 把钥匙必须合成 1 个钱包 ─────────────────────────────── */

test('readWallets：同服务同余额的 4 把钥匙合成一个钱包，余额不相加、用量求和', async () => {
  const shared = 43.42;
  // 照着 2026/10/7 实探的真实形态：一把挂在裸域，三把挂在 vip 子域。
  const bases = ['https://ai98pro.xyz', 'https://vip.ai98pro.xyz', 'https://vip.ai98pro.xyz', 'https://vip.ai98pro.xyz'];
  const credentials = [8, 14, 18, 22].map((id, index) => ({
    id,
    name: ['cc', 'gpt5x', 'img生图', 'dp渠道'][index],
    provider_type: 'openai-compatible',
    api_base: bases[index],
    api_key: 'k'
  }));
  const balances = credentials.map((item, index) => ({
    credential_id: item.id,
    status: 'ok',
    kind: 'usage',
    remaining: shared,
    currency: 'USD',
    // 各把钥匙的用量互不相同（实探就是这样）
    used_total: [54.9, 148.8, 21.9, 48.7][index],
    used_today: 0.1,
    wallet_key: buildWalletKey(item.api_base, shared, 'USD'),
    probed_at: new Date('2026-10-07T10:00:00Z')
  }));

  const wallets = await readWallets(createFakeDb({ credentials, balances }), 19);
  assert.equal(wallets.length, 1, '同一服务的 4 把钥匙 = 1 个钱包');
  assert.equal(wallets[0].remaining, shared, '余额取一份，绝不累加');
  assert.notEqual(wallets[0].remaining, shared * 4);
  assert.equal(
    Math.round(wallets[0].usedTotal * 100) / 100,
    Math.round((54.9 + 148.8 + 21.9 + 48.7) * 100) / 100,
    '用量是各把钥匙各记各的 → 求和'
  );
  assert.deepEqual(wallets[0].credentialIds.sort((a, b) => a - b), [8, 14, 18, 22]);
  assert.equal(wallets[0].status, 'ok');
  // 明细要摆出来，免得上面那个求和被误读成某一个渠道的数字。
  assert.equal(wallets[0].credentialUsage.length, 4);
  assert.deepEqual(
    wallets[0].credentialUsage.map((item) => item.usedTotal),
    [54.9, 148.8, 21.9, 48.7]
  );
});

test('readWallets：同站但余额不同 → 各算一个钱包（不能误合）', async () => {
  const credentials = [1, 2].map((id) => ({
    id,
    name: `k${id}`,
    provider_type: 'openai-compatible',
    api_base: 'https://same.example',
    api_key: 'k'
  }));
  const balances = [
    { credential_id: 1, status: 'ok', remaining: 10, currency: 'USD', wallet_key: buildWalletKey('https://same.example', 10, 'USD'), probed_at: new Date() },
    { credential_id: 2, status: 'ok', remaining: 20, currency: 'USD', wallet_key: buildWalletKey('https://same.example', 20, 'USD'), probed_at: new Date() }
  ];
  const wallets = await readWallets(createFakeDb({ credentials, balances }), 19);
  assert.equal(wallets.length, 2);
});

test('readWallets：拿不到余额的凭据也照实返回状态，不伪造数字', async () => {
  const credentials = [{ id: 17, name: 'grok', provider_type: 'openai-compatible', api_base: 'https://api.x.ai', api_key: 'k' }];
  const balances = [{ credential_id: 17, status: 'unavailable', reason: 'unauthorized', remaining: null, probed_at: new Date() }];
  const wallets = await readWallets(createFakeDb({ credentials, balances }), 19);
  assert.equal(wallets.length, 1);
  assert.equal(wallets[0].status, 'unavailable');
  assert.equal(wallets[0].reason, 'unauthorized');
  assert.equal(wallets[0].remaining, null);
});

test('readWallets：有余额的排在拿不到的后面之前', async () => {
  const credentials = [
    { id: 1, name: 'ok站', provider_type: 'x', api_base: 'https://a.example', api_key: 'k' },
    { id: 2, name: '拿不到', provider_type: 'x', api_base: 'https://b.example', api_key: 'k' }
  ];
  const balances = [
    { credential_id: 1, status: 'ok', remaining: 5, currency: 'USD', wallet_key: buildWalletKey('https://a.example', 5, 'USD'), probed_at: new Date() },
    { credential_id: 2, status: 'unavailable', reason: 'timeout', probed_at: new Date() }
  ];
  const wallets = await readWallets(createFakeDb({ credentials, balances }), 19);
  assert.equal(wallets[0].status, 'ok');
  assert.equal(wallets[1].status, 'unavailable');
});

test('latestProbedAt：取最新一次查询时间', () => {
  const earlier = new Date('2026-10-07T10:00:00Z');
  const later = new Date('2026-10-07T11:00:00Z');
  assert.equal(
    latestProbedAt([{ probedAt: earlier }, { probedAt: later }, { probedAt: null }]),
    later.getTime()
  );
  assert.equal(latestProbedAt([{ probedAt: null }]), null);
  assert.equal(latestProbedAt([]), null);
});

test('常量：缓存 30 分钟、手动刷新有冷却', () => {
  assert.equal(BALANCE_CACHE_TTL_MS, 30 * 60 * 1000);
  assert.ok(MANUAL_REFRESH_COOLDOWN_MS > 0);
});
