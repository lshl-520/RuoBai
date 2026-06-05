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
  "profile-key": "登录成功。下一步先去“我的”页把模型配置好。",
  "first-role": "登录成功。下一步先去创建第一个她。",
  profile: "登录成功。现在可以先去“我的”页看看。",
};

const noticeMessages = {
  "account-updated": "账号信息已更新，请用新的登录信息重新进入。",
  "password-updated": "密码已更新，请重新登录。",
  logout: "你已经退出登录了。",
};

function getInitialTab(search) {
  const params = new URLSearchParams(search);
  return params.get("tab") === "register" ? "register" : "login";
}

function LoginForm({ busy, onInteract, onSubmit }) {
  const [formData, setFormData] = useState({
    username: "",
    password: "",
  });

  function handleChange(event) {
    const { name, value } = event.target;
    onInteract?.();
    setFormData((current) => ({
      ...current,
      [name]: value,
    }));
  }

  function handleSubmit(event) {
    event.preventDefault();
    onSubmit({
      username: formData.username.trim(),
      password: formData.password.trim(),
    });
  }

  return (
    <form className="auth-form active" onSubmit={handleSubmit}>
      <div className="form-group">
        <label className="form-label" htmlFor="login-username">
          用户名
        </label>
        <input
          autoComplete="username"
          className="form-input"
          id="login-username"
          name="username"
          onChange={handleChange}
          placeholder="请输入用户名"
          required
          type="text"
          value={formData.username}
        />
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="login-password">
          密码
        </label>
        <input
          autoComplete="current-password"
          className="form-input"
          id="login-password"
          name="password"
          onChange={handleChange}
          placeholder="请输入密码"
          required
          type="password"
          value={formData.password}
        />
      </div>

      <button className="btn-submit" disabled={busy} type="submit">
        {busy ? "正在进入..." : "进入"}
      </button>
    </form>
  );
}

function RegisterForm({ busy, onInteract, onSubmit }) {
  const [formData, setFormData] = useState({
    inviteCode: "",
    username: "",
    password: "",
  });

  function handleChange(event) {
    const { name, value } = event.target;
    onInteract?.();
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
          邀请码
        </label>
        <input
          className="form-input"
          id="register-invite"
          name="inviteCode"
          onChange={handleChange}
          placeholder="请输入邀请码"
          required
          type="text"
          value={formData.inviteCode}
        />
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="register-username">
          用户名
        </label>
        <input
          autoComplete="username"
          className="form-input"
          id="register-username"
          name="username"
          onChange={handleChange}
          placeholder="给自己起个名字"
          required
          type="text"
          value={formData.username}
        />
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="register-password">
          设置密码
        </label>
        <input
          autoComplete="new-password"
          className="form-input"
          id="register-password"
          minLength={6}
          name="password"
          onChange={handleChange}
          placeholder="至少 6 位"
          required
          type="password"
          value={formData.password}
        />
      </div>

      <button className="btn-submit" disabled={busy} type="submit">
        {busy ? "正在进入..." : "进入她的世界"}
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
  const authRequestSeqRef = React.useRef(0);
  const sessionCheckSeqRef = React.useRef(0);
  const todo = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get("todo");
  }, [location.search]);
  const notice = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get("notice");
  }, [location.search]);
  const noticeUser = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get("user") || "";
  }, [location.search]);

  useEffect(() => {
    setTab(getInitialTab(location.search));
  }, [location.search]);

  useEffect(() => {
    setStatus((current) =>
      current.type === "error" ? { type: "", text: "" } : current,
    );
  }, [tab]);

  useEffect(() => {
    if (notice && noticeMessages[notice]) {
      const text =
        notice === "account-updated" && noticeUser
          ? "账号信息已更新，请用新的用户名 " + noticeUser + " 重新进入。"
          : noticeMessages[notice];
      setStatus({
        type: "success",
        text,
      });
    } else if (todo && todoMessages[todo]) {
      setStatus({
        type: "success",
        text: todoMessages[todo],
      });
    } else {
      setStatus((current) =>
        current.type === "success" ? { type: "", text: "" } : current,
      );
    }
  }, [notice, noticeUser, todo]);

  useEffect(() => {
    let cancelled = false;

    async function checkSession() {
      const requestId = sessionCheckSeqRef.current + 1;
      sessionCheckSeqRef.current = requestId;
      const data = await getSession().catch(() => null);
      if (!data?.loggedIn || cancelled || sessionCheckSeqRef.current !== requestId) {
        return;
      }

      const nextPath = await resolvePostAuthRedirect();
      if (
        !cancelled &&
        sessionCheckSeqRef.current === requestId &&
        location.pathname === "/auth" &&
        location.search !== nextPath.replace("/auth", "")
      ) {
        navigate(nextPath, { replace: true });
      }
    }

    function handleWindowFocus() {
      checkSession();
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        checkSession();
      }
    }

    checkSession();
    window.addEventListener("focus", handleWindowFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", handleWindowFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [location.pathname, location.search, navigate]);

  async function completeAuth(runRequest, payload, fallback) {
    const requestId = authRequestSeqRef.current + 1;
    authRequestSeqRef.current = requestId;
    setStatus({ type: "", text: "" });
    setBusy(true);

    try {
      const data = await runRequest(payload);
      if (authRequestSeqRef.current !== requestId) {
        return;
      }
      if (!data?.success) {
        setStatus({
          type: "error",
          text: normalizeErrorMessage(data, fallback),
        });
        return;
      }

      const nextPath = await resolvePostAuthRedirect();
      if (authRequestSeqRef.current !== requestId) {
        return;
      }
      navigate(nextPath, { replace: true });
    } catch (error) {
      if (authRequestSeqRef.current !== requestId) {
        return;
      }
      setStatus({
        type: "error",
        text: error instanceof Error ? error.message : fallback,
      });
    } finally {
      if (authRequestSeqRef.current === requestId) {
        setBusy(false);
      }
    }
  }

  function selectTab(nextTab) {
    authRequestSeqRef.current += 1;
    setBusy(false);
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

  function invalidateAuthSubmit() {
    authRequestSeqRef.current += 1;
    setBusy(false);
  }

  return (
    <section className="auth-page">
      <div className="auth-card rb-card">
        <Link aria-label="返回首页" className="auth-brand" to="/">
          <span className="auth-brand-mark">RB</span>
        </Link>

        <h1 className="auth-title">
          {tab === "login" ? "欢迎回来" : "进入她的世界"}
        </h1>
        <p className="auth-sub">
          {tab === "login"
            ? "登录后会按你当前的状态，直接带你去聊天、角色或“我的”页。"
            : "完成注册后，你会先去创建第一个她。"}
        </p>

        <div className="auth-tabs" role="tablist" aria-label="登录或注册">
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
              onInteract={invalidateAuthSubmit}
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
              onInteract={invalidateAuthSubmit}
              onSubmit={(payload) =>
                completeAuth(register, payload, "注册失败，请重试。")
              }
            />
          </div>
        )}

        <div className="auth-foot">
          <Link to="/">返回首页</Link>
          <span className="divider">/</span>
          <span>登录状态会自动保持</span>
        </div>
      </div>
    </section>
  );
}
