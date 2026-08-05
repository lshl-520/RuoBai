import React from "react";
import { Icon, Bars } from "../store.jsx";
import { getRoles, getRolePortraitSrc, getRoleAvatarRound } from "../lib/roles.js";
import { getMoments, createMoment, uploadMomentImage, likeMoment as apiLike, deleteMoment as apiDelete, commentMoment, shareMoment } from "../lib/moments.js";
import { recordDiagnostic } from "../lib/diagnostics.js";
import { getSessionProfile } from "../lib/profile.js";
import {
  DEFAULT_ROLE_AVATAR,
  DEFAULT_USER_AVATAR,
  fallbackToDefaultRoleAvatar,
  fallbackToDefaultUserAvatar,
} from "../lib/default-assets.js";
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
    avatar: isUser ? (user?.avatar || DEFAULT_USER_AVATAR) : (agent?.avatar || DEFAULT_ROLE_AVATAR),
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
    visibilityMode: m.visibility_mode || (isUser ? "private" : "publisher"),
    audienceCharacterIds: Array.isArray(m.audience_character_ids) ? m.audience_character_ids : [],
    auto: Boolean(m.auto_generated || m.origin === "auto"),
  };
}

function getMomentImageSource(src, variant) {
  const value = typeof src === "string" ? src : "";
  if (!value.startsWith("/user_assets/chat/")) return value;
  return `/api/media/${variant}?path=${encodeURIComponent(value)}`;
}

