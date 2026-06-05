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
            <p className="rb-brand-title">RuoBai</p>
            <p className="rb-brand-sub">RuoBai</p>
          </div>
        </div>

        <nav className="rb-nav" aria-label="主导航">
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
            to="/chat"
          >
            聊天
          </NavLink>
          <NavLink
            className={({ isActive }) =>
              isActive ? "rb-nav-link active" : "rb-nav-link"
            }
            to="/characters"
          >
            角色
          </NavLink>
          <NavLink
            className={({ isActive }) =>
              isActive ? "rb-nav-link active" : "rb-nav-link"
            }
            to="/moments"
          >
            动态
          </NavLink>
          <NavLink
            className={({ isActive }) =>
              isActive ? "rb-nav-link active" : "rb-nav-link"
            }
            to="/memory"
          >
            记忆
          </NavLink>
          <NavLink
            className={({ isActive }) =>
              isActive ? "rb-nav-link active" : "rb-nav-link"
            }
            to="/auth"
          >
            登录
          </NavLink>
          <NavLink
            className={({ isActive }) =>
              isActive ? "rb-nav-link active" : "rb-nav-link"
            }
            to="/profile"
          >
            我的
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
