import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  buildRolePayload,
  buildRoleUpdatePayload,
  clampIntimacy,
  createRole,
  getRolePortraitSrc,
  getRoles,
  getRoleSnippet,
  patchRole,
  restoreRole,
  switchRole,
  updateRole,
  uploadRolePortrait,
} from "../lib/roles.js";

const portraitPresets = Array.from(
  { length: 18 },
  (_item, index) => ({
    id: index,
    src: `/assets/portraits/square/${index}.png`,
    label: `立绘 ${index + 1}`,
  }),
);

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}

function RoleAvatar({ role }) {
  const [imageHidden, setImageHidden] = useState(false);
  const portraitSrc = getRolePortraitSrc(role);
  const fallback = String(role?.name ?? "R").trim().charAt(0) || "R";

  useEffect(() => {
    setImageHidden(false);
  }, [portraitSrc]);

  return (
    <div aria-hidden="true" className="characters-role-avatar">
      {portraitSrc && !imageHidden ? (
        <img
          alt=""
          className="characters-role-avatar-image"
          onError={() => setImageHidden(true)}
          src={portraitSrc}
        />
      ) : (
        <span className="characters-role-avatar-fallback">{fallback}</span>
      )}
    </div>
  );
}

function deleteAfterText(role) {
  if (!role?.delete_after && !role?.deleteAfter) {
    return "";
  }

  const raw = role?.delete_after || role?.deleteAfter;
  const time = new Date(raw).getTime();
  if (!Number.isFinite(time)) {
    return "已进入删除冷静期";
  }

  const diffMs = Math.max(0, time - Date.now());
  const diffDays = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
  return diffDays > 0 ? `${diffDays} 天后彻底删除` : "即将彻底删除";
}

function RoleCard({
  actionLocked,
  onDelete,
  onEdit,
  onRestore,
  onSwitch,
  role,
  switchingRoleId,
}) {
  const intimacy = clampIntimacy(role.intimacy);
  const snippet = getRoleSnippet(role) || "还没写简介，但她已经在这里了。";
  const switching = switchingRoleId === role.id;
  const disabled = actionLocked || switching;
  const pendingDelete = Boolean(role?.delete_after || role?.deleteAfter);

  return (
    <article className={role?.is_active ? "characters-role-card active" : "characters-role-card"}>
      <RoleAvatar role={role} />
      <div className="characters-role-content">
        <div className="characters-role-top">
          <div className="characters-role-name-row">
            <h3>{role.name}</h3>
            {role.tag ? <span className="characters-role-tag">{role.tag}</span> : null}
          </div>
          {role?.is_active ? <span className="characters-role-active">当前活跃</span> : null}
        </div>

        <p className="characters-role-snippet">{snippet}</p>

        <div className="characters-role-meta">
          <span>{`亲密 ${intimacy}`}</span>
          <span>
            {pendingDelete
              ? "正在冷静期中"
              : role?.first_chat_at
                ? "已经开始陪伴"
                : "还没开始聊天"}
          </span>
        </div>
        {pendingDelete ? (
          <div className="characters-role-delete-note">{deleteAfterText(role)}</div>
        ) : null}

        <div className="characters-role-actions">
          <Link className="primary-link characters-role-btn" to={`/chat/${encodeURIComponent(role.id)}`}>
            去聊天
          </Link>
          <Link className="secondary-link characters-role-btn" to={`/memory?roleId=${encodeURIComponent(role.id)}`}>
            去记忆
          </Link>
          <Link className="secondary-link characters-role-btn" to={`/moments?roleId=${encodeURIComponent(role.id)}`}>
            去动态
          </Link>
          <button
            className="secondary-link characters-role-btn"
            disabled={actionLocked}
            onClick={() => onEdit(role)}
            type="button"
          >
            编辑
          </button>
          <button
            className="secondary-link characters-role-btn"
            disabled={disabled || role?.is_active}
            onClick={() => onSwitch(role)}
            type="button"
          >
            {role?.is_active ? "当前活跃" : switching ? "切换中..." : "设为当前"}
          </button>
          <button
            className={pendingDelete ? "secondary-link characters-role-btn" : "secondary-link characters-role-btn danger"}
            disabled={actionLocked}
            onClick={() => (pendingDelete ? onRestore(role) : onDelete(role))}
            type="button"
          >
            {pendingDelete ? "恢复" : "删除"}
          </button>
        </div>
      </div>
    </article>
  );
}

