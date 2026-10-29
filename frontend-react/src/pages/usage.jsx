import React, { useEffect, useMemo, useState } from "react";
import { Icon } from "../store.jsx";
import { getUsageEvents, getUsageSummary } from "../lib/profile.js";

const PURPOSE_META = {
  chat: { label: "主回复", hue: "rose" },
  inner_os: { label: "内心 OS", hue: "lav" },
  image: { label: "画图发图", hue: "clay" },
  tts: { label: "文字转语音", hue: "sage" },
  realtime: { label: "实时通话", hue: "gold" },
  other: { label: "其他调用", hue: "mute" },
};

const HUE_COLORS = {
  rose: "#E45186",
  lav: "#9B7BF0",
  clay: "#E8A25C",
  sage: "#6FAE8E",
  gold: "#D9A441",
  mute: "#B5A898",
};

const HUE_TINTS = {
  rose: "#FCE9F1",
  lav: "#F1EAFD",
  clay: "#FBEEE0",
  sage: "#E3F2EA",
  gold: "#F8EFD8",
  mute: "#EFE9DF",
};

const PROVIDER_TYPE_LABELS = { relay: "中转渠道", official: "官方", other: "其他" };
const PROVIDER_BAR_COLORS = ["#9B7BF0", "#6FAE8E", "#E45186", "#E8A25C"];

function purposeMeta(key) {
  return PURPOSE_META[key] || PURPOSE_META.other;
}

function formatTokens(value) {
  const num = Number(value || 0);
  if (num >= 1e8) return `${(num / 1e8).toFixed(2)} 亿`;
  if (num >= 1e4) {
    const wan = (num / 1e4).toFixed(1);
    return `${wan.endsWith(".0") ? wan.slice(0, -2) : wan} 万`;
  }
  return num.toLocaleString("zh-CN");
}

function formatTokensPlain(value) {
  return Number(value || 0).toLocaleString("zh-CN");
}

function formatCost(actualCost, currency) {
  if (actualCost === null || actualCost === undefined) return null;
  return `${currency || "USD"} ${Number(actualCost).toFixed(4)}`;
}

function formatDuration(value) {
  if (value === null || value === undefined) return "耗时未提供";
  return `${(Number(value) / 1000).toFixed(1)} 秒`;
}

