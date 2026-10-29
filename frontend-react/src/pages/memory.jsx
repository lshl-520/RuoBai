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
/* 「找得到」：记忆筛选胶囊（单选）。标签用大白话，别让人猜。 */
const MEMORY_FILTERS = [["all", "全部"], ["important", "只看置顶"], ["candidate", "只看待确认"]];

function fromApiMemory(m) {
  return {
    id: m.id, content: m.content || "", tag: m.tag || "", category: m.category || "",
    memoryType: m.memory_type || "life", memoryTypeLabel: m.memory_type_label || "普通生活",
    weight: Number(m.weight ?? 50), appointmentAt: m.appointment_at || "", appointmentStatus: m.appointment_status || "pending",
    isImportant: !!m.is_important, reviewStatus: m.review_status || "active", requiresConfirmation: !!m.requires_confirmation,
    candidateOrigin: m.candidate_origin || "", detectedReason: m.detected_reason || "",
    sourceType: m.source_type || "manual", sourceId: m.source_id || "",
    // 「每日纸条」的详细版（只有 memory_type='daily_digest' 才有）
    digestDetail: m.digest_detail || "",
    // 时间轴要用：原始时间字段都留着，别只留一个本地化字符串
    createdAt: m.created_at || "", occurredAt: m.occurred_at || "",
    dateText: m.created_at ? new Date(m.created_at).toLocaleDateString("zh-CN") : "",
  };
}

