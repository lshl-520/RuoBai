import React from "react";
import { Icon } from "../store.jsx";
import { getRoles, getRolePortraitSrc, createRole, updateRole, switchRole, buildRolePayload, restoreRole, getIdentityPack, testAutoMoment, uploadRolePortrait, uploadRoleLive2D, removeRoleLive2D } from "../lib/roles.js";
import { getProactiveEvents } from "../lib/proactive.js";
import { Live2DStage } from "../components/Live2DStage.jsx";
import { getRoleVisualFrame, getVisualFrameView, VISUAL_FRAME_OPTIONS } from "../lib/visual-frames.js";
import { getMomentResponseStatus } from "../lib/moment-response-status.js";
/* 角色 — 列表(Hero + 网格) + 详情 + 创建/编辑 */
const { useState: useStateA, useEffect: useEffectA, useRef: useRefA } = React;
const MOMENT_FREQ_PRESETS = [2, 4, 6];
const IMAGE_RESOLUTION_OPTIONS = [
  { value: "channel", label: "跟随渠道" },
  { value: "1k", label: "1K" },
  { value: "2k", label: "2K" },
  { value: "4k", label: "4K" },
];

function normalizeMomentFrequency(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 1 && number <= 12 ? Math.round(number) : 4;
}

/* 后端角色 → 2.0 agent 格式 */
function getFullPortrait(role) {
  const visualMode = String(role?.visual_mode ?? role?.visualMode ?? "").trim().toLowerCase();
  const visualPreview = String(role?.visual_preview_url ?? role?.visualPreviewUrl ?? "").trim();
  if (visualMode === "live2d" && visualPreview) return visualPreview;

  const portraitId = Number(role?.portrait_id ?? role?.portraitId);
  const customUrl = String(role?.portrait_custom_url ?? role?.portraitCustomUrl ?? "").trim();
  if (portraitId === 999 && customUrl) return customUrl;
  if (Number.isInteger(portraitId) && portraitId >= 0 && portraitId <= 17) return `/assets/portraits/full/${portraitId}.png`;
  return `/assets/portraits/full/0.png`;
}

function toAgent(role) {
  const visualMode = String(role.visual_mode || role.visualMode || "builtin");
  return {
    id: role.id,
    name: role.name || "未命名",
    avatar: getRolePortraitSrc(role) || "/assets/portraits/round/0.png",
    cover: getFullPortrait(role),
    tag: role.tag || "",
    tagline: role.persona ? role.persona.slice(0, 30) + "…" : "",
    persona: role.persona || "",
    tags: role.tag ? [role.tag] : [],
    online: Boolean(role.is_active),
    isDefault: Boolean(role.is_active),
    autoMoments: Boolean(role.auto_moments_enabled),
    autoMomentsImages: Boolean(role.auto_moments_images_enabled),
    momentResponseEnabled: Boolean(role.moment_response_enabled ?? role.momentResponseEnabled),
    visualMode,
    visualPreviewUrl: String(role.visual_preview_url || role.visualPreviewUrl || ""),
    live2dModelUrl: visualMode === "live2d" ? String(role.live2d_model_url || role.live2dModelUrl || "") : "",
    live2dManifest: role.live2d_manifest || role.live2dManifest || null,
    visualFrame: getRoleVisualFrame(role),
    momentFreq: normalizeMomentFrequency(role.auto_moments_daily_max),
    handle: role.tag || "角色",
    _raw: role,
  };
}

/* ---- Hero: 主陪伴(置顶) ---- */
function AgentHero({ agent, onChat, onDetail }) {
  return (
    <div className="hero">
      <div className="hero-live2d-click" onClick={() => onDetail(agent)}>
        <img className="hero-bg" src={agent.cover} alt={agent.name} />
      </div>
      <div className="hero-scrim" />
      <div className="hero-top">
        <span className="tag tag-rose" style={{ background: "rgba(255,255,255,.85)", color: "var(--rose-deep)" }}>
          <Icon name="heartFill" style={{ width: 11, height: 11 }} /> 主陪伴
        </span>
        {agent.proactiveUnread > 0 && <span className="agent-proactive-hint" title="她有一条主动消息">💡</span>}
        <button className="hero-edit" onClick={() => onDetail(agent)}><Icon name="more" /></button>
      </div>
      <div className="hero-body">
        <div className="hero-name serif">{agent.name}</div>
        {agent.tagline && <div className="hero-quote">「{agent.tagline}」</div>}
        <div className="hero-cta-row">
          <button className="pill pill-primary hero-cta" onClick={() => onChat(agent)}>
            <Icon name="chat" /> 继续和{agent.name}聊
          </button>
          <button className="hero-info-btn" onClick={() => onDetail(agent)}><Icon name="card" /></button>
        </div>
      </div>
    </div>
  );
}

/* ---- 普通角色卡 ---- */
function AgentCard({ agent, onDetail }) {
  return (
    <div className="agent-card" onClick={() => onDetail(agent)}>
      <div className="ac-photo">
        <img className="detail-live2d" src={agent.cover} alt={agent.name} />
        <div className="ac-scrim" />
        {agent.online && <span className="ac-online" />}
          <div className="ac-overlay">
            <div className="ac-name serif">{agent.name}</div>
            {agent.proactiveUnread > 0 && <span className="agent-proactive-hint" title="她有一条主动消息">💡</span>}
          </div>
      </div>
      <div className="ac-meta">
        <div className="ac-tags">
          {(agent.tags && agent.tags.length ? agent.tags : [agent.name]).slice(0, 2).map((t) => <span key={t} className="micro-tag">{t}</span>)}
        </div>
      </div>
    </div>
  );
}

