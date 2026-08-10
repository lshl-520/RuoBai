import React from "react";
import { Icon, Bars } from "../store.jsx";
import { Bubble } from "./chat.jsx";
import { getMessages } from "../lib/chat.js";
import { getSessionProfile } from "../lib/profile.js";
import { DEFAULT_USER_AVATAR } from "../lib/default-assets.js";
/* 聊天记录查看器 — 微信式:窗口化懒加载 + 日期分隔 + 搜索定位 + 按日期跳转 + 导出
   性能说明:即使上万条,也只渲染「最近一个窗口」(默认 30 条),
   向上滚到顶才追加上一页(每页 24 条),并保持滚动位置不跳。
   真实实现里这一页页数据来自后端分页接口(按时间游标 LIMIT/OFFSET),
   前端永远不会把全部消息塞进 DOM —— 这正是微信流畅的原因。 */
const { useState: useStateH, useRef: useRefH, useEffect: useEffectH, useLayoutEffect: useLayoutH } = React;

const HIST_INIT = 30;
const HIST_PAGE = 24;

/* 把一段历史拼成可读文本(导出用) */
function historyToText(agent, full) {
  const head = `与「${agent.name}」的聊天记录\n共 ${full.filter((m) => m.type !== "time").length} 条 · 导出于 ${new Date().toLocaleString("zh-CN")}\n${"—".repeat(20)}\n\n`;
  let lastDay = null;
  const body = full.map((m) => {
    let line = "";
    if (m.day && m.day !== lastDay) { line += `\n【${m.day}】\n`; lastDay = m.day; }
    const who = m.who === "me" ? agent && agent.userName ? agent.userName : "我" : agent.name;
    let content = m.text || "";
    if (m.type === "voice") content = `[语音 ${m.dur || ""}]`;
    if (m.type === "sticker") content = `[表情 ${m.sticker || ""}${m.label ? " " + m.label : ""}]`;
    if (m.images && m.images.length) content += ` [图片×${m.images.length}]`;
    line += `${m.time || ""}  ${who}：${content}`;
    return line;
  }).join("\n");
  return head + body + "\n";
}

