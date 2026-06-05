import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { getRolePortraitSrc, getRoles } from "../lib/roles.js";
import {
  commentMoment,
  createMoment,
  generateMomentDraft,
  getMomentDetail,
  getMoments,
  likeMoment,
} from "../lib/moments.js";

function formatMomentTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return "刚刚";
  }

  return date.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function RoleChip({ active, label, onClick, portraitSrc }) {
  return (
    <button
      className={active ? "moments-role-chip active" : "moments-role-chip"}
      onClick={onClick}
      type="button"
    >
      {portraitSrc ? (
        <img alt="" className="moments-role-chip-avatar" src={portraitSrc} />
      ) : (
        <span className="moments-role-chip-dot" aria-hidden="true" />
      )}
      <span>{label}</span>
    </button>
  );
}

function mapMomentComments(items, rolesById, viewerName) {
  return (Array.isArray(items) ? items : []).map((item) => {
    const role = item?.character_id ? rolesById.get(String(item.character_id)) : null;
    return {
      ...item,
      authorName: role?.name || viewerName || "我",
      dateText: formatMomentTime(item?.created_at),
    };
  });
}

function MomentCard({ actionLocked, item, likeBusy, onComment, onDetail, onLike, onPreviewImage }) {
  return (
    <article className={item.isMine ? "moment-card-react mine" : "moment-card-react"}>
      <div className="moment-card-head-react" data-clickable onClick={() => onDetail(item.id)}>
        <div className="moment-card-avatar-react">
          {item.avatar ? <img alt="" src={item.avatar} /> : <span>{item.isMine ? "你" : "她"}</span>}
        </div>
        <div className="moment-card-meta-react">
          <strong>{item.authorName}</strong>
          <span>{item.dateText}</span>
        </div>
        <span className={item.isMine ? "moment-card-tag-react mine" : "moment-card-tag-react"}>
          {item.tagText}
        </span>
      </div>

      <div className="moment-card-body-react" data-clickable onClick={() => onDetail(item.id)}>
        {item.content}
      </div>

      {item.images.length > 0 ? (
        <div className="moment-card-images-react" data-count={item.images.length}>
          {item.images.map((image) => (
            <button
              className="moment-card-image-react"
              key={image.src}
              onClick={() => onPreviewImage(image)}
              type="button"
            >
              <img alt={image.alt || "动态图片"} src={image.src} />
            </button>
          ))}
        </div>
      ) : null}

      <div className="moment-card-actions-react">
        <button
          className={item.liked ? "moment-action-react liked" : "moment-action-react"}
          disabled={actionLocked || likeBusy}
          onClick={() => onLike(item)}
          type="button"
        >
          <span>{likeBusy ? "处理中..." : "点赞"}</span>
          <span>{item.likesCount}</span>
        </button>
        <button
          className="moment-action-react"
          disabled={actionLocked}
          onClick={() => onComment(item)}
          type="button"
        >
          <span>评论</span>
          <span>{item.commentsCount}</span>
        </button>
        <button
          className="moment-action-react"
          disabled={actionLocked}
          onClick={() => onDetail(item.id)}
          type="button"
        >
          <span>详情</span>
        </button>
      </div>
    </article>
  );
}

function mapMomentItems(items, rolesById, viewerName) {
  return items.map((item) => {
    const role = item.character_id ? rolesById.get(String(item.character_id)) : null;
    const images = Array.isArray(item.images)
      ? item.images.map((image, index) => ({
          src: image,
          alt: `${role?.name || "动态"}图片 ${index + 1}`,
        }))
      : [];

    const authorName = role?.name || viewerName || "我";
    const isMine = !item.character_id;

    return {
      ...item,
      authorName,
      avatar: role ? getRolePortraitSrc(role) || role.avatar || "" : "",
      comments: mapMomentComments(item.comments, rolesById, viewerName),
      commentsCount: Number(item.comments_count || item.comments?.length || 0),
      likesCount: Number(item.likes_count || 0),
      liked: Boolean(item.liked),
      images,
      isMine,
      tagText: isMine ? "我发的" : (role?.tag || "她的动态"),
      dateText: formatMomentTime(item.created_at),
    };
  });
}