function formatDate(value) {
  if (!value) return "时间未提供";
  const date = new Date(String(value).replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return "时间未提供";
  return date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatError(category) {
  if (!category || category === "unknown") return "未知错误";
  return category;
}

function formatDayLabel(dayKey) {
  const parts = String(dayKey || "").split("-");
  return parts.length === 3 ? `${Number(parts[1])}/${Number(parts[2])}` : "";
}

/* 把时间窗切成若干桶，返回每桶的 token 合计（按时间先后排列） */
function buildTrendBuckets(daily, days) {
  const bucketCount = days <= 7 ? days : days <= 30 ? 15 : 18;
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  start.setDate(start.getDate() - (days - 1));
  const byDay = new Map(daily.map((row) => [row.day, row.total_tokens]));

  const buckets = [];
  for (let index = 0; index < bucketCount; index += 1) {
    const bucketStart = new Date(start.getTime() + index * (days / bucketCount) * 86400000);
    const bucketEnd = new Date(start.getTime() + (index + 1) * (days / bucketCount) * 86400000);
    let tokens = 0;
    for (let t = new Date(bucketStart); t < bucketEnd; t.setDate(t.getDate() + 1)) {
      const key = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
      tokens += byDay.get(key) || 0;
    }
    buckets.push({ label: formatDayLabel(`${bucketStart.getFullYear()}-${String(bucketStart.getMonth() + 1).padStart(2, "0")}-${String(bucketStart.getDate()).padStart(2, "0")}`), tokens });
  }
  return buckets;
}

function PeriodSeg({ days, onChange }) {
  return (
    <div className="uq-seg" role="tablist" aria-label="统计时间">
      {[7, 30, 90].map((value) => (
        <button key={value} type="button" role="tab" aria-selected={days === value} className={days === value ? "on" : ""} onClick={() => onChange(value)}>
          {value} 天
        </button>
      ))}
    </div>
  );
}

function SubTopbar({ title, sub, onBack }) {
  return (
    <div className="topbar usage-topbar-std">
      <button className="icon-btn" type="button" onClick={onBack} aria-label="返回总览"><Icon name="back" /></button>
      <div><h1>{title}</h1><div className="sub">{sub}</div></div>
      <span style={{ width: 40 }} />
    </div>
  );
}

/* ---------- 总览入口 ---------- */

function HeroCard({ summary, days, loading }) {
  const buckets = useMemo(() => buildTrendBuckets(summary?.daily || [], days), [summary, days]);
  const max = Math.max(...buckets.map((bucket) => bucket.tokens), 0);
  if (loading || !summary) {
    return (
      <section className="uq-hero loading">
        <div className="uq-hero-top">
          <div className="uq-hero-main">
            <span className="uq-hero-label">累计消耗 Token</span>
            <strong className="uq-hero-num">—</strong>
            <span className="uq-hero-sub">正在读取调用账本</span>
          </div>
        </div>
      </section>
    );
  }
  const { totals } = summary;
  const cost = formatCost(totals.actual_cost, totals.cost_currency);
  return (
    <section className="uq-hero">
      <div className="uq-hero-top">
        <div className="uq-hero-main">
          <span className="uq-hero-label">累计消耗 Token · 最近 {days} 天</span>
          <strong className="uq-hero-num">{formatTokens(totals.total_tokens)}</strong>
          <span className="uq-hero-sub">
            {totals.calls} 次调用
            {totals.failures ? ` · ${totals.failures} 次失败` : " · 全部成功"}
          </span>
        </div>
        <div className="uq-hero-cost">
          <span>费用</span>
          <b>{cost || "未提供"}</b>
        </div>
      </div>
      <div className="uq-chart-wrap">
        <div className="uq-chart" role="img" aria-label="Token 消耗趋势">
          {buckets.map((bucket, index) => (
            <i
              key={index}
              className={bucket.tokens === 0 ? "zero" : ""}
              style={{ height: max === 0 ? "6%" : `${Math.max((bucket.tokens / max) * 100, 5)}%` }}
              title={`${bucket.label} · ${formatTokens(bucket.tokens)} Token`}
            />
          ))}
        </div>
        <div className="uq-chart-x">
          <span>{buckets[0]?.label}</span>
          <span>{buckets[Math.floor(buckets.length / 2)]?.label}</span>
          <span>{buckets[buckets.length - 1]?.label}</span>
        </div>
      </div>
      <div className="uq-hero-stats">
        <div><span>输入</span><b>{formatTokens(totals.input_tokens)}</b></div>
        <div><span>输出</span><b>{formatTokens(totals.output_tokens)}</b></div>
        <div><span>缓存命中</span><b>{formatTokens(totals.cache_read_tokens)}</b></div>
      </div>
    </section>
  );
}

const ENTRIES = [
  { key: "models", icon: "cpu", hue: "lav", label: "模型统计", desc: "每个模型调了多少次、多少 Token" },
  { key: "dist", icon: "wave", hue: "rose", label: "分布与趋势", desc: "消耗花在哪里 · 按天的走势" },
  { key: "recent", icon: "clock", hue: "clay", label: "最近调用", desc: "最近 30 条流水，含失败原因" },
];

function OverviewView({ summary, days, setDays, loading, error, onNavigate, onBack }) {
  return (
    <>
      <div className="topbar usage-topbar-std">
        <button className="icon-btn" type="button" onClick={onBack} aria-label="返回我的"><Icon name="back" /></button>
        <div><h1>用量与健康</h1><div className="sub">每一次调用去了哪里、用了多少</div></div>
        <span style={{ width: 40 }} />
      </div>
      <PeriodSeg days={days} onChange={setDays} />
      {error && <div className="usage-error" role="alert">{error}</div>}
      <HeroCard summary={summary} days={days} loading={loading} />
      <section className="usage-section">
        <h2>分类查看</h2>
        <div className="uq-entries">
          {ENTRIES.map((entry) => (
            <button key={entry.key} type="button" className="uq-entry" onClick={() => onNavigate(entry.key)}>
              <span className="uq-entry-icon" style={{ background: HUE_TINTS[entry.hue], color: HUE_COLORS[entry.hue] }}>
                <Icon name={entry.icon} />
              </span>
              <span className="uq-entry-main">
                <b>{entry.label}</b>
                <small>{entry.desc}</small>
              </span>
              <Icon name="chevron" />
            </button>
          ))}
        </div>
      </section>
      <div className="usage-note">统计来自本地调用账本；渠道不提供余额查询，没有费用数据时若白不会猜数字。</div>
    </>
  );
}

/* ---------- 模型统计 ---------- */

function ModelsView({ summary, days, setDays, loading, onBack }) {
  const rows = summary?.by_model || [];
  const grandTotal = summary?.totals?.total_tokens || 0;
  const providers = useMemo(() => {
    const grouped = new Map();
    rows.forEach((row) => {
      const name = row.provider_name || "未命名渠道";
      if (!grouped.has(name)) grouped.set(name, { name, type: row.provider_type || "other", models: [] });
      grouped.get(name).models.push(row);
    });
    return [...grouped.values()];
  }, [rows]);

  return (
    <>
      <SubTopbar title="模型统计" sub={`最近 ${days} 天 · 按渠道与模型聚合`} onBack={onBack} />
      <PeriodSeg days={days} onChange={setDays} />
      <div className="uq-models">
        {loading && !rows.length ? (
          <div className="usage-empty"><Icon name="clock" /><span>正在读取</span></div>
        ) : !providers.length ? (
          <div className="usage-empty"><Icon name="card" /><span>这个时间段还没有渠道调用记录</span></div>
        ) : providers.map((provider, providerIndex) => {
          const providerTotal = provider.models.reduce((sum, model) => sum + model.total_tokens, 0);
          const barColor = PROVIDER_BAR_COLORS[providerIndex % PROVIDER_BAR_COLORS.length];
          return (
            <article className="uq-provider" key={provider.name}>
              <div className="uq-provider-head">
                <strong>{provider.name}</strong>
                <span className="uq-provider-tag">{PROVIDER_TYPE_LABELS[provider.type] || "其他"}</span>
                <b>{formatTokens(providerTotal)}</b>
              </div>
              {provider.models.map((model, modelIndex) => {
                const share = grandTotal > 0 ? Math.round((model.total_tokens / grandTotal) * 100) : 0;
                const cost = formatCost(model.actual_cost, model.cost_currency);
                return (
                  <div className="uq-model-row" key={`${model.model}-${modelIndex}`}>
                    <div className="uq-model-row-head">
                      <span className="uq-model-name">{model.model || "模型未提供"}</span>
                      <b>{formatTokens(model.total_tokens)}</b>
                    </div>
                    <div className="uq-model-row-meta">
                      <span>输入 {formatTokens(model.input_tokens)}</span>
                      <span>输出 {formatTokens(model.output_tokens)}</span>
                      {model.cache_read_tokens > 0 && <span>缓存 {formatTokens(model.cache_read_tokens)}</span>}
                      <span>{model.calls} 次</span>
                    </div>
                    <div className="uq-model-bar"><i style={{ width: `${Math.max(share, 2)}%`, background: barColor }} /></div>
                    <div className="uq-model-row-foot">
                      <span>占总量 {share}%</span>
                      <span>{cost ? `${cost} · ` : ""}最近 {formatDate(model.last_used_at)}</span>
                    </div>
                  </div>
                );
              })}
            </article>
          );
        })}
      </div>
      <div className="usage-note">占比按 Token 消耗计算；费用数据渠道返回时才显示。</div>
    </>
  );
}

/* ---------- 分布与趋势 ---------- */

function PurposeDonut({ rows, total }) {
  const R = 46;
  const C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <svg viewBox="0 0 132 132" className="uq-donut" role="img" aria-label="消耗分布">
      <circle cx="66" cy="66" r={R} stroke="#EFE7DA" strokeWidth="20" fill="none" />
      {rows.map((row) => {
        const meta = purposeMeta(row.purpose);
        const frac = total > 0 ? row.total_tokens / total : 0;
        const len = frac * C;
        const gap = frac >= 0.999 ? 0 : 2;
        const element = (
          <circle
            key={row.purpose}
            cx="66" cy="66" r={R}
            stroke={HUE_COLORS[meta.hue]}
            strokeWidth="20"
            fill="none"
            strokeDasharray={`${Math.max(len - gap, 0.5)} ${C - len + gap}`}
            strokeDashoffset={-(acc * C) + C / 4}
            transform="rotate(-90 66 66)"
            strokeLinecap="round"
          />
        );
        acc += frac;
        return element;
      })}
      <text x="66" y="63" textAnchor="middle" className="uq-donut-num">{formatTokens(total).replace(" ", "")}</text>
      <text x="66" y="79" textAnchor="middle" className="uq-donut-sub">Token</text>
    </svg>
  );
}

function TrendLineChart({ daily, days }) {
  const buckets = useMemo(() => buildTrendBuckets(daily || [], days), [daily, days]);
  const W = 340, H = 130, PAD_X = 10, BASE = 116, TOP = 14;
  const max = Math.max(...buckets.map((bucket) => bucket.tokens), 0);
  if (!buckets.length) return null;
  const pts = buckets.map((bucket, index) => {
    const x = PAD_X + (index * (W - PAD_X * 2)) / Math.max(buckets.length - 1, 1);
    const y = max === 0 ? BASE : BASE - (bucket.tokens / max) * (BASE - TOP);
    return [Number(x.toFixed(1)), Number(y.toFixed(1))];
  });
  const line = pts.map((point, index) => `${index ? "L" : "M"}${point[0]} ${point[1]}`).join(" ");
  const area = `${line} L${pts[pts.length - 1][0]} ${BASE} L${pts[0][0]} ${BASE} Z`;
  const peakIndex = buckets.findIndex((bucket) => bucket.tokens === max);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="uq-linechart" role="img" aria-label="Token 趋势">
      <defs>
        <linearGradient id="uq-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#E45186" stopOpacity="0.22" />
          <stop offset="1" stopColor="#E45186" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`M10 28H330M10 68H330M10 108H330`} stroke="#EFE7DA" strokeWidth="1" />
      <path d={area} fill="url(#uq-area)" />
      <path d={line} stroke="#E45186" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      {peakIndex >= 0 && max > 0 && (
        <circle cx={pts[peakIndex][0]} cy={pts[peakIndex][1]} r="3.5" fill="#FFFFFF" stroke="#E45186" strokeWidth="2.5" />
      )}
    </svg>
  );
}

