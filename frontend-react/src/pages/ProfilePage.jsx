import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  activateModelConfig,
  changePassword,
  createModelConfig,
  deleteAvatarImage,
  deleteModelConfig,
  discoverModelConfigs,
  getModelConfigs,
  getModelConfigStatus,
  getRelationshipStatus,
  getSessionProfile,
  logoutSession,
  testModelConfig,
  getUsageStats,
  getUserSettings,
  updateUserSettings,
  updateModelConfig,
  uploadAvatarImage,
  updateNickname,
  useTestModelConfig,
} from "../lib/profile.js";
import { useTheme } from "../theme/ThemeProvider.jsx";
import { themes } from "../theme/themes.js";

const todoMessages = {
  "profile-key":
    "你已经登录成功了。下一步先去“我的”页把模型配置好。",
};

const avatarPresets = Array.from(
  { length: 18 },
  (_item, index) => `/assets/avatar-squares/${index}.png`,
);

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}

function readTodo(search) {
  const params = new URLSearchParams(search);
  return params.get("todo") || "";
}

function formatDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return "暂时没有";
  }

  return date.toLocaleDateString("zh-CN");
}

function formatDateTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return "暂时没有";
  }

  return date.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normalizeThemeValue(value) {
  return themes[value] ? value : "guangwei";
}

function normalizeBooleanValue(value) {
  return Boolean(Number(value || 0));
}

function createEmptyModelForm() {
  return {
    name: "",
    api_base: "",
    api_key: "",
    model: "",
  };
}

function buildModelConfigOriginal(item) {
  return {
    api_base: item?.api_base || "",
    model: item?.model || "",
    name: item?.name || "",
  };
}

function getThemeLabel(value) {
  const themeKey = normalizeThemeValue(value);
  return themes[themeKey]?.name || themes.guangwei.name;
}

function ProfileStatCard({ label, value }) {
  return (
    <article className="profile-stat-card">
      <span className="profile-stat-value">{value}</span>
      <span className="profile-stat-label">{label}</span>
    </article>
  );
}

