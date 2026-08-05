import React from "react";
import { Icon, Bars } from "../store.jsx";
import { getRoles, getRoleAvatarRound } from "../lib/roles.js";
import { getMemories, createMemory, updateMemory as apiUpdateMemory, deleteMemory as apiDeleteMemory } from "../lib/memory.js";
import { getLifeEvents, getLifeEventSource, updateLifeEvent, deleteLifeEvent, getLifeEventStatusLabel, getLifeEventStatusHint, LIFE_EVENT_STATUS_OPTIONS } from "../lib/life-events.js";
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
    isImportant: !!m.is_important, reviewStatus: m.review_status || "active", detectedReason: m.detected_reason || "",
    sourceType: m.source_type || "manual", sourceId: m.source_id || "",
    dateText: m.created_at ? new Date(m.created_at).toLocaleDateString("zh-CN") : "",
  };
}

function fromApiLifeEvent(event) {
  return {
    id: event.id,
    title: event.title || "未命名生活事件",
    eventType: event.event_type || "life",
    status: event.status || "active",
    occurredAt: event.occurred_at || event.created_at || "",
    createdAt: event.created_at || "",
    sources: Array.isArray(event.sources) ? event.sources : [],
  };
}

function formatEventDate(value) {
  if (!value) return "时间未记录";
  const date = new Date(String(value).replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? String(value).slice(0, 16) : date.toLocaleString("zh-CN", {
    month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function formatEventSource(source) {
  const [type, id] = String(source || "").split(":");
  const label = { chat: "聊天", moment: "动态", comment: "评论", memory: "记忆" }[type] || type || "来源";
  return id ? `${label} #${id}` : label;
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
    <div className={"mem-card" + (m.isImportant ? " pinned" : "") + (m.reviewStatus === "candidate" ? " candidate" : "")}>
      <div className="mem-top">
        <span className="mem-tag serif">{m.tag || m.memoryTypeLabel}</span>
        {m.isImportant && <span className="mem-pin"><Icon name="flame" /></span>}
        {m.reviewStatus === "candidate" && <span className="mem-candidate">💡 新候选</span>}
      </div>
      <div className="mem-content">{m.content}</div>
      {m.reviewStatus === "candidate" && (
        <div className="mem-source">来源：{m.sourceType === "chat_candidate" ? "聊天" : m.sourceType} · {m.detectedReason || "系统暂存为低优先级参考"}</div>
      )}
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

function LifeEventCard({ event, onStatusChange, onOpenSource, onDelete }) {
  return (
    <div className="life-event-card">
      <div className="life-event-main">
        <div className="life-event-title">{event.title}</div>
        <div className="life-event-meta">
          {formatEventDate(event.occurredAt)} · {event.sources.length ? `${event.sources.length} 条可追溯来源` : "来源待补"}
        </div>
        {event.sources.length > 0 && (
          <div className="life-event-sources">
            {event.sources.map((source) => (
              <button key={source} type="button" className="life-event-source" title={`查看${formatEventSource(source)}原文`} onClick={() => onOpenSource(event, source)}>
                {formatEventSource(source)}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="life-event-status">
        <div className="life-event-status-row">
          <label>
            <span className="sr-only">这件事现在的状态</span>
            <select aria-label={`这件事现在的状态：${getLifeEventStatusLabel(event.status)}`} value={event.status} onChange={(e) => onStatusChange(event, e.target.value)}>
              {LIFE_EVENT_STATUS_OPTIONS.map(([value]) => <option key={value} value={value}>{getLifeEventStatusLabel(value)}</option>)}
            </select>
          </label>
          <button type="button" className="life-event-delete" title="只删除这条回顾，不删除聊天、动态或评论原文" onClick={() => onDelete(event)}>删除</button>
        </div>
        <div className="life-event-status-hint">{getLifeEventStatusHint(event.status)}</div>
      </div>
    </div>
  );
}

function SourceSheet({ event, source, loading, error, onClose }) {
  const typeLabel = { chat: "聊天", moment: "动态", comment: "评论", memory: "记忆" }[source?.type] || "来源";
  const images = source?.type === "moment" ? source.images : source?.type === "comment" ? source.moment_images : [];
  return (
    <div className="sheet-mask" onClick={onClose}>
      <div className="sheet source-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="sheet-head">
          <div>
            <h2 className="serif">查看原始来源</h2>
            <div className="source-sheet-sub">{typeLabel} · {event.title}</div>
          </div>
          <button className="icon-btn" onClick={onClose} style={{ width: 34, height: 34 }} title="关闭">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>
        <div className="sheet-body source-sheet-body">
          {loading && <div className="date-hint">正在读取这条来源…</div>}
          {!loading && error && <div className="life-event-empty">{error}</div>}
          {!loading && !error && source && (
            <>
              <div className="source-sheet-meta">{formatEventDate(source.created_at || source.occurred_at)} · 编号 #{source.id}</div>
              {source.type === "comment" && source.moment_content && (
                <div className="source-parent-context">所在动态：{source.moment_content}</div>
              )}
              {source.type === "memory" && source.tag && <div className="source-parent-context">记忆标签：{source.tag}</div>}
              {source.type === "chat" && <div className="source-speaker">{source.role === "user" ? "我" : "她"}</div>}
              <div className="source-content">{source.content || "这条来源没有文字内容。"}</div>
              {source.mood && <div className="source-parent-context">心情：{source.mood}</div>}
              {Array.isArray(images) && images.length > 0 && (
                <div className="source-images">
                  {images.map((url, index) => <img key={`${url}-${index}`} src={url} alt={`${typeLabel}图片 ${index + 1}`} />)}
                </div>
              )}
              {source.media_url && source.type === "chat" && (
                <div className="source-media"><a href={source.media_url} target="_blank" rel="noreferrer">打开附件</a></div>
              )}
              {source.deleted && <div className="source-deleted">这条来源已经标记为删除，仍保留在事件索引中，但不会再被角色使用。</div>}
            </>
          )}
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
  const [events, setEvents] = useStateMem([]);
  const [eventsLoading, setEventsLoading] = useStateMem(false);
  const [loading, setLoading] = useStateMem(true);
  const [editor, setEditor] = useStateMem(undefined);
  const [history, setHistory] = useStateMem(false);
  const [sourceSheet, setSourceSheet] = useStateMem(null);
  const [sourceData, setSourceData] = useStateMem(null);
  const [sourceLoading, setSourceLoading] = useStateMem(false);
  const [sourceError, setSourceError] = useStateMem("");
  const [actionError, setActionError] = useStateMem("");

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

  useEffectMem(() => {
    if (!activeId) {
      setEvents([]);
      setEventsLoading(false);
      return;
    }
    let cancelled = false;
    setEventsLoading(true);
    getLifeEvents(activeId)
      .then((res) => {
        if (!cancelled && res?.success && Array.isArray(res.items)) setEvents(res.items.map(fromApiLifeEvent));
      })
      .catch(() => { if (!cancelled) setEvents([]); })
      .finally(() => { if (!cancelled) setEventsLoading(false); });
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

  const refreshEvents = async () => {
    if (!activeId) return;
    try {
      const res = await getLifeEvents(activeId);
      if (res?.success && Array.isArray(res.items)) setEvents(res.items.map(fromApiLifeEvent));
    } catch (e) { /* 事件索引失败不影响原始记忆 */ }
  };

  const handleEventStatus = async (event, status) => {
    setActionError("");
    try {
      await updateLifeEvent(event.id, { status });
      setEvents((current) => current.map((item) => item.id === event.id ? { ...item, status } : item));
    } catch (e) {
      setActionError(e?.message || "这件事的状态暂时没改成功，请再试一次。");
      refreshEvents();
    }
  };

  const handleEventDelete = async (event) => {
    if (!window.confirm("只删除这条生活回顾，不会删除聊天、动态或评论原文。确定删除吗？")) return;
    setActionError("");
    try {
      await deleteLifeEvent(event.id);
      setEvents((current) => current.filter((item) => item.id !== event.id));
    } catch (e) {
      setActionError(e?.message || "这条生活回顾暂时没删掉，请再试一次。");
    }
  };

  const openEventSource = (event, sourceRef) => {
    setSourceSheet({ event, sourceRef });
  };

  useEffectMem(() => {
    if (!sourceSheet) {
      setSourceData(null);
      setSourceError("");
      setSourceLoading(false);
      return undefined;
    }
    let cancelled = false;
    setSourceData(null);
    setSourceError("");
    setSourceLoading(true);
    getLifeEventSource(sourceSheet.event.id, sourceSheet.sourceRef)
      .then((res) => {
        if (!cancelled) setSourceData(res?.source || null);
      })
      .catch((error) => {
        if (!cancelled) setSourceError(error?.message || "来源暂时无法读取");
      })
      .finally(() => {
        if (!cancelled) setSourceLoading(false);
      });
    return () => { cancelled = true; };
  }, [sourceSheet]);

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
    if (!window.confirm("只删除这张记忆卡，不会删除聊天、动态或评论原文。确定删除吗？")) return;
    setActionError("");
    try {
      await apiDeleteMemory(m.id);
      await refreshList();
    } catch (e) {
      setActionError(e?.message || "这张记忆暂时没删掉，请再试一次。");
    }
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
          {actionError && <div className="memory-action-error" role="alert">{actionError}</div>}
          <button className="history-entry" onClick={() => setHistory(true)}>
            <span className="he-ic"><Icon name="chat" /></span>
            <span className="he-main">
              <span className="he-t">和{agent.name}的完整聊天记录</span>
              <span className="he-s">夜深人静,翻看说过的每一句话</span>
            </span>
            <Icon name="chevron" className="row-chev" />
          </button>

          <div className="section-label life-event-section-label" style={{ margin: "20px 0 12px" }}>
            <span>生活事件 · {eventsLoading ? "加载中" : events.length}</span>
            {events.length > 0 && <span className="memory-lightbulb" title="这些是从聊天、动态和评论建立的可追溯索引">💡</span>}
            <span className="sl-line" />
          </div>
          {events.length > 0 ? (
            <div className="life-event-list">
              {events.map((event) => <LifeEventCard key={event.id} event={event} onStatusChange={handleEventStatus} onOpenSource={openEventSource} onDelete={handleEventDelete} />)}
            </div>
          ) : (
            <div className="life-event-empty">还没有可回顾的生活事件。原始聊天、动态和评论会继续保留。</div>
          )}

          <div className="section-label" style={{ margin: "20px 0 12px" }}>
            <span>{agent.name}记得的事 · {list.length}</span>
            {list.some((item) => item.reviewStatus === "candidate") && <span className="memory-lightbulb" title="这里有系统新发现的低优先级记忆">💡</span>}
            <span className="sl-line" />
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
      {sourceSheet && (
        <SourceSheet event={sourceSheet.event} source={sourceData} loading={sourceLoading} error={sourceError} onClose={() => setSourceSheet(null)} />
      )}
    </div>
  );
}

export { MemoryScreen };