function DistView({ summary, days, loading, onBack }) {
  const rows = summary?.by_purpose || [];
  const total = summary?.totals?.total_tokens || 0;
  const legendRows = rows.slice(0, 4);
  return (
    <>
      <SubTopbar title="分布与趋势" sub="消耗花在哪里 · 走势怎么样" onBack={onBack} />
      <section className="uq-panel">
        <div className="uq-panel-head">
          <strong>消耗分布</strong>
          <span>最近 {days} 天 · 按用途</span>
        </div>
        {loading && !rows.length ? (
          <div className="usage-empty"><Icon name="clock" /><span>正在读取</span></div>
        ) : (
          <div className="uq-dist-body">
            <PurposeDonut rows={rows} total={total} />
            <div className="uq-legend">
              {legendRows.map((row) => {
                const meta = purposeMeta(row.purpose);
                const pct = total > 0 ? Math.round((row.total_tokens / total) * 100) : 0;
                return (
                  <div className="uq-legend-row" key={row.purpose}>
                    <span className={`uq-dot ${meta.hue}`} />
                    <span className="uq-legend-main">
                      <b>{meta.label}</b>
                      <small>{row.calls} 次 · 占 {pct}%</small>
                    </span>
                    <b className="uq-legend-val">{formatTokens(row.total_tokens)}</b>
                  </div>
                );
              })}
              {!legendRows.length && <div className="usage-empty"><Icon name="card" /><span>还没有消耗记录</span></div>}
            </div>
          </div>
        )}
      </section>
      <section className="uq-panel">
        <div className="uq-panel-head">
          <strong>Token 趋势</strong>
          <span>最近 {days} 天 · 按天</span>
        </div>
        <TrendLineChart daily={summary?.daily || []} days={days} />
        <div className="uq-chart-x uq-linechart-x">
          <span>{formatDayLabel(summary?.daily?.[0]?.day)}</span>
          <span>{formatDayLabel(summary?.daily?.[Math.floor((summary?.daily?.length || 0) / 2)]?.day)}</span>
          <span>{formatDayLabel(summary?.daily?.[summary.daily.length - 1]?.day)}</span>
        </div>
        <div className="uq-trend-legend">
          <span><i className="uq-dot rose" />总量走势</span>
          <span><i className="uq-dot-line" />峰值日</span>
        </div>
      </section>
    </>
  );
}

