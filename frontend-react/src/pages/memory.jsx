import React from "react";
import { Icon } from "../store.jsx";
/* 记忆页 — 多角色记忆管理 + 完整聊天记录(查看器见 history.jsx) */
const { useState: useStateMem } = React;

/* 记忆编辑/新建 */
function MemoryEditor({ agent, memory, onClose, onSave }) {
  const editing = !!memory;
  const [content, setContent] = useStateMem(memory?.content || "");
  const [tag, setTag] = useStateMem(memory?.tag || "");
  const [category, setCategory] = useStateMem(memory?.category || "");
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
          <div className="switch-row">
            <div>
              <div className="sr-t">置顶这条记忆</div>
              <div className="sr-s">最重要的事,让她优先记得</div>
            </div>
            <button className={"toggle" + (important ? " on" : "")} onClick={() => setImportant(!important)}><i /></button>
          </div>
        </div>
        <div className="sheet-foot">
          <button className="pill pill-primary grow" onClick={() => onSave({ id: memory?.id, content, tag, category, isImportant: important })}>
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
        <span className="mem-tag serif">{m.tag}</span>
        {m.isImportant && <span className="mem-pin"><Icon name="flame" /></span>}
      </div>
      <div className="mem-content">{m.content}</div>
      <div className="mem-foot">
        <span className="mem-meta">{m.dateText}{m.category ? " · " + m.category : ""}</span>
        <div className="mem-actions">
          <button onClick={() => onPin(m)}>{m.isImportant ? "取消置顶" : "置顶"}</button>
          <button onClick={() => onEdit(m)}>编辑</button>
          <button className="del" onClick={() => onDelete(m)}>删除</button>
        </div>
      </div>
    </div>
  );
}

function MemoryScreen({ agents, memories, onAdd, onUpdate, onDelete, onPin }) {
  const [activeId, setActiveId] = useStateMem(agents[0]?.id);
  const [editor, setEditor] = useStateMem(undefined);
  const [history, setHistory] = useStateMem(false);
  const agent = agents.find((a) => a.id === activeId) || agents[0];
  const list = memories[activeId] || [];
  const sorted = [...list].sort((a, b) => (b.isImportant ? 1 : 0) - (a.isImportant ? 1 : 0));

  if (history) return <ChatHistoryView agent={agent} onBack={() => setHistory(false)} />;

  return (
    <div className="screen anim-screen">
      <div className="statusbar"><span className="time">9:41</span><span className="notch" /><span className="icons"><Bars /></span></div>
      <div className="topbar">
        <div>
          <h1>记忆</h1>
          <div className="sub">她们各自记得关于你的事</div>
        </div>
        <button className="pill pill-primary" style={{ padding: "9px 16px", fontSize: 13 }} onClick={() => setEditor(null)}>
          <Icon name="plus" /> 新建
        </button>
      </div>

      <div className="mem-roles">
        {agents.map((a) => (
          <button key={a.id} className={"mem-role" + (a.id === activeId ? " on" : "")} onClick={() => setActiveId(a.id)}>
            <span className="mem-role-av"><img src={a.avatar} alt={a.name} /></span>
            <span className="mem-role-name">{a.name}</span>
          </button>
        ))}
      </div>

      <div className="pad">
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
          <div className="mem-empty">
            <div className="serif">还没有记忆</div>
            <p>点右上角「新建」,写下要{agent.name}记住的事。</p>
          </div>
        ) : (
          <div className="mem-list">
            {sorted.map((m) => (
              <MemoryCard key={m.id} m={m}
                onPin={(x) => onPin(activeId, x)}
                onEdit={(x) => setEditor(x)}
                onDelete={(x) => onDelete(activeId, x.id)} />
            ))}
          </div>
        )}
        <div style={{ height: 24 }} />
      </div>

      {editor !== undefined && (
        <MemoryEditor agent={agent} memory={editor}
          onClose={() => setEditor(undefined)}
          onSave={(data) => {
            if (data.id) onUpdate(activeId, data); else onAdd(activeId, data);
            setEditor(undefined);
          }} />
      )}
    </div>
  );
}

export { MemoryScreen };