function fromApiLifeEvent(event) {
  return {
    id: event.id,
    title: event.title || "未命名生活事件",
    eventType: event.event_type || "life",
    status: event.status || "active",
    statusNote: event.status_note || "",
    occurredAt: event.occurred_at || event.created_at || "",
    expiresAt: event.expires_at || "",
    correctedAt: event.corrected_at || "",
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

function MemoryCard({ m, onPin, onEdit, onDelete, onConfirmCandidate, onViewCandidateSource }) {
  return (
    <div className={"mem-card" + (m.isImportant ? " pinned" : "") + (m.reviewStatus === "candidate" ? " candidate" : "")}>
      <div className="mem-top">
        <span className="mem-tag serif">{m.tag || m.memoryTypeLabel}</span>
        {m.isImportant && <span className="mem-pin"><Icon name="flame" /></span>}
        {m.reviewStatus === "candidate" && <span className="mem-candidate">💡 {m.candidateOrigin === "legacy_auto_detected" ? "历史待确认" : "待确认"}</span>}
      </div>
      <div className="mem-content">{m.content}</div>
      {m.reviewStatus === "candidate" && (
        <>
          <div className="mem-source">来源：{m.sourceType === "chat_candidate" ? "聊天" : m.sourceType} · {m.candidateOrigin === "legacy_auto_detected" ? "历史自动识别记录，需由你确认后才会作为正式记忆使用" : (m.detectedReason || "系统暂存为低优先级参考")}</div>
          <div className="mem-candidate-actions">
            <button type="button" onClick={() => onViewCandidateSource(m)}>查看聊天</button>
            <button type="button" className="keep" onClick={() => onConfirmCandidate(m)}>记住它</button>
            <button type="button" className="dismiss" onClick={() => onDelete(m)}>暂不保留</button>
          </div>
        </>
      )}
      <div className="mem-foot">
        <span className="mem-meta">{m.memoryTypeLabel}{m.appointmentAt ? " · " + String(m.appointmentAt).slice(0, 10) : ""}{m.category ? " · " + m.category : ""}</span>
        <div className="mem-actions">
          {m.reviewStatus !== "candidate" && <button onClick={() => onPin(m)}>{m.isImportant ? "取消置顶" : "置顶"}</button>}
          <button onClick={() => onEdit(m)}>编辑</button>
          {m.reviewStatus !== "candidate" && <button className="del" onClick={() => onDelete(m)}>删除</button>}
        </div>
      </div>
    </div>
  );
}

/* ══════════════ 时间轴（记忆 + 生活事件按时间聚合）══════════════
 *
 * 设计要点：
 *   · 五个层级（日/周/月/季/年）横滑切换，和"选角色"一样是现成的做法。
 *   · 每张卡显示"摘要"，点开才看详细 —— 摘要省空间，详细给你自己看。
 *   · 专属回忆（约定/第一次）用金色标出来。
 *   · 长记忆默认只显示两行，点开才展开全文（避免"一堵墙"）。
 */
const TIMELINE_LEVELS = [["day", "日"], ["week", "周"], ["month", "月"], ["quarter", "季"], ["year", "年"]];

/** 把后端的时间字符串转成 YYYY-MM-DD。不依赖时区，直接取日期部分，避免跨天错位。 */
function timelineDateKey(value) {
  if (!value) return "";
  const raw = String(value).trim().replace("T", " ");
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 按层级算分组键。 */
function timelineLevelKey(dateKey, level) {
  if (!dateKey) return "";
  const [y, mo, da] = dateKey.split("-").map(Number);
  if (level === "year") return String(y);
  if (level === "quarter") return `${y}-Q${Math.floor((mo - 1) / 3) + 1}`;
  if (level === "month") return `${y}-${String(mo).padStart(2, "0")}`;
  if (level === "week") {
    // ISO 周号
    const dt = new Date(Date.UTC(y, mo - 1, da));
    const dayNum = dt.getUTCDay() || 7;
    dt.setUTCDate(dt.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((dt - yearStart) / 86400000) + 1) / 7);
    return `${dt.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
  }
  return dateKey;
}

/** ISO 周号 → 那一周的真实日期范围（周一到周日）。否则"第 33 周"这种没人看得懂。 */
function isoWeekDateRange(year, week) {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const week1Mon = new Date(jan4);
  week1Mon.setUTCDate(jan4.getUTCDate() - jan4Day + 1);
  const mon = new Date(week1Mon);
  mon.setUTCDate(week1Mon.getUTCDate() + (week - 1) * 7);
  const sun = new Date(mon);
  sun.setUTCDate(mon.getUTCDate() + 6);
  const fmt = (d) => `${d.getUTCMonth() + 1} 月 ${d.getUTCDate()} 日`;
  return `${fmt(mon)} — ${fmt(sun)}`;
}

/** 分组键 → 给人看的标题（**一定带上能认出来的日期**）。 */
function timelineLevelLabel(key, level) {
  if (!key) return "时间未记录";
  if (level === "year") return `${key} 年`;
  if (level === "quarter") {
    const [y, q] = key.split("-Q");
    const n = Number(q);
    return `${y} 年第 ${n} 季 · ${(n - 1) * 3 + 1}—${n * 3} 月`;
  }
  if (level === "month") { const [y, m] = key.split("-"); return `${y} 年 ${Number(m)} 月`; }
  if (level === "week") {
    const [y, w] = key.split("-W");
    return `${y} 年第 ${Number(w)} 周 · ${isoWeekDateRange(Number(y), Number(w))}`;
  }
  const [y, m, d] = key.split("-");
  return `${y} 年 ${Number(m)} 月 ${Number(d)} 日`;
}

/** 把记忆和生活事件合成一个按时间倒序的分组列表。 */
function buildTimeline(memories, events, level) {
  const groups = new Map();
  const push = (key, kind, item, dateKey) => {
    if (!key) return;
    if (!groups.has(key)) groups.set(key, { key, dateKey, memories: [], events: [] });
    groups.get(key)[kind].push(item);
    const g = groups.get(key);
    if (dateKey && (!g.dateKey || dateKey > g.dateKey)) g.dateKey = dateKey;
  };
  for (const m of memories) {
    // ★ 优先级很重要：occurred_at 是"这件事发生在哪一天"，
    //   created_at 只是"这行记录什么时候写进来的"。
    //   每日纸条就是典型 —— 它今天生成，但讲的是**昨天**；用 created_at 会把日期全弄错。
    const dk = timelineDateKey(m.occurredAt || m.appointmentAt || m.createdAt || m.dateText);
    push(timelineLevelKey(dk, level), "memories", m, dk);
  }
  for (const e of events) {
    const dk = timelineDateKey(e.occurredAt || e.createdAt);
    push(timelineLevelKey(dk, level), "events", e, dk);
  }
  return [...groups.values()].sort((a, b) => String(b.key).localeCompare(String(a.key)));
}

/** 一张时间轴卡片：默认摘要，点开详细。 */
function TimelineCard({ group, level, agent, onPin, onEdit, onDelete, onConfirmCandidate, onViewCandidateSource, onEventStatus, onEventCorrect, onEventSource, onEventDelete }) {
  const [open, setOpen] = React.useState(false);
  // 「每日纸条」是一天的主干：它自带短摘要（content）和详细版（digestDetail）
  const digest = group.memories.find((m) => m.memoryType === "daily_digest");
  const others = group.memories.filter((m) => m.memoryType !== "daily_digest");
  const total = group.memories.length + group.events.length;

  // 摘要：优先纸条的短摘要，其次生活事件标题（本身就是一句话总结），最后才是记忆正文
  const lead = digest?.content
    || group.events[0]?.title
    || [...others].sort((a, b) => Number(b.isImportant) - Number(a.isImportant))[0]?.content
    || "（这一天有新的事）";

  const milestones = others.filter((m) => m.memoryType === "appointment" || m.memoryType === "shared_experience" || m.memoryType === "core");
  const isMilestone = milestones.length > 0;

  return (
    <div className={"tl-item" + (isMilestone ? " milestone" : "")}>
      <div className={"tl-card" + (open ? " open" : "")} onClick={() => setOpen(!open)}>
        <div className="tl-head">
          <span className="tl-date">{timelineLevelLabel(group.key, level)}</span>
          {isMilestone && <span className="tl-badge">专属回忆</span>}
          {total > 1 && <span className="tl-count">{total} 件</span>}
        </div>
        <div className="tl-sum">{lead}</div>
        <div className="tl-more">展开详细 <span className="tl-ar">▾</span></div>

        <div className="tl-detail" onClick={(e) => e.stopPropagation()}>
          <div className="tl-detail-inner">
            {/* 纸条的详细版：这是"你自己看的"那份 */}
            {digest?.digestDetail && (
              <div className="tl-digest">
                <div className="tl-digest-mark">这一天</div>
                <div className="tl-digest-text">{digest.digestDetail}</div>
              </div>
            )}
            {group.events.map((event) => (
              <div className="tl-ev" key={`e-${event.id}`}>
                <LifeEventCard event={event} onStatusChange={onEventStatus} onCorrect={onEventCorrect} onOpenSource={onEventSource} onDelete={onEventDelete} />
              </div>
            ))}
            {others.length > 0 && (
              <div className="mem-list tl-mem-list">
                {others.map((m) => (
                  <MemoryCard key={m.id} m={m}
                    onPin={onPin} onEdit={onEdit} onDelete={onDelete}
                    onConfirmCandidate={onConfirmCandidate}
                    onViewCandidateSource={onViewCandidateSource} />
                ))}
              </div>
            )}
            {total === 0 && <div className="life-event-empty">这一天还没有记下什么。</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function LifeEventCard({ event, onStatusChange, onCorrect, onOpenSource, onDelete }) {  return (
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
          <button type="button" className="life-event-delete" title="纠正这条事件的标题，不删除原始来源" onClick={() => onCorrect(event)}>纠正</button>
          <button type="button" className="life-event-delete" title="只删除这条回顾，不删除聊天、动态或评论原文" onClick={() => onDelete(event)}>删除</button>
        </div>
        <div className="life-event-status-hint">{getLifeEventStatusHint(event.status)}{event.statusNote ? ` ${event.statusNote}` : ""}</div>
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
  const [historyQuery, setHistoryQuery] = useStateMem("");
  const [sourceSheet, setSourceSheet] = useStateMem(null);
  const [sourceData, setSourceData] = useStateMem(null);
  const [sourceLoading, setSourceLoading] = useStateMem(false);
  const [sourceError, setSourceError] = useStateMem("");
  const [actionError, setActionError] = useStateMem("");
  const [timelineLevel, setTimelineLevel] = useStateMem("day");
  const [memoryQuery, setMemoryQuery] = useStateMem("");
  const [memoryFilter, setMemoryFilter] = useStateMem("all");
  // 2026/9/30：置顶区默认收起（部署方反馈：置顶条数多时全展开会把时间轴挤到很下面）
  const [pinnedOpen, setPinnedOpen] = useStateMem(false);

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

  /* ── 「找得到」：搜索（正文 / 标签 / 分类，不区分大小写）+ 筛选（全部 / 只看置顶 / 只看待确认） ──
   * 这一页以前没有搜索也没有筛选，置顶的记忆混进几百条里就找不回来了。
   * 只做"找得到"，不动记忆页的整体结构。 */
  const memoryKeyword = memoryQuery.trim().toLowerCase();
  const matchKeyword = (m) => !memoryKeyword
    || String(m.content || "").toLowerCase().includes(memoryKeyword)
    || String(m.tag || "").toLowerCase().includes(memoryKeyword)
    || String(m.category || "").toLowerCase().includes(memoryKeyword);
  const matchFilter = (m) => memoryFilter === "important" ? m.isImportant
    : memoryFilter === "candidate" ? m.reviewStatus === "candidate"
      : true;
  const visibleMemories = list.filter((m) => matchKeyword(m) && matchFilter(m));
  // 有搜索词或换了筛选就「平铺」展示：不再靠日期分组，免得结果被折叠的日期藏起来。
  const flatListing = Boolean(memoryKeyword) || memoryFilter !== "all";
  const pinDateKey = (m) => timelineDateKey(m.occurredAt || m.appointmentAt || m.createdAt || m.dateText);
  // 平铺结果里也把置顶的排前面，同一档再按时间倒序 —— 找回来的那几条总在最上面。
  const flatResults = [...visibleMemories].sort((a, b) =>
    ((b.isImportant ? 1 : 0) - (a.isImportant ? 1 : 0)) || pinDateKey(b).localeCompare(pinDateKey(a)));
  // 置顶区：默认视图里把置顶的记忆单摆一块，一眼看得到，也能直接编辑/取消置顶。
  const pinnedMemories = list.filter((m) => m.isImportant).sort((a, b) => pinDateKey(b).localeCompare(pinDateKey(a)));
  const showPinnedBlock = !flatListing && pinnedMemories.length > 0;
  const flatEmptyHint = memoryKeyword
    ? "没有找到包含这个说法的记忆。换个词试试，或者把筛选切回「全部」。"
    : "没有符合条件的记忆。把筛选切回「全部」就能看到所有回忆。";

  // 时间轴分组：记忆 + 生活事件按当前层级（日/周/月/季/年）聚合
  const timelineGroups = buildTimeline(visibleMemories, events, timelineLevel);

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
      await updateLifeEvent(event.id, { status }, activeId);
      setEvents((current) => current.map((item) => item.id === event.id ? { ...item, status } : item));
    } catch (e) {
      setActionError(e?.message || "这件事的状态暂时没改成功，请再试一次。");
      refreshEvents();
    }
  };

  const handleEventCorrection = async (event) => {
    const title = window.prompt("把这件生活事件纠正成什么？", event.title);
    if (title === null || !title.trim() || title.trim() === event.title) return;
    setActionError("");
    try {
      await updateLifeEvent(event.id, { title: title.trim(), status_note: "已按你的纠正更新" }, activeId);
      setEvents((current) => current.map((item) => item.id === event.id
        ? { ...item, title: title.trim(), statusNote: "已按你的纠正更新" }
        : item));
    } catch (e) {
      setActionError(e?.message || "这件事暂时没纠正成功，请再试一次。");
      refreshEvents();
    }
  };

  const handleEventDelete = async (event) => {
    if (!window.confirm("只删除这条生活回顾，不会删除聊天、动态或评论原文。确定删除吗？")) return;
    setActionError("");
    try {
      await deleteLifeEvent(event.id, activeId);
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
        await apiUpdateMemory(data.id, { content: data.content, tag: data.tag, category: data.category, memory_type: data.memoryType, weight: data.weight, appointment_at: data.appointmentAt, appointment_status: data.appointmentStatus, is_important: data.isImportant }, activeId);
      } else {
        await createMemory(activeId, { content: data.content, tag: data.tag, category: data.category, memory_type: data.memoryType, weight: data.weight, appointment_at: data.appointmentAt, appointment_status: data.appointmentStatus, is_important: data.isImportant });
      }
    } catch (e) { /* 静默 */ }
    setEditor(undefined);
    refreshList();
  };

  const handleDelete = async (m) => {
    const prompt = m.reviewStatus === "candidate"
      ? "暂不保留会把这张候选记忆移到已删除，不会删除原聊天。确定吗？"
      : "只删除这张记忆卡，不会删除聊天、动态或评论原文。确定删除吗？";
    if (!window.confirm(prompt)) return;
    setActionError("");
    try {
      await apiDeleteMemory(m.id, activeId);
      await refreshList();
    } catch (e) {
      setActionError(e?.message || "这张记忆暂时没删掉，请再试一次。");
    }
  };

  const handlePin = async (m) => {
    try { await apiUpdateMemory(m.id, { is_important: !m.isImportant }, activeId); } catch (e) { /* 静默 */ }
    refreshList();
  };

  const handleConfirmCandidate = async (m) => {
    setActionError("");
    try {
      const result = await apiUpdateMemory(m.id, { review_status: "active" }, activeId);
      if (result?.data) {
        const updated = fromApiMemory(result.data);
        setList((current) => current.map((item) => item.id === m.id ? updated : item));
      } else {
        await refreshList();
      }
      await refreshEvents();
    } catch (e) {
      setActionError(e?.message || "这张候选记忆暂时没确认成功，请再试一次。");
      await refreshList();
    }
  };

  const handleViewCandidateSource = (m) => {
    setHistoryQuery(m.content);
    setHistory(true);
  };

  if (history && agent) return <ChatHistoryView agent={agent} initialQuery={historyQuery} onBack={() => { setHistory(false); setHistoryQuery(""); }} />;

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

          {/* 「找得到」：搜索框（正文 / 标签 / 分类，输入即过滤，不区分大小写）+ 清空 */}
          <div className="chat-search mem-search">
            <Icon name="search" />
            <input value={memoryQuery} onChange={(e) => setMemoryQuery(e.target.value)}
              placeholder="搜记忆：写过的内容、标签或分类…" aria-label="搜索记忆" />
            {memoryQuery !== "" && <button type="button" onClick={() => setMemoryQuery("")} title="清空搜索" aria-label="清空搜索">×</button>}
          </div>

          {/* 「找得到」：一排筛选胶囊（单选，默认「全部」）—— 复用时间轴那套胶囊样式 */}
          <div className="tl-levels mem-filters" role="tablist" aria-label="筛选记忆">
            {MEMORY_FILTERS.map(([value, label]) => (
              <button key={value} type="button" role="tab" aria-selected={memoryFilter === value}
                className={"tl-lv" + (memoryFilter === value ? " on" : "")}
                onClick={() => setMemoryFilter(value)}>{label}</button>
            ))}
          </div>

          {/* 置顶区：**默认收起的一行入口**（2026/9/30 调整）。
              原因：置顶有十几条时全展开会把下面的时间轴挤到很底下（用户："我翻了好久才看到"），
              而这些记忆在时间轴里还会再出现一次（用户："是不是重复了"）。
              所以默认只留一行"置顶 · N 条"，点开才铺卡片；时间轴保持完整不动，不删任何一条。 */}
          {showPinnedBlock && (
            <>
              <button type="button" className={"pinned-toggle" + (pinnedOpen ? " open" : "")}
                onClick={() => setPinnedOpen(!pinnedOpen)} aria-expanded={pinnedOpen}>
                <span className="pt-t">置顶 · {pinnedMemories.length} 条</span>
                <span className="pt-s">{pinnedOpen ? "收起来" : "点开看（不用往下翻）"}</span>
                <span className="pt-chev">{pinnedOpen ? "▾" : "▸"}</span>
              </button>
              {pinnedOpen && (
                <div className="mem-list pinned-list">
                  {pinnedMemories.map((m) => (
                    <MemoryCard key={`pin-${m.id}`} m={m}
                      onPin={(x) => handlePin(x)}
                      onEdit={(x) => setEditor(x)}
                      onDelete={(x) => handleDelete(x)}
                      onConfirmCandidate={(x) => handleConfirmCandidate(x)}
                      onViewCandidateSource={(x) => handleViewCandidateSource(x)} />
                  ))}
                </div>
              )}
            </>
          )}

          <div className="section-label" style={{ margin: "20px 0 10px" }}>
            <span>{flatListing ? `找到 ${flatResults.length} 条记忆` : `我们的回忆 · ${timelineGroups.length} 段`}</span>
            {list.some((item) => item.reviewStatus === "candidate") && <span className="memory-lightbulb" title="这里有系统新发现的低优先级记忆" />}
            <span className="sl-line" />
          </div>

          {/* 层级切换：日 / 周 / 月 / 季 / 年（横滑，和"选角色"一个做法）。搜索/筛选时结果是平铺的，这排就先收起来 */}
          {!flatListing && (
            <div className="tl-levels" role="tablist" aria-label="切换时间粒度">
              {TIMELINE_LEVELS.map(([value, label]) => (
                <button key={value} type="button" role="tab" aria-selected={timelineLevel === value}
                  className={"tl-lv" + (timelineLevel === value ? " on" : "")}
                  onClick={() => setTimelineLevel(value)}>{label}</button>
              ))}
            </div>
          )}

          {flatListing ? (
          /* 搜索/筛选结果：平铺，不按日期分组（否则会被折叠的日期藏起来） */
          flatResults.length === 0 ? (
            <div className="life-event-empty">{flatEmptyHint}</div>
          ) : (
            <div className="mem-list">
              {flatResults.map((m) => (
                <MemoryCard key={m.id} m={m}
                  onPin={(x) => handlePin(x)}
                  onEdit={(x) => setEditor(x)}
                  onDelete={(x) => handleDelete(x)}
                  onConfirmCandidate={(x) => handleConfirmCandidate(x)}
                  onViewCandidateSource={(x) => handleViewCandidateSource(x)} />
              ))}
            </div>
          )
        ) : sorted.length === 0 && events.length === 0 ? (
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
          <div className="tl-wrap">
            {timelineGroups.map((group) => (
              <TimelineCard key={group.key} group={group} level={timelineLevel} agent={agent}
                onPin={(x) => handlePin(x)}
                onEdit={(x) => setEditor(x)}
                onDelete={(x) => handleDelete(x)}
                onConfirmCandidate={(x) => handleConfirmCandidate(x)}
                onViewCandidateSource={(x) => handleViewCandidateSource(x)}
                onEventStatus={handleEventStatus}
                onEventCorrect={handleEventCorrection}
                onEventSource={openEventSource}
                onEventDelete={handleEventDelete} />
            ))}
            {eventsLoading && <div className="date-hint tl-loading">正在加载生活事件…</div>}
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