function MomentCard({ m, onLike, onDelete, onOpenImage, onComment, onShare, agents = [], currentUserId }) {
  const [isLiking, setIsLiking] = React.useState(false);
  const [commentsOpen, setCommentsOpen] = React.useState(false);
  const [commentDraft, setCommentDraft] = React.useState("");
  const [commentSending, setCommentSending] = React.useState(false);
  const [commentError, setCommentError] = React.useState("");
  const [shareOpen, setShareOpen] = React.useState(false);
  const [shareTargets, setShareTargets] = React.useState(() => new Set(m.audienceCharacterIds || []));
  const [shareSending, setShareSending] = React.useState(false);
  const [shareError, setShareError] = React.useState("");
  const moodTags = m.mood ? m.mood.trim().split(/\s+/).filter(Boolean) : [];

  const handleLike = async () => {
    if (isLiking) return;
    setIsLiking(true);
    await onLike(m.id);
    setTimeout(() => setIsLiking(false), 300);
  };

  const submitComment = async () => {
    const content = commentDraft.trim();
    if (!content || commentSending) return;
    setCommentSending(true);
    setCommentError("");
    try {
      await onComment(m.id, content);
      setCommentDraft("");
      setCommentsOpen(true);
    } catch (error) {
      setCommentError(error?.message || "评论没有发送成功，请重试。");
    } finally {
      setCommentSending(false);
    }
  };

  const saveShare = async () => {
    if (!onShare || shareSending) return;
    setShareSending(true);
    setShareError("");
    try {
      await onShare(m.id, Array.from(shareTargets));
      setShareOpen(false);
    } catch (error) {
      setShareError(error?.message || "分享范围没有保存成功，请重试。");
    } finally {
      setShareSending(false);
    }
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
      <div className="m-avatar"><img src={m.avatar} alt={m.who} onError={m.isUser ? fallbackToDefaultUserAvatar : fallbackToDefaultRoleAvatar} /></div>
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
            {m.images.map((src, i) => (
              <button
                type="button"
                className="m-img-button"
                key={`${src}-${i}`}
                onClick={() => onOpenImage(src)}
                aria-label="打开动态图片"
              >
                <img
                  src={getMomentImageSource(src, "thumbnail")}
                  alt="动态图片"
                  loading="lazy"
                  decoding="async"
                  onError={(event) => {
                    if (event.currentTarget.src.endsWith(src)) return;
                    event.currentTarget.src = src;
                  }}
                />
              </button>
            ))}
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
            <button className="m-act" onClick={() => setCommentsOpen((open) => !open)} aria-expanded={commentsOpen}>
              <Icon name="comment" /> {m.comments.length}
            </button>
            {m.isUser && (
              <button className={"m-act" + (m.visibilityMode === "shared" ? " shared" : "")} onClick={() => setShareOpen((open) => !open)} aria-expanded={shareOpen}>
                <Icon name="share" /> {m.visibilityMode === "shared" ? "已分享" : "分享"}
              </button>
            )}
          </div>
        </div>
        {shareOpen && m.isUser && (
          <div className="m-share-panel">
            <div className="m-share-title">这条动态分享给谁？</div>
            <div className="m-share-hint">默认只有你能看到。选中的角色才能在自己的空间里读到它。</div>
            <div className="m-share-options">
              {agents.length === 0 && <span className="m-share-empty">还没有可分享的角色。</span>}
              {agents.map((agent) => {
                const checked = shareTargets.has(agent.id);
                return (
                  <label className="m-share-option" key={agent.id}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => setShareTargets((current) => {
                        const next = new Set(current);
                        if (next.has(agent.id)) next.delete(agent.id); else next.add(agent.id);
                        return next;
                      })}
                    />
                    <img src={agent.avatar || DEFAULT_ROLE_AVATAR} alt="" onError={fallbackToDefaultRoleAvatar} />
                    <span>{agent.name}</span>
                  </label>
                );
              })}
            </div>
            {shareError && <div className="m-share-error" role="alert">{shareError}</div>}
            <div className="m-share-actions">
              <button type="button" className="m-share-cancel" onClick={() => setShareOpen(false)}>取消</button>
              <button type="button" className="m-share-save" onClick={saveShare} disabled={shareSending}>{shareSending ? "保存中" : "保存范围"}</button>
            </div>
          </div>
        )}
        {commentsOpen && (
          <div className="m-comments">
            {m.comments.map((c, i) => (
              <div key={i} className="m-comment"><span className="mc-name">{c.name}</span>{c.text}</div>
            ))}
            {m.comments.length === 0 && <div className="m-comment-empty">还没有评论，写下第一句吧。</div>}
            {commentError && (
              <div className="m-comment-error" role="alert">
                <span>{commentError}</span>
                <button type="button" onClick={submitComment} disabled={commentSending}>重试</button>
              </div>
            )}
            <div className="m-comment-composer">
              <input
                value={commentDraft}
                onChange={(event) => { setCommentDraft(event.target.value); setCommentError(""); }}
                onKeyDown={(event) => { if (event.key === "Enter") submitComment(); }}
                placeholder="写条评论…"
                aria-label="评论内容"
                disabled={commentSending}
              />
              <button type="button" onClick={submitComment} disabled={!commentDraft.trim() || commentSending}>
                {commentSending ? "发送中" : "发送"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MomentImagePreview({ src, onClose }) {
  React.useEffect(() => {
    const oldOverflow = document.body.style.overflow;
    const onKeyDown = (event) => { if (event.key === "Escape") onClose(); };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = oldOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div className="chat-image-preview" onClick={onClose}>
      <button className="cip-close" onClick={onClose} aria-label="关闭图片预览">×</button>
      <div className="cip-stage" onClick={(event) => event.stopPropagation()}>
        <img
          src={getMomentImageSource(src, "preview")}
          alt="动态图片高清预览"
          onError={(event) => {
            if (event.currentTarget.src.endsWith(src)) return;
            event.currentTarget.src = src;
          }}
        />
      </div>
      <div className="cip-actions" onClick={(event) => event.stopPropagation()}>
        <a className="cip-original" href={src} target="_blank" rel="noreferrer">打开原图</a>
      </div>
    </div>
  );
}

/* 发动态 */
function Composer({ user, onClose, onPost }) {
  const [text, setText] = useStateM("");
  const [moodInput, setMoodInput] = useStateM("");
  const [images, setImages] = useStateM([]);
  const [uploading, setUploading] = useStateM(0);
  const [uploadError, setUploadError] = useStateM("");
  const [publishing, setPublishing] = useStateM(false);
  const [isClosing, setIsClosing] = useStateM(false);
  const fileInputRef = React.useRef(null);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
    }, 200);
  };

  const addImageFiles = async (files) => {
    if (files.length === 0) return;

    const remainingSlots = 9 - images.length;
    const filesToAdd = files.slice(0, remainingSlots);

    for (const file of filesToAdd) {
      if (!file.type.startsWith("image/")) continue;
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const preview = URL.createObjectURL(file);
      setImages((prev) => [...prev, { id, preview, mediaUrl: "", file }]);
      setUploading((count) => count + 1);
      setUploadError("");
      try {
        const mediaUrl = await uploadMomentImage(file);
        setImages((prev) => prev.map((item) => item.id === id ? { ...item, mediaUrl } : item));
      } catch (error) {
        setImages((prev) => prev.filter((item) => item.id !== id));
        URL.revokeObjectURL(preview);
        setUploadError(error?.message || "图片上传失败，可稍后重试。");
        recordDiagnostic({ area: "image", action: "upload-image", error });
      } finally {
        setUploading((count) => Math.max(0, count - 1));
      }
    }
  };

  const handleImageSelect = (e) => {
    void addImageFiles(Array.from(e.target.files || []));

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handlePaste = (event) => {
    const files = Array.from(event.clipboardData?.items || [])
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter(Boolean);
    if (files.length) {
      event.preventDefault();
      void addImageFiles(files);
    }
  };

  const removeImage = (index) => {
    setImages(prev => {
      const removed = prev[index];
      if (removed?.preview?.startsWith("blob:")) URL.revokeObjectURL(removed.preview);
      return prev.filter((_, i) => i !== index);
    });
  };

  const parsedTags = moodInput.trim().split(/\s+/).filter(Boolean);

  const publish = async () => {
    if (!text.trim() || uploading > 0 || publishing || images.some((img) => !img.mediaUrl)) return;
    setPublishing(true);
    setUploadError("");
    try {
      await onPost({ content: text.trim(), mood: moodInput.trim(), images: images.map(img => img.mediaUrl).filter(Boolean) });
    } catch (error) {
      setUploadError(error?.message || "动态没有发布成功，刚才写的内容还在，可以重试。");
    } finally {
      setPublishing(false);
    }
  };

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
            <img src={user.avatar} alt="" onError={fallbackToDefaultUserAvatar} />
            <span>{user.name}</span>
          </div>
          <textarea className="fld area" style={{ minHeight: 130 }} autoFocus value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={handlePaste}
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
                    src={img.preview}
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
          {uploadError && <div className="chat-error" role="alert" style={{ marginTop: 8 }}>{uploadError}</div>}
          {uploading > 0 && <div className="compose-note">正在把图片安全上传，完成后才能发布。</div>}
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
          <button className="pill pill-primary grow" disabled={!text.trim() || uploading > 0 || publishing || images.some((img) => !img.mediaUrl)} style={!text.trim() || uploading > 0 || publishing || images.some((img) => !img.mediaUrl) ? { opacity: 0.5 } : null}
            onClick={publish}>
            {publishing ? "发布中…" : "发布"}
          </button>
        </div>
      </div>
      </div>
    </>
  );
}

function MomentsScreen() {
  const [composing, setComposing] = useStateM(false);
  const [filter, setFilter] = useStateM("all");
  const [previewImage, setPreviewImage] = useStateM("");
  const [offset, setOffset] = useStateM(0);
  const [hasMore, setHasMore] = useStateM(false);
  const [loadingMore, setLoadingMore] = useStateM(false);
  const [scrolled, setScrolled] = useStateM(false);
  const touchStartRef = React.useRef(null);
  const screenRef = React.useRef(null);

  /* 从后端拉真实数据 */
  const [realAgents, setRealAgents] = useStateM(null);
  const [realMoments, setRealMoments] = useStateM(null);
  const [realUser, setRealUser] = useStateM(null);
  const [loading, setLoading] = useStateM(true);

  const agents = realAgents ?? [];
  const user = realUser || { name: "我", avatar: DEFAULT_USER_AVATAR };

  const agentsMap = React.useMemo(() => {
    const m = new Map();
    agents.forEach((a) => m.set(a.id, a));
    return m;
  }, [agents]);

  const fetchMoments = async (nextFilter = filter, { append = false } = {}) => {
    const request = nextFilter === "mine"
      ? { scope: "mine" }
      : nextFilter === "all"
        ? { scope: "all" }
        : { characterId: Number(nextFilter), scope: "character" };
    const nextOffset = append ? offset : 0;
    if (append) setLoadingMore(true);
    try {
      const res = await getMoments({ ...request, limit: 20, offset: nextOffset });
      if (res?.success && Array.isArray(res.items)) {
        const mapped = res.items.map((m) => mapMoment(m, agentsMap, user));
        setRealMoments((prev) => append ? [...(prev || []), ...mapped] : mapped);
        setOffset(nextOffset + mapped.length);
        setHasMore(mapped.length >= 20);
      }
    } catch (error) {
      recordDiagnostic({ area: "app", action: "request", error });
    } finally {
      setLoadingMore(false);
    }
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
            avatar: getRoleAvatarRound(r) || DEFAULT_ROLE_AVATAR,
          })));
        }
        if (sessionRes?.success && sessionRes.user) {
          setRealUser({
            name: sessionRes.user.nickname || sessionRes.user.username,
            avatar: sessionRes.user.avatar || DEFAULT_USER_AVATAR,
          });
        }
      } catch (e) { /* 静默 */ }
      setLoading(false);
    })();
  }, []);

  /* agents 和 user 加载好后再拉动态（需要 agentsMap 做字段映射） */
  useEffectM(() => {
    if (loading) return;
    setOffset(0);
    setHasMore(false);
    fetchMoments(filter, { append: false });
  }, [loading, filter, agents.length]);

  const moments = realMoments ?? [];
  const list = moments;

  const handleLike = async (id) => {
    try { await apiLike(id); } catch (e) { /* 静默 */ }
    fetchMoments(filter, { append: false });
  };

  const handleDelete = async (id) => {
    try {
      await apiDelete(id);
      fetchMoments(filter, { append: false });
    } catch (e) {
      alert('删除失败：' + (e.message || '未知错误'));
    }
  };

  const handleComment = async (id, content) => {
    const result = await commentMoment(id, { content });
    if (!result?.success) throw new Error(result?.error || "评论没有发送成功，请重试。");
    await fetchMoments(filter, { append: false });
  };

  const handleShare = async (id, characterIds) => {
    const result = await shareMoment(id, characterIds);
    if (!result?.success) throw new Error(result?.error || "分享范围没有保存成功，请重试。");
    await fetchMoments(filter, { append: false });
  };

  const handlePost = async (data) => {
    try {
      const result = await createMoment({
        content: data.content,
        mood: data.mood,
        images: data.images || []
      });
      if (!result?.success) throw new Error(result?.error || "动态没有发布成功，请稍后重试。");
    } catch (error) {
      recordDiagnostic({ area: "app", action: "request", error });
      throw error;
    }
    setComposing(false);
    fetchMoments(filter, { append: false });
  };

  React.useEffect(() => {
    const screen = screenRef.current;
    const onScroll = () => setScrolled(Boolean(screen && screen.scrollTop > 180));
    onScroll();
    screen?.addEventListener("scroll", onScroll, { passive: true });
    return () => screen?.removeEventListener("scroll", onScroll);
  }, []);

  const switchRoleBySwipe = (direction) => {
    if (!agents.length) return;
    const currentIndex = filter === "mine" || filter === null ? -1 : agents.findIndex((agent) => String(agent.id) === String(filter));
    const start = currentIndex < 0 ? 0 : currentIndex;
    const nextIndex = (start + direction + agents.length) % agents.length;
    setFilter(String(agents[nextIndex].id));
  };

  const handleTouchStart = (event) => {
    if (event.target.closest(".m-img-button")) return;
    const touch = event.changedTouches?.[0];
    if (touch) touchStartRef.current = { x: touch.clientX, y: touch.clientY };
  };

  const handleTouchEnd = (event) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start || event.target.closest(".m-img-button")) return;
    const touch = event.changedTouches?.[0];
    if (!touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.25) return;
    switchRoleBySwipe(dx < 0 ? 1 : -1);
  };

  const scrollToTop = () => screenRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  return (
    <div ref={screenRef} className="screen moments-screen" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>

      <div className="moments-cover">
        <img src="assets/scene-sunset.png" alt="" className="mc-bg" />
        <div className="mc-scrim" />
        <div className="mc-title serif">动态</div>
        <div className="mc-sub">她们在过自己的日子,你也可以在这儿说说话</div>
        <button className="mc-user" onClick={() => setFilter("mine")} aria-label="只看我的动态" title="只看我的动态"><img src={user.avatar} alt="" onError={fallbackToDefaultUserAvatar} /></button>
      </div>

      {/* 头像筛选栏 */}
      <div className={"moment-role-strip mem-roles" + (scrolled ? " scrolled" : "")} style={{ marginTop: 2 }}>
        <button className={"mem-role" + (filter === "all" ? " on" : "")} onClick={() => setFilter("all")} aria-label="查看全部动态" title="查看全部动态">
          <span className="mem-role-av moment-all-avatar"><Icon name="sparkSm" /></span>
        </button>
        {agents.map((a) => (
          <button key={a.id} className={"mem-role" + (String(filter) === String(a.id) ? " on" : "")} onClick={() => setFilter(String(a.id))}>
            <span className="mem-role-av"><img src={a.avatar} alt={a.name} onError={fallbackToDefaultRoleAvatar} /></span>
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
          {list.map((m) => <MomentCard key={m.id} m={m} agents={agents} onLike={handleLike} onComment={handleComment} onShare={handleShare} onDelete={handleDelete} onOpenImage={setPreviewImage} currentUserId={user?.id} />)}
          {hasMore && (
            <button className="pill pill-ghost moment-load-more" disabled={loadingMore} onClick={() => fetchMoments(filter, { append: true })}>
              {loadingMore ? "正在继续加载…" : "继续看更早的动态"}
            </button>
          )}
          <div style={{ height: 20 }} />
        </div>
      )}

      <button className="fab moment-fab" onClick={() => setComposing(true)} aria-label="发动态"><Icon name="edit" /></button>
      {scrolled && <button className="moment-top-button" onClick={scrollToTop} aria-label="回到首屏"><Icon name="chevronD" style={{ transform: "rotate(180deg)" }} /></button>}

      {composing && (
        <Composer user={user} onClose={() => setComposing(false)}
          onPost={handlePost} />
      )}
      {previewImage && <MomentImagePreview src={previewImage} onClose={() => setPreviewImage("")} />}
    </div>
  );
}

export { MomentsScreen };