function RoleForm({
  busy,
  buttonText,
  initialValues,
  onInteract,
  onSubmit,
  syncKey,
  title,
}) {
  const [formData, setFormData] = useState(initialValues);
  const [dirtyFields, setDirtyFields] = useState({});
  const syncKeyRef = useRef(syncKey);
  const portraitReadRequestSeqRef = useRef(0);

  useEffect(() => {
    if (syncKeyRef.current !== syncKey) {
      syncKeyRef.current = syncKey;
      portraitReadRequestSeqRef.current += 1;
      setFormData(initialValues);
      setDirtyFields({});
      return;
    }

    setFormData((current) => {
      let changed = false;
      const next = { ...current };

      Object.entries(initialValues).forEach(([field, value]) => {
        if (dirtyFields[field]) {
          return;
        }

        if (next[field] !== value) {
          next[field] = value;
          changed = true;
        }
      });

      return changed ? next : current;
    });
  }, [dirtyFields, initialValues, syncKey]);

  function handleChange(event) {
    const { checked, name, type, value } = event.target;
    onInteract?.();
    setFormData((current) => ({
      ...current,
      [name]: type === "checkbox" ? checked : value,
    }));
    setDirtyFields((current) => ({
      ...current,
      [name]: true,
    }));
  }

  function handleSubmit(event) {
    event.preventDefault();
    onSubmit(formData);
  }

  async function handlePortraitUpload(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    onInteract?.();
    const requestId = portraitReadRequestSeqRef.current + 1;
    portraitReadRequestSeqRef.current = requestId;
    const preview = await readFileAsDataUrl(file).catch(() => "");
    if (portraitReadRequestSeqRef.current !== requestId) {
      return;
    }
    setFormData((current) => ({
      ...current,
      portraitId: 999,
      portraitCustomUrl: preview,
      portraitFile: file,
    }));
    setDirtyFields((current) => ({
      ...current,
      portraitId: true,
      portraitCustomUrl: true,
      portraitFile: true,
    }));
  }

  function handlePortraitSelect(portraitId) {
    onInteract?.();
    portraitReadRequestSeqRef.current += 1;
    setFormData((current) => ({
      ...current,
      portraitId,
      portraitCustomUrl: portraitId === 999 ? current.portraitCustomUrl : "",
      portraitFile: portraitId === 999 ? current.portraitFile : null,
    }));
    setDirtyFields((current) => ({
      ...current,
      portraitId: true,
      portraitCustomUrl: true,
      portraitFile: true,
    }));
  }

  return (
    <form className="characters-create-form" onSubmit={handleSubmit}>
      <h2>{title}</h2>
      <div className="form-group">
        <label className="form-label" htmlFor="role-name">
          她叫什么
        </label>
        <input
          className="form-input"
          id="role-name"
          name="name"
          onChange={handleChange}
          placeholder="比如：若白、小白、糖糖"
          type="text"
          value={formData.name}
        />
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="role-tag">
          关系标签
        </label>
        <input
          className="form-input"
          id="role-tag"
          name="tag"
          onChange={handleChange}
          placeholder="比如：恋人、挚友、家人"
          type="text"
          value={formData.tag}
        />
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="role-avatar">
          头像地址
        </label>
        <input
          className="form-input"
          id="role-avatar"
          name="avatar"
          onChange={handleChange}
          placeholder="可以先留空，后面再补"
          type="text"
          value={formData.avatar}
        />
      </div>

      <div className="form-group">
        <label className="form-label">角色立绘</label>
        <div className="characters-portrait-grid">
          {portraitPresets.map((portrait) => (
            <button
              className={Number(formData.portraitId) === portrait.id ? "characters-portrait-item active" : "characters-portrait-item"}
              key={portrait.id}
              onClick={() => handlePortraitSelect(portrait.id)}
              type="button"
            >
              <img alt={portrait.label} src={portrait.src} />
            </button>
          ))}
          <label className={Number(formData.portraitId) === 999 ? "characters-portrait-item active upload" : "characters-portrait-item upload"}>
            {formData.portraitCustomUrl ? (
              <img alt="自定义立绘" src={formData.portraitCustomUrl} />
            ) : (
              <span>上传</span>
            )}
            <input
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={handlePortraitUpload}
              type="file"
            />
          </label>
        </div>
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="role-persona">
          她是什么样的人
        </label>
        <textarea
          className="form-input characters-persona-input"
          id="role-persona"
          name="persona"
          onChange={handleChange}
          placeholder="写一点她的性格、说话方式、你们的关系。"
          rows={5}
          value={formData.persona}
        />
      </div>

      <label className="characters-switch-row">
        <input
          checked={Boolean(formData.autoMomentsEnabled)}
          name="autoMomentsEnabled"
          onChange={handleChange}
          type="checkbox"
        />
        <span>允许她自动发动态</span>
      </label>

      <label className="characters-switch-row">
        <input
          checked={Boolean(formData.speechCompact)}
          name="speechCompact"
          onChange={handleChange}
          type="checkbox"
        />
        <span>紧凑回复（不换行）</span>
      </label>

      <div className="characters-auto-grid">
        <div className="form-group">
          <label className="form-label" htmlFor="role-auto-min">
            每天最少
          </label>
          <input
            className="form-input"
            disabled={!formData.autoMomentsEnabled}
            id="role-auto-min"
            max="6"
            min="0"
            name="autoMomentsDailyMin"
            onChange={handleChange}
            type="number"
            value={formData.autoMomentsDailyMin}
          />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="role-auto-max">
            每天最多
          </label>
          <input
            className="form-input"
            disabled={!formData.autoMomentsEnabled}
            id="role-auto-max"
            max="6"
            min="0"
            name="autoMomentsDailyMax"
            onChange={handleChange}
            type="number"
            value={formData.autoMomentsDailyMax}
          />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="role-auto-interval">
            间隔小时
          </label>
          <input
            className="form-input"
            disabled={!formData.autoMomentsEnabled}
            id="role-auto-interval"
            max="24"
            min="4"
            name="autoMomentsMinIntervalHours"
            onChange={handleChange}
            type="number"
            value={formData.autoMomentsMinIntervalHours}
          />
        </div>
      </div>

      <p className="profile-settings-hint">
        {formData.autoMomentsEnabled
          ? "现在会按你给她设定的每日次数和间隔，自动发动态。"
          : "自动动态现在是关着的，所以下面这几项频率设置暂时不会生效。"}
      </p>

      <button className="btn-submit" disabled={busy} type="submit">
        {busy ? "保存中..." : buttonText}
      </button>
    </form>
  );
}

