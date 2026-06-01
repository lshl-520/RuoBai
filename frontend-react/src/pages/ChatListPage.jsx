import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
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
      to={`/chat?roleId=${encodeURIComponent(role.id)}`}
    >
      <RoleAvatar role={role} />

      <div className="chat-role-content">
        <div className="chat-role-top">
          <div className="chat-role-name-row">
            <span className="chat-role-name">{role.name}</span>
            {role.tag ? <span className="chat-role-tag">{role.tag}</span> : null}
          </div>
          {active ? <span className="chat-role-active-pill">Current</span> : null}
        </div>

        {snippet ? <p className="chat-role-snippet">{snippet}</p> : null}

        <div
          aria-label={`Intimacy ${intimacy}`}
          className="chat-role-intimacy"
        >
          <div className="chat-role-intimacy-track">
            <div
              className="chat-role-intimacy-fill"
              style={{ width: `${intimacy}%` }}
            />
          </div>
          <span className="chat-role-intimacy-label">{`Lv.${intimacy}`}</span>
        </div>
      </div>
    </Link>
  );
}

export function ChatListPage() {
  const [searchParams] = useSearchParams();
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadRoles() {
      setLoading(true);
      setError("");

      try {
        const data = await getRoles();

        if (!data?.success || !Array.isArray(data.items)) {
          throw new Error("Role list payload was not in the expected shape.");
        }

        if (!cancelled) {
          setRoles(data.items);
        }
      } catch (loadError) {
        if (!cancelled) {
          setRoles([]);
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Failed to load roles.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadRoles();

    return () => {
      cancelled = true;
    };
  }, []);

  const activeRoleId = useMemo(() => {
    const selectedRoleId = searchParams.get("roleId");

    if (selectedRoleId) {
      return selectedRoleId;
    }

    const activeRole = roles.find((role) => Boolean(role?.is_active));
    return activeRole ? String(activeRole.id) : "";
  }, [roles, searchParams]);

  return (
    <section className="chat-list-page">
      <div className="rb-card chat-list-hero">
        <div>
          <p className="chat-list-kicker">Chat Lobby</p>
          <h1 className="chat-list-title">Pick a role to continue the mainline.</h1>
          <p className="chat-list-subtitle">
            This route is backed by the real <code>/api/roles</code> response.
            For now, selecting a card keeps us on <code>/chat</code> and records
            the role with a query param until the room route is ready.
          </p>
        </div>
        <div className="chat-list-summary">
          <span className="chat-list-summary-label">Roles</span>
          <strong>{loading ? "--" : roles.length}</strong>
        </div>
      </div>

      <div className="chat-list-section">
        <div className="chat-list-section-head">
          <div>
            <h2>Available Roles</h2>
            <p>Only fields already provided by the API are shown here.</p>
          </div>
        </div>

        {loading ? (
          <div className="rb-card chat-list-feedback">
            <p>Loading role list...</p>
          </div>
        ) : null}

        {!loading && error ? (
          <div className="rb-card chat-list-feedback error" role="alert">
            <p>{error}</p>
          </div>
        ) : null}

        {!loading && !error && roles.length === 0 ? (
          <div className="rb-card chat-list-feedback">
            <p>No roles are available yet.</p>
          </div>
        ) : null}

        {!loading && !error && roles.length > 0 ? (
          <div className="chat-role-list">
            {roles.map((role) => (
              <ChatRoleCard
                active={String(role.id) === activeRoleId}
                key={role.id}
                role={role}
              />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
