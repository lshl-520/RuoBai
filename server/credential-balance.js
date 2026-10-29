/**
 * 渠道余额查询（⑤「钱包」后端）
 *
 * 部署方反馈：渠道多，大部分看不到余额，要挨个去渠道后台看。
 * 账本里费用一直只能显示"渠道未提供"，原因就是从没去渠道问过余额。
 *
 * 这一版只做**后端**：按凭据的 `api_base` 发一次只读 GET，把余额变成数字存进
 * `credential_balances`，再把同一个钱包的多个凭据归并成一条。不依赖 UI，
 * 可以先用接口在本地验证（板上 9/26 定的就是这个顺序）。
 *
 * ── 三条硬约束（都是板上/用户明确要求过的）──────────────────────────
 *  1. **只发往该凭据自己的 `api_base`**。不外发、不经过第三方、不汇总到别处。
 *  2. **只存数字 + 查询时间**。`credential_balances` 里没有原始响应、没有
 *     api_key、没有正文类字段；错误也只记一个枚举原因，绝不把响应体或密钥
 *     带进日志。
 *  3. **不猜**。404 / 401 / 超时一律记成 `unavailable`；页面显示"未提供"，
 *     而不是拿一个编出来的数字糊弄。
 *
 * ── 探测顺序（都是只读 GET，按顺序试，命中即停）─────────────────────
 *   ① `/v1/usage`                  —— ai98pro 这类中转站（返回 remaining）
 *   ② `/user/balance`              —— DeepSeek 官方（去掉 /v1）
 *   ③ `/v1/dashboard/billing/usage` —— 只报"已用"、没有余额的（如免费 agnes）
 *
 * 第一次探测成功后会把类型记下来（`kind`），下次直接先试这一种，避免每次都
 * 把三个端点走一遍。
 */

import express from 'express';
import { pool as defaultPool } from './db.js';
import { asyncHandler } from './helpers.js';

/** 余额多久算新鲜。超过就重新问渠道；页面刷新也走同一把尺子。 */
export const BALANCE_CACHE_TTL_MS = 30 * 60 * 1000;
/** 手动刷新按钮的最短间隔，防止连点把渠道打爆。 */
export const MANUAL_REFRESH_COOLDOWN_MS = 60 * 1000;
/** 单次探测超时。 */
export const PROBE_TIMEOUT_MS = 8000;
/** 同时探测几个凭据。 */
const PROBE_CONCURRENCY = 4;

const PROBE_ORDER = ['usage', 'balance', 'billing'];

// ── 状态枚举（前端按这个显示，不要自己拼字符串）──────────────────────
// ok           有余额数字
// used_only    只有"已用"，没有余额（免费渠道常见）
// unavailable  问了但拿不到（不支持 / 无权限 / 超时 / 网络），页面显示"未提供"
// none         这个凭据本来就没有余额概念（本地模型、实时语音），不显示
const STATUS = Object.freeze({
  OK: 'ok',
  USED_ONLY: 'used_only',
  UNAVAILABLE: 'unavailable',
  NONE: 'none'
});

const REASON = Object.freeze({
  NOT_SUPPORTED: 'not_supported',
  UNAUTHORIZED: 'unauthorized',
  TIMEOUT: 'timeout',
  NETWORK: 'network',
  INVALID_PAYLOAD: 'invalid_payload',
  NO_BALANCE_CONCEPT: 'no_balance_concept'
});

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toTextOrNull(value) {
  const text = String(value ?? '').trim();
  return text ? text : null;
}

/** 去掉结尾斜杠，再去掉结尾的 `/v1`，好把三种端点拼在同一个基础上。 */
export function stripVersionSuffix(apiBase) {
  const base = String(apiBase || '').trim().replace(/\/+$/, '');
  return base.replace(/\/v1$/i, '');
}

/**
 * 这个凭据值不值得问。
 *
 * 本地模型和火山实时语音这类端点没有"余额"这个概念（板上 9/26 实测记录），
 * 问了也只会得到 404，页面还得多显示一条"未提供" —— 所以直接标 `none`。
 */