function downloadHistory(agent, full) {
  const text = historyToText(agent, full);
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `与${agent.name}的聊天记录.txt`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* 后端消息 → 前端格式 */
function mapMessage(m) {
  const d = m.created_at ? new Date(m.created_at) : null;
  return {
    who: m.role === "user" ? "me" : "her",
    text: m.content || "",
    type: m.message_type || "text",
    images: m.media_url ? [m.media_url] : [],
    time: d ? d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "",
    day: d ? `${d.getMonth() + 1}/${d.getDate()}` : "",
  };
}

function ChatHistoryView({ agent, onBack, initialQuery = "" }) {
  const [full, setFull] = useStateH([]);
  const [loading, setLoading] = useStateH(true);
  const [myAvatar, setMyAvatar] = useStateH(DEFAULT_USER_AVATAR);

  /* 拉用户头像 */
  useEffectH(() => {
    getSessionProfile().then(res => {
      const av = res?.user?.avatar || res?.avatar;
      if (av) setMyAvatar(av);
    }).catch(() => {});
  }, []);

  /* 从后端拉真实聊天记录 */
  useEffectH(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await getMessages(agent.id, 5000);
        if (!cancelled && res?.success && Array.isArray(res.items)) {
          setFull(res.items.map(mapMessage));
        }
      } catch (e) { /* 静默 */ }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [agent.id]);

  const total = full.length;
  const days = React.useMemo(() => [...new Set(full.map((m) => m.day).filter(Boolean))], [full]);

  const [count, setCount] = useStateH(Math.min(full.length, HIST_INIT));
  const [q, setQ] = useStateH(initialQuery);
  const [searching, setSearching] = useStateH(Boolean(initialQuery));
  const [showDates, setShowDates] = useStateH(false);
  const [hit, setHit] = useStateH(null);

  const areaRef = useRefH(null);
  const prevH = useRefH(0);
  const loadingMore = useRefH(false);

  /* 初次/数据加载完:重置窗口并滚到底(最新一条) */
  useEffectH(() => {
    setCount(Math.min(full.length, HIST_INIT));
    setTimeout(() => { const el = areaRef.current; if (el) el.scrollTop = el.scrollHeight; }, 50);
  }, [full]);

  /* 加载更早后:保持滚动位置不跳 */
  useLayoutH(() => {
    const el = areaRef.current;
    if (el && loadingMore.current) { el.scrollTop = el.scrollHeight - prevH.current; loadingMore.current = false; }
  }, [count]);

  const onScroll = () => {
    const el = areaRef.current;
    if (!el || q.trim()) return;
    if (el.scrollTop < 64 && count < full.length && !loadingMore.current) {
      loadingMore.current = true;
      prevH.current = el.scrollHeight;
      setCount((c) => Math.min(full.length, c + HIST_PAGE));
    }
  };

  /* 定位到某条(搜索结果 / 日期跳转) */
  const locate = (gi, top) => {
    const need = full.length - gi + 3;
    setCount((c) => Math.max(c, Math.min(full.length, need)));
    setSearching(false); setQ(""); setShowDates(false);
    setHit(gi);
    setTimeout(() => {
      const el = document.getElementById((top ? "h-day-" : "h-msg-") + (top ? full[gi].day : gi));
      if (el && areaRef.current) areaRef.current.scrollTop = el.offsetTop - (top ? 8 : 110);
      setTimeout(() => setHit(null), 1700);
    }, 70);
  };
  const jumpToDay = (day) => { const gi = full.findIndex((m) => m.day === day); if (gi >= 0) locate(gi, true); };

  const matches = q.trim() ? full.map((m, i) => ({ m, i })).filter((x) => (x.m.text || "").includes(q.trim())) : [];

  /* 渲染窗口 */
  const startIdx = Math.max(0, full.length - count);
  const slice = full.slice(startIdx);
  let lastDay = null;
  const rows = slice.map((m, i) => {
    const gi = startIdx + i;
    const showDay = m.day && m.day !== lastDay;
    lastDay = m.day;
    return (
      <React.Fragment key={gi}>
        {showDay && <div className="time-div" id={"h-day-" + m.day}>{m.day}</div>}
        <div id={"h-msg-" + gi} className={"h-msg" + (hit === gi ? " h-hit" : "")}>
          <Bubble m={m} agent={agent} myAvatar={myAvatar} />
        </div>
      </React.Fragment>
    );
  });

  if (loading) {
    return (
      <div className="screen chat-screen anim-screen" style={{ background: "var(--paper)" }}>
          <header className="chat-top">
          <button className="ct-back" onClick={onBack}><Icon name="back" /></button>
          <div className="ct-info"><div className="ct-name">{agent.name}</div><div className="ct-meta">加载中…</div></div>
        </header>
        <div className="msg-area" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ opacity: 0.5 }}>正在读取聊天记录…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="screen chat-screen anim-screen" style={{ background: "var(--paper)" }}>
      <header className="chat-top">
        <button className="ct-back" onClick={onBack}><Icon name="back" /></button>
        <div className="ct-avatar"><img src={agent.avatar || "/assets/avatar-bai.png"} alt="" /></div>
        <div className="ct-info">
          <div className="ct-name">{agent.name}</div>
          <div className="ct-meta">完整聊天记录 · 共 {total} 条</div>
        </div>
        <button className="ct-ic" onClick={() => setShowDates(true)} title="按日期跳转"><Icon name="clock" /></button>
        <button className="ct-ic" onClick={() => { setSearching((s) => !s); setQ(""); }} style={searching ? { color: "var(--rose)" } : null}><Icon name="search" /></button>
        <button className="ct-ic" onClick={() => downloadHistory(agent, full)} title="导出"><Icon name="download" /></button>
      </header>

      {searching && (
        <div className="chat-search">
          <Icon name="search" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={`搜索和${agent.name}的聊天记录…`} />
          {q && <button onClick={() => setQ("")}>×</button>}
        </div>
      )}

      {/* 搜索结果列表(点一条定位回原文) */}
      {q.trim() ? (
        <div className="msg-area">
          <div className="search-note">找到 {matches.length} 条包含“{q.trim()}”的记录</div>
          {matches.map(({ m, i }) => (
            <button key={i} className="sr-row" onClick={() => locate(i)}>
              <span className="sr-meta">{m.day || ""} · {m.time || ""} · {m.who === "me" ? "我" : agent.name}</span>
              <span className="sr-text">{hl(m.text || "", q.trim())}</span>
              <span className="sr-go">定位到聊天 ›</span>
            </button>
          ))}
          {matches.length === 0 && <div className="history-hint">没有找到相关消息,换个词试试。</div>}
        </div>
      ) : (
        <div className="msg-area" ref={areaRef} onScroll={onScroll}>
          {count < full.length
            ? <div className="hist-more">↑ 继续上滑,加载更早的消息<span className="hist-more-s">已显示最近 {count} / {total} 条</span></div>
            : <div className="history-hint">· 这是你和{agent.name}最早说过的话 ·</div>}
          {rows}
          <div style={{ height: 16 }} />
        </div>
      )}

      {/* 按日期跳转 */}
      {showDates && (
        <div className="sheet-mask" onClick={() => setShowDates(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "70%" }}>
            <div className="sheet-grip" />
            <div className="sheet-head">
              <h2 className="serif">跳到某一天</h2>
              <button className="icon-btn" onClick={() => setShowDates(false)} style={{ width: 34, height: 34 }}>
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
              </button>
            </div>
            <div className="sheet-body">
              <div className="date-hint">上万条记录时,按日期直接跳转最省事 —— 不用一页页翻。</div>
              <div className="date-grid">
                {days.map((d) => <button key={d} className="date-chip" onClick={() => jumpToDay(d)}>{d}</button>)}
                {days.length === 0 && <div className="history-hint">这段记录还没有日期标记。</div>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* 高亮搜索命中词 */
function hl(text, q) {
  const idx = text.indexOf(q);
  if (idx < 0) return text;
  return <>{text.slice(0, idx)}<mark className="sr-mark">{q}</mark>{text.slice(idx + q.length)}</>;
}

export { ChatHistoryView, downloadHistory, historyToText };
