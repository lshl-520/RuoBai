import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  clampIntimacy,
  getRolePortraitSrc,
  getRoles,
  getRoleSnippet,
} from "../lib/roles.js";

function RoleAvatar({ role }) {
  const [imageHidden, setImageHidden] = useState(false);
  const portraitSrc = getRolePortraitSrc(role);
  const fallback = String(role?.name ?? "R").trim().charAt(0) || "R";

  useEffect(() => {
    setImageHidden(false);
  }, [portraitSrc]);

  return (
    <div aria-hidden="true" className="chat-role-avatar">
      {portraitSrc && !imageHidden ? (
        <img
          alt=""
          className="chat-role-avatar-image"
          onError={() => setImageHidden(true)}
          src={portraitSrc}
        />
      ) : (
        <span className="chat-role-avatar-fallback">{fallback}</span>
      )}
    </div>
  );
}

function ChatRoleCard({ active, role }) {
  const intimacy = clampIntimacy(role.intimacy);
  const snippet = getRoleSnippet(role);

  return (
    <Link
      className={active ? "chat-role-card active" : "chat-role-card"}
      to={`/chat/${encodeURIComponent(role.id)}`}
    >
      <RoleAvatar role={role} />

      <div className="chat-role-content">
        <div className="chat-role-top">
          <div className="chat-role-name-row">
            <span className="chat-role-name">{role.name}</span>
            {role.tag ? <span className="chat-role-tag">{role.tag}</span> : null}
          </div>
          {active ? <span className="chat-role-active-pill">当前聊天</span> : null}
        </div>

        {snippet ? <p className="chat-role-snippet">{snippet}</p> : null}

        <div
          aria-label={`亲密度 ${intimacy}`}
          className="chat-role-intimacy"
        >
          <div className="chat-role-intimacy-track">
            <div
              className="chat-role-intimacy-fill"
              style={{ width: `${intimacy}%` }}
            />
          </div>
          <span className="chat-role-intimacy-label">{`亲密 ${intimacy}`}</span>
        </div>
      </div>
    </Link>
  );
}

export function ChatListPage() {
  const navigate = useNavigate();
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [needsAuth, setNeedsAuth] = useState(false);
  const requestSeqRef = React.useRef(0);

  useEffect(() => {
    let cancelled = false;

    async function loadRoles({ showSpinner = true } = {}) {
      const requestId = requestSeqRef.current + 1;
      requestSeqRef.current = requestId;
      if (showSpinner) {
        setLoading(true);
      }
      setError("");

      try {
        const data = await getRoles();

        if (data?.success === false) {
          const authLikeError = String(data?.error ?? "");
          if (authLikeError.includes("登录")) {
            if (!cancelled && requestSeqRef.current === requestId) {
              setNeedsAuth(true);
              setRoles([]);
            }
            return;
          }

          throw new Error(authLikeError || "角色列表读取失败。");
        }

        if (!Array.isArray(data?.items)) {
          throw new Error("角色列表返回格式不对。");
        }

        if (!cancelled && requestSeqRef.current === requestId) {
          setNeedsAuth(false);
          setRoles(data.items);
        }
      } catch (loadError) {
        if (!cancelled && requestSeqRef.current === requestId) {
          setRoles([]);
          const message =
            loadError instanceof Error
              ? loadError.message
              : "角色列表读取失败。";

          if (message.includes("401")) {
            setNeedsAuth(true);
            setError("");
          } else {
            setError(message);
          }
        }
      } finally {
        if (!cancelled && requestSeqRef.current === requestId && showSpinner) {
          setLoading(false);
        }
      }
    }

    function handleWindowFocus() {
      loadRoles({ showSpinner: false });
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        loadRoles({ showSpinner: false });
      }
    }

    loadRoles();
    window.addEventListener("focus", handleWindowFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", handleWindowFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  const activeRoleId = useMemo(() => {
    const activeRole = roles.find((role) => Boolean(role?.is_active));
    return activeRole ? String(activeRole.id) : "";
  }, [roles]);

  const activeRole = useMemo(
    () => roles.find((role) => String(role.id) === activeRoleId) || null,
    [activeRoleId, roles],
  );
  const visibleRoles = useMemo(() => {
    if (!activeRoleId) {
      return roles;
    }

    return roles.filter((role) => String(role.id) !== String(activeRoleId));
  }, [activeRoleId, roles]);

  return (
    <section className="chat-list-page">
      <div className="rb-card chat-list-hero">
        <div>
          <p className="chat-list-kicker">聊天列表</p>
          <h1 className="chat-list-title">先选一个她，继续往聊天室主线走。</h1>
          <p className="chat-list-subtitle">
            这里会直接展示你现在能聊天的角色。点进任意一个她，就能继续把对话接上。
          </p>
          {activeRole ? (
            <div className="chat-list-hero-actions">
              <Link
                className="primary-link chat-list-hero-btn"
                to={`/chat/${encodeURIComponent(activeRole.id)}`}
              >
                继续和 {activeRole.name} 聊天
              </Link>
            </div>
          ) : null}
        </div>
        <div className="chat-list-summary">
          <span className="chat-list-summary-label">角色数</span>
          <strong>{loading ? "--" : roles.length}</strong>
        </div>
      </div>

      {activeRole ? (
        <div className="rb-card chat-list-current-card">
          <div className="chat-list-current-head">
            <span className="chat-list-current-label">当前活跃</span>
            <span className="chat-list-current-sub">现在正在陪着你的，是她</span>
          </div>
          <ChatRoleCard active role={activeRole} />
        </div>
      ) : null}

      <div className="chat-list-section">
          <div className="chat-list-section-head">
            <div>
              <h2>聊天入口</h2>
              <p>从这里选一个她，就能继续把你们的对话接起来。</p>
            </div>
          </div>

        {!loading && needsAuth ? (
          <div className="rb-card chat-list-feedback auth-required">
            <p>要先登录，才能看到你和她们的聊天入口。</p>
            <div className="chat-list-auth-actions">
              <button
                className="primary-link chat-list-auth-btn"
                onClick={() => navigate("/auth")}
                type="button"
              >
                去登录
              </button>
              <Link className="secondary-link chat-list-auth-btn" to="/">
                返回首页
              </Link>
            </div>
          </div>
        ) : null}

        {loading ? (
          <div className="rb-card chat-list-feedback">
            <p>正在拿聊天入口列表...</p>
          </div>
        ) : null}

        {!loading && !needsAuth && error ? (
          <div className="rb-card chat-list-feedback error" role="alert">
            <p>{error}</p>
          </div>
        ) : null}

        {!loading && !needsAuth && !error && roles.length === 0 ? (
          <div className="rb-card chat-list-feedback">
            <p>你现在还没有角色，先去创建一个她。</p>
            <div className="chat-list-auth-actions">
              <Link className="primary-link chat-list-auth-btn" to="/characters?onboard=first-role">
                去创建角色
              </Link>
            </div>
          </div>
        ) : null}

        {!loading && !needsAuth && !error && visibleRoles.length > 0 ? (
          <div className="chat-role-list">
            {visibleRoles.map((role) => (
              <ChatRoleCard
                active={String(role.id) === activeRoleId}
                key={role.id}
                role={role}
              />
            ))}
          </div>
        ) : null}

        {!loading && !needsAuth && !error && roles.length > 0 && visibleRoles.length === 0 ? (
          <div className="rb-card chat-list-feedback">
            <p>现在这里只有她在陪你。</p>
            <div className="chat-list-auth-actions">
              <Link className="secondary-link chat-list-auth-btn" to="/characters">
                再去看看其她人
              </Link>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
