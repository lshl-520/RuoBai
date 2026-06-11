import React from "react";
import { Icon, Bars } from "../store.jsx";
import { getRoles } from "../lib/roles.js";
import { getMoments, createMoment, likeMoment as apiLike } from "../lib/moments.js";
import { getSessionProfile } from "../lib/profile.js";
/* 动态 / 朋友圈 — 从后端拉真实数据 */
const { useState: useStateM, useEffect: useEffectM } = React;

const MOODS = ["想记录", "宣泄一下", "今天很好", "有点累", "深夜emo", "想她了"];

/* 后端动态 → 前端格式 */
function mapMoment(m, agentsMap, user) {
  const isUser = !m.character_id;
  const agent = agentsMap.get(m.character_id);
  const d = m.created_at ? new Date(m.created_at) : null;
  const timeStr = d ? `${d.getMonth() + 1}/${d.getDate()} ${d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}` : "";
  return {
    id: m.id,
    who: isUser ? (user?.name || "我") : (agent?.name || "她"),
    agentId: m.character_id || 0,
    avatar: isUser ? (user?.avatar || "/assets/avatar.png") : (agent?.avatar || "/assets/avatar-bai.png"),
    tag: isUser ? "我" : "她",
    tagType: isUser ? "lav" : "rose",
    time: timeStr,
    content: m.content || "",
    mood: "",
    images: Array.isArray(m.images) ? m.images : [],
    likes: m.likes_count || 0,
    liked: !!m.liked,
    comments: (m.comments || []).map((c) => ({
      name: c.character_id ? (agentsMap.get(c.character_id)?.name || "她") : (user?.name || "我"),
      text: c.content || "",
    })),
  };
}

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

function MomentsScreen({ moments: momentsProp, agents: agentsProp, user: userProp, onLike: onLikeProp, onPost: onPostProp }) {
  const [composing, setComposing] = useStateM(false);
  const [filter, setFilter] = useStateM(null);

  /* 从后端拉真实数据 */
  const [realAgents, setRealAgents] = useStateM(null);
  const [realMoments, setRealMoments] = useStateM(null);
  const [realUser, setRealUser] = useStateM(null);
  const [loading, setLoading] = useStateM(true);

  const agents = realAgents || agentsProp || [];
  const user = realUser || userProp || { name: "我", avatar: "/assets/avatar.png" };

  const agentsMap = React.useMemo(() => {
    const m = new Map();
    agents.forEach((a) => m.set(a.id, a));
    return m;
  }, [agents]);

  const fetchMoments = async (charId) => {
    try {
      const res = await getMoments(charId ? { characterId: charId } : {});
      if (res?.success && Array.isArray(res.items)) {
        setRealMoments(res.items.map((m) => mapMoment(m, agentsMap, user)));
      }
    } catch (e) { /* 静默 */ }
  };

  useEffectM(() => {
    (async () => {
      try {
        const [rolesRes, sessionRes] = await Promise.all([
          getRoles().catch(() => null),
          getSessionProfile().catch(() => null),
        ]);
        if (rolesRes?.success && Array.isArray(rolesRes.items)) {
          setRealAgents(rolesRes.items.map((r) => ({
            id: r.id, name: r.name, isDefault: !!r.is_active,
            avatar: r.avatar || "/assets/avatar-bai.png",
          })));
        }
        if (sessionRes?.success && sessionRes.user) {
          setRealUser({
            name: sessionRes.user.nickname || sessionRes.user.username,
            avatar: sessionRes.user.avatar || "/assets/avatar.png",
          });
        }
      } catch (e) { /* 静默 */ }
      setLoading(false);
    })();
  }, []);

  /* agents 和 user 加载好后再拉动态（需要 agentsMap 做字段映射） */
  useEffectM(() => {
    if (loading) return;
    fetchMoments(filter);
  }, [loading, filter, agents.length]);

  const moments = realMoments ?? momentsProp ?? [];
  const list = filter ? moments.filter((m) => m.agentId === filter) : moments;

  const handleLike = async (id) => {
    try { await apiLike(id); } catch (e) { /* 静默 */ }
    fetchMoments(filter);
  };

  const handlePost = async (data) => {
    try {
      await createMoment({ content: data.content, mood: data.mood });
    } catch (e) { /* 静默 */ }
    setComposing(false);
    fetchMoments(filter);
  };
  return (
    <div className="screen anim-screen">

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
        {list.map((m) => <MomentCard key={m.id} m={m} onLike={handleLike} />)}
        <div style={{ height: 20 }} />
      </div>

      <button className="fab" onClick={() => setComposing(true)}><Icon name="edit" /></button>

      {composing && (
        <Composer user={user} onClose={() => setComposing(false)}
          onPost={handlePost} />
      )}
    </div>
  );
}

export { MomentsScreen };