export function CharactersPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [roles, setRoles] = useState([]);
  const [deletedRoles, setDeletedRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [switchingRoleId, setSwitchingRoleId] = useState(null);
  const [error, setError] = useState("");
  const [needsAuth, setNeedsAuth] = useState(false);
  const [editingRole, setEditingRole] = useState(null);
  const loadRequestSeqRef = useRef(0);
  const roleMutationRequestSeqRef = useRef(0);
  const switchingRoleIdRef = useRef(null);

  const createInitialValues = useMemo(
    () => ({
      name: "",
      tag: "",
      persona: "",
      avatar: "",
      portraitId: null,
      portraitCustomUrl: "",
      portraitFile: null,
      autoMomentsEnabled: false,
      autoMomentsDailyMin: 0,
      autoMomentsDailyMax: 0,
      autoMomentsMinIntervalHours: 4,
      speechCompact: false,
    }),
    [],
  );

  const editInitialValues = useMemo(
    () => ({
      name: editingRole?.name || "",
      tag: editingRole?.tag || "",
      persona: editingRole?.persona || "",
      avatar: editingRole?.avatar || "",
      portraitId: editingRole?.portrait_id ?? editingRole?.portraitId ?? null,
      portraitCustomUrl:
        editingRole?.portrait_custom_url ?? editingRole?.portraitCustomUrl ?? "",
      portraitFile: null,
      autoMomentsEnabled: Boolean(
        editingRole?.auto_moments_enabled ?? editingRole?.autoMomentsEnabled,
      ),
      autoMomentsDailyMin:
        editingRole?.auto_moments_daily_min ?? editingRole?.autoMomentsDailyMin ?? 0,
      autoMomentsDailyMax:
        editingRole?.auto_moments_daily_max ?? editingRole?.autoMomentsDailyMax ?? 0,
      autoMomentsMinIntervalHours:
        editingRole?.auto_moments_min_interval_hours ??
        editingRole?.autoMomentsMinIntervalHours ??
        4,
      speechCompact:
        String(editingRole?.speech_style || editingRole?.speechStyle || "natural") === "compact",
    }),
    [editingRole],
  );

  const onboard = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get("onboard");
  }, [location.search]);

  useEffect(() => {
    switchingRoleIdRef.current = switchingRoleId;
  }, [switchingRoleId]);

  function syncRoleCollections(items) {
    setNeedsAuth(false);
    setRoles(items.filter((item) => !item.is_deleted));
    setDeletedRoles(items.filter((item) => item.is_deleted));
    syncEditingRoleWithItems(items);
  }

  function syncEditingRoleWithItems(items) {
    setEditingRole((current) => {
      if (!current) {
        return current;
      }

      return items.find((item) => String(item.id) === String(current.id)) || null;
    });
  }

  function beginRoleListRequest() {
    const requestId = loadRequestSeqRef.current + 1;
    loadRequestSeqRef.current = requestId;
    return requestId;
  }

  function applyRoleListSnapshot(items, requestId) {
    if (loadRequestSeqRef.current !== requestId) {
      return false;
    }

    syncRoleCollections(items);
    return true;
  }

  function invalidateRoleMutation() {
    roleMutationRequestSeqRef.current += 1;
    setBusy(false);
    setSwitchingRoleId(null);
  }

  function handleEditRole(role) {
    invalidateRoleMutation();
    setEditingRole(role);
  }

  async function loadRoleList(options = {}) {
    const requestId = beginRoleListRequest();
    const {
      showSpinner = true,
      clearError = true,
      reportError = true,
    } = options;
    if (showSpinner) {
      setLoading(true);
    }
    if (clearError) {
      setError("");
    }

    try {
      const data = await getRoles({ includeDeleted: true });
      if (data?.success === false) {
        throw new Error(data.error || "角色列表读取失败。");
      }

      if (!Array.isArray(data?.items)) {
        throw new Error("角色列表返回格式不对。");
      }

      if (loadRequestSeqRef.current !== requestId) {
        return;
      }

      applyRoleListSnapshot(data.items, requestId);
    } catch (loadError) {
      if (loadRequestSeqRef.current !== requestId) {
        return;
      }

      const message =
        loadError instanceof Error ? loadError.message : "角色列表读取失败。";

      if (message.includes("401") || message.includes("登录")) {
        setNeedsAuth(true);
        setRoles([]);
        setDeletedRoles([]);
        setEditingRole(null);
        setError("");
      } else if (reportError) {
        setError(message);
      }
    } finally {
      if (loadRequestSeqRef.current === requestId && showSpinner) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    loadRoleList();
  }, []);

  useEffect(() => {
    function refreshCurrentCharactersView() {
      loadRoleList({
        showSpinner: false,
        clearError: false,
        reportError: false,
      });
    }

    function handleWindowFocus() {
      refreshCurrentCharactersView();
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        refreshCurrentCharactersView();
      }
    }

    window.addEventListener("focus", handleWindowFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", handleWindowFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  async function handleCreateRole(values) {
    const requestId = roleMutationRequestSeqRef.current + 1;
    roleMutationRequestSeqRef.current = requestId;
    const payload = buildRolePayload(values);
    if (payload?.error) {
      setError(payload.error);
      return;
    }

    setBusy(true);
    setError("");

    try {
      const data = await createRole(payload);
      if (!data?.success || !data.item) {
        throw new Error(data?.error || "创建角色失败。");
      }
      if (roleMutationRequestSeqRef.current !== requestId) {
        return;
      }

      if (values.portraitFile) {
        const imageData = await readFileAsDataUrl(values.portraitFile);
        if (roleMutationRequestSeqRef.current !== requestId) {
          return;
        }
        const portrait = await uploadRolePortrait(data.item.id, imageData);
        if (!portrait?.success || !portrait.portrait_url) {
          throw new Error(portrait?.error || "上传立绘失败。");
        }
        if (roleMutationRequestSeqRef.current !== requestId) {
          return;
        }
        await updateRole(data.item.id, {
          ...payload,
          portrait_id: 999,
          portrait_custom_url: portrait.portrait_url,
        });
      }

      if (roleMutationRequestSeqRef.current !== requestId) {
        return;
      }

      const listRequestId = beginRoleListRequest();
      const refreshed = await getRoles({ includeDeleted: true }).catch(() => null);
      if (refreshed?.success && Array.isArray(refreshed.items)) {
        applyRoleListSnapshot(refreshed.items, listRequestId);
      }

      if (roleMutationRequestSeqRef.current !== requestId) {
        return;
      }
      navigate(`/chat/${encodeURIComponent(data.item.id)}`);
    } catch (createError) {
      if (roleMutationRequestSeqRef.current !== requestId) {
        return;
      }
      setError(
        createError instanceof Error ? createError.message : "创建角色失败。",
      );
    } finally {
      if (roleMutationRequestSeqRef.current === requestId) {
        setBusy(false);
      }
    }
  }

  async function handleUpdateRole(values) {
    if (!editingRole) {
      return;
    }

    const requestId = roleMutationRequestSeqRef.current + 1;
    roleMutationRequestSeqRef.current = requestId;
    const payload = buildRoleUpdatePayload(values, editingRole);
    if (payload?.error) {
      setError(payload.error);
      return;
    }

    setBusy(true);
    setError("");

    try {
      let nextPayload = payload;
      if (values.portraitFile) {
        const imageData = await readFileAsDataUrl(values.portraitFile);
        const portrait = await uploadRolePortrait(editingRole.id, imageData);
        if (!portrait?.success || !portrait.portrait_url) {
          throw new Error(portrait?.error || "上传立绘失败。");
        }
        if (roleMutationRequestSeqRef.current !== requestId) {
          return;
        }
        nextPayload = {
          ...payload,
          portrait_id: 999,
          portrait_custom_url: portrait.portrait_url,
        };
      }

      const data = await updateRole(editingRole.id, nextPayload);
      if (!data?.success || !data.item) {
        throw new Error(data?.error || "角色更新失败。");
      }
      if (roleMutationRequestSeqRef.current !== requestId) {
        return;
      }

      const listRequestId = beginRoleListRequest();
      const refreshed = await getRoles({ includeDeleted: true }).catch(() => null);
      if (refreshed?.success && Array.isArray(refreshed.items)) {
        applyRoleListSnapshot(refreshed.items, listRequestId);
      } else if (loadRequestSeqRef.current === listRequestId) {
        setRoles((current) =>
          current.map((role) => (role.id === editingRole.id ? data.item : role)),
        );
        setEditingRole(data.item);
      }
    } catch (updateError) {
      if (roleMutationRequestSeqRef.current !== requestId) {
        return;
      }
      setError(
        updateError instanceof Error ? updateError.message : "角色更新失败。",
      );
    } finally {
      if (roleMutationRequestSeqRef.current === requestId) {
        setBusy(false);
      }
    }
  }

  async function handleSwitchRole(role) {
    const requestId = roleMutationRequestSeqRef.current + 1;
    roleMutationRequestSeqRef.current = requestId;
    setSwitchingRoleId(role.id);
    setError("");

    try {
      const data = await switchRole(role.id);
      if (!data?.success || !data.item) {
        throw new Error(data?.error || "切换当前角色失败。");
      }
      if (roleMutationRequestSeqRef.current !== requestId) {
        return;
      }

      const listRequestId = beginRoleListRequest();
      const refreshed = await getRoles({ includeDeleted: true }).catch(() => null);
      if (refreshed?.success && Array.isArray(refreshed.items)) {
        applyRoleListSnapshot(refreshed.items, listRequestId);
      } else if (loadRequestSeqRef.current === listRequestId) {
        setRoles((current) =>
          current.map((item) => ({
            ...item,
            is_active: item.id === role.id ? 1 : 0,
          })),
        );
        setEditingRole((current) => {
          if (!current) {
            return current;
          }

          if (current.id === role.id) {
            return {
              ...current,
              is_active: 1,
            };
          }

          return {
            ...current,
            is_active: 0,
          };
        });
      }
    } catch (switchError) {
      if (roleMutationRequestSeqRef.current !== requestId) {
        return;
      }
      setError(
        switchError instanceof Error ? switchError.message : "切换当前角色失败。",
      );
    } finally {
      if (
        roleMutationRequestSeqRef.current === requestId &&
        String(switchingRoleIdRef.current) === String(role.id)
      ) {
        setSwitchingRoleId(null);
      }
    }
  }

  async function handleDeleteRole(role) {
    const ok = window.confirm(`先让 ${role.name} 进入 3 天删除冷静期，可以恢复。继续吗？`);
    if (!ok) {
      return;
    }

    setError("");
    setBusy(true);
    const requestId = roleMutationRequestSeqRef.current + 1;
    roleMutationRequestSeqRef.current = requestId;

    try {
      const deleteAfter = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
      const data = await patchRole(role.id, { delete_after: deleteAfter });
      if (!data?.success || !data.item) {
        throw new Error(data?.error || "设置删除冷静期失败。");
      }
      if (roleMutationRequestSeqRef.current !== requestId) {
        return;
      }

      const listRequestId = beginRoleListRequest();
      const refreshed = await getRoles({ includeDeleted: true }).catch(() => null);
      if (refreshed?.success && Array.isArray(refreshed.items)) {
        applyRoleListSnapshot(refreshed.items, listRequestId);
      } else if (loadRequestSeqRef.current === listRequestId) {
        setRoles((current) =>
          current.map((item) => (item.id === role.id ? data.item : item)),
        );
        setEditingRole((current) => (current?.id === role.id ? data.item : current));
      }
    } catch (deleteError) {
      if (roleMutationRequestSeqRef.current !== requestId) {
        return;
      }
      setError(
        deleteError instanceof Error ? deleteError.message : "设置删除冷静期失败。",
      );
    } finally {
      if (roleMutationRequestSeqRef.current === requestId) {
        setBusy(false);
      }
    }
  }

  async function handleRestoreRole(role) {
    setError("");
    setBusy(true);
    const requestId = roleMutationRequestSeqRef.current + 1;
    roleMutationRequestSeqRef.current = requestId;

    try {
      const restorePending = role?.delete_after || role?.deleteAfter;
      const data = restorePending
        ? await patchRole(role.id, { delete_after: null })
        : await restoreRole(role.id);

      if (!data?.success || !data.item) {
        throw new Error(data?.error || "恢复角色失败。");
      }
      if (roleMutationRequestSeqRef.current !== requestId) {
        return;
      }

      const listRequestId = beginRoleListRequest();
      const refreshed = await getRoles({ includeDeleted: true }).catch(() => null);
      if (refreshed?.success && Array.isArray(refreshed.items)) {
        applyRoleListSnapshot(refreshed.items, listRequestId);
      } else if (restorePending && loadRequestSeqRef.current === listRequestId) {
        setRoles((current) =>
          current.map((item) => (item.id === role.id ? data.item : item)),
        );
        setEditingRole((current) => (current?.id === role.id ? data.item : current));
      } else if (loadRequestSeqRef.current === listRequestId) {
        setDeletedRoles((current) =>
          current.filter((item) => String(item.id) !== String(role.id)),
        );
        setRoles((current) => [data.item, ...current]);
        setEditingRole((current) => (current?.id === role.id ? data.item : current));
      }
    } catch (restoreError) {
      if (roleMutationRequestSeqRef.current !== requestId) {
        return;
      }
      setError(
        restoreError instanceof Error ? restoreError.message : "恢复角色失败。",
      );
    } finally {
      if (roleMutationRequestSeqRef.current === requestId) {
        setBusy(false);
      }
    }
  }

  if (loading) {
    return (
      <section className="characters-page">
        <div className="rb-card characters-feedback">
          <p>正在整理你的角色列表...</p>
        </div>
      </section>
    );
  }

  if (needsAuth) {
    return (
      <section className="characters-page">
        <div className="rb-card characters-feedback">
          <p>要先登录，才能把她们接回来。</p>
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
    <section className="characters-page">
      <div className="rb-card characters-hero">
        <div>
          <p className="chat-list-kicker">角色</p>
          <h1 className="characters-title">把每一位陪伴都收好。</h1>
          <p className="characters-subtitle">
            在这里整理她们的名字、关系和样子，也能随时把正在陪你的那一个切出来。
          </p>
        </div>
        <div className="chat-list-summary">
          <span className="chat-list-summary-label">角色数</span>
          <strong>{roles.length}</strong>
        </div>
      </div>

      {error ? (
        <div className="rb-card characters-feedback error" role="alert">
          <p>{error}</p>
        </div>
      ) : null}

      {roles.length === 0 ? (
        <div className="characters-empty-layout">
          <div className="rb-card characters-onboard-card">
            <p className="home-section-label">从 0 开始也没关系</p>
            <h2>{onboard === "first-role" ? "先把第一个她带进来" : "现在还没有角色"}</h2>
            <p>先给她起名字，再写一点你想让她怎么陪你说话。创建完就能直接开始和她聊天。</p>
          </div>

          <div className="rb-card characters-create-card">
            <RoleForm
              busy={busy}
              buttonText="创建角色"
              initialValues={createInitialValues}
              onInteract={invalidateRoleMutation}
              onSubmit={handleCreateRole}
              syncKey="characters-create-empty"
              title="创建角色"
            />
          </div>
        </div>
      ) : (
        <div className="characters-grid-layout">
          <div className="characters-role-list">
            {roles.map((role) => (
              <RoleCard
                actionLocked={busy || switchingRoleId !== null}
                key={role.id}
                onDelete={handleDeleteRole}
                onEdit={handleEditRole}
                onRestore={handleRestoreRole}
                onSwitch={handleSwitchRole}
                role={role}
                switchingRoleId={switchingRoleId}
              />
            ))}

            {deletedRoles.length > 0 ? (
              <div className="characters-deleted-section">
                <div className="characters-deleted-head">
                  <strong>可恢复角色</strong>
                  <span>这些角色已经被删掉，但还可以从 React 页里接回来。</span>
                </div>
                <div className="characters-deleted-list">
                  {deletedRoles.map((role) => (
                    <article className="characters-deleted-card" key={role.id}>
                      <RoleAvatar role={role} />
                      <div className="characters-deleted-copy">
                        <strong>{role.name}</strong>
                        <span>{role.tag || "未设置关系"}</span>
                      </div>
                      <button
                        className="secondary-link characters-role-btn"
                        disabled={busy || switchingRoleId !== null}
                        onClick={() => handleRestoreRole(role)}
                        type="button"
                      >
                        恢复
                      </button>
                    </article>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <aside className="rb-card characters-create-card side">
            {editingRole ? (
              <>
                <p className="characters-create-note">
                  这里可以直接改她的基础资料、立绘和自动动态设置。
                </p>
                <RoleForm
                  busy={busy}
                  buttonText="保存修改"
                  initialValues={editInitialValues}
                  onInteract={invalidateRoleMutation}
                  onSubmit={handleUpdateRole}
                  syncKey={editingRole.id ? `edit-${editingRole.id}` : "edit-role"}
                  title={`编辑 ${editingRole.name}`}
                />
              </>
            ) : (
              <>
                <h2>再创建一个她</h2>
                <p className="characters-create-note">
                  想多一个陪你说话的人，就从这里把她带进来。
                </p>
                <RoleForm
                  busy={busy}
                  buttonText="创建角色"
                  initialValues={createInitialValues}
                  onInteract={invalidateRoleMutation}
                  onSubmit={handleCreateRole}
                  syncKey="characters-create-side"
                  title="创建角色"
                />
              </>
            )}
          </aside>
        </div>
      )}
    </section>
  );
}
