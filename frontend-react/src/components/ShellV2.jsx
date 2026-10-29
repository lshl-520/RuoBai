import React, { useEffect, useState } from "react";
import { Icon } from "../store.jsx";
import { getLifeEvents } from "../lib/life-events.js";
import { getRoles, getRoleFullPortrait } from "../lib/roles.js";

/**
 * 新骨架 v2（2026/10/19 起落地）
 * 只负责「左导航 / 中内容 / 右边是她」这三块怎么摆，
 * 页面内容原样复用现有路由，不改功能、不改数据。
 * 默认不启用：用 ?ui=v2 打开预览，?ui=classic 关掉。
 */
const NAV = [
  { key: "chat",    path: "/chat",       label: "聊天", icon: "chat" },
  { key: "agents",  path: "/characters", label: "角色", icon: "agents" },
  { key: "moments", path: "/moments",    label: "动态", icon: "moments" },
  { key: "memory",  path: "/memory",     label: "记忆", icon: "book" },
  { key: "me",      path: "/profile",    label: "我的", icon: "me" },
];

function Rail({ path, onNavigate }) {
  return (
    <aside className="rb-shell-rail" aria-label="主导航">
      <div className="rb-rail-brand">
        若白
        <small>RUOBAI</small>
      </div>
      <nav className="rb-rail-nav">
        {NAV.map((item) => (
          <button
            key={item.key}
            type="button"
            className={"rb-rail-item" + (path === item.path ? " active" : "")}
            aria-current={path === item.path ? "page" : undefined}
            onClick={() => onNavigate(item.path)}
          >
            <Icon name={item.icon} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
      <div className="rb-rail-foot">
        v2 骨架预览 · 内容还是原来的页面
      </div>
    </aside>
  );
}

function pickMainRole(list) {
  if (!Array.isArray(list) || !list.length) return null;
  return list.find((item) => item?.isDefault || item?.is_default || item?.is_primary) || list[0];
}

function Her({ agent, onChat }) {
  // 这里先放「她最近记下的事」（真实生活事件），
  // 等时间线接口接上来，再换成真正的「她此刻」。
  const [notes, setNotes] = useState(null);
  const agentId = agent?.id;

  useEffect(() => {
    let cancelled = false;
    if (!agentId) { setNotes(null); return () => { cancelled = true; }; }
    setNotes(null);
    getLifeEvents(agentId, { limit: 3 })
      .then((res) => {
        if (cancelled) return;
        const items = Array.isArray(res?.items) ? res.items : [];
        setNotes(items.map((item) => String(item?.title || "").trim()).filter(Boolean).slice(0, 3));
      })
      .catch(() => { if (!cancelled) setNotes([]); });
    return () => { cancelled = true; };
  }, [agentId]);

  const portrait = agent ? getRoleFullPortrait(agent) : "";

  return (
    <aside className="rb-shell-her" aria-label="她">
      <div className="rb-her-figure">
        {portrait
          ? <img src={portrait} alt={agent?.name ? agent.name + "的立绘" : "她的立绘"} />
          : <div className="rb-her-empty">还没有她的立绘</div>}
      </div>

      <div className="rb-her-meta">
        <div className="rb-her-name">{agent?.name || "她"}</div>
        <div className="rb-her-tagline">{agent?.tagline || "她还没写下自己的签名"}</div>
      </div>

      <div className="rb-her-notes">
        <div className="rb-her-notes-title">她最近记下的事</div>
        {notes === null && <div className="rb-her-note-empty">正在翻她的小本子…</div>}
        {notes && notes.length === 0 && <div className="rb-her-note-empty">这几天还没记下什么。</div>}
        {notes && notes.map((text, index) => (
          <div className="rb-her-note" key={index}>{text}</div>
        ))}
      </div>

      <button type="button" className="rb-her-cta" onClick={() => agent && onChat(agent)}>
        去找她说话
      </button>
    </aside>
  );
}

export function ShellV2({ agents = [], path, onNavigate, onChat, children }) {
  // 右栏要的是"她的主角色"，这里自己取一次，不依赖各页面往 App 里塞状态。
  const [fetched, setFetched] = useState(null);
  useEffect(() => {
    let cancelled = false;
    getRoles()
      .then((data) => {
        if (cancelled) return;
        setFetched(Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []));
      })
      .catch(() => { if (!cancelled) setFetched([]); });
    return () => { cancelled = true; };
  }, []);

  const list = (fetched && fetched.length ? fetched : agents) || [];
  const agent = pickMainRole(list);

  return (
    <>
      <Rail path={path} onNavigate={onNavigate} />
      {children}
      <Her agent={agent} onChat={onChat} />
    </>
  );
}

export default ShellV2;