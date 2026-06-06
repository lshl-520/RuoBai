import React from "react";
import { Icon } from "../store.jsx";
/* 动态 / 朋友圈 — 可浏览, 我也能发(宣泄口) */
const { useState: useStateM } = React;

const MOODS = ["想记录", "宣泄一下", "今天很好", "有点累", "深夜emo", "想她了"];

function MomentCard({ m, onLike }) {
  return (
    <div className="moment">
      <div className="m-avatar"><img src={m.avatar} alt={m.who} /></div>
      <div className="m-main">
        <div className="m-head">
          <span className="m-name">{m.who}</span>
          <span className={"tag tag-" + (m.tagType)}>{m.tag === "我" ? "我" : "她"}</span>
          {m.mood && <span className="tag tag-line">{m.mood}</span>}
          {m.auto && <span className="tag tag-line">自动</span>}
        </div>
        <div className="m-body">{m.content}</div>
        {m.images.length > 0 && (
          <div className={"m-imgs c" + m.images.length}>
            {m.images.map((src, i) => <img key={i} src={src} alt="" />)}
          </div>
        )}
        <div className="m-foot">
          <span className="m-time">{m.time}</span>
          <div className="m-actions">
            <button className={"m-act" + (m.liked ? " liked" : "")} onClick={() => onLike(m.id)}>
              <Icon name={m.liked ? "heartFill" : "heart"} /> {m.likes}
            </button>
            <button className="m-act"><Icon name="comment" /> {m.comments.length}</button>
          </div>
        </div>
        {m.comments.length > 0 && (
          <div className="m-comments">
            {m.comments.map((c, i) => (
              <div key={i} className="m-comment"><span className="mc-name">{c.name}</span>{c.text}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* 发动态 */
function Composer({ user, onClose, onPost }) {
  const [text, setText] = useStateM("");
  const [mood, setMood] = useStateM("");
  return (
    <div className="sheet-mask" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="sheet-head">
          <h2 className="serif">写点什么</h2>
          <button className="icon-btn" onClick={onClose} style={{ width: 34, height: 34 }}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>
        <div className="sheet-body">
          <div className="compose-head">
            <img src={user.avatar} alt="" />
            <span>{user.name}</span>
          </div>
          <textarea className="fld area" style={{ minHeight: 130 }} autoFocus value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="发泄一下也好,记录一下也好。这里没有别人,只有听你说话的她们。" />
          <div className="compose-tools">
            <button className="ct-tool"><Icon name="image" /> 配图</button>
          </div>
          <label className="field-label">此刻心情</label>
          <div className="mood-row">
            {MOODS.map((mo) => (
              <button key={mo} className={"mood-chip" + (mood === mo ? " on" : "")} onClick={() => setMood(mood === mo ? "" : mo)}>{mo}</button>
            ))}
          </div>
          <div className="compose-note">发出后,在意你的角色可能会来评论。</div>
        </div>
        <div className="sheet-foot">
          <button className="pill pill-primary grow" disabled={!text.trim()} style={!text.trim() ? { opacity: 0.5 } : null}
            onClick={() => text.trim() && onPost({ content: text.trim(), mood })}>
            发布
          </button>
        </div>
      </div>
    </div>
  );
}

function MomentsScreen({ moments, agents, user, onLike, onPost }) {
  const [composing, setComposing] = useStateM(false);
  const [filter, setFilter] = useStateM(null); // null=全部, agentId
  const list = filter ? moments.filter((m) => m.agentId === filter) : moments;
  return (
    <div className="screen anim-screen">
      <div className="statusbar on-photo"><span className="time">9:41</span><span className="notch" /><span className="icons"><Bars /></span></div>

      <div className="moments-cover">
        <img src="assets/scene-sunset.png" alt="" className="mc-bg" />
        <div className="mc-scrim" />
        <div className="mc-title serif">动态</div>
        <div className="mc-sub">她们在过自己的日子,你也可以在这儿说说话</div>
        <div className="mc-user"><img src={user.avatar} alt="" /></div>
      </div>

      {/* 头像筛选栏 */}
      <div className="mem-roles" style={{ marginTop: 2 }}>
        <button className={"mem-role" + (filter === null ? " on" : "")} onClick={() => setFilter(null)}>
          <span className="mem-role-av" style={{ display: "grid", placeItems: "center", background: "var(--rose-tint)", color: "var(--rose)" }}><Icon name="moments" style={{ width: 22, height: 22 }} /></span>
          <span className="mem-role-name">全部</span>
        </button>
        {agents.map((a) => (
          <button key={a.id} className={"mem-role" + (filter === a.id ? " on" : "")} onClick={() => setFilter(a.id)}>
            <span className="mem-role-av"><img src={a.avatar} alt={a.name} /></span>
            <span className="mem-role-name">{a.name}</span>
          </button>
        ))}
      </div>

      <div className="moments-list pad">
        {list.length === 0 && (
          <div className="empty-state">
            <img className="empty-state-img" src="/assets/empty-moments.png" alt="" />
            <div className="empty-state-title">她们还没来</div>
            <div className="empty-state-desc">但这里一直留着，等她们过来说说今天的事。</div>
          </div>
        )}
        {list.map((m) => <MomentCard key={m.id} m={m} onLike={onLike} />)}
        <div style={{ height: 20 }} />
      </div>

      <button className="fab" onClick={() => setComposing(true)}><Icon name="edit" /></button>

      {composing && (
        <Composer user={user} onClose={() => setComposing(false)}
          onPost={(data) => { onPost(data); setComposing(false); }} />
      )}
    </div>
  );
}

export { MomentsScreen };