export function hasNoBalanceConcept(credential) {
  const apiBase = String(credential?.api_base || '').trim();
  const providerType = String(credential?.provider_type || '').toLowerCase();
  if (!apiBase) return true;
  if (!/^https?:\/\//i.test(apiBase)) return true; // wss:// 之类
  let host = '';
  try {
    host = new URL(apiBase).hostname.toLowerCase();
  } catch {
    return true;
  }
  if (['localhost', '127.0.0.1', '0.0.0.0', '10.0.2.2', '::1'].includes(host)) return true;
  if (providerType.includes('realtime') || providerType.includes('volcano')) return true;
  return false;
}

/** 端点地址。全部只读 GET，全部指向该凭据自己的 api_base。 */
export function buildProbeUrl(kind, apiBase) {
  const base = stripVersionSuffix(apiBase);
  if (!base) return null;
  if (kind === 'usage') return `${base}/v1/usage`;
  if (kind === 'balance') return `${base}/user/balance`;
  if (kind === 'billing') return `${base}/v1/dashboard/billing/usage`;
  return null;
}

/**
 * `/v1/dashboard/billing/usage` 的 `total_usage`。
 *
 * ⚠️ 2026/10/7 实探教训：**不做除以 100 的换算**。
 * OpenAI 官方这个端点惯例是给**分**，我一开始照惯例除了 100 —— 结果免费 agnes
 * 实测原值 9.4256，除以 100 变成 $0.094，而板上 9/26 的真实记录是 **$9.43**。
 * 也就是说这个渠道**直接给美元**。差 100 倍，而且看起来"很正常"，最难发现。
 *
 * 所以这里**如实存渠道给的原始数值**、币种留空（端点本来就没给币种），
 * 页面按"渠道报的已用（原值）"显示。宁可标"单位未标注"，也不编一个换算。
 */
export function normalizeBillingUsed(value) {
  return toNumberOrNull(value);
}

/** `/v1/usage` → 中转站的余额 + 已用。 */
function normalizeUsageProbe(payload) {
  if (!payload || typeof payload !== 'object') {
    return { status: STATUS.UNAVAILABLE, reason: REASON.INVALID_PAYLOAD };
  }
  if (payload.is_valid === false) {
    return { status: STATUS.UNAVAILABLE, kind: 'usage', reason: REASON.UNAUTHORIZED };
  }
  const remaining = toNumberOrNull(payload.remaining);
  if (remaining === null) {
    return { status: STATUS.UNAVAILABLE, kind: 'usage', reason: REASON.INVALID_PAYLOAD };
  }
  const usage = payload.usage && typeof payload.usage === 'object' ? payload.usage : {};
  const total = usage.total && typeof usage.total === 'object' ? usage.total : {};
  const today = usage.today && typeof usage.today === 'object' ? usage.today : {};
  return {
    status: STATUS.OK,
    kind: 'usage',
    remaining,
    currency: toTextOrNull(payload.unit),
    // actual_cost 是实扣，cost 是标价 —— 记实扣更诚实。
    usedTotal: toNumberOrNull(total.actual_cost) ?? toNumberOrNull(total.cost),
    usedToday: toNumberOrNull(today.actual_cost) ?? toNumberOrNull(today.cost)
  };
}

/** `/user/balance` → DeepSeek 官方余额。 */
function normalizeBalanceProbe(payload) {
  if (!payload || typeof payload !== 'object') {
    return { status: STATUS.UNAVAILABLE, reason: REASON.INVALID_PAYLOAD };
  }
  const infos = Array.isArray(payload.balance_infos) ? payload.balance_infos : null;
  if (!infos || infos.length === 0) {
    return { status: STATUS.UNAVAILABLE, kind: 'balance', reason: REASON.INVALID_PAYLOAD };
  }
  // 多币种时优先人民币（业主是主模型走 DeepSeek 官方），否则取第一条。
  const info = infos.find((item) => String(item?.currency || '').toUpperCase() === 'CNY') || infos[0];
  const remaining = toNumberOrNull(info?.total_balance);
  if (remaining === null) {
    return { status: STATUS.UNAVAILABLE, kind: 'balance', reason: REASON.INVALID_PAYLOAD };
  }
  return {
    status: STATUS.OK,
    kind: 'balance',
    remaining,
    currency: toTextOrNull(info?.currency)
  };
}

/** `/v1/dashboard/billing/usage` → 只有"已用"。 */
function normalizeBillingProbe(payload) {
  if (!payload || typeof payload !== 'object') {
    return { status: STATUS.UNAVAILABLE, reason: REASON.INVALID_PAYLOAD };
  }
  const used = normalizeBillingUsed(payload.total_usage);
  if (used === null) {
    return { status: STATUS.UNAVAILABLE, kind: 'billing', reason: REASON.INVALID_PAYLOAD };
  }
  return {
    status: STATUS.USED_ONLY,
    kind: 'billing',
    usedTotal: used,
    // 这个端点不返回币种，就不替它认一个。
    currency: null
  };
}

function normalizeProbe(kind, payload) {
  if (kind === 'usage') return normalizeUsageProbe(payload);
  if (kind === 'balance') return normalizeBalanceProbe(payload);
  if (kind === 'billing') return normalizeBillingProbe(payload);
  return { status: STATUS.UNAVAILABLE, reason: REASON.INVALID_PAYLOAD };
}

/**
 * 取"可注册域名"（eTLD+1），用来判断两个 `api_base` 是不是同一个服务。
 *
 * 为什么不能直接用主机名：2026/10/7 实探发现 `ai98pro.xyz`（cc）和
 * `vip.ai98pro.xyz`（gpt5x / img生图 / dp渠道）**是同一个服务、同一个余额**
 * （都是 $21.27445286）。按完整主机名归并会把一个钱包拆成两个，
 * 页面上就会出现两块一模一样的余额。
 */
const TWO_LEVEL_SUFFIXES = new Set([
  'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn', 'co.uk', 'org.uk', 'ac.uk',
  'co.jp', 'co.kr', 'com.hk', 'com.tw', 'com.sg', 'com.au'
]);

export function registrableDomain(apiBase) {
  let host = '';
  try {
    host = new URL(String(apiBase || '')).hostname.toLowerCase();
  } catch {
    return String(apiBase || '').trim().toLowerCase();
  }
  if (!host || /^\d+(\.\d+){3}$/.test(host)) return host;
  const parts = host.split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const lastTwo = parts.slice(-2).join('.');
  if (TWO_LEVEL_SUFFIXES.has(lastTwo)) return parts.slice(-3).join('.');
  return lastTwo;
}

/**
 * 钱包归并键：**同一服务（可注册域名）+ 同一余额 + 同一币种 = 同一个钱包**。
 *
 * ai98pro 那 4 把钥匙共用一份余额，页面必须显示成一个，**不能相加** ——
 * 所以余额也进 key：余额一变 key 就变，不会把两次不同的余额误合成一个。
 */
export function buildWalletKey(apiBase, remaining, currency) {
  const domain = registrableDomain(apiBase);
  return `${domain}|${Number(remaining).toFixed(6)}|${String(currency || '').toUpperCase()}`;
}

/** 一条探测结果 → 可以直接写库的一行。 */
function toBalanceRow(credential, result, probedAt) {
  const remaining = toNumberOrNull(result?.remaining);
  const usable = result?.status === STATUS.OK || result?.status === STATUS.USED_ONLY;
  return {
    credential_id: credential.id,
    status: result?.status || STATUS.UNAVAILABLE,
    kind: toTextOrNull(result?.kind),
    reason: toTextOrNull(result?.reason),
    remaining,
    currency: toTextOrNull(result?.currency),
    used_total: toNumberOrNull(result?.usedTotal),
    used_today: toNumberOrNull(result?.usedToday),
    wallet_key: result?.status === STATUS.OK && remaining !== null
      ? buildWalletKey(credential.api_base, remaining, result?.currency)
      : null,
    probed_at: probedAt,
    _usable: usable
  };
}

/**
 * 探测单个凭据：按记住的类型优先、再按标准顺序试。
 *
 * 关键：**任何失败分支都不带响应体、不带 api_key**，只回一个枚举原因。
 */
export async function probeCredentialBalance(credential, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutMs = Number(options.timeoutMs) || PROBE_TIMEOUT_MS;

  if (hasNoBalanceConcept(credential)) {
    return { status: STATUS.NONE, reason: REASON.NO_BALANCE_CONCEPT };
  }

  const remembered = PROBE_ORDER.includes(options.preferredKind) ? options.preferredKind : null;
  const order = remembered
    ? [remembered, ...PROBE_ORDER.filter((kind) => kind !== remembered)]
    : [...PROBE_ORDER];

  let lastFailure = { status: STATUS.UNAVAILABLE, reason: REASON.NOT_SUPPORTED };
  let sawUnauthorized = false;

  for (const kind of order) {
    const url = buildProbeUrl(kind, credential.api_base);
    if (!url) continue;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${credential.api_key || ''}`,
          Accept: 'application/json'
        },
        signal: controller.signal
      });

      if (response.status === 401 || response.status === 403) {
        // 该分组不开放查询（板上记录的 grok #17 就是这条），聊天不受影响。
        //
        // ⚠️ 2026/10/7 实探修正：这里**不能 return**。免费 agnes 的
        // `/user/balance` 会回 401，但它的 `/v1/dashboard/billing/usage`
        // 是好的 —— 提前 return 就永远拿不到"只显示已用"。
        // 所以记下来继续试下一个端点；全部失败时再优先报 unauthorized。
        sawUnauthorized = true;
        lastFailure = { status: STATUS.UNAVAILABLE, kind, reason: REASON.UNAUTHORIZED };
        continue;
      }
      if (response.status === 404 || response.status === 405) {
        lastFailure = { status: STATUS.UNAVAILABLE, kind, reason: REASON.NOT_SUPPORTED };
        continue;
      }
      if (!response.ok) {
        lastFailure = { status: STATUS.UNAVAILABLE, kind, reason: REASON.NETWORK };
        continue;
      }

      const payload = await response.json();
      const normalized = normalizeProbe(kind, payload);
      if (normalized.status === STATUS.OK || normalized.status === STATUS.USED_ONLY) {
        return normalized;
      }
      lastFailure = normalized;
    } catch (error) {
      const aborted = error?.name === 'AbortError' || controller.signal.aborted;
      lastFailure = {
        status: STATUS.UNAVAILABLE,
        kind,
        reason: aborted ? REASON.TIMEOUT : REASON.NETWORK
      };
    } finally {
      clearTimeout(timer);
    }
  }

  // 三个端点都试过了。中途明确回过"无权限"的话，这比笼统的"不支持"更有信息量，
  // 页面能据此提示"去官网看"。
  if (sawUnauthorized) {
    return { status: STATUS.UNAVAILABLE, kind: lastFailure.kind || null, reason: REASON.UNAUTHORIZED };
  }
  return lastFailure;
}

/** 简单并发闸门，避免一次把 9 个渠道同时打出去。 */
async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = new Array(Math.min(limit, items.length)).fill(null).map(async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

async function readCredentialRows(db, userId) {
  const [rows] = await db.query(
    `
      SELECT id, name, provider_type, api_base, api_key
      FROM credentials
      WHERE user_id = ?
      ORDER BY id ASC
    `,
    [userId]
  );
  return rows || [];
}

async function readBalanceRows(db, userId) {
  const [rows] = await db.query(
    `
      SELECT
        credential_id,
        status,
        kind,
        reason,
        remaining,
        currency,
        used_total,
        used_today,
        wallet_key,
        probed_at
      FROM credential_balances
      WHERE user_id = ?
    `,
    [userId]
  );
  return rows || [];
}

/**
 * 问一遍所有凭据并把结果写进快照表。
 *
 * `force=false` 时：只要快照还都在 TTL 内就**一次请求都不发**（省钱、也少打扰渠道）。
 */
export async function refreshBalances(db, userId, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const force = options.force === true;
  const credentials = await readCredentialRows(db, userId);

  if (credentials.length === 0) {
    return { probed: 0, skipped: true, wallets: [] };
  }

  const existing = await readBalanceRows(db, userId);
  const preferred = new Map(existing.map((row) => [Number(row.credential_id), row.kind]));

  if (!force && existing.length > 0) {
    const oldest = existing.reduce((acc, row) => {
      const at = row.probed_at ? new Date(row.probed_at).getTime() : 0;
      return acc === null || at < acc ? at : acc;
    }, null);
    if (oldest !== null && now.getTime() - oldest < BALANCE_CACHE_TTL_MS) {
      return { probed: 0, skipped: true };
    }
  }

  const results = await mapWithConcurrency(credentials, PROBE_CONCURRENCY, async (credential) => {
    const result = await probeCredentialBalance(credential, {
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
      preferredKind: preferred.get(Number(credential.id)) || null
    });
    return toBalanceRow(credential, result, now);
  });

  for (const row of results) {
    await db.query(
      `
        INSERT INTO credential_balances
          (credential_id, user_id, status, kind, reason, remaining, currency, used_total, used_today, wallet_key, probed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          status = VALUES(status),
          kind = VALUES(kind),
          reason = VALUES(reason),
          remaining = VALUES(remaining),
          currency = VALUES(currency),
          used_total = VALUES(used_total),
          used_today = VALUES(used_today),
          wallet_key = VALUES(wallet_key),
          probed_at = VALUES(probed_at)
      `,
      [
        row.credential_id,
        userId,
        row.status,
        row.kind,
        row.reason,
        row.remaining,
        row.currency,
        row.used_total,
        row.used_today,
        row.wallet_key,
        row.probed_at
      ]
    );
  }

  return { probed: results.length, skipped: false };
}

/**
 * 读钱包视图：把快照按 `wallet_key` 归并。
 *
 * 合并规则要点：**同钱包的多个凭据只出一条，余额取一份**（绝不求和）——
 * ai98pro 那 4 把钥匙加起来会得到一个假数字。
 */
export async function readWallets(db, userId) {
  const credentials = await readCredentialRows(db, userId);
  const rows = await readBalanceRows(db, userId);
  const byId = new Map(credentials.map((item) => [Number(item.id), item]));

  const groups = new Map();
  const singles = [];

  for (const row of rows) {
    const credential = byId.get(Number(row.credential_id));
    if (!credential) continue;
    const entry = {
      credentialId: Number(row.credential_id),
      credentialName: credential.name || '',
      apiBase: credential.api_base || '',
      status: row.status,
      kind: row.kind || null,
      reason: row.reason || null,
      remaining: row.remaining === null || row.remaining === undefined ? null : Number(row.remaining),
      currency: row.currency || null,
      usedTotal: row.used_total === null || row.used_total === undefined ? null : Number(row.used_total),
      usedToday: row.used_today === null || row.used_today === undefined ? null : Number(row.used_today),
      probedAt: row.probed_at || null
    };

    if (row.status === STATUS.OK && row.wallet_key) {
      const list = groups.get(row.wallet_key) || [];
      list.push(entry);
      groups.set(row.wallet_key, list);
    } else {
      singles.push(entry);
    }
  }

  const hostOf = (apiBase) => {
    try {
      return new URL(String(apiBase || '')).hostname.toLowerCase();
    } catch {
      return '';
    }
  };

  const wallets = [];
  for (const [key, entries] of groups) {
    const first = entries[0];
    wallets.push({
      key,
      host: hostOf(first.apiBase),
      label: first.credentialName || hostOf(first.apiBase),
      status: STATUS.OK,
      kind: first.kind,
      reason: null,
      // 同一个钱包，余额只有一份 —— 取一份，不累加。
      remaining: Math.max(...entries.map((item) => Number(item.remaining) || 0)),
      currency: first.currency,
      // 余额只有一份（共用），但**用量是各把钥匙各记各的** ——
      // 2026/10/7 实探：ai98pro 那 4 把的 usage.total 分别是
      // 54.9 / 148.8 / 21.9 / 48.7，各不相同，说明它们都在从同一个池子里花。
      // 所以"这个钱包一共花了多少"要**求和**；而余额**绝不能求和**（上面取一份）。
      usedTotal: entries.reduce(
        (acc, item) => (item.usedTotal === null ? acc : (acc ?? 0) + item.usedTotal),
        null
      ),
      usedToday: entries.reduce(
        (acc, item) => (item.usedToday === null ? acc : (acc ?? 0) + item.usedToday),
        null
      ),
      credentialIds: entries.map((item) => item.credentialId),
      credentialNames: entries.map((item) => item.credentialName),
      // 明细摆出来：余额是**共用的一份**，用量是**各把钥匙各记各的**。
      // 上面那个 usedTotal 是求和，别被误读成某一个渠道的数字。
      credentialUsage: entries.map((item) => ({
        credentialId: item.credentialId,
        credentialName: item.credentialName,
        usedTotal: item.usedTotal,
        usedToday: item.usedToday
      })),
      probedAt: first.probedAt
    });
  }

  for (const entry of singles) {
    wallets.push({
      key: `credential:${entry.credentialId}`,
      host: hostOf(entry.apiBase),
      label: entry.credentialName || hostOf(entry.apiBase),
      status: entry.status,
      kind: entry.kind,
      reason: entry.reason,
      remaining: entry.remaining,
      currency: entry.currency,
      usedTotal: entry.usedTotal,
      usedToday: entry.usedToday,
      credentialIds: [entry.credentialId],
      credentialNames: [entry.credentialName],
      probedAt: entry.probedAt
    });
  }

  // 有余额的排前面、余额多的更靠前；没有数字的按状态排在后面。
  const statusRank = { ok: 0, used_only: 1, unavailable: 2, none: 3 };
  wallets.sort((a, b) => {
    const rank = (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9);
    if (rank !== 0) return rank;
    return (Number(b.remaining) || 0) - (Number(a.remaining) || 0);
  });

  return wallets;
}

/** 快照里最新的一次探测时间，用来判断"这页数据是不是旧的"。 */
export function latestProbedAt(wallets) {
  let latest = null;
  for (const wallet of wallets) {
    if (!wallet.probedAt) continue;
    const at = new Date(wallet.probedAt).getTime();
    if (!Number.isFinite(at)) continue;
    if (latest === null || at > latest) latest = at;
  }
  return latest;
}

export function createWalletRouter({ pool = defaultPool, fetchImpl } = {}) {
  const router = express.Router();

  const respondWithWallets = async (req, res) => {
    const wallets = await readWallets(pool, req.userId);
    const latest = latestProbedAt(wallets);
    return res.json({
      success: true,
      item: {
        wallets,
        probedAt: latest === null ? null : new Date(latest).toISOString(),
        stale: latest === null || Date.now() - latest >= BALANCE_CACHE_TTL_MS,
        cacheTtlMs: BALANCE_CACHE_TTL_MS
      }
    });
  };

  // 打开钱包页：快照还新鲜就直接给，过期了才去问渠道。
  router.get('/', asyncHandler(async (req, res) => {
    await refreshBalances(pool, req.userId, { fetchImpl, force: false });
    return respondWithWallets(req, res);
  }));

  // 手动刷新：绕过缓存，但有最短间隔，连点不会把渠道打爆。
  router.post('/refresh', asyncHandler(async (req, res) => {
    const walletsBefore = await readWallets(pool, req.userId);
    const latest = latestProbedAt(walletsBefore);
    if (latest !== null && Date.now() - latest < MANUAL_REFRESH_COOLDOWN_MS) {
      return res.status(429).json({
        success: false,
        error: '刚刚才查过，稍等一下再刷新。',
        item: {
          wallets: walletsBefore,
          probedAt: new Date(latest).toISOString(),
          stale: false,
          retryAfterMs: MANUAL_REFRESH_COOLDOWN_MS - (Date.now() - latest)
        }
      });
    }

    const result = await refreshBalances(pool, req.userId, { fetchImpl, force: true });
    const wallets = await readWallets(pool, req.userId);
    const probedAt = latestProbedAt(wallets);
    return res.json({
      success: true,
      item: {
        wallets,
        probedAt: probedAt === null ? null : new Date(probedAt).toISOString(),
        stale: false,
        cacheTtlMs: BALANCE_CACHE_TTL_MS,
        probed: result.probed
      }
    });
  }));

  return router;
}

export default createWalletRouter();
