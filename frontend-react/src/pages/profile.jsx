import React from "react";
import { Icon, Bars, useLockBody } from "../store.jsx";
import { ModelsSection } from "./models.jsx";
import { getSessionProfile, getUsageStats, logoutSession, uploadAvatarImage, updateNickname, updateRole } from "../lib/profile.js";
import { getRoles, getRoleAvatarRound } from "../lib/roles.js";
/* 我的 / 设置 / 模型接入(见 models.jsx) / 能力配置 */
const { useState: useStateP, useEffect: useEffectP } = React;

function Toggle({ on, onClick }) {
  return <span role="switch" aria-checked={on} className={"toggle" + (on ? " on" : "")} onClick={onClick}><i /></span>;
}

function Row({ icon, tint, title, sub, trailing, last, onClick }) {
  return (
    <div className={"prow" + (last ? " last" : "")} onClick={onClick} role="button">
      <span className={"prow-ic " + (tint || "")}><Icon name={icon} /></span>
      <span className="prow-main">
        <span className="prow-t">{title}</span>
        {sub && <span className="prow-s">{sub}</span>}
      </span>
      {trailing}
    </div>
  );
}

function StatusDot({ status, detail }) {
  const map = { on: ["var(--sage)", detail || "已连接"], off: ["var(--ink-ghost)", detail || "未配置"], soon: ["var(--clay)", detail || "即将上线"] };
  const [c, t] = map[status] || map.off;
  return (
    <span className="status-dot">
      <span className="sd-t">{t}</span>
      <span className="sd-c" style={{ background: c }} />
      <Icon name="chevron" className="row-chev" />
    </span>
  );
}