function ModelConfigCard({
  actionConfigId,
  actionType,
  busy,
  configs,
  discoveredModels,
  editingConfigId,
  editingConfigLabel,
  modelForm,
  modelStatus,
  onActivate,
  onChange,
  onCreate,
  onDelete,
  onPickDiscoveredModel,
  onDiscoverModels,
  onEdit,
  onTestDraft,
  onTest,
  onUseTest,
}) {
  return (
    <div className="rb-card profile-section-card profile-model-card">
      <h2>模型配置</h2>
      <p className="profile-model-note">
        {editingConfigId
          ? ("正在编辑：" + editingConfigLabel + "。如果不想改 key，可以把 key 留空。")
          : "在这里管理你正在用的模型配置，也可以测试、切换或整理不同方案。"}
      </p>

      <div className="profile-model-summary">
        <span>{modelStatus?.has_custom_config ? "已存在自定义模型" : "还没有自定义模型"}</span>
        <span>{modelStatus?.has_active_config ? "已有当前生效配置" : "当前还没有生效配置"}</span>
        <span>
          {modelStatus?.active_config_is_test
            ? "当前生效的是测试配置"
            : modelStatus?.has_active_config
              ? "当前生效的是正式配置"
              : "现在还没有正在生效的模型"}
        </span>
      </div>

      {configs.length > 0 ? (
        <div className="profile-model-list">
          {configs.map((item) => (
            (() => {
              const itemActionBusy = busy && actionConfigId === item.id;
              return (
            <article
              className={item.is_active ? "profile-model-item active" : "profile-model-item"}
              key={item.id}
            >
              <div className="profile-model-item-copy">
                <strong>{item.name}</strong>
                <p>{item.model || "未填模型名"}</p>
              </div>
              <div className="profile-model-item-side">
                <span>{item.is_active ? "当前使用" : item.api_key_masked || "已保存"}</span>
                <div className="profile-model-item-actions">
                  <button
                    className="secondary-link profile-model-mini-btn"
                    disabled={busy}
                    onClick={() => onEdit(item)}
                    type="button"
                  >
                    {editingConfigId === item.id ? "正在编辑" : "编辑"}
                  </button>
                  <button
                    className="secondary-link profile-model-mini-btn"
                    disabled={busy}
                    onClick={() => onActivate(item)}
                    type="button"
                  >
                    {item.is_active
                      ? "已启用"
                      : itemActionBusy && actionType === "activate"
                        ? "切换中..."
                        : "启用"}
                  </button>
                  <button
                    className="secondary-link profile-model-mini-btn"
                    disabled={busy}
                    onClick={() => onTest(item)}
                    type="button"
                  >
                    {itemActionBusy && actionType === "test"
                      ? "测试中..."
                      : "测试"}
                  </button>
                  <button
                    className="secondary-link profile-model-mini-btn danger"
                    disabled={busy}
                    onClick={() => onDelete(item)}
                    type="button"
                  >
                    {itemActionBusy && actionType === "delete"
                      ? "处理中..."
                      : "删除"}
                  </button>
                </div>
              </div>
            </article>
              );
            })()
          ))}
        </div>
      ) : null}

      <form className="profile-form" onSubmit={onCreate}>
        <div className="form-group">
          <label className="form-label" htmlFor="model-name">
            配置名
          </label>
          <input
            className="form-input"
            id="model-name"
            name="name"
            onChange={onChange}
            placeholder="比如：我的 DeepSeek / Grok"
            type="text"
            value={modelForm.name}
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="model-api-base">
            接口地址
          </label>
          <input
            className="form-input"
            id="model-api-base"
            name="api_base"
            onChange={onChange}
            placeholder="例如：https://api.openai.com/v1"
            type="text"
            value={modelForm.api_base}
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="model-api-key">
            API Key
          </label>
          <input
            autoComplete="off"
            className="form-input"
            id="model-api-key"
            name="api_key"
            onChange={onChange}
            placeholder={editingConfigId ? "不改 key 就留空" : "粘贴你自己的 key"}
            type="password"
            value={modelForm.api_key}
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="model-model-name">
            模型名
          </label>
          <input
            className="form-input"
            id="model-model-name"
            name="model"
            onChange={onChange}
            placeholder="比如：gpt-4o-mini / deepseek-chat"
            type="text"
            value={modelForm.model}
          />
        </div>

        <div className="profile-model-actions">
          <button className="btn-submit profile-model-primary" disabled={busy} type="submit">
            {busy ? "保存中..." : editingConfigId ? "保存配置" : "保存并启用"}
          </button>
          <button
            className="secondary-link profile-model-secondary"
            disabled={busy}
            onClick={onDiscoverModels}
            type="button"
          >
            {busy && actionType === "discover-models" ? "发现中..." : "发现模型"}
          </button>
          <button
            className="secondary-link profile-model-secondary"
            disabled={busy}
            onClick={onTestDraft}
            type="button"
          >
            {busy && actionType === "draft-test" ? "测试中..." : "测试当前输入"}
          </button>
          {editingConfigId ? (
            <button
              className="secondary-link profile-model-secondary"
              disabled={busy}
              onClick={() => onEdit(null)}
              type="button"
            >
              取消编辑
            </button>
          ) : null}
          {modelStatus?.can_use_test_config ? (
            <button
              className="secondary-link profile-model-secondary"
              disabled={busy}
              onClick={onUseTest}
              type="button"
            >
              先启用测试配置
            </button>
          ) : null}
        </div>

        {discoveredModels.length > 0 ? (
          <div className="profile-model-discovery">
            <strong>已发现的模型</strong>
            <div className="profile-model-discovery-list">
              {discoveredModels.map((item) => (
                <button
                  className={item === modelForm.model ? "profile-model-discovery-chip active" : "profile-model-discovery-chip"}
                  key={item}
                  onClick={() => onPickDiscoveredModel(item)}
                  type="button"
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </form>
    </div>
  );
}

export function ProfilePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { setTheme, theme: activeTheme } = useTheme();
  const [status, setStatus] = useState({ type: "", text: "" });
  const [loading, setLoading] = useState(true);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [busy, setBusy] = useState(false);
  const [profile, setProfile] = useState(null);
  const [relationship, setRelationship] = useState(null);
  const [settings, setSettings] = useState(null);
  const [usage, setUsage] = useState(null);
  const [modelStatus, setModelStatus] = useState(null);
  const [modelConfigs, setModelConfigs] = useState([]);
  const [actionConfigId, setActionConfigId] = useState(null);
  const [actionType, setActionType] = useState("");
  const [discoveredModels, setDiscoveredModels] = useState([]);
  const [editingConfigId, setEditingConfigId] = useState(null);
  const [editingConfigLabel, setEditingConfigLabel] = useState("");
  const [editingConfigOriginal, setEditingConfigOriginal] = useState(null);
  const [nickname, setNickname] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    newUsername: "",
  });
  const [settingsForm, setSettingsForm] = useState({
    theme: "guangwei",
    ttsEnabled: false,
    autoMomentsEnabled: false,
    autoMomentsFrequencyHours: 24,
    autoMomentsQuietEnabled: true,
    autoMomentsQuietStart: "23:00",
    autoMomentsQuietEnd: "08:00",
  });
  const [modelForm, setModelForm] = useState(createEmptyModelForm);
  const [modelFormDirty, setModelFormDirty] = useState({});
  const profileRef = React.useRef(null);
  const profileRequestSeqRef = React.useRef(0);
  const modelStateRequestSeqRef = React.useRef(0);
  const discoverModelsRequestSeqRef = React.useRef(0);
  const modelTestRequestSeqRef = React.useRef(0);
  const modelSaveRequestSeqRef = React.useRef(0);
  const modelMutationRequestSeqRef = React.useRef(0);
  const modelBusyScopeRef = React.useRef("");
  const settingsSaveRequestSeqRef = React.useRef(0);
  const profileIdentityRequestSeqRef = React.useRef(0);
  const passwordSubmitRequestSeqRef = React.useRef(0);
  const profileBusyScopeRef = React.useRef("");
  const settingsRef = React.useRef(null);
  const nicknameRef = React.useRef("");
  const avatarUrlRef = React.useRef("");
  const modelFormRef = React.useRef(createEmptyModelForm());
  const modelFormDirtyRef = React.useRef({});
  const editingConfigIdRef = React.useRef(null);
  const settingsFormRef = React.useRef({
    theme: "guangwei",
    ttsEnabled: false,
    autoMomentsEnabled: false,
    autoMomentsFrequencyHours: 24,
    autoMomentsQuietEnabled: true,
    autoMomentsQuietStart: "23:00",
    autoMomentsQuietEnd: "08:00",
  });

  const todo = useMemo(() => readTodo(location.search), [location.search]);
  const themeLabel = useMemo(() => getThemeLabel(settings?.theme), [settings?.theme]);
  const ttsEnabled = useMemo(() => normalizeBooleanValue(settings?.tts_enabled), [settings?.tts_enabled]);
  const autoMomentsEnabled = useMemo(
    () => normalizeBooleanValue(settings?.auto_moments_enabled),
    [settings?.auto_moments_enabled],
  );

  useEffect(() => {
    profileRef.current = profile;
    settingsRef.current = settings;
    nicknameRef.current = nickname;
    avatarUrlRef.current = avatarUrl;
    modelFormRef.current = modelForm;
    modelFormDirtyRef.current = modelFormDirty;
    editingConfigIdRef.current = editingConfigId;
    settingsFormRef.current = settingsForm;
  }, [
    avatarUrl,
    editingConfigId,
    modelForm,
    modelFormDirty,
    nickname,
    profile,
    settings,
    settingsForm,
  ]);

  function invalidateModelDiscovery() {
    discoverModelsRequestSeqRef.current += 1;
    if (modelBusyScopeRef.current === "discover") {
      modelBusyScopeRef.current = "";
      setBusy(false);
      setActionType("");
    }
  }

  function invalidateModelTest() {
    modelTestRequestSeqRef.current += 1;
    if (modelBusyScopeRef.current === "test") {
      modelBusyScopeRef.current = "";
      setBusy(false);
      setActionConfigId(null);
      setActionType("");
    }
  }

  function invalidateModelSave() {
    modelSaveRequestSeqRef.current += 1;
    if (modelBusyScopeRef.current === "save") {
      modelBusyScopeRef.current = "";
      setBusy(false);
    }
  }

  function invalidateModelMutation() {
    modelMutationRequestSeqRef.current += 1;
    if (modelBusyScopeRef.current === "mutation") {
      modelBusyScopeRef.current = "";
      setBusy(false);
      setActionConfigId(null);
      setActionType("");
    }
  }

  function invalidateSettingsSave() {
    settingsSaveRequestSeqRef.current += 1;
    if (profileBusyScopeRef.current === "settings") {
      profileBusyScopeRef.current = "";
      setBusy(false);
    }
  }

  function invalidateProfileIdentity() {
    profileIdentityRequestSeqRef.current += 1;
    if (profileBusyScopeRef.current === "identity") {
      profileBusyScopeRef.current = "";
      setBusy(false);
    }
  }

  function invalidatePasswordSubmit() {
    passwordSubmitRequestSeqRef.current += 1;
    if (profileBusyScopeRef.current === "password") {
      profileBusyScopeRef.current = "";
      setBusy(false);
    }
  }

  function syncEditingModelConfig(items, options = {}) {
    const { preserveDrafts = false } = options;
    const nextItems = Array.isArray(items) ? items : [];
    setModelConfigs(nextItems);

    const currentEditingId = editingConfigIdRef.current;
    if (!currentEditingId) {
      return;
    }

    const matchedItem =
      nextItems.find((item) => String(item.id) === String(currentEditingId)) || null;

    if (!matchedItem) {
      setEditingConfigId(null);
      setEditingConfigLabel("");
      setEditingConfigOriginal(null);
      setDiscoveredModels([]);
      setModelForm(createEmptyModelForm());
      setModelFormDirty({});
      return;
    }

    setEditingConfigId(matchedItem.id);
    setEditingConfigLabel(matchedItem.name || "这条配置");
    setEditingConfigOriginal(buildModelConfigOriginal(matchedItem));
    setModelForm((current) => {
      const dirty = modelFormDirtyRef.current || {};
      const synced = {
        name: preserveDrafts && dirty.name ? current.name : (matchedItem.name || ""),
        api_base:
          preserveDrafts && dirty.api_base ? current.api_base : (matchedItem.api_base || ""),
        api_key: current.api_key,
        model: preserveDrafts && dirty.model ? current.model : (matchedItem.model || ""),
      };

      return synced;
    });

    if (!preserveDrafts) {
      setModelFormDirty({});
    }
  }

  function applyModelStateSnapshot({
    statusData,
    configsData,
    preserveDrafts = false,
    requestId,
    usageData = null,
  }) {
    if (requestId !== undefined && modelStateRequestSeqRef.current !== requestId) {
      return { stale: true };
    }

    setModelStatus(statusData?.item || null);
    syncEditingModelConfig(configsData?.items, { preserveDrafts });
    if (usageData?.item) {
      setUsage(usageData.item);
    }

    return { stale: false };
  }

  async function refreshProfileState(options = {}) {
    const {
      preserveDrafts = false,
      requestId = profileRequestSeqRef.current + 1,
    } = options;
    if (requestId > profileRequestSeqRef.current) {
      profileRequestSeqRef.current = requestId;
    }
    const modelStateRequestId = modelStateRequestSeqRef.current + 1;
    modelStateRequestSeqRef.current = modelStateRequestId;
    const [sessionData, settingsData, usageData, statusData, configsData, relationshipData] = await Promise.all([
      getSessionProfile(),
      getUserSettings(),
      getUsageStats(),
      getModelConfigStatus(),
      getModelConfigs(),
      getRelationshipStatus().catch(() => null),
    ]);

    if (profileRequestSeqRef.current !== requestId) {
      return { stale: true };
    }

    if (!sessionData?.loggedIn || !sessionData.user) {
      throw new Error("请先登录");
    }

    const savedTheme = normalizeThemeValue(settingsData?.item?.theme || activeTheme);
    setNeedsAuth(false);
    setProfile(sessionData.user);
    setSettings(settingsData?.item || null);
    if (applyModelStateSnapshot({
      statusData,
      configsData,
      preserveDrafts,
      requestId: modelStateRequestId,
      usageData,
    })?.stale) {
      return { stale: true };
    }
    setRelationship(relationshipData?.success ? (relationshipData.item || null) : null);
    const nextNickname = sessionData.user.nickname || sessionData.user.username || "";
    const nextAvatarUrl = sessionData.user.avatar || avatarPresets[0];
    const nextSettingsForm = {
      theme: savedTheme,
      ttsEnabled: normalizeBooleanValue(settingsData?.item?.tts_enabled),
      autoMomentsEnabled: normalizeBooleanValue(settingsData?.item?.auto_moments_enabled),
      autoMomentsFrequencyHours: Number(settingsData?.item?.auto_moments_frequency_hours || 24),
      autoMomentsQuietEnabled: normalizeBooleanValue(
        settingsData?.item?.auto_moments_quiet_enabled ?? 1,
      ),
      autoMomentsQuietStart: settingsData?.item?.auto_moments_quiet_start || "23:00",
      autoMomentsQuietEnd: settingsData?.item?.auto_moments_quiet_end || "08:00",
    };
    const currentProfile = profileRef.current;
    const savedNickname =
      currentProfile?.nickname || currentProfile?.username || "";
    const savedAvatarUrl = currentProfile?.avatar || avatarPresets[0];
    const nicknameDirty = nicknameRef.current !== savedNickname;
    const avatarDirty = avatarUrlRef.current !== savedAvatarUrl;
    const currentSettings = settingsRef.current;
    const savedSettingsForm = {
      theme: normalizeThemeValue(currentSettings?.theme || activeTheme),
      ttsEnabled: normalizeBooleanValue(currentSettings?.tts_enabled),
      autoMomentsEnabled: normalizeBooleanValue(currentSettings?.auto_moments_enabled),
      autoMomentsFrequencyHours: Number(currentSettings?.auto_moments_frequency_hours || 24),
      autoMomentsQuietEnabled: normalizeBooleanValue(
        currentSettings?.auto_moments_quiet_enabled ?? 1,
      ),
      autoMomentsQuietStart: currentSettings?.auto_moments_quiet_start || "23:00",
      autoMomentsQuietEnd: currentSettings?.auto_moments_quiet_end || "08:00",
    };
    const settingsDirty =
      settingsFormRef.current.theme !== savedSettingsForm.theme ||
      settingsFormRef.current.ttsEnabled !== savedSettingsForm.ttsEnabled ||
      settingsFormRef.current.autoMomentsEnabled !== savedSettingsForm.autoMomentsEnabled ||
      Number(settingsFormRef.current.autoMomentsFrequencyHours) !==
        Number(savedSettingsForm.autoMomentsFrequencyHours) ||
      settingsFormRef.current.autoMomentsQuietEnabled !== savedSettingsForm.autoMomentsQuietEnabled ||
      settingsFormRef.current.autoMomentsQuietStart !== savedSettingsForm.autoMomentsQuietStart ||
      settingsFormRef.current.autoMomentsQuietEnd !== savedSettingsForm.autoMomentsQuietEnd;
    if (!preserveDrafts || !nicknameDirty) {
      setNickname(nextNickname);
    }
    if (!preserveDrafts || !avatarDirty) {
      setAvatarUrl(nextAvatarUrl);
    }
    if (!preserveDrafts || !settingsDirty) {
      setSettingsForm(nextSettingsForm);
    }
    setTheme(savedTheme);
    return { stale: false };
  }

  useEffect(() => {
    let cancelled = false;

    async function loadProfilePage() {
      const requestId = profileRequestSeqRef.current + 1;
      profileRequestSeqRef.current = requestId;
      setLoading(true);

      try {
        const result = await refreshProfileState({ requestId });
        if (cancelled || result?.stale) {
          return;
        }
      } catch (error) {
        if (cancelled) {
          return;
        }

        const message = error instanceof Error ? error.message : "我的页加载失败。";
        if (message.includes("登录") || message.includes("401")) {
          setNeedsAuth(true);
          setProfile(null);
          setRelationship(null);
        } else {
          setStatus({ type: "error", text: message });
        }
      } finally {
        if (!cancelled && profileRequestSeqRef.current === requestId) {
          setLoading(false);
        }
      }
    }

    loadProfilePage();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function refreshVisibleProfileState() {
      const requestId = profileRequestSeqRef.current + 1;
      profileRequestSeqRef.current = requestId;
      try {
        const result = await refreshProfileState({
          preserveDrafts: true,
          requestId,
        });
        if (cancelled || result?.stale) {
          return;
        }
      } catch (error) {
        if (cancelled) {
          return;
        }

        const message = error instanceof Error ? error.message : "我的页刷新失败。";
        if (message.includes("登录") || message.includes("401")) {
          setNeedsAuth(true);
          setProfile(null);
          setRelationship(null);
        }
      }
    }

    function handleWindowFocus() {
      refreshVisibleProfileState();
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        refreshVisibleProfileState();
      }
    }

    window.addEventListener("focus", handleWindowFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", handleWindowFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  function handleModelFormChange(event) {
    const { name, value } = event.target;
    invalidateModelMutation();
    invalidateModelSave();
    invalidateModelTest();
    if (name === "api_base" || name === "api_key") {
      invalidateModelDiscovery();
      setDiscoveredModels([]);
    }
    setModelForm((current) => ({
      ...current,
      [name]: value,
    }));
    setModelFormDirty((current) => ({
      ...current,
      [name]: true,
    }));
  }

  function handleSettingsFormChange(event) {
    const { checked, name, type, value } = event.target;
    invalidateSettingsSave();
    setSettingsForm((current) => ({
      ...current,
      [name]: type === "checkbox" ? checked : value,
    }));
  }

  function handleNicknameChange(event) {
    invalidateProfileIdentity();
    setNickname(event.target.value);
  }

  function handleAvatarPresetSelect(preset) {
    invalidateProfileIdentity();
    setAvatarUrl(preset);
  }

  function handlePasswordFormChange(field, value) {
    invalidatePasswordSubmit();
    setPasswordForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function refreshModelConfigState(options = {}) {
    const {
      preserveDrafts = true,
      requestId = modelStateRequestSeqRef.current + 1,
    } = options;
    if (requestId > modelStateRequestSeqRef.current) {
      modelStateRequestSeqRef.current = requestId;
    }
    const [statusData, configsData, usageData] = await Promise.all([
      getModelConfigStatus(),
      getModelConfigs(),
      getUsageStats().catch(() => null),
    ]);

    return applyModelStateSnapshot({
      statusData,
      configsData,
      preserveDrafts,
      requestId,
      usageData,
    });
  }

  async function handleSaveSettings(event) {
    event.preventDefault();
    const requestId = settingsSaveRequestSeqRef.current + 1;
    settingsSaveRequestSeqRef.current = requestId;
    profileBusyScopeRef.current = "settings";
    setBusy(true);
    setStatus({ type: "", text: "" });

    try {
      const payload = {
        theme: normalizeThemeValue(settingsForm.theme),
        tts_enabled: settingsForm.ttsEnabled,
        auto_moments_enabled: settingsForm.autoMomentsEnabled,
        auto_moments_frequency_hours: Number(settingsForm.autoMomentsFrequencyHours) || 24,
        auto_moments_quiet_enabled: settingsForm.autoMomentsQuietEnabled,
        auto_moments_quiet_start: settingsForm.autoMomentsQuietStart || "23:00",
        auto_moments_quiet_end: settingsForm.autoMomentsQuietEnd || "08:00",
      };

      const data = await updateUserSettings(payload);
      if (!data?.success || !data.item) {
        throw new Error(data?.error || "偏好设置保存失败。");
      }

      if (settingsSaveRequestSeqRef.current !== requestId) {
        return;
      }

      setSettings(data.item);
      const nextTheme = normalizeThemeValue(data.item.theme || settingsForm.theme);
      setSettingsForm({
        theme: nextTheme,
        ttsEnabled: normalizeBooleanValue(data.item.tts_enabled),
        autoMomentsEnabled: normalizeBooleanValue(data.item.auto_moments_enabled),
        autoMomentsFrequencyHours: Number(data.item.auto_moments_frequency_hours || 24),
        autoMomentsQuietEnabled: normalizeBooleanValue(data.item.auto_moments_quiet_enabled ?? 1),
        autoMomentsQuietStart: data.item.auto_moments_quiet_start || "23:00",
        autoMomentsQuietEnd: data.item.auto_moments_quiet_end || "08:00",
      });
      setTheme(nextTheme);
      setStatus({ type: "success", text: "偏好设置已经保存。" });
    } catch (error) {
      if (settingsSaveRequestSeqRef.current !== requestId) {
        return;
      }
      setStatus({
        type: "error",
        text: error instanceof Error ? error.message : "偏好设置保存失败。",
      });
    } finally {
      if (
        profileBusyScopeRef.current === "settings" &&
        settingsSaveRequestSeqRef.current === requestId
      ) {
        profileBusyScopeRef.current = "";
        setBusy(false);
      }
    }
  }

  async function handleNicknameSubmit(event) {
    event.preventDefault();
    const trimmed = nickname.trim();
    if (!trimmed && !avatarUrl) {
      setStatus({ type: "error", text: "昵称和头像至少改一个。" });
      return;
    }

    const requestId = profileIdentityRequestSeqRef.current + 1;
    profileIdentityRequestSeqRef.current = requestId;
    profileBusyScopeRef.current = "identity";
    setBusy(true);
    setStatus({ type: "", text: "" });

    try {
      const data = await updateNickname({
        ...(trimmed ? { nickname: trimmed } : {}),
        ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
      });
      if (!data?.success || !data.user) {
        throw new Error(data?.error || "昵称更新失败。");
      }

      if (profileIdentityRequestSeqRef.current !== requestId) {
        return;
      }

      setProfile((current) => ({
        ...(current || {}),
        ...data.user,
      }));
      setNickname(data.user.nickname || data.user.username || trimmed);
      setAvatarUrl(data.user.avatar || avatarPresets[0]);
      setStatus({ type: "success", text: "昵称已经更新。" });
    } catch (error) {
      if (profileIdentityRequestSeqRef.current !== requestId) {
        return;
      }
      setStatus({
        type: "error",
        text: error instanceof Error ? error.message : "昵称更新失败。",
      });
    } finally {
      if (
        profileBusyScopeRef.current === "identity" &&
        profileIdentityRequestSeqRef.current === requestId
      ) {
        profileBusyScopeRef.current = "";
        setBusy(false);
      }
    }
  }

  async function handleAvatarUpload(event) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    const requestId = profileIdentityRequestSeqRef.current + 1;
    profileIdentityRequestSeqRef.current = requestId;
    profileBusyScopeRef.current = "identity";
    setBusy(true);
    setStatus({ type: "", text: "" });

    try {
      const imageData = await readFileAsDataUrl(file);
      if (profileIdentityRequestSeqRef.current !== requestId) {
        return;
      }
      const data = await uploadAvatarImage(imageData);
      if (!data?.success || !data.avatar_url) {
        throw new Error(data?.error || "上传头像失败。");
      }

      if (profileIdentityRequestSeqRef.current !== requestId) {
        return;
      }

      setAvatarUrl(data.avatar_url);
      setStatus({ type: "success", text: "头像已上传，记得点一次保存。" });
    } catch (error) {
      if (profileIdentityRequestSeqRef.current !== requestId) {
        return;
      }
      setStatus({
        type: "error",
        text: error instanceof Error ? error.message : "上传头像失败。",
      });
    } finally {
      if (
        profileBusyScopeRef.current === "identity" &&
        profileIdentityRequestSeqRef.current === requestId
      ) {
        profileBusyScopeRef.current = "";
        setBusy(false);
      }
    }
  }

  async function handleDeleteAvatar() {
    if (!avatarUrl.startsWith("/user_assets/avatars/")) {
      return;
    }

    const requestId = profileIdentityRequestSeqRef.current + 1;
    profileIdentityRequestSeqRef.current = requestId;
    profileBusyScopeRef.current = "identity";
    setBusy(true);
    setStatus({ type: "", text: "" });

    try {
      const data = await deleteAvatarImage(avatarUrl);
      if (!data?.success) {
        throw new Error(data?.error || "删除头像失败。");
      }

      if (profileIdentityRequestSeqRef.current !== requestId) {
        return;
      }

      const nextAvatar = data.avatar || avatarPresets[0];
      setAvatarUrl(nextAvatar);
      setProfile((current) =>
        current
          ? {
              ...current,
              avatar: data.avatar || "",
            }
          : current,
      );
      setStatus({ type: "success", text: "上传头像已经删除，记得点一次保存。" });
    } catch (error) {
      if (profileIdentityRequestSeqRef.current !== requestId) {
        return;
      }
      setStatus({
        type: "error",
        text: error instanceof Error ? error.message : "删除头像失败。",
      });
    } finally {
      if (
        profileBusyScopeRef.current === "identity" &&
        profileIdentityRequestSeqRef.current === requestId
      ) {
        profileBusyScopeRef.current = "";
        setBusy(false);
      }
    }
  }

  async function handlePasswordSubmit(event) {
    event.preventDefault();
    if (!passwordForm.currentPassword.trim() || !passwordForm.newPassword.trim()) {
      setStatus({ type: "error", text: "当前密码和新密码都要填。" });
      return;
    }

    const requestId = passwordSubmitRequestSeqRef.current + 1;
    passwordSubmitRequestSeqRef.current = requestId;
    profileBusyScopeRef.current = "password";
    setBusy(true);
    setStatus({ type: "", text: "" });

    try {
      const data = await changePassword({
        current_password: passwordForm.currentPassword,
        new_password: passwordForm.newPassword,
        ...(passwordForm.newUsername.trim()
          ? { new_username: passwordForm.newUsername.trim() }
          : {}),
      });

      if (!data?.success) {
        throw new Error(data?.error || "密码更新失败。");
      }

      if (passwordSubmitRequestSeqRef.current !== requestId) {
        return;
      }

      const nextUsername = passwordForm.newUsername.trim();
      setPasswordForm({ currentPassword: "", newPassword: "", newUsername: "" });
      setStatus({
        type: "success",
        text:
          data.message ||
          (nextUsername
            ? "账号信息已经更新，请用新用户名 " + nextUsername + " 重新登录。"
            : "密码已经更新，请重新登录。"),
      });
      if (nextUsername) {
        navigate("/auth?notice=account-updated&user=" + encodeURIComponent(nextUsername), {
          replace: true,
        });
      } else {
        navigate("/auth?notice=password-updated", { replace: true });
      }
    } catch (error) {
      if (passwordSubmitRequestSeqRef.current !== requestId) {
        return;
      }
      setStatus({
        type: "error",
        text: error instanceof Error ? error.message : "密码更新失败。",
      });
    } finally {
      if (
        profileBusyScopeRef.current === "password" &&
        passwordSubmitRequestSeqRef.current === requestId
      ) {
        profileBusyScopeRef.current = "";
        setBusy(false);
      }
    }
  }

  async function handleCreateModelConfig(event) {
    event.preventDefault();

    if (
      !modelForm.name.trim() ||
      !modelForm.api_base.trim() ||
      !modelForm.model.trim()
    ) {
      setStatus({
        type: "error",
        text: editingConfigId
          ? "模型配置的名字、接口、模型名都要填。"
          : "模型配置的名字、接口、key、模型名都要填。",
      });
      return;
    }

    if (!editingConfigId && !modelForm.api_key.trim()) {
      setStatus({ type: "error", text: "新建模型配置时要先填 key。" });
      return;
    }

    setBusy(true);
    setStatus({ type: "", text: "" });
    const requestId = modelSaveRequestSeqRef.current + 1;
    modelSaveRequestSeqRef.current = requestId;
    modelBusyScopeRef.current = "save";

    try {
      invalidateModelDiscovery();
      invalidateModelTest();
      const payload = {
        ...modelForm,
        provider_type: "openai-compatible",
        purpose: "chat",
      };

      if (editingConfigId && !payload.api_key.trim()) {
        delete payload.api_key;
      }

      if (!editingConfigId) {
        payload.is_active = true;
      }

      const data = editingConfigId
        ? await updateModelConfig(editingConfigId, payload)
        : await createModelConfig(payload);

      if (!data?.success) {
        throw new Error(data?.error || (editingConfigId ? "模型配置更新失败。" : "模型配置保存失败。"));
      }

      if (modelSaveRequestSeqRef.current !== requestId) {
        return;
      }
      await refreshModelConfigState();
      if (modelSaveRequestSeqRef.current !== requestId) {
        return;
      }
      setModelForm(createEmptyModelForm());
      setModelFormDirty({});
      setDiscoveredModels([]);
      setEditingConfigId(null);
      setEditingConfigLabel("");
      setEditingConfigOriginal(null);
      setStatus({ type: "success", text: editingConfigId ? "模型配置已经更新。" : "模型配置已经保存并启用。" });
    } catch (error) {
      if (modelSaveRequestSeqRef.current !== requestId) {
        return;
      }
      setStatus({
        type: "error",
        text: error instanceof Error ? error.message : (editingConfigId ? "模型配置更新失败。" : "模型配置保存失败。"),
      });
    } finally {
      if (
        modelBusyScopeRef.current === "save" &&
        modelSaveRequestSeqRef.current === requestId
      ) {
        modelBusyScopeRef.current = "";
        setBusy(false);
      }
    }
  }

  function handleEditModelConfig(item) {
    invalidateModelMutation();
    invalidateModelSave();
    invalidateModelTest();
    if (!item) {
      invalidateModelDiscovery();
      setEditingConfigId(null);
      setEditingConfigLabel("");
      setEditingConfigOriginal(null);
      setDiscoveredModels([]);
      setModelForm(createEmptyModelForm());
      setModelFormDirty({});
      return;
    }

    invalidateModelDiscovery();
    setEditingConfigId(item.id);
    setEditingConfigLabel(item.name || "这条配置");
    setEditingConfigOriginal(buildModelConfigOriginal(item));
    setDiscoveredModels([]);
    setModelFormDirty({});
    setModelForm({
      name: item.name || "",
      api_base: item.api_base || "",
      api_key: "",
      model: item.model || "",
    });
    setStatus({ type: "", text: "" });
  }

  function handlePickDiscoveredModel(modelName) {
    invalidateModelMutation();
    invalidateModelSave();
    invalidateModelTest();
    setModelForm((current) => ({
      ...current,
      model: modelName,
    }));
    setModelFormDirty((current) => ({
      ...current,
      model: true,
    }));
  }

  async function handleDiscoverModels() {
    if (!modelForm.api_base.trim() || !modelForm.api_key.trim()) {
      setStatus({
        type: "error",
        text: "先填好接口地址和 key，再去发现模型。",
      });
      return;
    }

    setBusy(true);
    setActionConfigId(null);
    setActionType("discover-models");
    setStatus({ type: "", text: "" });
    const requestId = discoverModelsRequestSeqRef.current + 1;
    discoverModelsRequestSeqRef.current = requestId;
    modelBusyScopeRef.current = "discover";

    try {
      const data = await discoverModelConfigs({
        api_base: modelForm.api_base.trim(),
        api_key: modelForm.api_key.trim(),
      });
      if (!data?.success || !Array.isArray(data.items)) {
        throw new Error(data?.error || "发现模型失败。");
      }

      if (discoverModelsRequestSeqRef.current !== requestId) {
        return;
      }

      setDiscoveredModels(data.items);
      if (data.suggested_model) {
        setModelForm((current) => ({
          ...current,
          model: current.model.trim() ? current.model : data.suggested_model,
        }));
      }
      setStatus({
        type: "success",
        text: data.message || `已发现 ${data.items.length} 个可用模型。`,
      });
    } catch (error) {
      if (discoverModelsRequestSeqRef.current !== requestId) {
        return;
      }

      setStatus({
        type: "error",
        text: error instanceof Error ? error.message : "发现模型失败。",
      });
    } finally {
      if (
        modelBusyScopeRef.current === "discover" &&
        discoverModelsRequestSeqRef.current === requestId
      ) {
        modelBusyScopeRef.current = "";
        setBusy(false);
        setActionType("");
      }
    }
  }

  async function handleUseTestConfig() {
    const requestId = modelMutationRequestSeqRef.current + 1;
    modelMutationRequestSeqRef.current = requestId;
    modelBusyScopeRef.current = "mutation";
    setBusy(true);
    setStatus({ type: "", text: "" });

    try {
      const data = await useTestModelConfig();
      if (!data?.success) {
        throw new Error(data?.error || "测试配置启用失败。");
      }

      if (modelMutationRequestSeqRef.current !== requestId) {
        return;
      }
      await refreshModelConfigState();
      if (modelMutationRequestSeqRef.current !== requestId) {
        return;
      }
      setStatus({ type: "success", text: data?.status?.onboarding_message || "测试配置已启用。" });
    } catch (error) {
      if (modelMutationRequestSeqRef.current !== requestId) {
        return;
      }
      setStatus({
        type: "error",
        text: error instanceof Error ? error.message : "测试配置启用失败。",
      });
    } finally {
      if (
        modelBusyScopeRef.current === "mutation" &&
        modelMutationRequestSeqRef.current === requestId
      ) {
        modelBusyScopeRef.current = "";
        setBusy(false);
      }
    }
  }

  async function handleActivateModelConfig(item) {
    if (item?.is_active) {
      return;
    }

    const requestId = modelMutationRequestSeqRef.current + 1;
    modelMutationRequestSeqRef.current = requestId;
    modelBusyScopeRef.current = "mutation";
    setBusy(true);
    setActionConfigId(item.id);
    setActionType("activate");
    setStatus({ type: "", text: "" });

    try {
      const data = await activateModelConfig(item.id);
      if (!data?.success) {
        throw new Error(data?.error || "切换模型配置失败。");
      }

      if (modelMutationRequestSeqRef.current !== requestId) {
        return;
      }
      await refreshModelConfigState();
      if (modelMutationRequestSeqRef.current !== requestId) {
        return;
      }
      setStatus({ type: "success", text: data.message || "当前模型配置已切换。" });
    } catch (error) {
      if (modelMutationRequestSeqRef.current !== requestId) {
        return;
      }
      setStatus({
        type: "error",
        text: error instanceof Error ? error.message : "切换模型配置失败。",
      });
    } finally {
      if (
        modelMutationRequestSeqRef.current === requestId &&
        modelBusyScopeRef.current === "mutation"
      ) {
        modelBusyScopeRef.current = "";
        setBusy(false);
        setActionConfigId(null);
        setActionType("");
      }
    }
  }

  async function handleTestModelConfig(item) {
    const requestId = modelTestRequestSeqRef.current + 1;
    modelTestRequestSeqRef.current = requestId;
    modelBusyScopeRef.current = "test";
    setBusy(true);
    setActionConfigId(item.id);
    setActionType("test");
    setStatus({ type: "", text: "" });

    try {
      const data = await testModelConfig({ id: item.id });
      if (!data?.success) {
        throw new Error(data?.error || "模型配置测试失败。");
      }

      if (modelTestRequestSeqRef.current !== requestId) {
        return;
      }

      setStatus({ type: "success", text: data.message || "模型配置连通性测试成功。" });
    } catch (error) {
      if (modelTestRequestSeqRef.current !== requestId) {
        return;
      }

      setStatus({
        type: "error",
        text: error instanceof Error ? error.message : "模型配置测试失败。",
      });
    } finally {
      if (
        modelTestRequestSeqRef.current === requestId &&
        modelBusyScopeRef.current === "test"
      ) {
        modelBusyScopeRef.current = "";
        setBusy(false);
        setActionConfigId(null);
        setActionType("");
      }
    }
  }

  async function handleTestDraftModelConfig() {
    if (
      !modelForm.api_base.trim() ||
      !modelForm.model.trim()
    ) {
      setStatus({
        type: "error",
        text: "测试当前输入时，接口和模型名都要先填上。",
      });
      return;
    }

    if (!editingConfigId && !modelForm.api_key.trim()) {
      setStatus({
        type: "error",
        text: "测试当前输入时，key 也要先填上。",
      });
      return;
    }

    const requestId = modelTestRequestSeqRef.current + 1;
    modelTestRequestSeqRef.current = requestId;
    modelBusyScopeRef.current = "test";
    setBusy(true);
    setActionConfigId(null);
    setActionType("draft-test");
    setStatus({ type: "", text: "" });

    try {
      const changedBaseOrModel =
        editingConfigId &&
        editingConfigOriginal &&
        (
          modelForm.api_base.trim() !== String(editingConfigOriginal.api_base || "") ||
          modelForm.model.trim() !== String(editingConfigOriginal.model || "")
        );

      if (editingConfigId && !modelForm.api_key.trim() && changedBaseOrModel) {
        throw new Error("你改了接口地址或模型名，想测这组新参数的话，需要把 key 再填一次。");
      }

      const data =
        editingConfigId && !modelForm.api_key.trim()
          ? await testModelConfig({ id: editingConfigId })
          : await testModelConfig({
              api_base: modelForm.api_base.trim(),
              api_key: modelForm.api_key.trim(),
              model: modelForm.model.trim(),
              name: modelForm.name.trim() || "当前输入",
              provider_type: "openai-compatible",
            });

      if (!data?.success) {
        throw new Error(data?.error || "当前输入的模型配置测试失败。");
      }

      if (modelTestRequestSeqRef.current !== requestId) {
        return;
      }

      setStatus({
        type: "success",
        text:
          data.message ||
          (editingConfigId && !modelForm.api_key.trim()
            ? "已保存的模型配置连通性测试成功。"
            : "当前输入的模型配置连通性测试成功。"),
      });
    } catch (error) {
      if (modelTestRequestSeqRef.current !== requestId) {
        return;
      }

      setStatus({
        type: "error",
        text: error instanceof Error ? error.message : "当前输入的模型配置测试失败。",
      });
    } finally {
      if (
        modelTestRequestSeqRef.current === requestId &&
        modelBusyScopeRef.current === "test"
      ) {
        modelBusyScopeRef.current = "";
        setBusy(false);
        setActionType("");
      }
    }
  }

  async function handleDeleteModelConfig(item) {
    const ok = window.confirm("确认删除模型配置“" + item.name + "”吗？");
    if (!ok) {
      return;
    }

    const requestId = modelMutationRequestSeqRef.current + 1;
    modelMutationRequestSeqRef.current = requestId;
    modelBusyScopeRef.current = "mutation";
    setBusy(true);
    setActionConfigId(item.id);
    setActionType("delete");
    setStatus({ type: "", text: "" });

    try {
      const data = await deleteModelConfig(item.id);
      if (!data?.success) {
        throw new Error(data?.error || "删除模型配置失败。");
      }

      if (modelMutationRequestSeqRef.current !== requestId) {
        return;
      }
      await refreshModelConfigState();
      if (modelMutationRequestSeqRef.current !== requestId) {
        return;
      }
      if (editingConfigIdRef.current === item.id) {
        handleEditModelConfig(null);
      }
      setStatus({ type: "success", text: data.message || "模型配置已删除。" });
    } catch (error) {
      if (modelMutationRequestSeqRef.current !== requestId) {
        return;
      }
      setStatus({
        type: "error",
        text: error instanceof Error ? error.message : "删除模型配置失败。",
      });
    } finally {
      if (
        modelMutationRequestSeqRef.current === requestId &&
        modelBusyScopeRef.current === "mutation"
      ) {
        modelBusyScopeRef.current = "";
        setBusy(false);
        setActionConfigId(null);
        setActionType("");
      }
    }
  }

  async function handleLogout() {
    setBusy(true);
    setStatus({ type: "", text: "" });

    try {
      const data = await logoutSession();
      if (!data?.success) {
        throw new Error(data?.error || "退出登录失败。");
      }

      navigate("/auth?notice=logout", { replace: true });
    } catch (error) {
      setStatus({
        type: "error",
        text: error instanceof Error ? error.message : "退出登录失败。",
      });
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <section className="profile-page">
        <div className="rb-card profile-feedback">
          <p>正在把“我的”页接回来...</p>
        </div>
      </section>
    );
  }

  if (needsAuth) {
    return (
      <section className="profile-page">
        <div className="rb-card profile-feedback">
          <p>要先登录，才能看到你的“我的”页。</p>
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
    <section className="profile-page">
      <div className="rb-card profile-hero">
        <div className="profile-hero-main">
          <div className="profile-avatar">
            {profile?.avatar ? <img alt="头像" src={profile.avatar} /> : <span>{String(profile?.nickname || profile?.username || "白").charAt(0)}</span>}
          </div>
          <div className="profile-hero-copy">
            <p className="chat-list-kicker">我的</p>
            <h1>{profile?.nickname || profile?.username || "江湖小白"}</h1>
            <p className="profile-hero-subtitle">
              {profile?.username ? ("@" + profile.username) : "还没有用户名"}
              {" · "}
              {profile?.role === "owner" ? "管理员" : "自托管用户"}
            </p>
            <p className="profile-hero-note">
              在这里整理账户资料、模型配置、偏好设置和你现在的陪伴状态。
            </p>
          </div>
        </div>

        <div className="profile-hero-actions">
          <Link className="secondary-link profile-action-btn" to="/characters">
            去看角色
          </Link>
          <Link className="primary-link profile-action-btn" to="/chat">
            去聊天
          </Link>
          <button
            className="secondary-link profile-action-btn profile-action-danger"
            disabled={busy}
            onClick={handleLogout}
            type="button"
          >
            {busy ? "处理中..." : "退出登录"}
          </button>
        </div>
      </div>

      {status.text ? (
        <div
          className={status.type === "error" ? "rb-card profile-feedback error" : "rb-card profile-feedback success"}
          role={status.type === "error" ? "alert" : "status"}
        >
          <p>{status.text}</p>
        </div>
      ) : null}

      <div className="profile-stat-grid">
        <ProfileStatCard label="陪伴角色" value={usage?.roles_total ?? profile?.character_count ?? 0} />
        <ProfileStatCard label="最长陪伴天数" value={profile?.longest_companionship_days ?? 0} />
        <ProfileStatCard label="记忆条数" value={usage?.memories_total ?? profile?.memory_count ?? 0} />
        <ProfileStatCard
          label={"今日聊天量 / " + (usage?.daily_limit ?? 200)}
          value={usage?.daily_chat_used ?? 0}
        />
      </div>

      <div className="profile-grid">
        <div className="rb-card profile-section-card">
          <h2>基础资料</h2>
          <form className="profile-form" onSubmit={handleNicknameSubmit}>
            <div className="form-group">
              <label className="form-label" htmlFor="profile-username">
                用户名
              </label>
              <input
                className="form-input"
                disabled
                id="profile-username"
                type="text"
                value={profile?.username || ""}
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="profile-nickname">
                昵称
              </label>
              <input
                className="form-input"
                id="profile-nickname"
                onChange={handleNicknameChange}
                type="text"
                value={nickname}
              />
            </div>

            <div className="form-group">
              <label className="form-label">头像</label>
              <div className="profile-avatar-picker">
                <div className="profile-avatar-picker-current">
                  {avatarUrl ? <img alt="当前头像" src={avatarUrl} /> : <span>白</span>}
                </div>
                <div className="profile-avatar-picker-actions">
                  <label className="secondary-link profile-avatar-upload">
                    上传自己的头像
                    <input
                      accept="image/png,image/jpeg,image/webp"
                      hidden
                      onChange={handleAvatarUpload}
                      type="file"
                    />
                  </label>
                  {avatarUrl.startsWith("/user_assets/avatars/") ? (
                    <button
                      className="secondary-link profile-avatar-upload danger"
                      onClick={handleDeleteAvatar}
                      type="button"
                    >
                      删除上传头像
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="profile-avatar-grid">
                {avatarPresets.map((preset) => (
                  <button
                    className={avatarUrl === preset ? "profile-avatar-tile active" : "profile-avatar-tile"}
                    key={preset}
                    onClick={() => handleAvatarPresetSelect(preset)}
                    type="button"
                  >
                    <img alt="头像预设" src={preset} />
                  </button>
                ))}
              </div>
            </div>

            <button className="btn-submit" disabled={busy} type="submit">
              {busy ? "保存中..." : "保存资料"}
            </button>
          </form>
        </div>

        <div className="rb-card profile-section-card">
          <h2>账户安全</h2>
          <form className="profile-form" onSubmit={handlePasswordSubmit}>
            <div className="form-group">
              <label className="form-label" htmlFor="profile-new-username">
                新用户名
              </label>
              <input
                className="form-input"
                id="profile-new-username"
                onChange={(event) => handlePasswordFormChange("newUsername", event.target.value)}
                placeholder="可选，不改就留空"
                type="text"
                value={passwordForm.newUsername}
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="profile-current-password">
                当前密码
              </label>
              <input
                autoComplete="current-password"
                className="form-input"
                id="profile-current-password"
                onChange={(event) => handlePasswordFormChange("currentPassword", event.target.value)}
                type="password"
                value={passwordForm.currentPassword}
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="profile-new-password">
                新密码
              </label>
              <input
                autoComplete="new-password"
                className="form-input"
                id="profile-new-password"
                onChange={(event) => handlePasswordFormChange("newPassword", event.target.value)}
                type="password"
                value={passwordForm.newPassword}
              />
            </div>

            <button className="btn-submit" disabled={busy} type="submit">
              {busy ? "保存中..." : "修改密码"}
            </button>
          </form>
        </div>

        <div className="rb-card profile-section-card">
          <h2>当前状态</h2>
          <ul className="profile-meta-list">
            <li>{"注册时间：" + formatDate(usage?.registered_at || profile?.created_at)}</li>
            <li>{"上次登录：" + formatDate(profile?.last_login)}</li>
            <li>{"今日聊天已用：" + (usage?.daily_chat_used ?? 0) + " / " + (usage?.daily_limit ?? 200)}</li>
            <li>{"今日聊天重置：" + formatDateTime(usage?.daily_chat_reset_at)}</li>
            <li>{"主题：" + themeLabel}</li>
            <li>{"TTS：" + (ttsEnabled ? "已开启" : "未开启")}</li>
            <li>{"自动动态：" + (autoMomentsEnabled ? "已开启" : "未开启")}</li>
            <li>{"当前模型：" + (usage?.current_model_name || "还没在这里显示出来")}</li>
          </ul>
        </div>

        <div className="rb-card profile-section-card">
          <h2>当前关系状态</h2>
          {relationship ? (
            <>
              <ul className="profile-meta-list">
                <li>{"当前角色：" + (relationship.name || "未命名角色")}</li>
                <li>{"关系标签：" + (relationship.tag || "未设置")}</li>
                <li>{"心情值：" + (relationship.mood ?? "未知")}</li>
                <li>{"亲密度：" + (relationship.intimacy ?? "未知")}</li>
                <li>{relationship.is_active ? "这就是当前正在陪你的她" : "她现在不是当前活跃角色"}</li>
              </ul>
              <div className="profile-action-list">
                <Link
                  className="secondary-link profile-action-link"
                  to={"/chat/" + encodeURIComponent(relationship.character_id)}
                >
                  回到和她聊天
                </Link>
                <Link
                  className="secondary-link profile-action-link"
                  to={"/memory?roleId=" + encodeURIComponent(relationship.character_id)}
                >
                  去她的记忆页
                </Link>
                <Link
                  className="secondary-link profile-action-link"
                  to={"/moments?roleId=" + encodeURIComponent(relationship.character_id)}
                >
                  去她的动态页
                </Link>
              </div>
            </>
          ) : (
            <div className="profile-action-list">
              <p className="profile-action-tip">
                还没读到当前活跃角色，先去角色页确认有一位正在陪你的她。
              </p>
              <Link className="secondary-link profile-action-link" to="/characters">
                去角色页看看
              </Link>
            </div>
          )}
        </div>

        <div className="rb-card profile-section-card">
          <h2>偏好设置</h2>
          <form className="profile-form" onSubmit={handleSaveSettings}>
            <div className="form-group">
              <label className="form-label" htmlFor="profile-theme">
                主题
              </label>
              <select
                className="form-input"
                id="profile-theme"
                name="theme"
                onChange={handleSettingsFormChange}
                value={settingsForm.theme}
              >
                <option value="guangwei">微光</option>
                <option value="classic">原版</option>
              </select>
            </div>

            <label className="profile-switch-row">
              <input
                checked={settingsForm.ttsEnabled}
                name="ttsEnabled"
                onChange={handleSettingsFormChange}
                type="checkbox"
              />
              <span>开启语音朗读</span>
            </label>

            <label className="profile-switch-row">
              <input
                checked={settingsForm.autoMomentsEnabled}
                name="autoMomentsEnabled"
                onChange={handleSettingsFormChange}
                type="checkbox"
              />
              <span>允许她自动发动态</span>
            </label>

            <div className="profile-settings-grid">
              <div className="form-group">
                <label className="form-label" htmlFor="profile-auto-frequency">
                  动态间隔（小时）
                </label>
                <input
                  className="form-input"
                  disabled={!settingsForm.autoMomentsEnabled}
                  id="profile-auto-frequency"
                  max="168"
                  min="1"
                  name="autoMomentsFrequencyHours"
                  onChange={handleSettingsFormChange}
                  type="number"
                  value={settingsForm.autoMomentsFrequencyHours}
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="profile-quiet-start">
                  勿扰开始
                </label>
                <input
                  className="form-input"
                  disabled={
                    !settingsForm.autoMomentsEnabled || !settingsForm.autoMomentsQuietEnabled
                  }
                  id="profile-quiet-start"
                  name="autoMomentsQuietStart"
                  onChange={handleSettingsFormChange}
                  type="time"
                  value={settingsForm.autoMomentsQuietStart}
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="profile-quiet-end">
                  勿扰结束
                </label>
                <input
                  className="form-input"
                  disabled={
                    !settingsForm.autoMomentsEnabled || !settingsForm.autoMomentsQuietEnabled
                  }
                  id="profile-quiet-end"
                  name="autoMomentsQuietEnd"
                  onChange={handleSettingsFormChange}
                  type="time"
                  value={settingsForm.autoMomentsQuietEnd}
                />
              </div>
            </div>

            <label className="profile-switch-row">
              <input
                checked={settingsForm.autoMomentsQuietEnabled}
                disabled={!settingsForm.autoMomentsEnabled}
                name="autoMomentsQuietEnabled"
                onChange={handleSettingsFormChange}
                type="checkbox"
              />
              <span>开启自动动态勿扰时段</span>
            </label>

            <p className="profile-settings-hint">
              {settingsForm.autoMomentsEnabled
                ? settingsForm.autoMomentsQuietEnabled
                  ? "现在会按你设的频率发动态，并在勿扰时段内安静下来。"
                  : "现在会按你设的频率发动态，不限制夜间时段。"
                : "自动动态现在是关着的，所以频率和勿扰时段设置暂时不会生效。"}
            </p>

            <button className="btn-submit" disabled={busy} type="submit">
              {busy ? "保存中..." : "保存偏好设置"}
            </button>
          </form>
        </div>

        <ModelConfigCard
          actionConfigId={actionConfigId}
          actionType={actionType}
          busy={busy}
          configs={modelConfigs}
          discoveredModels={discoveredModels}
          editingConfigId={editingConfigId}
          editingConfigLabel={editingConfigLabel}
          modelForm={modelForm}
          modelStatus={modelStatus}
          onActivate={handleActivateModelConfig}
          onChange={handleModelFormChange}
          onCreate={handleCreateModelConfig}
          onDelete={handleDeleteModelConfig}
          onDiscoverModels={handleDiscoverModels}
          onEdit={handleEditModelConfig}
          onPickDiscoveredModel={handlePickDiscoveredModel}
          onTestDraft={handleTestDraftModelConfig}
          onTest={handleTestModelConfig}
          onUseTest={handleUseTestConfig}
        />

        <div className="rb-card profile-section-card">
          <h2>下一步入口</h2>
          <div className="profile-action-list">
            <Link className="secondary-link profile-action-link" to="/characters?onboard=first-role">
              创建或整理角色
            </Link>
            <Link className="secondary-link profile-action-link" to="/chat">
              回到聊天列表
            </Link>
            <span className="profile-action-tip">
              改完这里的设置后，就可以回去继续和她聊天，或者再去整理角色与记忆。
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
