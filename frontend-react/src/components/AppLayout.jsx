import React from "react";
import { NavLink, Outlet } from "react-router-dom";
import { ThemeToggle } from "./ThemeToggle.jsx";

export function AppLayout() {
  return (
    <div className="rb-app">
      <header className="rb-topbar">
        <div className="rb-brand">
          <img
            alt="若白头像"
            className="rb-brand-avatar"
            src="/images/brand-avatar.png"
          />
          <div>
            <p className="rb-brand-title">若白</p>
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
            首页
          </NavLink>
          <NavLink
            className={({ isActive }) =>
              isActive ? "rb-nav-link active" : "rb-nav-link"
            }
            to="/auth"
          >
            进入
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