/* ---------- 最近调用 ---------- */

function UsageEventRow({ event }) {
  const meta = purposeMeta(event.purpose);
  const failed = event.status === "failure";
  return (
    <article className={`usage-event-row ${failed ? "failed" : ""}`}>
      <span className="usage-event-icon"><Icon name={failed ? "alert" : "check"} /></span>
      <div className="usage-event-main">
        <strong><span className={`uq-dot ${meta.hue}`} />{meta.label}</strong>
        <span>{event.provider_name || "未命名渠道"} · {event.model || "模型未提供"}</span>
        <small>
          {formatDate(event.created_at)} · {formatDuration(event.duration_ms)}
          {failed ? ` · 失败原因：${formatError(event.error_category)}` : ""}
        </small>
      </div>
      <div className="usage-event-tokens">
        <b>{failed ? "—" : formatTokensPlain(event.total_tokens)}</b>
        <span>{failed ? "调用失败" : `入 ${formatTokens(event.input_tokens)} · 出 ${formatTokens(event.output_tokens)}`}</span>
      </div>
    </article>
  );
}

function RecentView({ days, purpose, setPurpose, events, loading, onBack }) {
  return (
    <>
      <SubTopbar title="最近调用" sub="最近 30 条流水 · 含失败原因" onBack={onBack} />
      <div className="uq-chips" aria-label="调用用途">
        <button type="button" className={purpose === "all" ? "on" : ""} onClick={() => setPurpose("all")}>全部用途</button>
        {Object.entries(PURPOSE_META).map(([key, meta]) => (
          <button key={key} type="button" className={purpose === key ? "on" : ""} onClick={() => setPurpose(key)}>
            {meta.label}
          </button>
        ))}
      </div>
      <div className="usage-events">
        {loading
          ? <div className="usage-empty"><Icon name="clock" /><span>正在读取</span></div>
          : events.length
            ? events.map((event) => <UsageEventRow key={event.id} event={event} />)
            : <div className="usage-empty"><Icon name="card" /><span>这个筛选条件下还没有调用记录</span></div>}
      </div>
      <div className="usage-note">只记录调用元信息（用途/模型/Token/耗时），不记录聊天正文。</div>
    </>
  );
}

