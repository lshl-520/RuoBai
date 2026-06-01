import { NavLink, Outlet } from "react-router-dom";
import { ThemeToggle } from "./ThemeToggle.jsx";

export function AppLayout() {
  return (
    <div className="rb-app">
      <header className="rb-topbar">
        <div className="rb-brand">
          <span className="rb-brand-mark">RB</span>
          <div>
            <p className="rb-brand-title">RuoBai React</p>
            <p className="rb-brand-sub">Mainline migration shell</p>
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
