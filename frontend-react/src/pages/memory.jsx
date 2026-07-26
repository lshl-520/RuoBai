import React from "react";
import { Icon, Bars } from "../store.jsx";
import { getRoles, getRoleAvatarRound } from "../lib/roles.js";
import { getMemories, createMemory, updateMemory as apiUpdateMemory, deleteMemory as apiDeleteMemory } from "../lib/memory.js";
import { ChatHistoryView } from "./history.jsx";
import { DEFAULT_ROLE_AVATAR, fallbackToDefaultRoleAvatar } from "../lib/default-assets.js";
/* 记忆页 — 多角色记忆管理 + 完整聊天记录 */
const { useState: useStateMem, useEffect: useEffectMem } = React;
const MEMORY_TYPES = [
  ["life", "普通生活"], ["important_event", "重要事件"], ["shared_experience", "共同经历"],
  ["emotional", "情感记忆"], ["core", "核心记忆"], ["appointment", "未来约定"],
];
const APPOINTMENT_STATUSES = [["pending", "待发生"], ["completed", "已完成"], ["cancelled", "已取消"]];

function fromApiMemory(m) {
  return {
    id: m.id, content: m.content || "", tag: m.tag || "", category: m.category || "",
    memoryType: m.memory_type || "life", memoryTypeLabel: m.memory_type_label || "普通生活",
    weight: Number(m.weight ?? 50), appointmentAt: m.appointment_at || "", appointmentStatus: m.appointment_status || "pending",
    isImportant: !!m.is_important, dateText: m.created_at ? new Date(m.created_at).toLocaleDateString("zh-CN") : "",
  };
}

