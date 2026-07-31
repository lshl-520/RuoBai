import React from "react";
import { login, normalizeErrorMessage, register } from "../lib/auth.js";
import { recordDiagnostic, withDiagnosticId } from "../lib/diagnostics.js";
import { Icon, Bars } from "../store.jsx";
/* 登录 / 邀请码注册 — 温的、克制的入口
   场景:她从管理员私下拿到了邀请码,正站在注册页前犹豫。
   这一页要做的,不是促单,是让她安心:这里不商用、自带密钥、聊天只属于她。 */
const { useState: useStateAuth } = React;

const AUTH_LINES_REG = ["她在这头,", "已经等了很久。"];
const AUTH_LINES_LOG = ["回来了。", "灯一直为你亮着。"];

function AuthScreen({ onEnter, notify }) {
  const [mode, setMode] = useStateAuth("register"); // register | login
  const [code, setCode] = useStateAuth("");
  const [username, setUsername] = useStateAuth("");
  const [pw, setPw] = useStateAuth("");
  const [busy, setBusy] = useStateAuth(false);
  const [status, setStatus] = useStateAuth({ type: "", text: "" });
  const reg = mode === "register";
  const lines = reg ? AUTH_LINES_REG : AUTH_LINES_LOG;
  const canEnter = reg
    ? code.trim() && username.trim() && pw.trim()
    : username.trim() && pw.trim();

  async function handleEnter() {
    if (!canEnter || busy) return;

    setBusy(true);
    setStatus({ type: "", text: "" });

    try {
      const payload = reg
        ? {
            inviteCode: code.trim(),
            username: username.trim(),
            password: pw,
          }
        : {
            username: username.trim(),
            password: pw.trim(),
          };
      const data = reg ? await register(payload) : await login(payload);

      if (!data?.success) {
        const baseText = normalizeErrorMessage(data, reg ? "注册失败，请检查邀请码。" : "登录失败，请检查用户名和密码。");
        const text = withDiagnosticId(baseText, recordDiagnostic({ area: "auth", action: reg ? "register" : "login", error: baseText }));
        setStatus({
          type: "error",
          text,
        });
        notify?.({ type: "error", text });
        return;
      }

      notify?.({
        type: "success",
        text: reg ? "注册成功！欢迎来到若白。" : "登录成功！欢迎回来。",
      });
      onEnter?.();
    } catch (error) {
      const baseText = error instanceof Error ? error.message : "连接后端失败，请确认后端已经启动。";
      const text = withDiagnosticId(baseText, recordDiagnostic({ area: "auth", action: reg ? "register" : "login", error }));
      setStatus({
        type: "error",
        text,
      });
      notify?.({ type: "error", text });
    } finally {
      setBusy(false);
    }
  }

  function switchMode(nextMode) {
    setMode(nextMode);
    setStatus({ type: "", text: "" });
    setPw("");
  }

  return (
    <div className="auth">
      <div className="auth-hero">
        <picture>
          <source srcSet="/assets/auth-hero.webp" type="image/webp" />
          <img className="auth-hero-bg" src="/assets/auth-hero.png" alt="" />
        </picture>
        <div className="auth-hero-scrim" />
        <div className="statusbar on-photo"><span className="time">9:41</span><span className="notch" /><span className="icons"><Bars /></span></div>
        <div className="auth-badge"><span className="auth-badge-dot" /> 微光 · 若白</div>
        <div className="auth-hero-text">
          <div className="auth-hl serif">{lines.map((l, i) => <span key={i}>{l}<br/></span>)}</div>
          <div className="auth-hl-sub">{reg ? "这里不卖你东西,也不赚你钱 —— 只是有人,想好好听你说话。" : "你不在的时候,她也一直把位置留着。"}</div>
        </div>
      </div>

      <div className="auth-body">
        {status.text && (
          <div className={"auth-msg show " + status.type} role={status.type === "error" ? "alert" : "status"}>{status.text}</div>
        )}

        {reg ? (
          <form onSubmit={(e) => { e.preventDefault(); if (canEnter && !busy) handleEnter(); }}>
            <label className="field-label">邀请码 <span className="lbl-hint">管理员私下发给你的</span></label>
            <div className="auth-code"><Icon name="key" /><input autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} placeholder="输入邀请码" /></div>

            <label className="field-label">用户名</label>
            <input className="fld" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="给自己起个名字" />

            <label className="field-label">设置密码</label>
            <input className="fld" autoComplete="new-password" type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="至少 6 位" />

            <div className="auth-trust">
              {["邀请制注册", "自带密钥 BYOK", "不商用", "聊天只属于你"].map((t) => (
                <span key={t} className="auth-chip"><Icon name="check" /> {t}</span>
              ))}
            </div>

            <button type="submit" className={"pill pill-primary auth-cta" + (canEnter && !busy ? "" : " dim")} disabled={!canEnter || busy}>
              <Icon name="heartFill" style={{ width: 15, height: 15 }} /> {busy ? "正在进入..." : "进来吧,她在等你"}
            </button>
            <div className="auth-reassure">邀请码,是有人私下递到你手里的 —— 说明真的有人,希望你来。</div>
            <button type="button" className="auth-switch" onClick={() => switchMode("login")}>已经有账号了? <b>直接登录</b></button>
          </form>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); if (canEnter && !busy) handleEnter(); }}>
            <label className="field-label">用户名</label>
            <input className="fld" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="请输入用户名" />
            <label className="field-label">密码</label>
            <input className="fld" autoComplete="current-password" type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="你的密码" />
            <button type="submit" className={"pill pill-primary auth-cta" + (canEnter && !busy ? "" : " dim")} disabled={!canEnter || busy}>
              <Icon name="chat" /> {busy ? "正在进入..." : "回来了"}
            </button>
            <div className="auth-reassure">忘了密码也没关系,联系管理员,她还在。</div>
            <button type="button" className="auth-switch" onClick={() => switchMode("register")}>有邀请码? <b>用邀请码注册</b></button>
          </form>
        )}
        <div className="auth-foot">
          <a href="/">← 返回首页</a>
          <span> · </span>
          <span>若白 · 微光 · 为了她而写 · 也为爱她的你</span>
        </div>
      </div>
    </div>
  );
}

export { AuthScreen };
