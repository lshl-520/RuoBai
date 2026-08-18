import React, { useEffect, useMemo, useState } from "react";
import { Icon } from "../store.jsx";
import { getUsageEvents } from "../lib/profile.js";

const PURPOSE_LABELS = {
  chat: "主回复",
  inner_os: "内心 OS",
  image: "画图发图",
  tts: "文字转语音",
  realtime: "实时通话",
  other: "其他调用",
};

function formatToken(value) {
  if (value === null || value === undefined) return "未提供";
  return Number(value).toLocaleString("zh-CN");
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

function formatCost(events) {
  const known = events.filter((event) => event.actual_cost !== null && event.actual_cost !== undefined);
  if (!known.length) return "费用未提供";
  const currency = known.find((event) => event.cost_currency)?.cost_currency || "USD";
  const total = known.reduce((sum, event) => sum + Number(event.actual_cost || 0), 0);
  return `${currency} ${total.toFixed(4)}`;
}

function UsageOverview({ events, loading }) {
  const totalTokens = events.reduce((sum, event) => sum + Number(event.total_tokens || 0), 0);
  const failed = events.filter((event) => event.status === "failure").length;
  if (loading) {
    return <section className="usage-overview loading"><Icon name="clock" /><strong>正在读取调用记录</strong><span>只读取必要的统计信息，不读取聊天正文。</span></section>;
  }
  if (!events.length) {
    return <section className="usage-overview empty"><Icon name="shield" /><div><strong>等待第一笔记录</strong><span>完成一次调用后，会在这里说明它做了什么。</span></div></section>;
  }
  return (
    <section className="usage-overview has-data">
      <div className="usage-overview-mark"><Icon name={failed ? "alert" : "check"} /></div>
      <div className="usage-overview-copy">
        <strong>{events.length} 次调用 · {formatToken(totalTokens)} Token</strong>
        <span>{failed ? `${failed} 次失败，原因会在最近用量里标明。` : "最近 7 天调用都已记录。"}</span>
      </div>
      <div className="usage-overview-cost">{formatCost(events)}</div>
    </section>
  );
}

function ProviderCard({ name, events, fallbackType = "other" }) {
  const hasEvents = events.length > 0;
  const failed = events.filter((event) => event.status === "failure").length;
  const statusText = !hasEvents
    ? name === "DeepSeek" ? "官方余额 · 未查询" : "费用未提供"
    : failed ? `${failed} 次失败 · 请查看记录` : `${events.length} 次调用 · Token 已记录`;
  return (
    <article className={`usage-provider-card ${hasEvents ? "has-data" : "waiting"}`}>
      <div className={`usage-provider-mark ${name === "DeepSeek" ? "deepseek" : fallbackType}`}><Icon name={name === "DeepSeek" ? "globe" : "cpu"} /></div>
      <div className="usage-provider-main">
        <strong>{name}</strong>
        <span>{hasEvents ? `${formatToken(events.reduce((sum, event) => sum + Number(event.total_tokens || 0), 0))} Token · ${formatCost(events)}` : name === "DeepSeek" ? "官方余额仅在可查询时显示" : "会记录 Token、耗时和结果"}</span>
      </div>
      <span className={`usage-status ${failed ? "warning" : hasEvents ? "ok" : "info"}`}>{statusText}</span>
    </article>
  );
}

function UsageEventRow({ event }) {
  return (
    <article className={`usage-event-row ${event.status === "failure" ? "failed" : ""}`}>
      <span className="usage-event-icon"><Icon name={event.status === "failure" ? "alert" : "check"} /></span>
      <div className="usage-event-main">
        <strong>{PURPOSE_LABELS[event.purpose] || event.purpose || "其他调用"}</strong>
        <span>{event.provider_name || "未命名渠道"} · {event.model || "模型未提供"}</span>
        <small>{formatDate(event.created_at)} · {formatDuration(event.duration_ms)}</small>
      </div>
      <div className="usage-event-tokens">
        <b>{formatToken(event.total_tokens)}</b>
        <span>{event.status === "failure" ? (event.error_category || "调用失败") : "Token"}</span>
      </div>
    </article>
  );
}

export function UsageHealthScreen({ onBack }) {
  const [days, setDays] = useState(7);
  const [purpose, setPurpose] = useState("all");
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    getUsageEvents({ days, purpose, limit: 100 }).then((result) => {
      if (!active) return;
      if (!result?.success || !Array.isArray(result.item?.events)) throw new Error(result?.error || "用量记录读取失败");
      setEvents(result.item.events);
    }).catch((reason) => {
      if (!active) return;
      setEvents([]);
      setError(reason instanceof Error ? reason.message : "用量记录读取失败");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [days, purpose]);

  const providers = useMemo(() => {
    const grouped = new Map();
    events.forEach((event) => {
      const name = event.provider_name || "其他渠道";
      grouped.set(name, [...(grouped.get(name) || []), event]);
    });
    return grouped;
  }, [events]);

  return (
    <div className="screen usage-screen anim-screen">
      <div className="usage-topbar">
        <button className="usage-back" type="button" onClick={onBack} aria-label="返回我的"><Icon name="back" /></button>
        <div><h1>用量与健康</h1><p>你的调用与渠道状态，只记录必要信息</p></div>
      </div>

      <div className="usage-filters">
        <label><span className="sr-only">统计时间</span><select value={days} onChange={(event) => setDays(Number(event.target.value))}><option value={7}>最近 7 天</option><option value={30}>最近 30 天</option><option value={90}>最近 90 天</option></select></label>
        <label><span className="sr-only">调用用途</span><select value={purpose} onChange={(event) => setPurpose(event.target.value)}><option value="all">全部用途</option>{Object.entries(PURPOSE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      </div>

      {error && <div className="usage-error" role="alert">{error}</div>}
      <UsageOverview events={events} loading={loading} />

      <section className="usage-section">
        <h2>渠道状态</h2>
        <div className="usage-provider-list">
          {providers.size === 0 ? <><ProviderCard name="DeepSeek" events={[]} /><ProviderCard name="其他渠道" events={[]} /></> : [...providers.entries()].map(([name, items]) => <ProviderCard key={name} name={name} events={items} />)}
        </div>
      </section>

      <section className="usage-section">
        <h2>最近用量</h2>
        <div className="usage-events">
          {loading ? <div className="usage-empty"><Icon name="clock" /><span>正在读取</span></div> : events.length ? events.slice(0, 20).map((event) => <UsageEventRow key={event.id} event={event} />) : <div className="usage-empty"><Icon name="card" /><span>还没有用量记录</span></div>}
        </div>
      </section>
      <div className="usage-note">没有余额或费用数据时，若白不会猜一个数字。</div>
    </div>
  );
}
