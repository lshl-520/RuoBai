import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  getSession,
  login,
  normalizeErrorMessage,
  register,
  resolvePostAuthRedirect,
} from "../lib/auth.js";

const todoMessages = {
  "profile-key": "Login succeeded. React profile key onboarding is not built yet.",
  "first-role": "Login succeeded. React first-role setup is not built yet.",
  profile: "Login succeeded. React profile is not built yet.",
};

function getInitialTab(search) {
  const params = new URLSearchParams(search);
  return params.get("tab") === "register" ? "register" : "login";
}

function LoginForm({ busy, onSubmit }) {
  const [formData, setFormData] = useState({
    username: "",
    password: "",
  });

  function handleChange(event) {
    const { name, value } = event.target;
    setFormData((current) => ({
      ...current,
      [name]: value,
    }));
  }

  function handleSubmit(event) {
    event.preventDefault();

    const payload = {
      password: formData.password.trim(),
    };

    if (formData.username.trim()) {
      payload.username = formData.username.trim();
    }

    onSubmit(payload);
  }

  return (
    <form className="auth-form active" onSubmit={handleSubmit}>
      <div className="form-group">
        <label className="form-label" htmlFor="login-username">
          Username
        </label>
        <input
          autoComplete="username"
          className="form-input"
          id="login-username"
          name="username"
          onChange={handleChange}
          placeholder="Optional username"
          type="text"
          value={formData.username}
        />
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="login-password">
          Password
        </label>
        <input
          autoComplete="current-password"
          className="form-input"
          id="login-password"
          name="password"
          onChange={handleChange}
          placeholder="Enter your password"
          required
          type="password"
          value={formData.password}
        />
      </div>

      <button className="btn-submit" disabled={busy} type="submit">
        {busy ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}

function RegisterForm({ busy, onSubmit }) {
  const [formData, setFormData] = useState({
    inviteCode: "",
    username: "",
    password: "",
  });

  function handleChange(event) {
    const { name, value } = event.target;
    setFormData((current) => ({
      ...current,
      [name]: value,
    }));
  }

  function handleSubmit(event) {
    event.preventDefault();
    onSubmit({
      inviteCode: formData.inviteCode.trim(),
      username: formData.username.trim(),
      password: formData.password,
    });
  }

  return (
    <form className="auth-form active" onSubmit={handleSubmit}>
      <div className="form-group">
        <label className="form-label" htmlFor="register-invite">
          Invite code
        </label>
        <input
          className="form-input"
          id="register-invite"
          name="inviteCode"
          onChange={handleChange}
          placeholder="Required for registration"
          required
          type="text"
          value={formData.inviteCode}
        />
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="register-username">
          Username
        </label>
        <input
          autoComplete="username"
          className="form-input"
          id="register-username"
          name="username"
          onChange={handleChange}
          placeholder="Choose a username"
          required
          type="text"
          value={formData.username}
        />
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="register-password">
          Password
        </label>
        <input
          autoComplete="new-password"
          className="form-input"
          id="register-password"
          minLength={6}
          name="password"
          onChange={handleChange}
          placeholder="At least 6 characters"
          required
          type="password"
          value={formData.password}
        />
      </div>

      <button className="btn-submit" disabled={busy} type="submit">
        {busy ? "Creating account..." : "Register"}
      </button>
    </form>
  );
}

export function AuthPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [tab, setTab] = useState(() => getInitialTab(location.search));
  const [status, setStatus] = useState({ type: "", text: "" });
  const [busy, setBusy] = useState(false);
  const todo = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get("todo");
  }, [location.search]);

  useEffect(() => {
    setTab(getInitialTab(location.search));
  }, [location.search]);

  useEffect(() => {
    if (todo && todoMessages[todo]) {
      setStatus({
        type: "success",
        text: todoMessages[todo],
      });
    } else {
      setStatus((current) =>
        current.type === "success" ? { type: "", text: "" } : current,
      );
    }
  }, [todo]);

  useEffect(() => {
    let cancelled = false;

    async function checkSession() {
      const data = await getSession().catch(() => null);
      if (!data?.loggedIn || cancelled) {
        return;
      }

      const nextPath = await resolvePostAuthRedirect();
      if (
        !cancelled &&
        location.pathname === "/auth" &&
        location.search !== nextPath.replace("/auth", "")
      ) {
        navigate(nextPath, { replace: true });
      }
    }

    checkSession();

    return () => {
      cancelled = true;
    };
  }, [location.pathname, navigate]);

  async function completeAuth(runRequest, payload, fallback) {
    setStatus({ type: "", text: "" });
    setBusy(true);

    try {
      const data = await runRequest(payload);
      if (!data?.success) {
        setStatus({
          type: "error",
          text: normalizeErrorMessage(data, fallback),
        });
        return;
      }

      const nextPath = await resolvePostAuthRedirect();
      navigate(nextPath, { replace: true });
    } catch (error) {
      setStatus({
        type: "error",
        text: error instanceof Error ? error.message : fallback,
      });
    } finally {
      setBusy(false);
    }
  }

  function selectTab(nextTab) {
    const params = new URLSearchParams(location.search);

    if (nextTab === "register") {
      params.set("tab", "register");
    } else {
      params.delete("tab");
    }

    navigate(
      {
        pathname: "/auth",
        search: params.toString() ? `?${params.toString()}` : "",
      },
      { replace: false },
    );
  }

  return (
    <section className="auth-page">
      <div className="auth-card rb-card">
        <Link aria-label="Back to home" className="auth-brand" to="/">
          <span className="auth-brand-mark">RB</span>
        </Link>

        <h1 className="auth-title">
          {tab === "login" ? "欢迎回来" : "进入她的世界"}
        </h1>
        <p className="auth-sub">
          {tab === "login"
            ? "真实后端登录已接通，后续 onboarding 先保持临时跳转。"
            : "邀请码注册已接通，后续资料页和首个角色引导还在迁移中。"}
        </p>

        <div className="auth-tabs" role="tablist" aria-label="Auth modes">
          <button
            aria-controls="auth-panel-login"
            aria-selected={tab === "login"}
            className={tab === "login" ? "auth-tab active" : "auth-tab"}
            id="auth-tab-login"
            onClick={() => selectTab("login")}
            role="tab"
            type="button"
          >
            登录
          </button>
          <button
            aria-controls="auth-panel-register"
            aria-selected={tab === "register"}
            className={tab === "register" ? "auth-tab active" : "auth-tab"}
            id="auth-tab-register"
            onClick={() => selectTab("register")}
            role="tab"
            type="button"
          >
            注册
          </button>
        </div>

        <div
          className={status.type ? `auth-msg show ${status.type}` : "auth-msg"}
          role={status.type === "error" ? "alert" : "status"}
        >
          {status.text}
        </div>

        {tab === "login" ? (
          <div
            aria-labelledby="auth-tab-login"
            id="auth-panel-login"
            role="tabpanel"
          >
            <LoginForm
              busy={busy}
              onSubmit={(payload) =>
                completeAuth(login, payload, "登录失败，请重试。")
              }
            />
          </div>
        ) : (
          <div
            aria-labelledby="auth-tab-register"
            id="auth-panel-register"
            role="tabpanel"
          >
            <RegisterForm
              busy={busy}
              onSubmit={(payload) =>
                completeAuth(register, payload, "注册失败，请重试。")
              }
            />
          </div>
        )}

        <div className="auth-foot">
          <Link to="/">返回首页</Link>
          <span className="divider">/</span>
          <span>已启用同源凭证</span>
        </div>
      </div>
    </section>
  );
}