/* ---------- 主屏 ---------- */

export function UsageHealthScreen({ onBack }) {
  const [view, setView] = useState("overview");
  const [days, setDays] = useState(7);
  const [purpose, setPurpose] = useState("all");
  const [summary, setSummary] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    getUsageSummary({ days }).then((result) => {
      if (!active) return;
      if (!result?.success || !result.item) throw new Error(result?.error || "用量汇总读取失败");
      setSummary(result.item);
      setError("");
    }).catch((reason) => {
      if (!active) return;
      setSummary(null);
      setError(reason instanceof Error ? reason.message : "用量汇总读取失败");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [days]);

  useEffect(() => {
    let active = true;
    setEventsLoading(true);
    getUsageEvents({ days, purpose, limit: 30 }).then((result) => {
      if (!active) return;
      if (!result?.success || !Array.isArray(result.item?.events)) throw new Error(result?.error || "用量记录读取失败");
      setEvents(result.item.events);
    }).catch(() => {
      if (!active) return;
      setEvents([]);
    }).finally(() => { if (active) setEventsLoading(false); });
    return () => { active = false; };
  }, [days, purpose]);

  return (
    <div className="screen usage-screen anim-screen">
      {view === "overview" && (
        <OverviewView
          summary={summary}
          days={days}
          setDays={setDays}
          loading={loading}
          error={error}
          onNavigate={setView}
          onBack={onBack}
        />
      )}
      {view === "models" && (
        <ModelsView summary={summary} days={days} setDays={setDays} loading={loading} onBack={() => setView("overview")} />
      )}
      {view === "dist" && (
        <DistView summary={summary} days={days} loading={loading} onBack={() => setView("overview")} />
      )}
      {view === "recent" && (
        <RecentView
          days={days}
          purpose={purpose}
          setPurpose={setPurpose}
          events={events}
          loading={eventsLoading}
          onBack={() => setView("overview")}
        />
      )}
    </div>
  );
}