/* 记忆编辑/新建 */
function MemoryEditor({ agent, memory, onClose, onSave }) {
  const editing = !!memory;
  const [content, setContent] = useStateMem(memory?.content || "");
  const [tag, setTag] = useStateMem(memory?.tag || "");
  const [category, setCategory] = useStateMem(memory?.category || "");
  const [memoryType, setMemoryType] = useStateMem(memory?.memoryType || "life");
  const [weight, setWeight] = useStateMem(memory?.weight ?? 50);
  const [appointmentAt, setAppointmentAt] = useStateMem(memory?.appointmentAt ? String(memory.appointmentAt).slice(0, 16).replace(" ", "T") : "");
  const [appointmentStatus, setAppointmentStatus] = useStateMem(memory?.appointmentStatus || "pending");
  const [important, setImportant] = useStateMem(memory?.isImportant || false);
  return (
    <div className="sheet-mask" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="sheet-head">
          <h2 className="serif">{editing ? "编辑记忆" : `要 ${agent.name} 记住的事`}</h2>
          <button className="icon-btn" onClick={onClose} style={{ width: 34, height: 34 }}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>
        <div className="sheet-body">
          <label className="field-label">记忆内容</label>
          <textarea className="fld area" value={content} onChange={(e) => setContent(e.target.value)} placeholder="写下要她记住的事——一件小事、一个约定、一处雷区。" />
          <label className="field-label">标签</label>
          <input className="fld" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="例如:他撑不住的样子" />
          <label className="field-label">分类 <span className="lbl-hint">喜好 / 约定 / 底色…</span></label>
          <input className="fld" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="在意" />
          <label className="field-label">记忆类型</label>
          <select className="fld" value={memoryType} onChange={(e) => setMemoryType(e.target.value)}>
            {MEMORY_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          {memoryType === "appointment" && <>
            <label className="field-label">约定时间 <span className="lbl-hint">可稍后补充</span></label>
            <input className="fld" type="datetime-local" value={appointmentAt} onChange={(e) => setAppointmentAt(e.target.value)} />
            <label className="field-label">约定状态</label>
            <select className="fld" value={appointmentStatus} onChange={(e) => setAppointmentStatus(e.target.value)}>
              {APPOINTMENT_STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </>}
          <div className="switch-row">
            <div>
              <div className="sr-t">置顶这条记忆</div>
              <div className="sr-s">最重要的事,让她优先记得</div>
            </div>
            <button className={"toggle" + (important ? " on" : "")} onClick={() => setImportant(!important)}><i /></button>
          </div>
        </div>
        <div className="sheet-foot">
          <button className="pill pill-primary grow" onClick={() => onSave({ id: memory?.id, content, tag, category, memoryType, weight, appointmentAt, appointmentStatus, isImportant: important })}>
            {editing ? "保存" : "记住它"}
          </button>
        </div>
      </div>
    </div>
  );
}

function MemoryCard({ m, onPin, onEdit, onDelete }) {
  return (
    <div className={"mem-card" + (m.isImportant ? " pinned" : "")}>
      <div className="mem-top">
        <span className="mem-tag serif">{m.tag || m.memoryTypeLabel}</span>
        {m.isImportant && <span className="mem-pin"><Icon name="flame" /></span>}
      </div>
      <div className="mem-content">{m.content}</div>
      <div className="mem-foot">
        <span className="mem-meta">{m.memoryTypeLabel}{m.appointmentAt ? " · " + String(m.appointmentAt).slice(0, 10) : ""}{m.category ? " · " + m.category : ""}</span>
        <div className="mem-actions">
          <button onClick={() => onPin(m)}>{m.isImportant ? "取消置顶" : "置顶"}</button>
          <button onClick={() => onEdit(m)}>编辑</button>
          <button className="del" onClick={() => onDelete(m)}>删除</button>
        </div>
      </div>
    </div>
  );
}

function MemoryScreen() {
  const [realAgents, setRealAgents] = useStateMem(null);
  const agents = realAgents ?? [];
  const rolesLoaded = realAgents !== null;
  const hasAgents = agents.length > 0;

  const [activeId, setActiveId] = useStateMem(null);
  const [list, setList] = useStateMem([]);
  const [loading, setLoading] = useStateMem(true);
  const [editor, setEditor] = useStateMem(undefined);
  const [history, setHistory] = useStateMem(false);

  /* 拉真实角色列表 */
  useEffectMem(() => {
    (async () => {
      try {
        const res = await getRoles();
        if (res?.success && Array.isArray(res.items)) {
          const mapped = res.items.map((r) => ({
            id: r.id, name: r.name, isDefault: !!r.is_active,
            avatar: getRoleAvatarRound(r) || DEFAULT_ROLE_AVATAR,
          }));
          setRealAgents(mapped);
          if (mapped.length && !activeId) setActiveId(mapped[0].id);
          if (mapped.length === 0) {
            setActiveId(null);
            setList([]);
            setLoading(false);
          }
        }
      } catch (e) {
        setRealAgents([]);
        setActiveId(null);
        setList([]);
        setLoading(false);
      }
    })();
  }, []);

  /* 初始化：如果没选中角色且 agents 有数据，选第一个 */
  useEffectMem(() => {
    if (!activeId && agents.length) setActiveId(agents[0].id);
  }, [agents]);

  /* 切换角色时拉该角色的记忆 */
  useEffectMem(() => {
    if (!activeId) {
      setList([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await getMemories(activeId);
        if (!cancelled && res?.success && Array.isArray(res.data)) {
          setList(res.data.map(fromApiMemory));
        }
      } catch (e) { setList([]); }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [activeId]);

  const agent = agents.find((a) => a.id === activeId) || agents[0] || null;
  const sorted = [...list].sort((a, b) => (b.isImportant ? 1 : 0) - (a.isImportant ? 1 : 0));

  /* 操作：调后端 API 后刷新列表 */
  const refreshList = async () => {
    if (!activeId) return;
    try {
      const res = await getMemories(activeId);
      if (res?.success && Array.isArray(res.data)) {
        setList(res.data.map(fromApiMemory));
      }
    } catch (e) { /* 静默 */ }
  };

  const handleSave = async (data) => {
    if (!activeId) return;
    try {
      if (data.id) {
        await apiUpdateMemory(data.id, { content: data.content, tag: data.tag, category: data.category, memory_type: data.memoryType, weight: data.weight, appointment_at: data.appointmentAt, appointment_status: data.appointmentStatus, is_important: data.isImportant });
      } else {
        await createMemory(activeId, { content: data.content, tag: data.tag, category: data.category, memory_type: data.memoryType, weight: data.weight, appointment_at: data.appointmentAt, appointment_status: data.appointmentStatus, is_important: data.isImportant });
      }
    } catch (e) { /* 静默 */ }
    setEditor(undefined);
    refreshList();
  };

  const handleDelete = async (m) => {
    try { await apiDeleteMemory(m.id); } catch (e) { /* 静默 */ }
    refreshList();
  };

  const handlePin = async (m) => {
    try { await apiUpdateMemory(m.id, { is_important: !m.isImportant }); } catch (e) { /* 静默 */ }
    refreshList();
  };

  if (history && agent) return <ChatHistoryView agent={agent} onBack={() => setHistory(false)} />;

  return (
    <div className="screen anim-screen">
      <div className="topbar">
        <div>
          <h1>记忆</h1>
          <div className="sub">她们各自记得关于你的事</div>
        </div>
        <button className="pill pill-primary" style={{ padding: "9px 16px", fontSize: 13 }} disabled={!hasAgents} onClick={() => hasAgents && setEditor(null)}>
          <Icon name="plus" /> 新建
        </button>
      </div>

      <div className="mem-roles">
        {agents.map((a) => (
          <button key={a.id} className={"mem-role" + (a.id === activeId ? " on" : "")} onClick={() => setActiveId(a.id)}>
            <span className="mem-role-av"><img src={a.avatar} alt={a.name} onError={fallbackToDefaultRoleAvatar} /></span>
            <span className="mem-role-name">{a.name}</span>
          </button>
        ))}
      </div>

      <div className="pad">
        {!rolesLoaded ? (
          <div className="date-hint">正在加载角色...</div>
        ) : !hasAgents ? (
          <div className="empty-immersive memory-empty-full">
            <picture>
              <source srcSet="/assets/empty-memory.webp" type="image/webp" />
              <img className="empty-immersive-img" src="/assets/empty-memory.png" alt="" />
            </picture>
            <div className="empty-immersive-scrim" />
            <div className="empty-immersive-guide">
              <div className="empty-state-title">这里还没有角色</div>
              <div className="empty-state-desc">先创建或恢复公开版小白，<br/>再写下要她记住的事。</div>
              <button className="empty-state-btn" onClick={() => window.location.href = "/characters"}>去迎回第一个她</button>
            </div>
          </div>
        ) : (<>
          <button className="history-entry" onClick={() => setHistory(true)}>
            <span className="he-ic"><Icon name="chat" /></span>
            <span className="he-main">
              <span className="he-t">和{agent.name}的完整聊天记录</span>
              <span className="he-s">夜深人静,翻看说过的每一句话</span>
            </span>
            <Icon name="chevron" className="row-chev" />
          </button>

          <div className="section-label" style={{ margin: "20px 0 12px" }}>
            <span>{agent.name}记得的事 · {list.length}</span><span className="sl-line" />
          </div>

          {sorted.length === 0 ? (
          <div className="empty-immersive memory-empty-full">
            <picture>
              <source srcSet="/assets/empty-memory.webp" type="image/webp" />
              <img className="empty-immersive-img" src="/assets/empty-memory.png" alt="" />
            </picture>
            <div className="empty-immersive-scrim" />
            <div className="empty-immersive-guide">
              <div className="empty-state-title">以后的每一天</div>
              <div className="empty-state-desc">她都会记住。点右上角「新建」，写下要{agent.name}记住的事。</div>
            </div>
          </div>
        ) : (
          <div className="mem-list">
            {sorted.map((m) => (
              <MemoryCard key={m.id} m={m}
                onPin={(x) => handlePin(x)}
                onEdit={(x) => setEditor(x)}
                onDelete={(x) => handleDelete(x)} />
            ))}
          </div>
          )}
        </>)}
        <div style={{ height: 24 }} />
      </div>

      {editor !== undefined && agent && (
        <MemoryEditor agent={agent} memory={editor}
          onClose={() => setEditor(undefined)}
          onSave={handleSave} />
      )}
    </div>
  );
}

export { MemoryScreen };