function AgentsScreen({ agents: fallbackAgents, onChat, onDetail, onCreate, onRestore }) {
  const [agents, setAgents] = useStateA(null);
  const [proactiveByRole, setProactiveByRole] = useStateA({});
  const seqRef = useRefA(0);

  useEffectA(() => {
    let cancelled = false;
    async function load() {
      const id = ++seqRef.current;
      try {
        const data = await getRoles();
        if (cancelled || seqRef.current !== id) return;
        const items = Array.isArray(data) ? data : (data?.items || []);
        setAgents(items.map(toAgent));
        try {
          const proactive = await getProactiveEvents();
          const next = {};
          (proactive?.items || []).filter((item) => item.unread).forEach((item) => {
            next[item.character_id] = (next[item.character_id] || 0) + 1;
          });
          setProactiveByRole(next);
        } catch { setProactiveByRole({}); }
      } catch {
        // 后端没开就用兜底
      }
    }
    load();
    const onFocus = () => load();
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    window.addEventListener("focus", onFocus);
    window.addEventListener("ruobai:role-saved", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("ruobai:role-saved", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const list = (agents ?? fallbackAgents ?? []).map((agent) => ({
    ...agent,
    proactiveUnread: proactiveByRole[agent.id] || 0,
  }));

  if (agents === null) {
    return (
      <div className="screen anim-screen">
        <div className="topbar"><div><h1>角色</h1><div className="sub">加载中…</div></div></div>
      </div>
    );
  }

  const hero = list.find((a) => a.isDefault) || list[0];
  const rest = list.filter((a) => a.id !== (hero?.id));

  const reloadRoles = async () => {
    try {
      const data = await getRoles();
      const items = Array.isArray(data) ? data : (data?.items || []);
      setAgents(items.map(toAgent));
    } catch {}
  };

  if (list.length === 0) {
    return (
      <div className="screen anim-screen">
        <div className="empty-immersive">
          <img className="empty-immersive-img" src="/assets/empty-characters.webp" alt="" />
          <div className="empty-immersive-scrim" />
          <div className="empty-immersive-guide">
            <div className="empty-state-title">不着急</div>
            <div className="empty-state-desc">想好了再创建她，她会一直在这里等你。</div>
            <button className="empty-state-btn" onClick={onCreate}>创建第一个她</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="screen anim-screen">
      <div className="topbar">
        <div>
          <h1>角色</h1>
          <div className="sub">{agents.length} 位 · 各自记得不一样的你</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="icon-btn" style={{ background: "var(--rose)", color: "#fff", boxShadow: "var(--shadow-rose)" }} onClick={onCreate}>
            <Icon name="plus" />
          </button>
        </div>
      </div>

      <div className="pad">
        <AgentHero agent={hero} onChat={onChat} onDetail={onDetail} />
      </div>

      <div className="section-label pad"><span>其他角色</span><span className="sl-line" /></div>

      <div className="agent-grid pad">
        {rest.map((a) => <AgentCard key={a.id} agent={a} onDetail={onDetail} />)}
        <button className="agent-new" onClick={onCreate}>
          <span className="an-plus"><Icon name="plus" /></span>
          <span className="an-t serif">创建新角色</span>
          <span className="an-s">给她一个名字和性格</span>
        </button>
      </div>

      <RecoverableAgents onRestored={() => { reloadRoles(); onRestore?.(); }} />
      <div style={{ height: 32 }} />
    </div>
  );
}

/* ============ 角色详情 ============ */
function CharacterDetail({ agent, onClose, onChat, onEdit, onDelete, onSetMain, onOnboard, onMomentResponseSaved }) {
  const [confirm, setConfirm] = useStateA(false);
  const [momentResponseSheet, setMomentResponseSheet] = useStateA(false);
  const [deleting, setDeleting] = useStateA(false);
  const [deleteError, setDeleteError] = useStateA("");
  const [mainError, setMainError] = useStateA("");
  const [packError, setPackError] = useStateA("");

  const handleDelete = async (options = {}) => {
    if (!onDelete || deleting) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await onDelete(agent.id, options);
      setConfirm(false);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "删除失败");
    } finally {
      setDeleting(false);
    }
  };

  const handleSetMain = async () => {
    if (!onSetMain) return;
    setMainError("");
    try {
      await onSetMain(agent.id);
    } catch (err) {
      setMainError(err instanceof Error ? err.message : "设置主陪伴失败");
    }
  };

  const handleExportIdentityPack = async () => {
    setPackError("");
    try {
      const result = await getIdentityPack(agent.id);
      if (!result?.success || !result.item) throw new Error(result?.error || "身份包暂时没有生成成功");
      const blob = new Blob([JSON.stringify(result.item, null, 2)], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${agent.name || "角色"}-identity-pack-v${result.item.version || "1.0.0"}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setPackError(error instanceof Error ? error.message : "身份包暂时没有导出成功");
    }
  };

  return (
    <div className="detail-screen anim-screen">
      <div className="detail-photo">
        <img className="detail-live2d" src={agent.cover} alt={agent.name} />
        <div className="detail-scrim" />
        <button className="detail-back" onClick={onClose}><Icon name="back" /></button>
        {agent.isDefault && <span className="detail-badge"><Icon name="heartFill" style={{ width: 11, height: 11 }} /> 主陪伴</span>}
        <div className="detail-photo-text">
          <div className="detail-name serif">{agent.name}</div>
          <div className="detail-handle">{agent.handle}</div>
        </div>
      </div>

      <div className="detail-body">
        <div className="detail-quote serif">「{agent.tagline}」</div>

        <div className="detail-section-t">人设</div>
        <div className="detail-persona">{agent.persona}</div>

        <div className="detail-section-t">性格</div>
        <div className="detail-tags">
          {agent.tags.map((t) => <span key={t} className="micro-tag">{t}</span>)}
        </div>

        <button className="onboard-card" style={{ marginTop: 18 }} onClick={() => onOnboard && onOnboard(agent)}>
          <span className="ob-glow" />
          <span className="ob-av"><img src={agent.avatar} alt="" /></span>
          <span className="ob-main">
            <span className="ob-t serif">让{agent.name}更懂你</span>
            <span className="ob-s">回答几个她想问的,她会把你记得更深</span>
          </span>
          <Icon name="chevron" className="row-chev" />
        </button>

        <div className="detail-row">
          <span className="dr-l">主陪伴</span>
          {agent.isDefault
            ? <span className="dr-r" style={{ color: "var(--rose-deep)", display: "inline-flex", alignItems: "center", gap: 4 }}><Icon name="heartFill" style={{ width: 12, height: 12 }} /> 当前主陪伴</span>
            : <button className="set-main-btn" onClick={handleSetMain}>设为主陪伴</button>}
        </div>
        {mainError && <div className="chat-error" style={{ marginTop: -2 }}>{mainError}</div>}
        {packError && <div className="chat-error" style={{ marginTop: -2 }}>{packError}</div>}

        <div className="detail-row">
          <span className="dr-l">主动发动态</span>
          <span className="dr-r">{agent.autoMoments ? "已开启" : "已关闭"}</span>
        </div>
        <div className="detail-row">
          <span className="dr-l">自动动态配图</span>
          <span className="dr-r">{agent.autoMomentsImages ? "已开启" : "已关闭"}</span>
        </div>
        <button className="onboard-card response-settings-entry" type="button" onClick={() => setMomentResponseSheet(true)}>
          <span className="ob-main">
            <span className="ob-t serif">{agent.name}的动态回应</span>
            <span className="ob-s">只回应你明确分享给她的动态</span>
          </span>
          <span className={"response-entry-status" + (agent.momentResponseEnabled ? " on" : "")}>{agent.momentResponseEnabled ? "已开启" : "默认关闭"}</span>
          <Icon name="chevron" className="row-chev" />
        </button>
      </div>

      <div className="detail-foot">
        <button className="icon-btn" onClick={handleExportIdentityPack} title="导出身份包" aria-label="导出身份包"><Icon name="book" /></button>
        <button className="icon-btn det-edit" onClick={() => onEdit(agent)}><Icon name="edit" /></button>
        <button className="icon-btn det-del" onClick={() => setConfirm(true)}><Icon name="trash" /></button>
        <button className="pill pill-primary grow" onClick={() => onChat(agent)}><Icon name="chat" /> 开始聊天</button>
      </div>

      {confirm && (
        <div className="confirm-mask" onClick={() => setConfirm(false)}>
          <div className="confirm-box" onClick={(e) => e.stopPropagation()}>
            <div className="cf-t serif">要和{agent.name}告别吗?</div>
            <div className="cf-s">“狠心删除”还能恢复。“立即删除”会把这个角色和相关内容直接清掉，适合删测试角色。</div>
            {deleteError && <div className="chat-error" style={{ marginBottom: 10 }}>{deleteError}</div>}
            <div className="cf-actions">
              <button className="pill pill-ghost grow" disabled={deleting} onClick={() => setConfirm(false)}>再想想</button>
              <button className="pill grow" disabled={deleting} onClick={() => handleDelete()}>
                {deleting ? "删除中…" : "狠心删除"}
              </button>
              <button
                className="pill grow cf-del"
                disabled={deleting}
                onClick={() => handleDelete({ immediate: true })}
                title="适合直接清理测试角色"
              >
                {deleting ? "删除中…" : "立即删除"}
              </button>
            </div>
          </div>
        </div>
      )}
      {momentResponseSheet && <MomentResponseSettingsSheet
        agent={agent}
        onClose={() => setMomentResponseSheet(false)}
        onSaved={(enabled) => {
          onMomentResponseSaved?.(agent.id, enabled);
          setMomentResponseSheet(false);
        }}
      />}
    </div>
  );
}

function MomentResponseSettingsSheet({ agent, onClose, onSaved }) {
  const [enabled, setEnabled] = useStateA(Boolean(agent?.momentResponseEnabled ?? agent?._raw?.moment_response_enabled));
  const [events, setEvents] = useStateA([]);
  const [loadError, setLoadError] = useStateA("");
  const [busy, setBusy] = useStateA(false);
  const [error, setError] = useStateA("");
  const framing = getVisualFrameView(agent?.visualFrame, "fullscreen");
  const status = getMomentResponseStatus({ enabled, events });

  useEffectA(() => {
    let cancelled = false;
    async function loadStatus() {
      try {
        const result = await getProactiveEvents({ characterId: agent.id, limit: 20 });
        const items = Array.isArray(result) ? result : (result?.items || []);
        if (!cancelled) setEvents(items);
      } catch (requestError) {
        if (!cancelled) setLoadError(requestError instanceof Error ? requestError.message : "状态记录暂时未加载");
      }
    }
    loadStatus();
    return () => { cancelled = true; };
  }, [agent.id]);

  const handleSave = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await updateRole(agent.id, { moment_response_enabled: enabled });
      const savedEnabled = Boolean(result?.item?.moment_response_enabled ?? enabled);
      onSaved?.(savedEnabled);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "动态回应设置没有保存成功");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="moment-response-screen" role="dialog" aria-modal="true" aria-label={`${agent.name}的动态回应设置`}>
      <div className="mrs-stage" aria-hidden="true">
        <Live2DStage
          className="mrs-live2d-stage"
          modelUrl={agent.live2dModelUrl}
          manifest={agent.live2dManifest}
          framing={framing}
          staticSrc={agent.visualPreviewUrl || agent.cover}
          fallbackSrc={agent.cover}
          alt={agent.name}
        />
        <div className="mrs-stage-scrim" />
      </div>

      <header className="mrs-topbar">
        <button type="button" className="mrs-back" onClick={onClose} aria-label="返回角色详情"><Icon name="back" /></button>
        <div><h1>动态生活</h1><p>{agent.name} · 角色设置</p></div>
      </header>

      <div className={`mrs-status-card ${status.tone}`} aria-live="polite">
        <strong>{status.label}</strong>
        <span>{status.description}</span>
      </div>

      <section className="mrs-sheet">
        <div className="mrs-grip" />
        <div className="mrs-sheet-body">
          <div className="mrs-section-heading">
            <h2>回应分享的动态</h2>
            <p>只处理你明确分享给她的生活记录</p>
          </div>
          <div className="mrs-setting-card">
            <div><strong>允许回应我分享的动态</strong><span>仅限分享给{agent.name}的动态</span></div>
            <button
              type="button"
              className={"toggle" + (enabled ? " on" : "")}
              aria-label="允许回应我分享的动态"
              aria-pressed={enabled}
              onClick={() => setEnabled((value) => !value)}
            ><i /></button>
          </div>

          <div className="mrs-rules">
            <h2>回应方式</h2>
            <ul>
              <li>仅你明确分享给她的动态会被看到</li>
              <li>每位角色至少间隔 4 小时再回应</li>
              <li>她可以选择不评论，不制造热闹</li>
            </ul>
          </div>
        </div>
        <footer className="mrs-footer">
          {loadError && <p className="mrs-load-note">状态记录暂时未加载，不影响开关保存</p>}
          {error && <p className="mrs-error" role="alert">{error}</p>}
          <button type="button" className="pill pill-primary grow" disabled={busy} onClick={handleSave}>{busy ? "保存中…" : "保存修改"}</button>
        </footer>
      </section>
    </section>
  );
}

/* ============ 创建 / 编辑 ============ */
const PORTRAIT_OPTIONS = Array.from({ length: 18 }, (_, i) => `/assets/portraits/square/${i}.png`);
const DYNAMIC_PROFILE_CHOICES = {
  temperament: ["温柔", "安静", "治愈", "不故意卖萌", "有陪伴感", "自然亲近"],
  face: ["小巧鹅蛋脸", "五官柔和", "不网红脸"],
  eyes: ["蓝灰偏浅", "眼神温柔", "不夸张大眼"],
  hair: ["白银色", "柔顺自然", "中长发"],
};
const DYNAMIC_TEMPLATE_CHOICES = {
  categories: ["自拍", "日常片段", "心情记录", "和你有关"],
  selfie_scenes: ["镜子自拍", "床上自拍", "抱猫自拍", "沙发自拍", "洗漱自拍", "阳台自拍", "做饭自拍", "看电影自拍"],
  poses: ["侧看", "回眸", "抱枕", "托腮", "双手托脸", "靠窗"],
  moods: ["开心", "困困", "害羞", "想你", "放松", "生病", "撒娇"],
};

function cleanChoices(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function DynamicSettingsSheet({ roleName, initialProfile, initialTemplates, onClose, onSave }) {
  const [profile, setProfile] = useStateA(() => ({
    name: initialProfile?.name || roleName || "",
    age_feel: initialProfile?.age_feel || "",
    ...Object.fromEntries(Object.keys(DYNAMIC_PROFILE_CHOICES).map((key) => [key, cleanChoices(initialProfile?.[key])])),
    other: cleanChoices(initialProfile?.other),
  }));
  const [templates, setTemplates] = useStateA(() => ({
    ...Object.fromEntries(Object.keys(DYNAMIC_TEMPLATE_CHOICES).map((key) => [key, cleanChoices(initialTemplates?.[key])])),
    custom: cleanChoices(initialTemplates?.custom),
  }));
  const [profileOther, setProfileOther] = useStateA(cleanChoices(initialProfile?.other).join("，"));
  const [templateOther, setTemplateOther] = useStateA(cleanChoices(initialTemplates?.custom).join("，"));
  const [error, setError] = useStateA("");
  const toggle = (setter, key, choice) => setter((current) => ({
    ...current,
    [key]: current[key].includes(choice) ? current[key].filter((item) => item !== choice) : [...current[key], choice],
  }));

  const choiceBlock = (title, note, source, setter, key) => {
    const selected = setter === setProfile ? profile[key] : templates[key];
    return (
      <div style={{ marginTop: 18 }}>
        <div className="field-label" style={{ margin: 0 }}>{title}<span className="lbl-hint">{note}</span></div>
        <div className="type-grid" style={{ marginTop: 8 }}>
          {source.map((choice) => <button key={choice} type="button" className={"type-chip" + (selected.includes(choice) ? " on" : "")} onClick={() => toggle(setter, key, choice)}>{choice}</button>)}
        </div>
      </div>
    );
  };

  return (
    <div className="sheet-mask" onClick={onClose}>
      <div className="sheet" onClick={(event) => event.stopPropagation()} style={{ maxHeight: "90%" }}>
        <div className="sheet-grip" />
        <div className="sheet-head">
          <h2 className="serif">{roleName}的动态生活</h2>
          <button className="icon-btn" onClick={onClose} aria-label="关闭" style={{ width: 34, height: 34 }}><span style={{ fontSize: 24, lineHeight: 1 }}>×</span></button>
        </div>
        <div className="sheet-body">
          <div className="onboard-card" style={{ marginTop: 4 }}>
            <span className="ob-main"><span className="ob-t serif">她会有自己的生活感</span><span className="ob-s">聊天只提供合适灵感。系统会避开重复和不适合分享的话，再决定文字、自拍或第三人称画面。</span></span>
          </div>
          <div className="detail-section-t" style={{ marginTop: 20 }}>固定形象</div>
          <label className="field-label">姓名 <span className="lbl-hint">必填</span></label>
          <input className="fld" value={profile.name} onChange={(event) => setProfile((value) => ({ ...value, name: event.target.value }))} />
          <label className="field-label">年龄感 <span className="lbl-hint">必填</span></label>
          <input className="fld" value={profile.age_feel} onChange={(event) => setProfile((value) => ({ ...value, age_feel: event.target.value }))} placeholder="例如：20岁左右" />
          {Object.entries(DYNAMIC_PROFILE_CHOICES).map(([key, options]) => <React.Fragment key={key}>{choiceBlock({ temperament: "气质", face: "脸型", eyes: "眼睛", hair: "头发" }[key], "可多选", options, setProfile, key)}</React.Fragment>)}
          <label className="field-label" style={{ marginTop: 18 }}>形象其他补充 <span className="lbl-hint">中文逗号分隔</span></label>
          <input className="fld" value={profileOther} onChange={(event) => setProfileOther(event.target.value)} placeholder="例如：皮肤自然白，安静微笑" />
          <div className="detail-section-t" style={{ marginTop: 24 }}>生活模板</div>
          {Object.entries(DYNAMIC_TEMPLATE_CHOICES).map(([key, options]) => <React.Fragment key={key}>{choiceBlock({ categories: "动态大类别", selfie_scenes: "自拍", poses: "姿势和镜头感", moods: "心情" }[key], "可多选", options, setTemplates, key)}</React.Fragment>)}
          <label className="field-label" style={{ marginTop: 18 }}>还有别的想要？ <span className="lbl-hint">中文逗号分隔</span></label>
          <input className="fld" value={templateOther} onChange={(event) => setTemplateOther(event.target.value)} placeholder="例如：雨天撑伞，逛书店" />
        </div>
        <div className="sheet-foot">
          {error && <div className="chat-error" style={{ marginBottom: 10 }}>{error}</div>}
          <button className="pill pill-primary grow" onClick={() => {
            if (!profile.name.trim() || !profile.age_feel.trim()) { setError("固定形象需要姓名和年龄感"); return; }
            onSave({
              profile: { ...profile, name: profile.name.trim(), age_feel: profile.age_feel.trim(), other: profileOther.split(/[,，]/).map((item) => item.trim()).filter(Boolean) },
              templates: { ...templates, custom: templateOther.split(/[,，]/).map((item) => item.trim()).filter(Boolean) },
            });
          }}>保存动态生活</button>
        </div>
      </div>
    </div>
  );
}

function AgentEditor({ agent, onClose, onSave }) {
  const editing = !!agent;
  const [name, setName] = useStateA(agent?.name || "");
  const [persona, setPersona] = useStateA(agent?.persona || "");
  const [tagline, setTagline] = useStateA(agent?.tagline || "");
  const [portrait, setPortrait] = useStateA(agent?.avatar || PORTRAIT_OPTIONS[0]);
  const [uploads, setUploads] = useStateA([]); // 用户上传的自定义头像(dataURL)
  const [visualMode, setVisualMode] = useStateA(agent?._raw?.visual_mode || (agent?.live2dModelUrl ? "live2d" : (agent?._raw?.portrait_custom_url ? "image" : "builtin")));
  const [live2dAsset, setLive2dAsset] = useStateA(agent?._raw?.live2d_manifest || null);
  const [visualFrame, setVisualFrame] = useStateA(() => getRoleVisualFrame(agent?._raw || agent));
  const [portraitUploading, setPortraitUploading] = useStateA(false);
  const [live2dUploading, setLive2dUploading] = useStateA(false);
  const [tagsStr, setTagsStr] = useStateA((agent?.tags || []).join(" "));
  const [auto, setAuto] = useStateA(agent?.autoMoments ?? false);
  const [autoImages, setAutoImages] = useStateA(agent?.autoMomentsImages ?? false);
  const [imageProfile, setImageProfile] = useStateA(agent?._raw?.auto_moments_image_profile || null);
  const [momentTemplates, setMomentTemplates] = useStateA(agent?._raw?.auto_moments_templates || null);
  const [dynamicSheet, setDynamicSheet] = useStateA(false);
  const initialFreq = normalizeMomentFrequency(agent?.momentFreq ?? 4);
  const [freq, setFreq] = useStateA(initialFreq);
  const [customFreq, setCustomFreq] = useStateA(MOMENT_FREQ_PRESETS.includes(initialFreq) ? "" : String(initialFreq));
  const [imageResolution, setImageResolution] = useStateA(agent?._raw?.auto_moments_image_resolution || "channel");
  const isCustomFreq = !MOMENT_FREQ_PRESETS.includes(freq);
  const momentIntervalHours = Math.max(1, Math.round(24 / freq));
  const [compact, setCompact] = useStateA((agent?._raw?.speech_style || "") === "compact");
  const [busy, setBusy] = useStateA(false);
  const [error, setError] = useStateA("");
  const [momentTest, setMomentTest] = useStateA(null);

  const onUpload = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    e.target.value = "";
    if (!editing || !agent?._raw?.id) {
      setError("先保存角色，再上传自定义形象");
      return;
    }
    setPortraitUploading(true);
    setError("");
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const result = await uploadRolePortrait(agent._raw.id, reader.result);
        const url = result?.portrait_url;
        if (!url) throw new Error("图片上传后没有返回地址");
        await updateRole(agent._raw.id, {
          avatar: url,
          portrait_id: 999,
          portrait_custom_url: url,
          visual_mode: "image",
        });
        setUploads((p) => [url, ...p]);
        setPortrait(url);
        setVisualMode("image");
      } catch (err) {
        setError(err instanceof Error ? err.message : "图片上传失败");
      } finally {
        setPortraitUploading(false);
      }
    };
    reader.onerror = () => {
      setPortraitUploading(false);
      setError("读取图片失败");
    };
    reader.readAsDataURL(file);
  };

  const onLive2DUpload = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (!editing || !agent?._raw?.id) {
      setError("先保存角色，再上传 Live2D 模型包");
      return;
    }
    if (file.size > 80 * 1024 * 1024) {
      setError("Live2D ZIP 不能超过 80 MiB，请换用较小的模型包");
      return;
    }
    setLive2dUploading(true);
    setError("");
    try {
      const result = await uploadRoleLive2D(agent._raw.id, file);
      const asset = result?.asset;
      if (!asset?.model_url) throw new Error("模型包上传后没有返回模型入口");
      setLive2dAsset(asset.manifest || null);
      setVisualMode("live2d");
      if (asset.preview_url) {
        setPortrait(asset.preview_url);
        setUploads((p) => [asset.preview_url, ...p.filter((url) => url !== asset.preview_url)]);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Live2D 模型包上传失败";
      setError(/status 413/i.test(message)
        ? "上传被服务器体积限制拒绝（413），不是模型格式问题；等待服务器上传限制更新后再试"
        : message);
    } finally {
      setLive2dUploading(false);
    }
  };

  const onRemoveLive2D = async () => {
    if (!editing || !agent?._raw?.id || !live2dAsset) return;
    setLive2dUploading(true);
    setError("");
    try {
      await removeRoleLive2D(agent._raw.id);
      setLive2dAsset(null);
      setVisualMode("builtin");
      setPortrait(agent?.avatar || PORTRAIT_OPTIONS[0]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "移除 Live2D 失败");
    } finally {
      setLive2dUploading(false);
    }
  };

  const selectBuiltinPortrait = (value) => {
    setPortrait(value);
    setVisualMode("builtin");
  };

  const selectCustomPortrait = (value) => {
    setPortrait(value);
    setVisualMode("image");
  };

  return (
    <div className="sheet-mask" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="sheet-head">
          <h2 className="serif">{editing ? `编辑 · ${agent.name}` : "创建新角色"}</h2>
          <button className="icon-btn" onClick={onClose} style={{ width: 34, height: 34 }}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>

        <div className="sheet-body">
          <label className="field-label">形象 / 立绘</label>
          <div className="portrait-row">
            <div className="portrait-left">
              <div className="portrait-preview"><img src={portrait} alt="" /></div>
              <label className="pp pp-upload" style={{ marginTop: 8, width: "100%", opacity: editing ? 1 : 0.55 }}>
                <input type="file" accept="image/*" onChange={onUpload} disabled={portraitUploading || !editing} hidden />
                <Icon name="image" /><span>{portraitUploading ? "上传中…" : "上传自定义"}</span>
              </label>
              {uploads.map((u) => (
                <button key={u} className={"pp" + (u === portrait ? " on" : "")} onClick={() => selectCustomPortrait(u)} style={{ marginTop: 4 }}>
                  <img src={u} alt="" />
                </button>
              ))}
            </div>
            <div className="portrait-pick">
              {PORTRAIT_OPTIONS.map((p) => (
                <button key={p} className={"pp" + (p === portrait ? " on" : "")} onClick={() => selectBuiltinPortrait(p)}>
                  <img src={p} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <div className="field-label" style={{ marginBottom: 8 }}>形象模式</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {[
                ["builtin", "内置立绘"],
                ["image", "自定义图片"],
                ["live2d", "Live2D 模型"],
              ].map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  className={"freq-chip" + (visualMode === mode ? " on" : "")}
                  onClick={() => {
                    if (mode === "live2d" && !live2dAsset && !agent?.live2dModelUrl) {
                      setError("这个角色还没有 Live2D，请先点击下方“上传 ZIP”选择模型包");
                      return;
                    }
                    setError("");
                    setVisualMode(mode);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="route-note">每个角色单独保存自己的形象。模型包只保存在当前部署的服务器，不会跟着项目代码上传。</div>
          </div>

          <div className="onboard-card" style={{ marginTop: 12, alignItems: "flex-start" }}>
            <span className="ob-main">
              <span className="ob-t serif">给这个角色上传 Live2D</span>
              <span className="ob-s">上传包含 .model3.json 和 .moc3 的 ZIP。安全校验通过后会保存预览，并自动切到这个角色的 Live2D 模型。</span>
              {live2dAsset && <span className="ob-s" style={{ color: "var(--rose-deep)" }}>已识别 {live2dAsset.fileCount || 0} 个文件 · {live2dAsset.expressionPaths?.length || 0} 个表情 · {live2dAsset.motionPaths?.length || 0} 个动作</span>}
            </span>
            <label className="pp pp-upload" style={{ flex: "0 0 auto", opacity: editing ? 1 : 0.55 }}>
              <input type="file" accept=".zip,application/zip" onChange={onLive2DUpload} disabled={live2dUploading || !editing} hidden />
              <Icon name="image" /><span>{live2dUploading ? "检查中…" : "上传 ZIP"}</span>
            </label>
            {live2dAsset && <button type="button" className="freq-chip" onClick={onRemoveLive2D} disabled={live2dUploading}>移除模型</button>}
          </div>

          <div className="visual-frame-settings">
            <div className="field-label">聊天室里的立绘范围</div>
            <div className="visual-frame-grid">
              <label className="visual-frame-field">
                <span>聊天时</span>
                <select className="fld" value={visualFrame.chatFrame} onChange={(event) => setVisualFrame((current) => ({ ...current, chatFrame: event.target.value }))}>
                  {VISUAL_FRAME_OPTIONS.chat.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <label className="visual-frame-field">
                <span>点开头像后</span>
                <select className="fld" value={visualFrame.fullscreenFrame} onChange={(event) => setVisualFrame((current) => ({ ...current, fullscreenFrame: event.target.value }))}>
                  {VISUAL_FRAME_OPTIONS.fullscreen.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
            </div>
            <div className="route-note">默认是聊天显示到膝盖以上，点开头像显示全身。半身模型可以在这里改成半身；每个角色单独保存。</div>
          </div>

          <label className="field-label">名字</label>
          <input className="fld" value={name} onChange={(e) => setName(e.target.value)} placeholder="她叫什么" />

          <label className="field-label">一句话签名</label>
          <input className="fld" value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="她最想对你说的一句" />

          <label className="field-label">人设 · 她是什么样的人</label>
          <textarea className="fld area" value={persona} onChange={(e) => setPersona(e.target.value)} placeholder="写她的性格、怎么陪你说话、在意什么。写得越细,她越像她。从零开始也没关系——把别处的人设复制进来就行。" />

          <label className="field-label">性格标签 <span className="lbl-hint">空格分隔</span></label>
          <input className="fld" value={tagsStr} onChange={(e) => setTagsStr(e.target.value)} placeholder="温柔 清醒 深夜在线" />
          <div className="chip-preview">
            {tagsStr.split(/\s+/).filter(Boolean).map((t, i) => <span key={i} className="micro-tag">{t}</span>)}
          </div>

          <div className="switch-row">
            <div>
              <div className="sr-t">主动发动态</div>
              <div className="sr-s">她会自己发朋友圈,像个真的在过日子的人</div>
            </div>
            <button className={"toggle" + (auto ? " on" : "")} onClick={() => setAuto(!auto)}><i /></button>
          </div>
          {auto && (
            <div className="freq-row">
              <span className="sr-s">每天最多</span>
              {MOMENT_FREQ_PRESETS.map((f) => (
                <button key={f} className={"freq-chip" + (freq === f ? " on" : "")} onClick={() => setFreq(f)}>{f} 条</button>
              ))}
              <button className={"freq-chip" + (isCustomFreq ? " on" : "")} onClick={() => { setFreq(8); setCustomFreq("8"); }}>自定义</button>
              {isCustomFreq && <input className="fld freq-custom-input" type="number" min="1" max="12" step="1" value={customFreq} aria-label="每天最多发几条动态" onChange={(e) => {
                const value = e.target.value;
                setCustomFreq(value);
                const number = Number(value);
                if (Number.isFinite(number) && number >= 1 && number <= 12) setFreq(Math.round(number));
              }} />}
            </div>
          )}
          <div className="switch-row">
            <div>
              <div className="sr-t">动态发图</div>
              <div className="sr-s">只控制她自己发动态时是否允许带图，不影响聊天里让她画图</div>
            </div>
            <button className={"toggle" + (autoImages ? " on" : "")} onClick={() => setAutoImages(!autoImages)} disabled={!auto}><i /></button>
          </div>
          {auto && autoImages && <div className="image-resolution-row">
            <label className="sr-s" htmlFor="auto-moment-resolution">图片清晰度</label>
            <select id="auto-moment-resolution" className="fld" value={imageResolution} onChange={(e) => setImageResolution(e.target.value)}>
              {IMAGE_RESOLUTION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <div className="route-note">默认跟随当前动态渠道；只有渠道支持时，1K/2K/4K 才会生效。</div>
          </div>}
          {auto && <button type="button" className="onboard-card" style={{ marginTop: 14 }} onClick={() => setDynamicSheet(true)}>
            <span className="ob-main"><span className="ob-t serif">{name || "她"}的动态生活</span><span className="ob-s">固定形象、生活模板和系统画面判断</span></span>
            <Icon name="chevron" className="row-chev" />
          </button>}
          {auto && editing && agent?._raw?.id && <>
            <button type="button" className="onboard-card" style={{ marginTop: 10 }} disabled={momentTest?.loading} onClick={async () => {
              setMomentTest({ loading: true, message: "正在试发..." });
              try {
                const result = await testAutoMoment(agent._raw.id);
                if (!result?.success) throw new Error(result?.error || "试发失败");
                setMomentTest({ loading: false, message: result.message || "试发完成" });
              } catch (err) {
                setMomentTest({ loading: false, message: err instanceof Error ? err.message : "试发失败" });
              }
            }}>
              <span className="ob-main"><span className="ob-t serif">{momentTest?.loading ? "正在测试动态发图渠道" : "现在测试动态发图"}</span><span className="ob-s">跳过聊天判断，直接生成一条测试图文动态，可能消耗一次额度</span></span>
              <Icon name="chevron" className="row-chev" />
            </button>
            {momentTest?.message && !momentTest.loading && <div className="route-note" style={{ marginTop: 8 }}>{momentTest.message}</div>}
          </>}

          <div className="switch-row">
            <div>
              <div className="sr-t">紧凑回复</div>
              <div className="sr-s">回复连成一句,不会每句都换行。适合简短日常聊天</div>
            </div>
            <button className={"toggle" + (compact ? " on" : "")} onClick={() => setCompact(!compact)}><i /></button>
          </div>
        </div>

        <div className="sheet-foot">
          {error && <div className="chat-error" style={{marginBottom:10}} onClick={() => setError("")}>{error} 点击关闭</div>}
          <button className="pill pill-primary grow" disabled={busy} onClick={async () => {
            if (!name.trim() || !persona.trim()) { setError("名字和人设不能为空"); return; }
            setBusy(true); setError("");
            try {
              // 从立绘路径提取 portrait_id，让后端知道选的是哪个预设立绘
              const presetMatch = portrait.match(/\/assets\/portraits\/(?:square|round|full)\/(\d+)\.png/);
              const isLive2D = visualMode === "live2d";
              const live2dPreviewUrl = String(live2dAsset?.previewUrl || live2dAsset?.preview_url || agent?._raw?.visual_preview_url || "").trim();
              const existingPortraitValue = agent?._raw?.portrait_id;
              const existingPortraitId = existingPortraitValue === null || existingPortraitValue === undefined || existingPortraitValue === "" ? null : Number(existingPortraitValue);
              const existingCustomUrl = String(agent?._raw?.portrait_custom_url || "").trim() || null;
              const portraitId = isLive2D
                ? (Number.isInteger(existingPortraitId) && existingPortraitId >= 0 ? existingPortraitId : null)
                : (presetMatch ? parseInt(presetMatch[1], 10) : (visualMode === "image" || portrait.startsWith("data:") ? 999 : null));
              const portraitCustomUrl = isLive2D ? (portraitId === 999 ? existingCustomUrl : null) : (portraitId === 999 ? portrait : null);
              const payload = {
                name: name.trim(),
                persona: persona.trim(),
                tag: tagsStr.split(/\s+/).filter(Boolean)[0] || "",
                avatar: isLive2D ? (String(agent?._raw?.avatar || "").trim() || portrait) : portrait,
                portrait_id: portraitId,
                portrait_custom_url: portraitCustomUrl,
                visual_mode: visualMode,
                visual_preview_url: isLive2D ? (live2dPreviewUrl || null) : null,
                visual_frame_config: visualFrame,
                auto_moments_enabled: auto,
                auto_moments_images_enabled: auto && autoImages,
                auto_moments_image_resolution: auto && autoImages ? imageResolution : "channel",
                auto_moments_image_profile: auto ? imageProfile : null,
                auto_moments_templates: auto ? momentTemplates : null,
                auto_moments_daily_min: auto ? freq : 0,
                auto_moments_daily_max: auto ? freq : 0,
                auto_moments_min_interval_hours: momentIntervalHours,
                speech_style: compact ? "compact" : "natural",
              };
              if (editing && agent._raw?.id) {
                await updateRole(agent._raw.id, payload);
              } else {
                await createRole(payload);
              }
              onSave({ id: agent?.id, name, persona, tagline, avatar: isLive2D ? (live2dPreviewUrl || portrait) : portrait, tags: tagsStr.split(/\s+/).filter(Boolean), autoMoments: auto, autoMomentsImages: auto && autoImages, visualMode, visualPreviewUrl: live2dPreviewUrl, live2dModelUrl: agent?.live2dModelUrl || "", live2dManifest: live2dAsset, visualFrame, auto_moments_image_resolution: auto && autoImages ? imageResolution : "channel", auto_moments_image_profile: auto ? imageProfile : null, auto_moments_templates: auto ? momentTemplates : null });
            } catch (err) {
              setError(err instanceof Error ? err.message : "保存失败");
            } finally { setBusy(false); }
          }}>
            {busy ? "保存中…" : (editing ? "保存修改" : "创建她")}
          </button>
        </div>
      </div>
      {dynamicSheet && <DynamicSettingsSheet roleName={name || agent?.name || "她"} initialProfile={imageProfile} initialTemplates={momentTemplates} onClose={() => setDynamicSheet(false)} onSave={({ profile, templates }) => { setImageProfile(profile); setMomentTemplates(templates); setDynamicSheet(false); }} />}
    </div>
  );
}

/* ============ 可恢复角色区域 ============ */
function RecoverableAgents({ onRestored }) {
  const [deleted, setDeleted] = useStateA(null);
  const [restoring, setRestoring] = useStateA(null);
  const [open, setOpen] = useStateA(false);

  useEffectA(() => {
    async function load() {
      try {
        const data = await getRoles({ includeDeleted: true });
        const items = Array.isArray(data) ? data : (data?.items || []);
        setDeleted(items.filter((r) => r.is_deleted === 1 || r.is_deleted === true));
      } catch { setDeleted([]); }
    }
    load();
  }, []);

  const handleRestore = async (roleId) => {
    if (restoring) return;
    setRestoring(roleId);
    try {
      await restoreRole(roleId);
      setDeleted((p) => p.filter((r) => r.id !== roleId));
      onRestored?.();
    } catch { /* 静默失败 */ }
    finally { setRestoring(null); }
  };

  if (!deleted || deleted.length === 0) return null;

  return (
    <div className="recoverable-section pad">
      <button
        className="recoverable-header"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="clock" style={{ width: 14, height: 14, opacity: 0.6 }} />
        <span>可恢复角色 · {deleted.length} 位</span>
        <span className={"rec-chev" + (open ? " open" : "")}>
          <Icon name="chevronD" style={{ width: 14, height: 14 }} />
        </span>
      </button>

      {open && (
        <div className="recoverable-list">
          <p className="recoverable-hint">这些角色已删除，但还能从本地数据里找回来。</p>
          {deleted.map((role) => (
            <div key={role.id} className="recoverable-row">
              <img
                className="rec-avatar"
                src={getRolePortraitSrc(role) || "/assets/portraits/round/0.png"}
                alt={role.name}
              />
              <div className="rec-info">
                <div className="rec-name serif">{role.name}</div>
                <div className="rec-sub">{role.persona ? role.persona.slice(0, 36) + "…" : "无人设"}</div>
              </div>
              <button
                className="pill pill-ghost rec-restore-btn"
                disabled={restoring === role.id}
                onClick={() => handleRestore(role.id)}
              >
                {restoring === role.id ? "恢复中…" : "恢复"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export { AgentsScreen, AgentEditor, CharacterDetail, RecoverableAgents };