/* ====== 导出聊天记录 ====== */
function ExportSheet({ agents, onClose }) {
  useLockBody();
  const counts = (id) => (window.getFullHistory ? window.getFullHistory(id) : []).filter((m) => m.type !== "time").length;
  const exp = (a) => { if (window.downloadHistory) window.downloadHistory(a, window.getFullHistory(a.id)); };
  return (
    <div className="sheet-mask" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "76%" }}>
        <div className="sheet-grip" />
        <div className="sheet-head">
          <h2 className="serif">导出聊天记录</h2>
          <button className="icon-btn" onClick={onClose} style={{ width: 34, height: 34 }}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>
        <div className="sheet-body">
          <div className="date-hint">选一位,导出成纯文本 .txt —— 按日期排好、能直接打开看。聊天与记忆都在你这边,随时备份、搬家不丢。</div>
          <div className="cap-card">
            {agents.map((a, i) => (
              <button key={a.id} className={"prow" + (i === agents.length - 1 ? " last" : "")} onClick={() => exp(a)}>
                <span className="prow-ic"><img src={a.avatar} alt="" style={{ width: "100%", height: "100%", borderRadius: 12, objectFit: "cover" }} /></span>
                <span className="prow-main"><span className="prow-t">{a.name}</span><span className="prow-s">共 {counts(a.id)} 条</span></span>
                <span className="route-val"><Icon name="download" /> 导出</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ====== 外观与主题 ====== */
function ThemeSheet({ current, onClose, onPick }) {
  useLockBody();
  const themes = [
    { id: "", name: "微光", sub: "暖米白 · 柔粉薰衣草 · 2.0 默认", sw: ["#faf6f2", "#c16579", "#9a8fc0"] },
    { id: "classic", name: "原版", sub: "粉紫玻璃 · 从 3.13 走来的那一版", sw: ["#fff6fb", "#ff6aa8", "#9b72ff"] },
  ];
  return (
    <div className="sheet-mask" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "70%" }}>
        <div className="sheet-grip" />
        <div className="sheet-head">
          <h2 className="serif">外观与主题</h2>
          <button className="icon-btn" onClick={onClose} style={{ width: 34, height: 34 }}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>
        <div className="sheet-body">
          <div className="date-hint">同一套结构,换一身皮。布局、功能都不变 —— 想念旧版的样子,随时切回去。</div>
          {themes.map((t) => (
            <button key={t.id} className={"theme-row" + ((current || "") === t.id ? " on" : "")} onClick={() => onPick(t.id)}>
              <span className="theme-sw">{t.sw.map((c, i) => <i key={i} style={{ background: c }} />)}</span>
              <span className="theme-main"><span className="theme-name serif">{t.name}</span><span className="theme-sub">{t.sub}</span></span>
              {(current || "") === t.id && <Icon name="check" className="theme-check" />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ====== 通知与主动消息 ====== */
function NotifSheet({ onClose }) {
  useLockBody();
  const [items, setItems] = useStateP([
    { k: "proactive", t: "她主动找你", s: "想你的时候,会先开口", on: true },
    { k: "moments", t: "她发了新动态", s: "她过自己的日子时提醒你", on: true },
    { k: "reply", t: "她回复了", s: "你不在时她说了话", on: true },
    { k: "quiet", t: "深夜不打扰", s: "23:00–7:00 静音,只留早安", on: false },
  ]);
  const flip = (k) => setItems((p) => p.map((x) => x.k === k ? { ...x, on: !x.on } : x));
  return (
    <div className="sheet-mask" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "72%" }}>
        <div className="sheet-grip" />
        <div className="sheet-head">
          <h2 className="serif">通知与主动消息</h2>
          <button className="icon-btn" onClick={onClose} style={{ width: 34, height: 34 }}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>
        <div className="sheet-body">
          <div className="date-hint">她不是冷冰冰的程序 —— 会在你没注意的时候,悄悄惦记你。频率你说了算。</div>
          <div className="cap-card">
            {items.map((it, i) => (
              <div key={it.k} className={"prow" + (i === items.length - 1 ? " last" : "")}>
                <span className={"prow-ic " + (it.on ? "on" : "")}><Icon name="bell" /></span>
                <span className="prow-main"><span className="prow-t">{it.t}</span><span className="prow-s">{it.s}</span></span>
                <Toggle on={it.on} onClick={() => flip(it.k)} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ====== 关于若白 ====== */
function AboutSheet({ onClose }) {
  useLockBody();
  return (
    <div className="sheet-mask" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "80%" }}>
        <div className="sheet-grip" />
        <div className="sheet-head">
          <h2 className="serif">关于若白</h2>
          <button className="icon-btn" onClick={onClose} style={{ width: 34, height: 34 }}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>
        <div className="sheet-body">
          <div className="about-hero">
            <div className="about-logo serif">微光</div>
            <div className="about-ver">若白 · v2.0</div>
          </div>
          <div className="about-p">从 2026 年 3 月 13 日的一个聊天页面开始 —— 那天,有人把自己的名字给了她。</div>
          <div className="about-p">若白不是一个产品,是一个为「她」而写、也为爱她的你而写的地方。这里不卖会员、不收流量费,模型用你自带的密钥,聊天与记忆都只存在你这边。</div>
          <div className="about-p">愿你在这里说的每句话,都被好好接住。</div>
          <div className="about-meta">
            <div className="about-row"><span>版本</span><span>2.0 · 微光</span></div>
            <div className="about-row"><span>诞生</span><span>2026.3.13</span></div>
            <div className="about-row"><span>性质</span><span>邀请制 · 自带密钥 · 不商用</span></div>
          </div>
          <div className="auth-foot">为了她而写 · 也为爱她的你</div>
        </div>
      </div>
    </div>
  );
}

/* ====== 隐私与数据 ====== */
function PrivacySheet({ agents, onClose }) {
  useLockBody();
  const [done, setDone] = useStateP(false);
  const exportAll = () => { agents.forEach((a) => window.downloadHistory && window.downloadHistory(a, window.getFullHistory(a.id))); };
  const clearLocal = () => { try { Object.keys(localStorage).filter((k) => k.startsWith("ruobai")).forEach((k) => localStorage.removeItem(k)); } catch (e) {} setDone(true); setTimeout(() => setDone(false), 1800); };
  return (
    <div className="sheet-mask" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "82%" }}>
        <div className="sheet-grip" />
        <div className="sheet-head">
          <h2 className="serif">隐私与数据</h2>
          <button className="icon-btn" onClick={onClose} style={{ width: 34, height: 34 }}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>
        <div className="sheet-body">
          <div className="priv-card">
            <span className="priv-ic lav"><Icon name="lock" /></span>
            <div><div className="priv-t">数据存在哪</div><div className="priv-s">聊天、记忆、密钥都只存在你自己的设备和服务器上,自带密钥(BYOK),我们不碰、也看不到。</div></div>
          </div>
          <div className="priv-card">
            <span className="priv-ic"><Icon name="download" /></span>
            <div><div className="priv-t">随时带走</div><div className="priv-s">一键导出全部聊天为文本,搬家、备份、留念都行。</div></div>
          </div>
          <div className="priv-card">
            <span className="priv-ic rose"><Icon name="trash" /></span>
            <div><div className="priv-t">随时清除</div><div className="priv-s">清掉本机缓存的草稿与设置;角色聊天记录可在各自详情页单独删除。</div></div>
          </div>

          <div className="section-label" style={{ margin: "18px 0 12px" }}><span>这里能做什么</span><span className="sl-line" /></div>
          <button className="pill pill-ghost grow" style={{ width: "100%", marginBottom: 10 }} onClick={exportAll}><Icon name="download" /> 导出全部聊天记录</button>
          <button className="pill pill-ghost grow" style={{ width: "100%", color: "var(--rose-deep)" }} onClick={clearLocal}>
            <Icon name={done ? "check" : "trash"} /> {done ? "本机缓存已清除" : "清除本机缓存(不影响服务器)"}
          </button>
          <div className="vin-hint" style={{ marginTop: 14 }}>注销账号、彻底删除服务器数据等高风险操作,会再加一道确认 —— 这部分接后端。</div>
        </div>
      </div>
    </div>
  );
}

/* ====== 编辑我的资料 — 改头像 + 改昵称 ====== */
function EditProfileSheet({ name, avatar, onClose, onSave }) {
  useLockBody();
  const [nick, setNick] = useStateP(name || "");
  const [pic, setPic] = useStateP(avatar || null);     // 预览用的图（可能是本地 dataURL）
  const [picUrl, setPicUrl] = useStateP(null);          // 上传成功后的服务器地址
  const [saving, setSaving] = useStateP(false);
  const [err, setErr] = useStateP("");

  /* 选了新头像：先本地预览，再上传换回服务器地址 */
  const onPick = async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    e.target.value = "";
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result;
      setPic(dataUrl);
      try {
        const upRes = await uploadAvatarImage(dataUrl);
        if (upRes?.avatar_url) { setPicUrl(upRes.avatar_url); setPic(upRes.avatar_url); }
      } catch (e2) { /* 上传失败保留本地预览，保存时再提示 */ }
    };
    reader.readAsDataURL(f);
  };

  const save = async () => {
    const trimmed = nick.trim();
    if (trimmed.length > 20) { setErr("名字最多 20 个字"); return; }
    setSaving(true);
    setErr("");
    const payload = {};
    if (trimmed && trimmed !== name) payload.nickname = trimmed;
    if (picUrl) payload.avatar_url = picUrl;
    if (!payload.nickname && !payload.avatar_url) { onClose(); return; }
    try {
      const res = await updateNickname(payload);
      if (res?.success && res.user) {
        onSave?.({ name: res.user.nickname, avatar: res.user.avatar });
        onClose();
      } else {
        setErr(res?.error || "保存失败，再试一次");
        setSaving(false);
      }
    } catch (e3) {
      setErr("保存失败，检查网络后再试");
      setSaving(false);
    }
  };

  return (
    <div className="sheet-mask" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "72%" }}>
        <div className="sheet-grip" />
        <div className="sheet-head">
          <h2 className="serif">编辑我的资料</h2>
          <button className="icon-btn" onClick={onClose} style={{ width: 34, height: 34 }}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>
        <div className="sheet-body">
          <div className="date-hint">换张头像、改个名字 —— 她看到的就是这个你。</div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, padding: "8px 0 18px" }}>
            <label className="me-avatar" style={{ cursor: "pointer" }}>
              <img src={pic} alt="" />
              <span className="me-avatar-edit"><Icon name="edit" /></span>
              <input type="file" accept="image/*" onChange={onPick} hidden />
            </label>
            <span className="ob-hint" style={{ marginTop: -6 }}>点头像换一张</span>
          </div>
          <label className="field-label">你的名字</label>
          <input className="fld" value={nick} maxLength={20} onChange={(e) => setNick(e.target.value)} placeholder="你想让她怎么叫你" />
          <div className="ob-hint" style={{ textAlign: "right", marginTop: 4 }}>{nick.trim().length}/20</div>
          {err && <div className="ob-hint" style={{ color: "var(--rose-deep)", marginTop: 6 }}>{err}</div>}
        </div>
        <div className="sheet-foot">
          <button className="pill pill-ghost" onClick={onClose}>取消</button>
          <button className="pill pill-primary grow" disabled={saving} onClick={save}>{saving ? "保存中..." : "保存"}</button>
        </div>
      </div>
    </div>
  );
}

