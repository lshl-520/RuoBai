import React from "react";
import { Icon, Bars } from "../store.jsx";
import { getRoles, getRolePortraitSrc, getRoleAvatarRound } from "../lib/roles.js";
import { getMoments, createMoment, likeMoment as apiLike, deleteMoment as apiDelete } from "../lib/moments.js";
import { getSessionProfile } from "../lib/profile.js";
/* 动态 / 朋友圈 — 从后端拉真实数据 */
const { useState: useStateM, useEffect: useEffectM } = React;

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
    mood: m.mood || "",
    images: Array.isArray(m.images) ? m.images : [],
    likes: m.likes_count || 0,
    liked: !!m.liked,
    isUser,
    comments: (m.comments || []).map((c) => ({
      name: c.character_id ? (agentsMap.get(c.character_id)?.name || "她") : (user?.name || "我"),
      text: c.content || "",
    })),
  };
}

function MomentCard({ m, onLike, onDelete, currentUserId }) {
  const [isLiking, setIsLiking] = React.useState(false);
  const moodTags = m.mood ? m.mood.trim().split(/\s+/).filter(Boolean) : [];

  const handleLike = async () => {
    if (isLiking) return;
    setIsLiking(true);
    await onLike(m.id);
    setTimeout(() => setIsLiking(false), 300);
  };

  return (
    <div
      className="moment"
      style={{
        transition: 'all 0.3s ease',
        cursor: 'default'
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-2px)';
        e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = 'none';
      }}
    >
      <div className="m-avatar"><img src={m.avatar} alt={m.who} /></div>
      <div className="m-main">
        <div className="m-head" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
          <span className="m-name">{m.who}</span>
          <span className={"tag tag-" + (m.tagType)}>{m.tag === "我" ? "我" : "她"}</span>
          {moodTags.map((tag, idx) => (
            <span key={idx} className="tag tag-line">{tag}</span>
          ))}
          {m.auto && <span className="tag tag-line">自动</span>}
          <button
            className="m-delete-btn"
            onClick={() => {
              if (window.confirm('确定删除这条动态吗？')) {
                onDelete(m.id);
              }
            }}
            style={{
              marginLeft: 'auto',
              padding: '2px 8px',
              fontSize: '12px',
              color: '#999',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              opacity: 0.6
            }}
            onMouseEnter={(e) => {
              e.target.style.color = '#ff4444';
              e.target.style.opacity = '1';
            }}
            onMouseLeave={(e) => {
              e.target.style.color = '#999';
              e.target.style.opacity = '0.6';
            }}
          >
            删除
          </button>
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
            <button
              className={"m-act" + (m.liked ? " liked" : "")}
              onClick={handleLike}
              style={{
                transition: 'all 0.2s ease',
                transform: isLiking ? 'scale(1.2)' : 'scale(1)'
              }}
            >
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
  const [moodInput, setMoodInput] = useStateM("");
  const [images, setImages] = useStateM([]);
  const [isClosing, setIsClosing] = useStateM(false);
  const fileInputRef = React.useRef(null);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
    }, 200);
  };

  const handleImageSelect = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const remainingSlots = 9 - images.length;
    const filesToAdd = files.slice(0, remainingSlots);

    filesToAdd.forEach(file => {
      if (!file.type.startsWith('image/')) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        setImages(prev => [...prev, {
          dataUrl: event.target.result,
          file
        }]);
      };
      reader.readAsDataURL(file);
    });

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeImage = (index) => {
    setImages(prev => prev.filter((_, i) => i !== index));
  };

  const parsedTags = moodInput.trim().split(/\s+/).filter(Boolean);

  return (
    <>
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes fadeOut {
          from { opacity: 1; }
          to { opacity: 0; }
        }
        @keyframes slideUp {
          from { transform: translateY(30px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        @keyframes slideDown {
          from { transform: translateY(0); opacity: 1; }
          to { transform: translateY(30px); opacity: 0; }
        }
      `}</style>
      <div
        className="sheet-mask"
        onClick={handleClose}
        style={{
          animation: isClosing ? 'fadeOut 0.2s ease-out' : 'fadeIn 0.2s ease-out',
          backdropFilter: 'blur(8px)',
          backgroundColor: 'rgba(0, 0, 0, 0.4)'
        }}
      >
        <div
          className="sheet"
          onClick={(e) => e.stopPropagation()}
          style={{
            animation: isClosing ? 'slideDown 0.2s ease-out' : 'slideUp 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
            boxShadow: '0 10px 40px rgba(0,0,0,0.15)'
          }}
        >
          <div className="sheet-grip" />
        <div className="sheet-head">
          <h2 className="serif">写点什么</h2>
          <button className="icon-btn" onClick={handleClose} style={{ width: 34, height: 34 }}>
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

          {images.length > 0 && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '8px',
              marginTop: '12px'
            }}>
              {images.map((img, idx) => (
                <div key={idx} style={{ position: 'relative', paddingTop: '100%' }}>
                  <img
                    src={img.dataUrl}
                    alt=""
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      borderRadius: '8px'
                    }}
                  />
                  <button
                    onClick={() => removeImage(idx)}
                    style={{
                      position: 'absolute',
                      top: '4px',
                      right: '4px',
                      width: '20px',
                      height: '20px',
                      borderRadius: '50%',
                      background: 'rgba(0,0,0,0.6)',
                      color: 'white',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '14px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="compose-tools">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleImageSelect}
              style={{ display: 'none' }}
            />
            <button
              className="ct-tool"
              onClick={() => fileInputRef.current?.click()}
              disabled={images.length >= 9}
            >
              <Icon name="image" /> 配图 {images.length > 0 && `(${images.length}/9)`}
            </button>
          </div>
          <label className="field-label">心情标签</label>
          <input
            type="text"
            className="fld"
            value={moodInput}
            onChange={(e) => setMoodInput(e.target.value)}
            placeholder="空格分隔多个标签，如：开心 放松 想你了"
            style={{ marginBottom: '8px' }}
          />
          {parsedTags.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
              {parsedTags.map((tag, idx) => (
                <span
                  key={idx}
                  className="tag tag-line"
                  style={{
                    padding: '4px 12px',
                    fontSize: '13px',
                    background: '#f0f0f0',
                    borderRadius: '12px',
                    color: '#666'
                  }}
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
          <div className="compose-note">发出后,在意你的角色可能会来评论。</div>
        </div>
        <div className="sheet-foot">
          <button className="pill pill-primary grow" disabled={!text.trim()} style={!text.trim() ? { opacity: 0.5 } : null}
            onClick={() => text.trim() && onPost({ content: text.trim(), mood: moodInput.trim(), images: images.map(img => img.dataUrl) })}>
            发布
          </button>
        </div>
      </div>
      </div>
    </>
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
            avatar: getRoleAvatarRound(r) || "/assets/portraits/round/0.png",
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

  const handleDelete = async (id) => {
    try {
      await apiDelete(id);
      fetchMoments(filter);
    } catch (e) {
      alert('删除失败：' + (e.message || '未知错误'));
    }
  };

  const handlePost = async (data) => {
    try {
      await createMoment({
        content: data.content,
        mood: data.mood,
        images: data.images || []
      });
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
          <span className="mem-role-av"><img src={user?.avatar || "/assets/portraits/round/0.png"} alt={user?.username || "我"} /></span>
          <span className="mem-role-name">{user?.username || "我"}</span>
        </button>
        {agents.map((a) => (
          <button key={a.id} className={"mem-role" + (filter === a.id ? " on" : "")} onClick={() => setFilter(a.id)}>
            <span className="mem-role-av"><img src={a.avatar} alt={a.name} /></span>
            <span className="mem-role-name">{a.name}</span>
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <div className="empty-immersive moments-empty-full">
          <picture>
            <source srcSet="/assets/empty-moments.webp" type="image/webp" />
            <img className="empty-immersive-img" src="/assets/empty-moments.png" alt="" />
          </picture>
          <div className="empty-immersive-scrim" />
          <div className="empty-immersive-guide">
            <div className="empty-state-title">她们还没来</div>
            <div className="empty-state-desc">但这里一直留着，<br/>等她们过来说说今天的事。</div>
          </div>
        </div>
      ) : (
        <div className="moments-list pad">
          {list.map((m) => <MomentCard key={m.id} m={m} onLike={handleLike} onDelete={handleDelete} currentUserId={user?.id} />)}
          <div style={{ height: 20 }} />
        </div>
      )}

      <button className="fab" onClick={() => setComposing(true)}><Icon name="edit" /></button>

      {composing && (
        <Composer user={user} onClose={() => setComposing(false)}
          onPost={handlePost} />
      )}
    </div>
  );
}

export { MomentsScreen };
