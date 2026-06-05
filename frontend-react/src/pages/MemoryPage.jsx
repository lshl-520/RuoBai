import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { getRolePortraitSrc, getRoles } from "../lib/roles.js";
import {
  createMemory,
  deleteMemory,
  getMemories,
  restoreMemory,
  updateMemory,
} from "../lib/memory.js";

function formatMemoryDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return "刚刚";
  }

  return date.toLocaleDateString("zh-CN", {
    month: "numeric",
    day: "numeric",
  });
}

function RoleChip({ active, disabled = false, label, onClick, portraitSrc }) {
  return (
    <button
      disabled={disabled}
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

function MemoryCard({ actionBusy, actionType, item, onDelete, onRestore, onTogglePin, onEdit }) {
  return (
    <article className={item.isImportant ? "memory-card-react pinned" : "memory-card-react"}>
      <div className="memory-card-head-react">
        <div>
          <strong>{item.tag}</strong>
          <span>{item.dateText}</span>
        </div>
        {item.isDeleted ? (
          <span className="memory-card-pin-react deleted">已删除</span>
        ) : item.isImportant ? (
          <span className="memory-card-pin-react">置顶</span>
        ) : null}
      </div>
      <div className="memory-card-body-react">{item.content}</div>
      {item.category ? <div className="memory-card-category-react">{item.category}</div> : null}
      <div className="memory-card-actions-react">
        {item.isDeleted ? (
          <button
            className="moment-action-react"
            disabled={actionBusy}
            onClick={() => onRestore(item)}
            type="button"
          >
            {actionBusy && actionType === "restore" ? "恢复中..." : "恢复"}
          </button>
        ) : (
          <>
            <button
              className="moment-action-react"
              disabled={actionBusy}
              onClick={() => onEdit(item)}
              type="button"
            >
              编辑
            </button>
            <button
              className="moment-action-react"
              disabled={actionBusy}
              onClick={() => onTogglePin(item)}
              type="button"
            >
              {actionBusy && actionType === "pin"
                ? "处理中..."
                : item.isImportant
                  ? "取消置顶"
                  : "置顶"}
            </button>
            <button
              className="moment-action-react"
              disabled={actionBusy}
              onClick={() => onDelete(item)}
              type="button"
            >
              {actionBusy && actionType === "delete" ? "删除中..." : "删除"}
            </button>
          </>
        )}
      </div>
    </article>
  );
}

function mapMemoryItems(items) {
  return items.map((item) => ({
    id: item.id,
    characterId: item.character_id,
    content: item.content || "",
    tag: item.tag || "普通记忆",
    category: item.category || "",
    isImportant: Boolean(item.is_important),
    isDeleted: Boolean(item.is_deleted),
    createdAt: item.created_at || "",
    dateText: formatMemoryDate(item.created_at),
  }));
}

function createEmptyMemoryForm() {
  return {
    content: "",
    tag: "普通记忆",
    category: "",
    isImportant: false,
  };
}

function upsertMemoryById(items, nextItem) {
  const nextId = String(nextItem.id);
  const index = items.findIndex((item) => String(item.id) === nextId);
  if (index === -1) {
    return [nextItem, ...items];
  }

  const copy = [...items];
  copy[index] = nextItem;
  return copy;
}

function sortMemoryItems(items) {
  return [...items].sort((left, right) => {
    if (Number(Boolean(left.isImportant)) !== Number(Boolean(right.isImportant))) {
      return Number(Boolean(right.isImportant)) - Number(Boolean(left.isImportant));
    }

    return String(right.createdAt || "").localeCompare(String(left.createdAt || ""), "zh-CN");
  });
}

export function MemoryPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [roles, setRoles] = useState([]);
  const [currentRoleId, setCurrentRoleId] = useState("");
  const [memories, setMemories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [status, setStatus] = useState({ type: "", text: "" });
  const [composerOpen, setComposerOpen] = useState(false);
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionMemoryId, setActionMemoryId] = useState(null);
  const [actionType, setActionType] = useState("");
  const [editingMemoryId, setEditingMemoryId] = useState(null);
  const [formData, setFormData] = useState(createEmptyMemoryForm);
  const [formDirty, setFormDirty] = useState({});

  const loadRequestSeqRef = useRef(0);
  const saveRequestSeqRef = useRef(0);
  const pinRequestSeqRef = useRef(new Map());
  const deleteRequestSeqRef = useRef(new Map());
  const restoreRequestSeqRef = useRef(new Map());
  const currentRoleIdRef = useRef("");
  const includeDeletedRef = useRef(false);
  const actionMemoryIdRef = useRef(null);
  const actionTypeRef = useRef("");
  const formDirtyRef = useRef({});
  const editingMemoryIdRef = useRef(null);
  const requestedRoleId = searchParams.get("roleId") || "";
  const requestedIncludeDeleted = searchParams.get("includeDeleted") === "1";

  const rolesById = useMemo(
    () => new Map(roles.map((role) => [String(role.id), role])),
    [roles],
  );
  const currentRole = currentRoleId ? rolesById.get(String(currentRoleId)) : null;

  useEffect(() => {
    currentRoleIdRef.current = currentRoleId;
    includeDeletedRef.current = includeDeleted;
    actionMemoryIdRef.current = actionMemoryId;
    actionTypeRef.current = actionType;
    formDirtyRef.current = formDirty;
    editingMemoryIdRef.current = editingMemoryId;
  }, [actionMemoryId, actionType, currentRoleId, editingMemoryId, formData, formDirty, includeDeleted]);

  function createMemoryActionContext(roleId = currentRoleId, deletedView = includeDeleted) {
    return {
      roleId: String(roleId || ""),
      includeDeleted: Boolean(deletedView),
    };
  }

  function isMemoryActionCurrent(context) {
    return (
      String(currentRoleIdRef.current || "") === String(context.roleId) &&
      Boolean(includeDeletedRef.current) === Boolean(context.includeDeleted)
    );
  }

  function invalidateMemorySave() {
    saveRequestSeqRef.current += 1;
    setSaving(false);
  }

  function beginMemoryPinRequest(memoryId) {
    const key = String(memoryId);
    const nextRequestId = (pinRequestSeqRef.current.get(key) || 0) + 1;
    pinRequestSeqRef.current.set(key, nextRequestId);
    return { key, requestId: nextRequestId };
  }

  function isMemoryPinRequestCurrent(key, requestId) {
    return pinRequestSeqRef.current.get(String(key)) === requestId;
  }

  function beginDeleteRequest(memoryId) {
    const key = String(memoryId);
    const nextRequestId = (deleteRequestSeqRef.current.get(key) || 0) + 1;
    deleteRequestSeqRef.current.set(key, nextRequestId);
    return { key, requestId: nextRequestId };
  }

  function isDeleteRequestCurrent(key, requestId) {
    return deleteRequestSeqRef.current.get(String(key)) === requestId;
  }

  function beginRestoreRequest(memoryId) {
    const key = String(memoryId);
    const nextRequestId = (restoreRequestSeqRef.current.get(key) || 0) + 1;
    restoreRequestSeqRef.current.set(key, nextRequestId);
    return { key, requestId: nextRequestId };
  }

  function isRestoreRequestCurrent(key, requestId) {
    return restoreRequestSeqRef.current.get(String(key)) === requestId;
  }

  function clearMemoryActionState(memoryId, type) {
    if (
      String(actionMemoryIdRef.current) === String(memoryId) &&
      actionTypeRef.current === type
    ) {
      setActionMemoryId(null);
      setActionType("");
    }
  }

  function syncEditingMemory(nextMemories, options = {}) {
    const { preserveDrafts = false, closeComposerOnMissing = false } = options;
    const currentEditingId = editingMemoryIdRef.current;
    if (!currentEditingId) {
      return;
    }

    const matchedMemory =
      nextMemories.find((item) => String(item.id) === String(currentEditingId)) || null;

    if (!matchedMemory) {
      resetForm();
      if (closeComposerOnMissing) {
        setComposerOpen(false);
      }
      return;
    }

    setFormData((current) => {
      const dirty = formDirtyRef.current || {};
      return {
        content: preserveDrafts && dirty.content ? current.content : matchedMemory.content,
        tag: preserveDrafts && dirty.tag ? current.tag : matchedMemory.tag,
        category:
          preserveDrafts && dirty.category ? current.category : matchedMemory.category,
        isImportant:
          preserveDrafts && dirty.isImportant
            ? current.isImportant
            : matchedMemory.isImportant,
      };
    });

    if (!preserveDrafts) {
      setFormDirty({});
    }
  }

  function applyMemoryCollection(nextMemories, options = {}) {
    const { preserveDrafts = false, closeComposerOnMissing = false } = options;
    setMemories(nextMemories);
    syncEditingMemory(nextMemories, {
      preserveDrafts,
      closeComposerOnMissing,
    });
  }

  async function loadMemoryPage(
    roleId = currentRoleId,
    nextIncludeDeleted = includeDeleted,
    options = {},
  ) {
    const requestId = loadRequestSeqRef.current + 1;
    loadRequestSeqRef.current = requestId;
    const {
      showSpinner = true,
      clearStatus = true,
      reportError = true,
      preserveDrafts = false,
    } = options;
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

      const nextRoles = rolesResponse.items;
      const nextRoleId =
        roleId && nextRoles.some((role) => String(role.id) === String(roleId))
          ? String(roleId)
          : String(nextRoles.find((role) => role.is_active)?.id || nextRoles[0]?.id || "");
      const roleChangedByRefresh =
        currentRoleId &&
        nextRoleId &&
        String(nextRoleId) !== String(currentRoleId);
      const memoriesResponse =
        nextRoleId
          ? await getMemories(nextRoleId, { limit: 100, includeDeleted: nextIncludeDeleted })
          : { success: true, data: [] };

      if (
        !memoriesResponse?.success ||
        !Array.isArray(memoriesResponse.data || memoriesResponse.items)
      ) {
        throw new Error(memoriesResponse?.error || "记忆列表读取失败。");
      }

      if (loadRequestSeqRef.current !== requestId) {
        return;
      }

      setNeedsAuth(false);
      setRoles(nextRoles);
      setCurrentRoleId(nextRoleId);
      const nextMemories = mapMemoryItems(memoriesResponse.data || memoriesResponse.items || []);
      applyMemoryCollection(nextMemories, {
        preserveDrafts,
        closeComposerOnMissing: true,
      });
      if (roleChangedByRefresh) {
        resetForm();
        setComposerOpen(false);
      }
    } catch (error) {
      if (loadRequestSeqRef.current !== requestId) {
        return;
      }

      const message = error instanceof Error ? error.message : "记忆页加载失败。";
      if (message.includes("登录") || message.includes("401")) {
        setNeedsAuth(true);
        setRoles([]);
        setMemories([]);
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
    setComposerOpen(false);
    invalidateMemorySave();
    setSaving(false);
    setActionMemoryId(null);
    setActionType("");
    setEditingMemoryId(null);
    setFormData(createEmptyMemoryForm());
    setFormDirty({});
    setStatus({ type: "", text: "" });
    setCurrentRoleId(requestedRoleId);
    setIncludeDeleted(requestedIncludeDeleted);
    loadMemoryPage(requestedRoleId, requestedIncludeDeleted);
  }, [requestedIncludeDeleted, requestedRoleId]);

  useEffect(() => {
    function refreshCurrentMemoryView() {
      loadMemoryPage(requestedRoleId || currentRoleId, requestedIncludeDeleted, {
        showSpinner: false,
        clearStatus: false,
        reportError: false,
        preserveDrafts: true,
      });
    }

    function handleWindowFocus() {
      refreshCurrentMemoryView();
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        refreshCurrentMemoryView();
      }
    }

    window.addEventListener("focus", handleWindowFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", handleWindowFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [currentRoleId, requestedIncludeDeleted, requestedRoleId]);

  async function handleRoleChange(roleId) {
    setComposerOpen(false);
    setEditingMemoryId(null);
    setSearchParams(
      roleId
        ? includeDeleted
          ? { roleId, includeDeleted: "1" }
          : { roleId }
        : includeDeleted
          ? { includeDeleted: "1" }
          : {},
    );
  }

  async function handleToggleDeletedView() {
    const nextValue = !includeDeleted;
    setSearchParams(
      currentRoleId
        ? nextValue
          ? { roleId: currentRoleId, includeDeleted: "1" }
          : { roleId: currentRoleId }
        : nextValue
          ? { includeDeleted: "1" }
          : {},
    );
  }

  function resetForm() {
    setFormData(createEmptyMemoryForm());
    setFormDirty({});
    setEditingMemoryId(null);
  }

  function handleCreateOpen() {
    invalidateMemorySave();
    resetForm();
    setComposerOpen(true);
  }

  function handleEdit(memory) {
    invalidateMemorySave();
    setEditingMemoryId(memory.id);
    setFormDirty({});
    setFormData({
      content: memory.content,
      tag: memory.tag,
      category: memory.category,
      isImportant: memory.isImportant,
    });
    setComposerOpen(true);
  }

  async function handleSave(event) {
    event.preventDefault();
    if (!currentRoleId) {
      setStatus({ type: "error", text: "先选一个角色。" });
      return;
    }

    if (!formData.content.trim()) {
      setStatus({ type: "error", text: "记忆内容不能为空。" });
      return;
    }

    setSaving(true);
    setStatus({ type: "", text: "" });
    const requestId = saveRequestSeqRef.current + 1;
    saveRequestSeqRef.current = requestId;
    const actionContext = createMemoryActionContext(currentRoleId, includeDeleted);

    try {
      const payload = {
        content: formData.content.trim(),
        tag: formData.tag.trim() || "普通记忆",
        category: formData.category.trim(),
        is_important: formData.isImportant,
      };

      if (editingMemoryId) {
        const data = await updateMemory(editingMemoryId, {
          ...payload,
          character_id: currentRoleId,
        });
        if (!data?.success) {
          throw new Error(data?.error || "记忆更新失败。");
        }

        if (saveRequestSeqRef.current !== requestId || !isMemoryActionCurrent(actionContext)) {
          return;
        }

        const nextMemory = mapMemoryItems([data.data || data.item])[0];
        setMemories((current) => sortMemoryItems(upsertMemoryById(current, nextMemory)));
      } else {
        const data = await createMemory(currentRoleId, payload);
        if (!data?.success) {
          throw new Error(data?.error || "记忆创建失败。");
        }

        if (saveRequestSeqRef.current !== requestId || !isMemoryActionCurrent(actionContext)) {
          return;
        }

        const nextMemory = mapMemoryItems([data.data || data.item])[0];
        setMemories((current) => sortMemoryItems(upsertMemoryById(current, nextMemory)));
      }

      if (saveRequestSeqRef.current !== requestId || !isMemoryActionCurrent(actionContext)) {
        return;
      }

      resetForm();
      setComposerOpen(false);
      setStatus({ type: "success", text: editingMemoryId ? "记忆已更新。" : "记忆已保存。" });
    } catch (error) {
      if (saveRequestSeqRef.current !== requestId || !isMemoryActionCurrent(actionContext)) {
        return;
      }

      setStatus({
        type: "error",
        text: error instanceof Error ? error.message : "记忆保存失败。",
      });
    } finally {
      if (saveRequestSeqRef.current === requestId && isMemoryActionCurrent(actionContext)) {
        setSaving(false);
      }
    }
  }

  async function handleDelete(memory) {
    const ok = window.confirm("确认删除这条记忆吗？");
    if (!ok) {
      return;
    }

    const actionContext = createMemoryActionContext(currentRoleId, includeDeleted);
    const { key, requestId } = beginDeleteRequest(memory.id);
    setActionMemoryId(memory.id);
    setActionType("delete");
    try {
      const data = await deleteMemory(memory.id);
      if (!data?.success) {
        throw new Error(data?.error || "记忆删除失败。");
      }

      if (!isMemoryActionCurrent(actionContext) || !isDeleteRequestCurrent(key, requestId)) {
        return;
      }

      const nextMemory = mapMemoryItems([data.data || data.item])[0];
      if (includeDeleted) {
        setMemories((current) => {
          const nextItems = sortMemoryItems(upsertMemoryById(current, nextMemory));
          syncEditingMemory(nextItems, {
            preserveDrafts: true,
            closeComposerOnMissing: true,
          });
          return nextItems;
        });
      } else {
        setMemories((current) => {
          const nextItems = current.filter((item) => String(item.id) !== String(memory.id));
          syncEditingMemory(nextItems, {
            preserveDrafts: true,
            closeComposerOnMissing: true,
          });
          return nextItems;
        });
      }
      setStatus({ type: "success", text: "记忆已删除。" });
    } catch (error) {
      if (!isMemoryActionCurrent(actionContext) || !isDeleteRequestCurrent(key, requestId)) {
        return;
      }

      setStatus({
        type: "error",
        text: error instanceof Error ? error.message : "记忆删除失败。",
      });
    } finally {
      clearMemoryActionState(memory.id, "delete");
    }
  }

  async function handleTogglePin(memory) {
    const actionContext = createMemoryActionContext(currentRoleId, includeDeleted);
    setActionMemoryId(memory.id);
    setActionType("pin");
    const { key, requestId } = beginMemoryPinRequest(memory.id);
    try {
      const data = await updateMemory(memory.id, {
        character_id: currentRoleId,
        is_important: !memory.isImportant,
      });
      if (!data?.success) {
        throw new Error(data?.error || "记忆更新失败。");
      }

      if (!isMemoryActionCurrent(actionContext) || !isMemoryPinRequestCurrent(key, requestId)) {
        return;
      }

      const nextMemory = mapMemoryItems([data.data || data.item])[0];
      setMemories((current) => {
        const nextItems = sortMemoryItems(upsertMemoryById(current, nextMemory));
        syncEditingMemory(nextItems, { preserveDrafts: true });
        return nextItems;
      });
      setStatus({
        type: "success",
        text: nextMemory.isImportant ? "已经置顶成重要记忆。" : "已经取消置顶。",
      });
    } catch (error) {
      if (!isMemoryActionCurrent(actionContext) || !isMemoryPinRequestCurrent(key, requestId)) {
        return;
      }

      setStatus({
        type: "error",
        text: error instanceof Error ? error.message : "记忆更新失败。",
      });
    } finally {
      clearMemoryActionState(memory.id, "pin");
    }
  }

  async function handleRestore(memory) {
    const actionContext = createMemoryActionContext(currentRoleId, includeDeleted);
    const { key, requestId } = beginRestoreRequest(memory.id);
    setActionMemoryId(memory.id);
    setActionType("restore");
    try {
      const data = await restoreMemory(memory.id);
      if (!data?.success) {
        throw new Error(data?.error || "记忆恢复失败。");
      }

      if (!isMemoryActionCurrent(actionContext) || !isRestoreRequestCurrent(key, requestId)) {
        return;
      }

      const nextMemory = mapMemoryItems([data.data || data.item])[0];
      setMemories((current) => {
        const nextItems = sortMemoryItems(upsertMemoryById(current, nextMemory));
        syncEditingMemory(nextItems, { preserveDrafts: true });
        return nextItems;
      });
      setStatus({ type: "success", text: "记忆已经恢复。" });
    } catch (error) {
      if (!isMemoryActionCurrent(actionContext) || !isRestoreRequestCurrent(key, requestId)) {
        return;
      }

      setStatus({
        type: "error",
        text: error instanceof Error ? error.message : "记忆恢复失败。",
      });
    } finally {
      clearMemoryActionState(memory.id, "restore");
    }
  }

  if (loading) {
    return (
      <section className="memory-page">
        <div className="rb-card memory-feedback">
          <p>正在把记忆接回来...</p>
        </div>
      </section>
    );
  }

  if (needsAuth) {
    return (
      <section className="memory-page">
        <div className="rb-card memory-feedback">
          <p>要先登录，才能看到她记住了什么。</p>
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
    <section className="memory-page">
      <div className="rb-card memory-hero">
        <div>
          <p className="chat-list-kicker">记忆</p>
          <h1 className="memory-title">她记得什么，现在都能在这里看见了。</h1>
          <p className="memory-subtitle">
            在这里把重要的事留给她，也能回头翻一翻她已经认真记住了什么。
          </p>
        </div>
        <div className="chat-list-summary">
          <span className="chat-list-summary-label">记忆数</span>
          <strong>{memories.length}</strong>
        </div>
      </div>

      {status.text ? (
        <div className={status.type === "error" ? "rb-card memory-feedback error" : "rb-card memory-feedback success"}>
          <p>{status.text}</p>
        </div>
      ) : null}

      <div className="rb-card memory-filter-card">
        <div className="moments-filter-head">
          <strong>按角色看</strong>
          <span>{currentRole ? `${currentRole.name} 的记忆` : "当前还没有角色"}</span>
        </div>
        {roles.length > 0 ? (
          <div className="moments-role-strip">
            {roles.map((role) => (
              <RoleChip
                active={String(role.id) === String(currentRoleId)}
                disabled={saving}
                key={role.id}
                label={role.name}
                onClick={() => {
                  if (!saving) {
                    handleRoleChange(String(role.id));
                  }
                }}
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
        <div className="memory-filter-toggle-row">
          <button
            className={includeDeleted ? "secondary-link moments-composer-btn active-toggle" : "secondary-link moments-composer-btn"}
            disabled={saving}
            onClick={handleToggleDeletedView}
            type="button"
          >
            {includeDeleted ? "当前包含已删除记忆" : "显示已删除记忆"}
          </button>
        </div>
      </div>

      <div className="memory-layout">
        <div className="rb-card memory-composer-card">
          <div className="memory-composer-head">
            <h2>{editingMemoryId ? "编辑记忆" : "写一条新记忆"}</h2>
            <div className="moments-composer-actions">
              <button
                className="secondary-link moments-composer-btn"
                disabled={saving}
                onClick={handleCreateOpen}
                type="button"
              >
                新建记忆
              </button>
              {currentRole ? (
                <>
                  <Link
                    className="secondary-link moments-composer-btn"
                    to={`/chat/${encodeURIComponent(currentRole.id)}`}
                  >
                    回到和她聊天
                  </Link>
                  <Link
                    className="secondary-link moments-composer-btn"
                    to="/chat"
                  >
                    去聊天列表
                  </Link>
                </>
              ) : null}
            </div>
          </div>

          {composerOpen ? (
            <form className="memory-form" onSubmit={handleSave}>
              <textarea
                className="form-input memory-textarea"
                onChange={(event) => {
                  invalidateMemorySave();
                  setFormData((current) => ({
                    ...current,
                    content: event.target.value,
                  }));
                  setFormDirty((current) => ({
                    ...current,
                    content: true,
                  }));
                }}
                placeholder="写下她应该记住的事..."
                rows={5}
                value={formData.content}
              />
              <input
                className="form-input"
                onChange={(event) => {
                  invalidateMemorySave();
                  setFormData((current) => ({
                    ...current,
                    tag: event.target.value,
                  }));
                  setFormDirty((current) => ({
                    ...current,
                    tag: true,
                  }));
                }}
                placeholder="标签，比如：普通记忆 / 纪念日 / 喜好"
                type="text"
                value={formData.tag}
              />
              <input
                className="form-input"
                onChange={(event) => {
                  invalidateMemorySave();
                  setFormData((current) => ({
                    ...current,
                    category: event.target.value,
                  }));
                  setFormDirty((current) => ({
                    ...current,
                    category: true,
                  }));
                }}
                placeholder="分类，可选"
                type="text"
                value={formData.category}
              />
              <label className="memory-checkbox">
                <input
                  checked={formData.isImportant}
                  onChange={(event) => {
                    invalidateMemorySave();
                    setFormData((current) => ({
                      ...current,
                      isImportant: event.target.checked,
                    }));
                    setFormDirty((current) => ({
                      ...current,
                      isImportant: true,
                    }));
                  }}
                  type="checkbox"
                />
                <span>置顶成重要记忆</span>
              </label>
              <button className="btn-submit" disabled={saving} type="submit">
                {saving ? "保存中..." : editingMemoryId ? "保存修改" : "保存记忆"}
              </button>
            </form>
          ) : (
            <p className="moments-composer-hint">
              想起一件值得留下来的小事，就写进来；写完也可以马上回去继续和她说话。
            </p>
          )}
        </div>

        <div className="memory-list">
          {memories.length === 0 ? (
            <div className="rb-card memory-empty">
              <p>还没有记忆。</p>
              <p>
                {currentRole
                  ? "先写下一条，让她开始真正记住你。"
                  : "先创建一个角色，再开始往她脑子里放东西。"}
              </p>
              {!currentRole ? (
                <div className="memory-empty-actions">
                  <Link className="secondary-link moments-composer-btn" to="/characters?onboard=first-role">
                    去角色页
                  </Link>
                </div>
              ) : null}
            </div>
          ) : (
            memories.map((item) => (
              <MemoryCard
                actionBusy={String(actionMemoryId) === String(item.id)}
                actionType={actionType}
                item={item}
                key={item.id}
                onDelete={handleDelete}
                onEdit={handleEdit}
                onRestore={handleRestore}
                onTogglePin={handleTogglePin}
              />
            ))
          )}
        </div>
      </div>
    </section>
  );
}