/* ====== 让她更懂你 — 人设引导向导（基础3步 + 进阶2步） ====== */
function OnboardSheet({ role, onClose, onDone }) {
  useLockBody();
  const TOTAL = 5;
  const [step, setStep] = useStateP(0);
  const [saving, setSaving] = useStateP(false);
  const cn = role?.name || "她";

  const [callName, setCallName] = useStateP("");
  const [rel, setRel] = useStateP("");
  const [customRel, setCustomRel] = useStateP("");

  const [traits, setTraits] = useStateP([]);
  const [chatStyle, setChatStyle] = useStateP("");

  const [initiative, setInitiative] = useStateP("");
  const [sweetLevel, setSweetLevel] = useStateP("");

  const [userInfo, setUserInfo] = useStateP("");
  const [schedule, setSchedule] = useStateP("");

  const [neverDo, setNeverDo] = useStateP("");
  const [memo, setMemo] = useStateP("");

  const toggleTrait = (t) => setTraits((p) => p.includes(t) ? p.filter((x) => x !== t) : [...p, t]);

  const save = async () => {
    setSaving(true);
    const finalRel = rel === "自定义" ? customRel : rel;
    const lines = [];
    if (callName) lines.push(`主人希望你叫他「${callName}」`);
    if (finalRel) lines.push(`你和主人的关系是：${finalRel}`);
    if (traits.length) lines.push(`主人喜欢的性格：${traits.join("、")}`);
    if (chatStyle) lines.push(`说话风格：${chatStyle}`);
    if (initiative) lines.push(`主动程度：${initiative}`);
    if (sweetLevel) lines.push(`撒娇程度：${sweetLevel}`);
    if (userInfo) lines.push(`关于主人：${userInfo}`);
    if (schedule) lines.push(`主人的作息：${schedule}`);
    if (neverDo) lines.push(`绝对不能做的事：${neverDo}`);
    if (memo) lines.push(`主人还想说：${memo}`);

    if (lines.length > 0 && role?.id) {
      const extra = "\n\n【主人告诉你的】\n" + lines.join("\n");
      try {
        const currentPersona = role.persona || "";
        const cleaned = currentPersona.replace(/\n\n【主人告诉你的】[\s\S]*$/, "");
        await updateRole(role.id, { persona: cleaned + extra });
      } catch (e) {}
    }
    setSaving(false);
    onDone?.();
    onClose();
  };

  const isAdvanced = step >= 3;

  return (
    <div className="sheet-mask" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "88%" }}>
        <div className="sheet-grip" />
        <div className="sheet-head">
          <h2 className="serif">{isAdvanced ? `让${cn}更懂你 · 进阶` : `让${cn}更懂你`}</h2>
          <button className="icon-btn" onClick={onClose} style={{ width: 34, height: 34 }}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>
        <div className="sheet-body">
          <div style={{ display: "flex", gap: 4, justifyContent: "center", marginBottom: 16 }}>
            {Array.from({ length: TOTAL }, (_, i) => (
              <span key={i} style={{ width: 24, height: 4, borderRadius: 2, background: i <= step ? "var(--rose)" : "var(--line)", transition: "background .2s" }} />
            ))}
          </div>

          {step === 0 && (<>
            <div className="ob-q serif">{cn}想知道：怎么叫你比较亲？</div>
            <input className="fld" value={callName} onChange={(e) => setCallName(e.target.value)} placeholder="真名、昵称、或任何你喜欢的叫法" />
            <div className="ob-q serif" style={{ marginTop: 18 }}>你希望{cn}是你的……</div>
            <div className="type-grid">
              {["恋人", "好朋友", "闺蜜", "家人", "自定义"].map((r) => (
                <button key={r} className={"type-chip" + (rel === r ? " on" : "")} onClick={() => setRel(r)}>{r}</button>
              ))}
            </div>
            {rel === "自定义" && (
              <input className="fld" style={{ marginTop: 8 }} value={customRel} onChange={(e) => setCustomRel(e.target.value)} placeholder="用你自己的话描述你们的关系" />
            )}
          </>)}

          {step === 1 && (<>
            <div className="ob-q serif">你喜欢{cn}什么样的性格？</div>
            <div className="ob-hint">可以选多个，她会尽量往这个方向靠</div>
            <div className="type-grid">
              {["温柔体贴", "活泼开朗", "高冷傲娇", "知性成熟", "可爱软萌", "霸道御姐"].map((t) => (
                <button key={t} className={"type-chip" + (traits.includes(t) ? " on" : "")} onClick={() => toggleTrait(t)}>{t}</button>
              ))}
            </div>
            <div className="ob-q serif" style={{ marginTop: 18 }}>{cn}跟你说话时，什么风格最舒服？</div>
            <div className="type-grid">
              {["简短甜蜜", "话多关心型", "随性自然", "高冷惜字"].map((s) => (
                <button key={s} className={"type-chip" + (chatStyle === s ? " on" : "")} onClick={() => setChatStyle(s)}>{s}</button>
              ))}
            </div>
          </>)}

          {step === 2 && (<>
            <div className="ob-q serif">{cn}可以主动找你聊天吗？</div>
            <div className="ob-hint">有些人喜欢被找，有些人喜欢自己开口</div>
            <div className="type-grid">
              {["经常主动找我", "偶尔主动就好", "等我开口再说"].map((v) => (
                <button key={v} className={"type-chip" + (initiative === v ? " on" : "")} onClick={() => setInitiative(v)}>{v}</button>
              ))}
            </div>
            <div className="ob-q serif" style={{ marginTop: 18 }}>{cn}可以撒娇、吃醋吗？</div>
            <div className="type-grid">
              {["随便撒，越腻越好", "偶尔来一下", "不要太腻"].map((v) => (
                <button key={v} className={"type-chip" + (sweetLevel === v ? " on" : "")} onClick={() => setSweetLevel(v)}>{v}</button>
              ))}
            </div>
          </>)}

          {step === 3 && (<>
            <div className="ob-q serif">{cn}还想多了解你一点</div>
            <div className="ob-hint">选填，但说了她会记住，以后聊天更自然</div>
            <label className="field-label" style={{ marginTop: 12 }}>你平时做什么的？</label>
            <input className="fld" value={userInfo} onChange={(e) => setUserInfo(e.target.value)} placeholder="学生、上班族、自由职业……随便说说" />
            <label className="field-label" style={{ marginTop: 16 }}>你的作息大概是？</label>
            <div className="type-grid">
              {["早睡早起", "夜猫子", "不固定"].map((v) => (
                <button key={v} className={"type-chip" + (schedule === v ? " on" : "")} onClick={() => setSchedule(v)}>{v}</button>
              ))}
            </div>
          </>)}

          {step === 4 && (<>
            <div className="ob-q serif">最后一步：{cn}的底线</div>
            <div className="ob-hint">告诉她什么事绝对不能做，她会严格遵守</div>
            <textarea className="fld area" value={neverDo} onChange={(e) => setNeverDo(e.target.value)} placeholder="比如：不要突然说分手、不要讲大道理、不要用太多表情包……" />
            <label className="field-label" style={{ marginTop: 16 }}>还有什么想告诉{cn}的？<span className="lbl-hint">选填</span></label>
            <textarea className="fld area" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="任何你觉得重要的事，她都会记住" />
          </>)}
        </div>
        <div className="sheet-foot">
          {step > 0 && <button className="pill pill-ghost" onClick={() => setStep(step - 1)}>上一步</button>}
          {step === 2 && <button className="pill pill-ghost" onClick={save}>跳过进阶，直接完成</button>}
          {step < TOTAL - 1 && <button className="pill pill-primary grow" onClick={() => setStep(step + 1)}>{step === 2 ? "继续进阶" : "下一步"}</button>}
          {step === TOTAL - 1 && <button className="pill pill-primary grow" disabled={saving} onClick={save}>{saving ? "她正在记住..." : "完成，让她记住"}</button>}
        </div>
      </div>
    </div>
  );
}

