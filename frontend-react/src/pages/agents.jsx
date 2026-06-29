import React from "react";
import { Icon, AGENTS } from "../store.jsx";
import { getRoles, getRolePortraitSrc, clampIntimacy, createRole, updateRole, switchRole, buildRolePayload } from "../lib/roles.js";
/* 角色 — 列表(Hero + 网格) + 详情 + 创建/编辑 */
const { useState: useStateA, useEffect: useEffectA, useRef: useRefA } = React;

/* 后端角色 → 2.0 agent 格式 */
function getFullPortrait(role) {
  const portraitId = Number(role?.portrait_id ?? role?.portraitId);
  const customUrl = String(role?.portrait_custom_url ?? role?.portraitCustomUrl ?? "").trim();
  if (portraitId === 999 && customUrl) return customUrl;
  if (Number.isInteger(portraitId) && portraitId >= 0 && portraitId <= 17) return `/assets/portraits/full/${portraitId}.png`;
  return `/assets/portraits/full/0.png`;
}

function toAgent(role) {
  return {
    id: role.id,
    name: role.name || "未命名",
    avatar: getRolePortraitSrc(role) || "/assets/portraits/round/0.png",
    cover: getFullPortrait(role),
    tag: role.tag || "",
    tagline: role.persona ? role.persona.slice(0, 30) + "…" : "",
    persona: role.persona || "",
    tags: role.tag ? [role.tag] : [],
    intimacy: clampIntimacy(role.intimacy),
    temp: Number(role.mood) || 36.5,
    days: role.first_chat_at ? Math.max(1, Math.ceil((Date.now() - new Date(role.first_chat_at).getTime()) / 86400000)) : 0,
    online: Boolean(role.is_active),
    isDefault: Boolean(role.is_active),
    autoMoments: Boolean(role.auto_moments_enabled),
    handle: role.tag || "角色",
    voice: "默认",
    lastMsg: "",
    _raw: role,
  };
}

/* ---- Hero: 主陪伴(置顶) ---- */
function AgentHero({ agent, onChat, onDetail }) {
  return (
    <div className="hero">
      <img className="hero-bg" src={agent.cover} alt={agent.name} onClick={() => onDetail(agent)} />
      <div className="hero-scrim" />
      <div className="hero-top">
        <span className="tag tag-rose" style={{ background: "rgba(255,255,255,.85)", color: "var(--rose-deep)" }}>
          <Icon name="heartFill" style={{ width: 11, height: 11 }} /> 主陪伴
        </span>
        <button className="hero-edit" onClick={() => onDetail(agent)}><Icon name="more" /></button>
      </div>
      <div className="hero-body">
        <div className="hero-name serif">{agent.name}</div>
        <div className="hero-quote">「{agent.tagline}」</div>
        <div className="hero-stats">
          <div className="hs"><b>{agent.days}</b><span>在一起 · 天</span></div>
          <div className="hs-div" />
          <div className="hs"><b>{(Number(agent.temp) || 36.5).toFixed(1)}°</b><span>关系温度</span></div>
          <div className="hs-div" />
          <div className="hs"><b>{agent.intimacy}</b><span>亲密度</span></div>
        </div>
        <div className="hero-temp"><div className="temp-bar"><i style={{ width: `${agent.intimacy}%` }} /></div></div>
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
        <img src={agent.cover} alt={agent.name} />
        <div className="ac-scrim" />
        {agent.online && <span className="ac-online" />}
        <div className="ac-overlay">
          <div className="ac-name serif">{agent.name}</div>
          <div className="ac-temp"><Icon name="flame" /> {(Number(agent.temp) || 36.5).toFixed(1)}° · {agent.days}天</div>
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

function AgentsScreen({ agents: fallbackAgents, onChat, onDetail, onCreate }) {
  const [agents, setAgents] = useStateA(null);
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
      } catch {
        // 后端没开就用兜底
      }
    }
    load();
    const onFocus = () => load();
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const list = agents ?? fallbackAgents ?? [];

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
          <button className="icon-btn"><Icon name="search" /></button>
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
      <div style={{ height: 24 }} />
    </div>
  );
}