function sortMomentItems(items) {
  return [...items].sort((left, right) =>
    String(right.created_at || "").localeCompare(String(left.created_at || ""), "zh-CN"),
  );
}

export function MomentsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [roles, setRoles] = useState([]);
  const [moments, setMoments] = useState([]);
  const [viewerName, setViewerName] = useState("我");
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [status, setStatus] = useState({ type: "", text: "" });
  const [composerOpen, setComposerOpen] = useState(false);
  const [content, setContent] = useState("");
  const [images, setImages] = useState([]);
  const [commentingMoment, setCommentingMoment] = useState(null);
  const [commentContent, setCommentContent] = useState("");
  const [commentBusy, setCommentBusy] = useState(false);
  const [detailMoment, setDetailMoment] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [previewImage, setPreviewImage] = useState(null);
  const [likeBusyIds, setLikeBusyIds] = useState([]);
  const loadRequestSeqRef = useRef(0);
  const detailRequestSeqRef = useRef(0);
  const draftRequestSeqRef = useRef(0);
  const publishRequestSeqRef = useRef(0);
  const commentRequestSeqRef = useRef(0);
  const likeRequestSeqRef = useRef(new Map());
  const commentingMomentRef = useRef(null);
  const composerOpenRef = useRef(false);
  const contentRef = useRef("");
  const imagesRef = useRef([]);
  const selectedRoleIdRef = useRef("");
  const requestedRoleId = searchParams.get("roleId") || "";

  const rolesById = useMemo(
    () => new Map(roles.map((role) => [String(role.id), role])),
    [roles],
  );

  useEffect(() => {
    composerOpenRef.current = composerOpen;
    contentRef.current = content;
    imagesRef.current = images;
  }, [composerOpen, content, images]);

  useEffect(() => {
    commentingMomentRef.current = commentingMoment;
    selectedRoleIdRef.current = selectedRoleId;
  }, [commentingMoment, selectedRoleId]);

  function createMomentsActionContext(roleId = selectedRoleId) {
    return String(roleId || "");
  }

  function isMomentsActionCurrent(contextRoleId) {
    return String(selectedRoleIdRef.current || "") === String(contextRoleId || "");
  }

  function invalidateDraftRequest() {
    draftRequestSeqRef.current += 1;
    setDrafting(false);
  }

  function invalidatePublishRequest() {
    publishRequestSeqRef.current += 1;
    setPublishing(false);
  }

  function invalidateCommentRequest() {
    commentRequestSeqRef.current += 1;
    setCommentBusy(false);
  }

  function invalidateDetailRequest() {
    detailRequestSeqRef.current += 1;
    setDetailLoading(false);
  }

  function beginLikeRequest(momentId) {
    const key = String(momentId);
    const nextRequestId = (likeRequestSeqRef.current.get(key) || 0) + 1;
    likeRequestSeqRef.current.set(key, nextRequestId);
    return { key, requestId: nextRequestId };
  }

  function isLikeRequestCurrent(key, requestId) {
    return likeRequestSeqRef.current.get(String(key)) === requestId;
  }

  async function loadMomentsPage(roleId = selectedRoleId, options = {}) {
    const requestId = loadRequestSeqRef.current + 1;
    loadRequestSeqRef.current = requestId;
    const {
      showSpinner = true,
      clearStatus = true,
      reportError = true,
      preserveDrafts = false,
    } = options;
    invalidateDetailRequest();
    if (showSpinner) {
      setLoading(true);
    }
    if (clearStatus) {
      setStatus({ type: "", text: "" });
    }

    try {
      const [sessionResponse, rolesResponse] = await Promise.all([
        fetch("/api/auth/session", { credentials: "same-origin" }).then((res) => res.json()),
        getRoles(),
      ]);

      if (!sessionResponse?.loggedIn) {
        throw new Error("请先登录");
      }

      if (!rolesResponse?.success || !Array.isArray(rolesResponse.items)) {
        throw new Error(rolesResponse?.error || "角色列表读取失败。");
      }

      const nextViewerName =
        sessionResponse?.user?.nickname || sessionResponse?.user?.username || "我";
      const nextRoles = rolesResponse.items;
      const nextRoleMap = new Map(nextRoles.map((role) => [String(role.id), role]));
      const resolvedRoleId =
        roleId && nextRoles.some((role) => String(role.id) === String(roleId))
          ? String(roleId)
          : "";
      const momentsResponse = await getMoments({
        characterId: resolvedRoleId,
        limit: 50,
      });

      if (!momentsResponse?.success || !Array.isArray(momentsResponse.items)) {
        throw new Error(momentsResponse?.error || "动态列表读取失败。");
      }

      if (loadRequestSeqRef.current !== requestId) {
        return;
      }

      setNeedsAuth(false);
      setViewerName(nextViewerName);
      setRoles(nextRoles);
      setSelectedRoleId(resolvedRoleId || "");
      const nextMoments = mapMomentItems(momentsResponse.items, nextRoleMap, nextViewerName);
      setMoments(nextMoments);
      const nextImageSources = new Set(
        nextMoments.flatMap((item) => item.images.map((image) => image.src)),
      );
      setCommentingMoment((current) => {
        if (!current) {
          return current;
        }

        const matchedMoment =
          nextMoments.find((item) => String(item.id) === String(current.id)) || null;
        if (!matchedMoment) {
          setCommentContent("");
        }
        return matchedMoment;
      });
      setDetailMoment((current) => {
        if (!current) {
          return current;
        }

        return nextMoments.find((item) => String(item.id) === String(current.id)) || null;
      });
      setPreviewImage((current) => {
        if (!current) {
          return current;
        }

        return nextImageSources.has(String(current.src || "")) ? current : null;
      });
      if (preserveDrafts && composerOpenRef.current) {
        setComposerOpen(true);
        setContent(contentRef.current);
        setImages(imagesRef.current);
      }
    } catch (error) {
      if (loadRequestSeqRef.current !== requestId) {
        return;
      }

      const message = error instanceof Error ? error.message : "动态页加载失败。";
      if (message.includes("登录") || message.includes("401")) {
        setNeedsAuth(true);
        setRoles([]);
        setMoments([]);
      } else if (reportError) {
        setStatus({ type: "error", text: message });
      }
    } finally {
      if (loadRequestSeqRef.current === requestId && showSpinner) {
        setLoading(false);
      }
    }
  }
  useEffect(() => {
    invalidateDraftRequest();
    invalidatePublishRequest();
    invalidateCommentRequest();
    setPublishing(false);
    setCommentBusy(false);
    setComposerOpen(false);
    setContent("");
    setImages([]);
    setCommentingMoment(null);
    setCommentContent("");
    setDetailMoment(null);
    invalidateDetailRequest();
    setLikeBusyIds([]);
    setPreviewImage(null);
    setStatus({ type: "", text: "" });
    setSelectedRoleId(requestedRoleId);
    loadMomentsPage(requestedRoleId);
  }, [requestedRoleId]);

  useEffect(() => {
    function refreshCurrentMomentsView() {
      loadMomentsPage(requestedRoleId, {
        showSpinner: false,
        clearStatus: false,
        reportError: false,
        preserveDrafts: true,
      });
    }

    function handleWindowFocus() {
      refreshCurrentMomentsView();
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        refreshCurrentMomentsView();
      }
    }

    window.addEventListener("focus", handleWindowFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", handleWindowFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [requestedRoleId]);

  async function handleFilter(roleId) {
    invalidateDraftRequest();
    invalidatePublishRequest();
    invalidateCommentRequest();
    setPublishing(false);
    setCommentBusy(false);
    setComposerOpen(false);
    setContent("");
    setImages([]);
    setCommentingMoment(null);
    setCommentContent("");
    setDetailMoment(null);
    invalidateDetailRequest();
    setLikeBusyIds([]);
    setPreviewImage(null);
    setStatus({ type: "", text: "" });
    setSearchParams(roleId ? { roleId } : {});
  }

  async function handleGenerateDraft() {
    if (!selectedRoleId) {
      setStatus({ type: "error", text: "先选一个角色，再让她写草稿。" });
      return;
    }

    const requestId = draftRequestSeqRef.current + 1;
    draftRequestSeqRef.current = requestId;
    const targetRoleId = selectedRoleId;
    setDrafting(true);
    setStatus({ type: "", text: "" });

    try {
      const data = await generateMomentDraft(targetRoleId);
      if (!data?.success || !data.item?.content) {
        throw new Error(data?.error || "动态草稿生成失败。");
      }

      if (
        draftRequestSeqRef.current !== requestId ||
        String(selectedRoleIdRef.current || "") !== String(targetRoleId)
      ) {
        return;
      }

      setComposerOpen(true);
      setContent(data.item.content);
    } catch (error) {
      if (draftRequestSeqRef.current !== requestId) {
        return;
      }

      setStatus({
        type: "error",
        text: error instanceof Error ? error.message : "动态草稿生成失败。",
      });
    } finally {
      if (draftRequestSeqRef.current === requestId) {
        setDrafting(false);
      }
    }
  }

  async function handlePublish(event) {
    event.preventDefault();
    const trimmed = content.trim();
    if (!trimmed && images.length === 0) {
      setStatus({ type: "error", text: "动态内容和图片至少要有一个。" });
      return;
    }

    const targetRoleId = selectedRoleId;
    const actionContext = createMomentsActionContext(targetRoleId);
    const requestId = publishRequestSeqRef.current + 1;
    publishRequestSeqRef.current = requestId;
    setPublishing(true);
    setStatus({ type: "", text: "" });

    try {
      const payload = targetRoleId
        ? { content: trimmed, character_id: targetRoleId, images }
        : { content: trimmed, images };
      const data = await createMoment(payload);

      if (!data?.success) {
        throw new Error(data?.error || "动态发布失败。");
      }

      if (
        publishRequestSeqRef.current !== requestId ||
        !isMomentsActionCurrent(actionContext)
      ) {
        return;
      }

      const nextMoment = mapMomentItems(
        [data.item],
        rolesById,
        viewerName,
      )[0];
      setMoments((current) => sortMomentItems([nextMoment, ...current]));

      setContent("");
      setImages([]);
      setComposerOpen(false);
      setStatus({ type: "success", text: "动态已经发出去了。" });
    } catch (error) {
      if (
        publishRequestSeqRef.current !== requestId ||
        !isMomentsActionCurrent(actionContext)
      ) {
        return;
      }

      setStatus({
        type: "error",
        text: error instanceof Error ? error.message : "动态发布失败。",
      });
    } finally {
      if (
        publishRequestSeqRef.current === requestId &&
        isMomentsActionCurrent(actionContext)
      ) {
        setPublishing(false);
      }
    }
  }

  async function handleLike(item) {
    const actionContext = createMomentsActionContext(selectedRoleId);
    const { key, requestId } = beginLikeRequest(item.id);
    setLikeBusyIds((current) =>
      current.includes(String(item.id)) ? current : [...current, String(item.id)],
    );
    try {
      const data = await likeMoment(item.id);
      if (!data?.success) {
        throw new Error(data?.error || "点赞失败。");
      }

      if (!isMomentsActionCurrent(actionContext) || !isLikeRequestCurrent(key, requestId)) {
        return;
      }

      setMoments((current) =>
        current.map((moment) =>
          moment.id === item.id
            ? {
                ...moment,
                liked: Boolean(data.liked),
                likesCount: Number(data.likes_count ?? moment.likesCount ?? 0),
              }
            : moment,
        ),
      );

      setDetailMoment((current) =>
        current && current.id === item.id
          ? {
              ...current,
              liked: Boolean(data.liked),
              likesCount: Number(data.likes_count ?? current.likesCount ?? 0),
            }
          : current,
      );
      setStatus({ type: "", text: "" });
    } catch (error) {
      if (!isMomentsActionCurrent(actionContext) || !isLikeRequestCurrent(key, requestId)) {
        return;
      }

      setStatus({
        type: "error",
        text: error instanceof Error ? error.message : "点赞失败。",
      });
    } finally {
      if (isLikeRequestCurrent(key, requestId)) {
        setLikeBusyIds((current) => current.filter((busyId) => busyId !== String(item.id)));
      }
    }
  }

  function openCommentPanel(item) {
    invalidateCommentRequest();
    setCommentingMoment(item);
    setCommentContent("");
    setStatus({ type: "", text: "" });
  }

  function closeCommentPanel() {
    invalidateCommentRequest();
    setCommentingMoment(null);
    setCommentContent("");
  }

  async function handleSaveComment(event) {
    event.preventDefault();
    if (!commentingMoment) {
      return;
    }

    const targetMomentId = String(commentingMoment.id);
    const trimmed = commentContent.trim();
    if (!trimmed) {
      setStatus({ type: "error", text: "评论内容不能为空。" });
      return;
    }

    setCommentBusy(true);
    setStatus({ type: "", text: "" });
    const targetRoleId = selectedRoleId;
    const actionContext = createMomentsActionContext(targetRoleId);
    const requestId = commentRequestSeqRef.current + 1;
    commentRequestSeqRef.current = requestId;

    try {
      const payload = targetRoleId ? { content: trimmed, character_id: targetRoleId } : { content: trimmed };
      const data = await commentMoment(commentingMoment.id, payload);
      if (!data?.success) {
        throw new Error(data?.error || "评论发送失败。");
      }

      if (
        commentRequestSeqRef.current !== requestId ||
        !isMomentsActionCurrent(actionContext)
      ) {
        return;
      }

      const nextComment = {
        ...(data.item || {}),
        content: data.item?.content || trimmed,
        created_at: data.item?.created_at || new Date().toISOString(),
        authorName:
          targetRoleId
            ? rolesById.get(String(targetRoleId))?.name || viewerName
            : viewerName,
        dateText: formatMomentTime(data.item?.created_at || new Date().toISOString()),
      };

      setMoments((current) =>
        current.map((item) =>
          item.id === commentingMoment.id
            ? {
                ...item,
                commentsCount: Number(item.commentsCount || 0) + 1,
                comments: [...(item.comments || []), nextComment],
              }
            : item,
        ),
      );

      setCommentingMoment((current) =>
        current && String(current.id) === targetMomentId
          ? {
              ...current,
              commentsCount: Number(current.commentsCount || 0) + 1,
              comments: [...(current.comments || []), nextComment],
            }
          : current,
      );

      setDetailMoment((current) =>
        current && current.id === commentingMoment.id
          ? {
              ...current,
              commentsCount: Number(current.commentsCount || 0) + 1,
              comments: [...(current.comments || []), nextComment],
            }
          : current,
      );

      if (String(commentingMomentRef.current?.id || "") === targetMomentId) {
        setCommentingMoment(null);
        setCommentContent("");
      }
      setStatus({ type: "success", text: "评论已经发出去了。" });
    } catch (error) {
      if (
        commentRequestSeqRef.current !== requestId ||
        !isMomentsActionCurrent(actionContext)
      ) {
        return;
      }

      setStatus({
        type: "error",
        text: error instanceof Error ? error.message : "评论发送失败。",
      });
    } finally {
      if (
        commentRequestSeqRef.current === requestId &&
        isMomentsActionCurrent(actionContext)
      ) {
        setCommentBusy(false);
      }
    }
  }

  async function handleOpenDetail(momentId) {
    const requestId = detailRequestSeqRef.current + 1;
    detailRequestSeqRef.current = requestId;
    setDetailLoading(true);
    setDetailMoment(null);
    setStatus({ type: "", text: "" });

    try {
      const data = await getMomentDetail(momentId);
      if (!data?.success || !data.item) {
        throw new Error(data?.error || "动态详情读取失败。");
      }

      const mapped = mapMomentItems(
        [data.item],
        rolesById,
        viewerName,
      )[0];
      mapped.comments = mapMomentComments(data.item.comments, rolesById, viewerName);
      if (detailRequestSeqRef.current !== requestId) {
        return;
      }
      setDetailMoment(mapped);
    } catch (error) {
      if (detailRequestSeqRef.current !== requestId) {
        return;
      }
      setStatus({
        type: "error",
        text: error instanceof Error ? error.message : "动态详情读取失败。",
      });
    } finally {
      if (detailRequestSeqRef.current === requestId) {
        setDetailLoading(false);
      }
    }
  }

  function handlePreviewImage(image) {
    setPreviewImage(image);
  }

  async function handleMomentImageChange(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) {
      return;
    }

    invalidateDraftRequest();
    invalidatePublishRequest();
    const requestId = draftRequestSeqRef.current + 1;
    draftRequestSeqRef.current = requestId;
    const actionContext = createMomentsActionContext(selectedRoleId);
    try {
      const urls = await Promise.all(
        files.slice(0, 9).map(
          (file) =>
            new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result || ""));
              reader.onerror = () => reject(new Error("读取图片失败。"));
              reader.readAsDataURL(file);
            }),
        ),
      );
      if (
        draftRequestSeqRef.current !== requestId ||
        !isMomentsActionCurrent(actionContext)
      ) {
        return;
      }
      setImages((current) => [...current, ...urls].slice(0, 9));
    } catch (error) {
      if (draftRequestSeqRef.current !== requestId) {
        return;
      }
      setStatus({
        type: "error",
        text: error instanceof Error ? error.message : "图片读取失败。",
      });
    }
  }

  function handleRemoveDraftImage(target) {
    invalidateDraftRequest();
    invalidatePublishRequest();
    setImages((current) => current.filter((item) => item !== target));
  }

  function handleToggleComposer() {
    invalidateDraftRequest();
    setComposerOpen((current) => !current);
  }

  if (loading) {
    return (
      <section className="moments-page">
        <div className="rb-card moments-feedback">
          <p>正在把她们的动态接回来...</p>
        </div>
      </section>
    );
  }

  if (needsAuth) {
    return (
      <section className="moments-page">
        <div className="rb-card moments-feedback">
          <p>要先登录，才能看到她们的动态。</p>
          <div className="chat-room-auth-actions">
            <button
              className="primary-link chat-room-auth-btn"
              onClick={() => navigate("/auth")}
              type="button"
            >
              去登录
            </button>
            <Link className="secondary-link chat-room-auth-btn" to="/">
              返回首页
            </Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="moments-page">
      <div className="rb-card moments-hero">
        <div>
          <p className="chat-list-kicker">动态</p>
          <h1 className="moments-title">她们不聊天的时候，也会留下一点生活痕迹。</h1>
          <p className="moments-subtitle">
            在这里看看她们最近说了什么、做了什么，也可以替自己或替她发一条新的动态。
          </p>
        </div>
        <div className="chat-list-summary">
          <span className="chat-list-summary-label">动态数</span>
          <strong>{moments.length}</strong>
        </div>
      </div>

      {status.text ? (
        <div className={status.type === "error" ? "rb-card moments-feedback error" : "rb-card moments-feedback success"}>
          <p>{status.text}</p>
        </div>
      ) : null}

      <div className="rb-card moments-filter-card">
        <div className="moments-filter-head">
          <strong>按角色看</strong>
          <span>{selectedRoleId ? "当前只看一个她" : "当前看全部动态"}</span>
        </div>
        {roles.length > 0 ? (
          <div className="moments-role-strip">
            <RoleChip
              active={!selectedRoleId}
              label="全部"
              onClick={() => handleFilter("")}
            />
            {roles.map((role) => (
              <RoleChip
                active={String(role.id) === String(selectedRoleId)}
                key={role.id}
                label={role.name}
                onClick={() => handleFilter(String(role.id))}
                portraitSrc={getRolePortraitSrc(role)}
              />
            ))}
          </div>
        ) : (
          <div className="memory-empty-actions">
            <Link className="secondary-link moments-composer-btn" to="/characters?onboard=first-role">
              先去创建角色
            </Link>
          </div>
        )}
      </div>

      <div className="moments-layout">
        <div className="rb-card moments-composer-card">
          <div className="moments-composer-head">
            <h2>发一条动态</h2>
            <div className="moments-composer-actions">
              <button
                className="secondary-link moments-composer-btn"
                onClick={handleToggleComposer}
                type="button"
              >
                {composerOpen ? "收起" : "自己写"}
              </button>
              <button
                className="secondary-link moments-composer-btn"
                disabled={drafting}
                onClick={handleGenerateDraft}
                type="button"
              >
                {drafting ? "草稿生成中..." : "让她写草稿"}
              </button>
              {selectedRoleId ? (
                <Link
                  className="secondary-link moments-composer-btn"
                  to={`/chat/${encodeURIComponent(selectedRoleId)}`}
                >
                  回到和她聊天
                </Link>
              ) : null}
            </div>
          </div>

          {composerOpen ? (
            <form className="moments-composer-form" onSubmit={handlePublish}>
              <textarea
                className="form-input moments-composer-textarea"
                onChange={(event) => {
                  invalidateDraftRequest();
                  invalidatePublishRequest();
                  setContent(event.target.value);
                }}
                placeholder={selectedRoleId ? "写一点她现在的心情..." : "写一点今天的心情..."}
                rows={5}
                value={content}
              />
              <label className="secondary-link moments-composer-btn upload">
                加几张图
                <input
                  accept="image/png,image/jpeg,image/webp"
                  hidden
                  multiple
                  onChange={handleMomentImageChange}
                  type="file"
                />
              </label>
              {images.length > 0 ? (
                <div className="moments-draft-images">
                  {images.map((image) => (
                    <button
                      className="moments-draft-image"
                      key={image}
                      onClick={() => handleRemoveDraftImage(image)}
                      type="button"
                    >
                      <img alt="待发布图片" src={image} />
                    </button>
                  ))}
                </div>
              ) : null}
              <button className="btn-submit" disabled={publishing} type="submit">
                {publishing ? "发布中..." : "发布动态"}
              </button>
            </form>
          ) : (
            <p className="moments-composer-hint">
              可以先写几句近况，或者让她替你起一个草稿，再决定要不要发出去。
            </p>
          )}
        </div>

        <div className="moments-list">
          {moments.length === 0 ? (
            <div className="rb-card moments-empty">
              <p>还没有动态。</p>
              <p>
                {roles.length > 0
                  ? "你可以自己发一条，或者先选一个角色让她写草稿。"
                  : "先去创建一个角色，再让她开始留下自己的动态。"}
              </p>
              {roles.length === 0 ? (
                <div className="memory-empty-actions">
                  <Link className="secondary-link moments-composer-btn" to="/characters?onboard=first-role">
                    去角色页
                  </Link>
                </div>
              ) : null}
            </div>
          ) : (
            moments.map((item) => (
              <MomentCard
                actionLocked={commentBusy}
                item={item}
                key={item.id}
                likeBusy={likeBusyIds.includes(String(item.id))}
                onComment={openCommentPanel}
                onDetail={handleOpenDetail}
                onLike={handleLike}
                onPreviewImage={handlePreviewImage}
              />
            ))
          )}
        </div>
      </div>

      {commentingMoment ? (
        <div
          className="moments-modal-overlay"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeCommentPanel();
            }
          }}
        >
          <div className="rb-card moments-modal-card">
            <div className="moments-modal-head">
              <h2>写评论</h2>
              <button
                className="moments-modal-close"
                disabled={commentBusy}
                onClick={closeCommentPanel}
                type="button"
              >
                关闭
              </button>
            </div>
            <div className="moments-comment-list">
              {(commentingMoment.comments || []).length > 0 ? (
                commentingMoment.comments.map((item) => (
                  <div className="moments-comment-item" key={item.id || `${item.content}-${item.created_at}`}>
                    <div className="moments-comment-meta">
                      <strong>{item.authorName || "我"}</strong>
                      <span>{item.dateText || "刚刚"}</span>
                    </div>
                    <div>{item.content}</div>
                  </div>
                ))
              ) : (
                <div className="moments-comment-item">还没有评论。</div>
              )}
            </div>
            <form className="moments-comment-form" onSubmit={handleSaveComment}>
              <textarea
                className="form-input moments-comment-textarea"
                onChange={(event) => {
                  invalidateCommentRequest();
                  setCommentContent(event.target.value);
                }}
                placeholder="写一句想说的话"
                rows={4}
                value={commentContent}
              />
              <button className="btn-submit" disabled={commentBusy} type="submit">
                {commentBusy ? "发送中..." : "发送评论"}
              </button>
            </form>
          </div>
        </div>
      ) : null}

      {detailLoading || detailMoment ? (
        <div
          className="moments-modal-overlay"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setDetailMoment(null);
              invalidateDetailRequest();
            }
          }}
        >
          <div className="rb-card moments-modal-card detail">
            <div className="moments-modal-head">
              <h2>动态详情</h2>
              <button
                className="moments-modal-close"
                onClick={() => {
                  setDetailMoment(null);
                  invalidateDetailRequest();
                }}
                type="button"
              >
                关闭
              </button>
            </div>
            {detailLoading ? (
              <div className="moments-detail-loading">正在读取这条动态...</div>
            ) : detailMoment ? (
              <div className="moments-detail-body">
                <div className="moments-detail-meta">
                  <strong>{detailMoment.authorName}</strong>
                  <span>{detailMoment.dateText}</span>
                </div>
                <div className="moments-detail-content">{detailMoment.content}</div>
                {detailMoment.images.length > 0 ? (
                  <div className="moment-card-images-react">
                    {detailMoment.images.map((image) => (
                      <button
                        className="moment-card-image-react"
                        key={image.src}
                        onClick={() => handlePreviewImage(image)}
                        type="button"
                      >
                        <img alt={image.alt || "动态图片"} src={image.src} />
                      </button>
                    ))}
                  </div>
                ) : null}
                <div className="moments-detail-stats">
                  <span>{`点赞 ${detailMoment.likesCount}`}</span>
                  <span>{`评论 ${detailMoment.commentsCount}`}</span>
                </div>
                <div className="moments-comment-list">
                  {(detailMoment.comments || []).length > 0 ? (
                    detailMoment.comments.map((item) => (
                      <div className="moments-comment-item" key={item.id || `${item.content}-${item.created_at}`}>
                        <div className="moments-comment-meta">
                          <strong>{item.authorName || "我"}</strong>
                          <span>{item.dateText || "刚刚"}</span>
                        </div>
                        <div>{item.content}</div>
                      </div>
                    ))
                  ) : (
                    <div className="moments-comment-item">还没有评论。</div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {previewImage ? (
        <div
          className="moments-modal-overlay image-preview"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setPreviewImage(null);
            }
          }}
        >
          <div className="rb-card moments-image-preview-card">
            <div className="moments-modal-head">
              <h2>图片预览</h2>
              <button
                className="moments-modal-close"
                onClick={() => setPreviewImage(null)}
                type="button"
              >
                关闭
              </button>
            </div>
            <div className="moments-image-preview-body">
              <img alt={previewImage.alt || "动态图片"} src={previewImage.src} />
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