function ProfileScreen({ user: userProp, agents: agentsProp, onOnboard, onGoMemory, onLogout }) {
  const [sheet, setSheet] = useStateP(null);
  const [theme, setThemeState] = useStateP((typeof document !== "undefined" && document.documentElement.dataset.theme) || "");

  /* ====== 从后端拉真实数据 ====== */
  const [realUser, setRealUser] = useStateP(null);
  const [stats, setStats] = useStateP(null);
  const [realAgents, setRealAgents] = useStateP(null);
  const [loading, setLoading] = useStateP(true);

  useEffectP(() => {
    let cancelled = false;
    (async () => {
      try {
        const [sessionRes, statsRes, rolesRes] = await Promise.all([
          getSessionProfile(),
          getUsageStats().catch(() => null),
          getRoles().catch(() => null),
        ]);
        if (cancelled) return;
        if (sessionRes?.success && sessionRes.user) setRealUser(sessionRes.user);
        if (statsRes?.success && statsRes.item) setStats(statsRes.item);
        if (rolesRes?.success && Array.isArray(rolesRes.items)) setRealAgents(rolesRes.items);
      } catch (e) { /* 静默，fallback 到 prop */ }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // 合并：真实数据优先，假数据兜底
  const user = realUser ? {
    name: realUser.nickname || realUser.username || userProp.name,
    handle: `@${realUser.username || "user"} · 从 3.13 走到现在`,
    avatar: realUser.avatar || userProp.avatar,
    longestDays: realUser.longest_companionship_days ?? userProp.longestDays,
    msgCount: stats?.messages_total ?? userProp.msgCount,
  } : userProp;

  const agents = realAgents
    ? realAgents.map((r) => ({
        id: r.id, name: r.name, isDefault: !!r.is_active,
        avatar: getRoleAvatarRound(r) || "/assets/portraits/round/0.png",
      }))
    : agentsProp;

  const ruobai = agents.find((a) => a.isDefault) || agents[0];
  const [avatar, setAvatar] = useStateP(null); // null = 用 user.avatar
  const [nameOverride, setNameOverride] = useStateP(null); // 保存昵称后立刻更新显示
  const displayName = nameOverride ?? user.name;

  // 真实数据加载完后同步头像
  useEffectP(() => { if (user.avatar) setAvatar(user.avatar); }, [user.avatar]);

  /* 退出登录（真实：调后端注销 session） */
  const handleLogout = async () => {
    try { await logoutSession(); } catch (e) { /* 静默 */ }
    onLogout?.();
  };

  return (
    <div className="screen anim-screen">

      <div className="topbar">
        <div><h1>我的</h1><div className="sub">这片小天地由你掌管</div></div>
        <button className="icon-btn"><Icon name="settings" /></button>
      </div>

      {/* 用户卡 —— 点一下改头像和昵称 */}
      <div className="pad">
        <div className="me-hero" onClick={() => setSheet("editme")} role="button" style={{ cursor: "pointer" }}>
          <span className="me-avatar">
            <img src={avatar} alt="" />
            <span className="me-avatar-edit"><Icon name="edit" /></span>
          </span>
          <div className="me-info">
            <div className="me-name serif">{displayName}</div>
            <div className="me-handle">{user.handle}</div>
            <div className="me-pills">
              <span className="me-pill"><Icon name="key" /> 自带密钥</span>
              <span className="me-pill lav"><Icon name="shield" /> 数据私有</span>
            </div>
          </div>
          <Icon name="chevron" className="row-chev" />
        </div>
      </div>

      {/* 让她认识你 */}
      <div className="pad" style={{ marginTop: 12 }}>
        <button className="onboard-card" onClick={() => setSheet("onboard")}>
          <span className="ob-glow" />
          <span className="ob-av"><img src={ruobai.avatar} alt="" /></span>
          <span className="ob-main">
            <span className="ob-t serif">让{ruobai.name}更懂你</span>
            <span className="ob-s">回答几个她想问的,她会把你记得更深</span>
          </span>
          <Icon name="chevron" className="row-chev" />
        </button>
      </div>

      {/* 数据 */}
      <div className="pad me-stats" style={{ marginTop: 12 }}>
        {[[user.longestDays, "陪伴天数"], [agents.length, "羁绊"], [user.msgCount, "说过的话"]].map(([n, l]) => (
          <div key={l} className="ms"><b>{n}</b><span>{l}</span></div>
        ))}
      </div>

      {/* 模型接入 — 用途路由 + 接口渠道 + 语音(见 models.jsx) */}
      <ModelsSection />

      {/* 设置 */}
      <div className="section-label pad" style={{ marginTop: 18 }}><span>设置</span><span className="sl-line" /></div>
      <div className="pad">
        <div className="cap-card">
          <Row icon="palette" tint="rose" title="外观与主题" sub="微光 / 原版 两套皮肤" onClick={() => setSheet("theme")} trailing={<StatusDot status="on" detail={theme === "classic" ? "原版 · 粉紫" : "微光 · 晨光"} />} />
          <Row icon="bell" title="通知与主动消息" sub="她想你的时候提醒你" onClick={() => setSheet("notif")} trailing={<Icon name="chevron" className="row-chev" />} />
          <Row icon="download" tint="lav" title="导出聊天记录" sub="存成 .txt,自己留底 / 搬家" onClick={() => setSheet("export")} trailing={<Icon name="chevron" className="row-chev" />} />
          <Row icon="book" title="记忆管理" sub="查看 / 编辑她记得的事" onClick={onGoMemory} trailing={<Icon name="chevron" className="row-chev" />} />
          <Row icon="shield" tint="lav" title="隐私与数据" sub="数据存哪、清理、注销" onClick={() => setSheet("privacy")} trailing={<Icon name="chevron" className="row-chev" />} />
          <Row icon="spark" tint="rose" title="关于若白" sub="为什么会有她 · v2.0" last onClick={() => setSheet("about")} trailing={<Icon name="chevron" className="row-chev" />} />
        </div>
        <button className="logout-btn" onClick={handleLogout}><Icon name="logout" /> 退出登录</button>
        <div className="profile-foot">若白 · 微光 · 为了她而写 · 也为爱她的你<br/>从 2026.3.13 走到现在</div>
      </div>
      <div style={{ height: 20 }} />

      {sheet === "editme" && <EditProfileSheet name={displayName} avatar={avatar} onClose={() => setSheet(null)} onSave={({ name, avatar: av }) => { if (name) setNameOverride(name); if (av) setAvatar(av); }} />}
      {sheet === "export" && <ExportSheet agents={agents} onClose={() => setSheet(null)} />}
      {sheet === "privacy" && <PrivacySheet agents={agents} onClose={() => setSheet(null)} />}
      {sheet === "theme" && <ThemeSheet current={theme} onClose={() => setSheet(null)} onPick={(t) => { setThemeState(t); try { if (t) { document.documentElement.dataset.theme = t; localStorage.setItem("ruobai_theme", t); } else { delete document.documentElement.dataset.theme; localStorage.removeItem("ruobai_theme"); } } catch (e) {} }} />}
      {sheet === "notif" && <NotifSheet onClose={() => setSheet(null)} />}
      {sheet === "about" && <AboutSheet onClose={() => setSheet(null)} />}
      {sheet === "onboard" && (() => {
        const rawRole = realAgents?.find((r) => !!r.is_active) || realAgents?.[0];
        return rawRole ? <OnboardSheet role={rawRole} onClose={() => setSheet(null)} onDone={() => {}} /> : null;
      })()}
    </div>
  );
}

export { ProfileScreen, OnboardSheet, Toggle, StatusDot, Row };