/* ============ 角色详情 ============ */
function CharacterDetail({ agent, memCount, onClose, onChat, onEdit, onDelete, onSetMain, onOnboard }) {
  const [confirm, setConfirm] = useStateA(false);
  const [deleting, setDeleting] = useStateA(false);
  const [deleteError, setDeleteError] = useStateA("");

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

  return (
    <div className="detail-screen anim-screen">
      <div className="detail-photo">
        <img src={agent.cover} alt={agent.name} />
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

        <div className="detail-stats">
          <div className="ds"><b>{agent.days}</b><span>在一起·天</span></div>
          <div className="ds"><b>{agent.temp.toFixed(1)}°</b><span>关系温度</span></div>
          <div className="ds"><b>{agent.intimacy}</b><span>亲密度</span></div>
          <div className="ds"><b>{memCount}</b><span>记忆条</span></div>
        </div>

        <div className="temp-bar" style={{ margin: "16px 2px 4px" }}><i style={{ width: `${agent.intimacy}%` }} /></div>

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
            : <button className="set-main-btn" onClick={() => onSetMain && onSetMain(agent.id)}>设为主陪伴</button>}
        </div>

        <div className="detail-row">
          <span className="dr-l">声音</span>
          <span className="dr-r">{agent.voice}</span>
        </div>
        <div className="detail-row">
          <span className="dr-l">主动发动态</span>
          <span className="dr-r">{agent.autoMoments ? "已开启" : "已关闭"}</span>
        </div>
        <div className="detail-row">
          <span className="dr-l">最近一句</span>
          <span className="dr-r ellip">{agent.lastMsg}</span>
        </div>
      </div>

      <div className="detail-foot">
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
    </div>
  );
}

/* ============ 创建 / 编辑 ============ */
const PORTRAIT_OPTIONS = Array.from({ length: 18 }, (_, i) => `/assets/portraits/square/${i}.png`);

function AgentEditor({ agent, onClose, onSave }) {
  const editing = !!agent;
  const [name, setName] = useStateA(agent?.name || "");
  const [persona, setPersona] = useStateA(agent?.persona || "");
  const [tagline, setTagline] = useStateA(agent?.tagline || "");
  const [portrait, setPortrait] = useStateA(agent?.avatar || PORTRAIT_OPTIONS[0]);
  const [uploads, setUploads] = useStateA([]); // 用户上传的自定义头像(dataURL)
  const [tagsStr, setTagsStr] = useStateA((agent?.tags || []).join(" "));
  const [auto, setAuto] = useStateA(agent?.autoMoments ?? true);
  const [freq, setFreq] = useStateA(agent?.momentFreq ?? 4);
  const [style, setStyle] = useStateA(agent?.figureStyle || "anime");
  const [busy, setBusy] = useStateA(false);
  const [error, setError] = useStateA("");

  const onUpload = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { const url = reader.result; setUploads((p) => [url, ...p]); setPortrait(url); };
    reader.readAsDataURL(file);
    e.target.value = "";
  };
  const isCustom = portrait.startsWith("data:");

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
              <label className="pp pp-upload" style={{ marginTop: 8, width: "100%" }}>
                <input type="file" accept="image/*" onChange={onUpload} hidden />
                <Icon name="image" /><span>上传自定义</span>
              </label>
              {uploads.map((u) => (
                <button key={u} className={"pp" + (u === portrait ? " on" : "")} onClick={() => setPortrait(u)} style={{ marginTop: 4 }}>
                  <img src={u} alt="" />
                </button>
              ))}
            </div>
            <div className="portrait-pick">
              {PORTRAIT_OPTIONS.map((p) => (
                <button key={p} className={"pp" + (p === portrait ? " on" : "")} onClick={() => setPortrait(p)}>
                  <img src={p} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          </div>

          <label className="field-label">立绘风格 <span className="lbl-hint">聊天时她出现在背景里的样子</span></label>
          <div className="freq-row" style={{ marginTop: 0 }}>
            {[["anime", "动漫感"], ["real", "真人感"], ["none", "不显示"]].map(([k, l]) => (
              <button key={k} className={"freq-chip" + (style === k ? " on" : "")} onClick={() => setStyle(k)}>{l}</button>
            ))}
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
              <span className="sr-s">每天约</span>
              {[2, 4, 6].map((f) => (
                <button key={f} className={"freq-chip" + (freq === f ? " on" : "")} onClick={() => setFreq(f)}>{f} 条</button>
              ))}
            </div>
          )}
        </div>

        <div className="sheet-foot">
          {error && <div className="chat-error" style={{marginBottom:10}} onClick={() => setError("")}>{error} 点击关闭</div>}
          <button className="pill pill-primary grow" disabled={busy} onClick={async () => {
            if (!name.trim() || !persona.trim()) { setError("名字和人设不能为空"); return; }
            setBusy(true); setError("");
            try {
              const payload = { name: name.trim(), persona: persona.trim(), tag: tagsStr.split(/\s+/).filter(Boolean)[0] || "", avatar: portrait, auto_moments_enabled: auto };
              if (editing && agent._raw?.id) {
                await updateRole(agent._raw.id, payload);
              } else {
                await createRole(payload);
              }
              onSave({ id: agent?.id, name, persona, tagline, avatar: portrait, tags: tagsStr.split(/\s+/).filter(Boolean), autoMoments: auto });
            } catch (err) {
              setError(err instanceof Error ? err.message : "保存失败");
            } finally { setBusy(false); }
          }}>
            {busy ? "保存中…" : (editing ? "保存修改" : "创建她")}
          </button>
        </div>
      </div>
    </div>
  );
}

export { AgentsScreen, AgentEditor, CharacterDetail };
