import React from "react";
import { useTheme } from "../theme/ThemeProvider.jsx";

export function ThemeToggle() {
  const { theme, setTheme, themes } = useTheme();

  async function handleSwitch(nextTheme) {
    setTheme(nextTheme);

    try {
      await fetch("/api/settings", {
        method: "PATCH",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          theme: nextTheme,
        }),
      });
    } catch {
      // Keep local theme even if backend persistence is unavailable.
    }
  }

  return (
    <div className="theme-row" aria-label="Theme switcher">
      {Object.entries(themes).map(([key, meta]) => (
        <button
          key={key}
          className={theme === key ? "theme-btn active" : "theme-btn"}
          onClick={() => handleSwitch(key)}
          type="button"
        >
          {meta.name}
        </button>
      ))}
    </div>
  );
}
