import React from "react";
import { NavLink, Outlet } from "react-router-dom";
import { ThemeToggle } from "./ThemeToggle.jsx";

export function AppLayout() {
  return (
    <div className="rb-app">
      <header className="rb-topbar">
        <div className="rb-brand">
          <img
            alt="RuoBai brand avatar"
            className="rb-brand-avatar"
            src="/images/brand-avatar.png"
          />
          <div>
            <p className="rb-brand-title">RuoBai</p>
            <p className="rb-brand-sub">RuoBai</p>
          </div>
        </div>

        <nav className="rb-nav" aria-label="Primary">
          <NavLink
            className={({ isActive }) =>
              isActive ? "rb-nav-link active" : "rb-nav-link"
            }
            to="/"
          >
            Home
          </NavLink>
          <NavLink
            className={({ isActive }) =>
              isActive ? "rb-nav-link active" : "rb-nav-link"
            }
            to="/chat"
          >
            Chat
          </NavLink>
          <NavLink
            className={({ isActive }) =>
              isActive ? "rb-nav-link active" : "rb-nav-link"
            }
            to="/auth"
          >
            Auth
          </NavLink>
        </nav>

        <ThemeToggle />
      </header>

      <main className="rb-shell">
        <Outlet />
      </main>
    </div>
  );
}
