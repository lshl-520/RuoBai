import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { DEFAULT_THEME, THEME_KEY, themes } from "./themes.js";

const ThemeContext = createContext({
  theme: DEFAULT_THEME,
  setTheme: () => {},
  themes,
});

function readTheme() {
  if (typeof window === "undefined") {
    return DEFAULT_THEME;
  }

  const saved = window.localStorage.getItem(THEME_KEY);
  return saved && themes[saved] ? saved : DEFAULT_THEME;
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(readTheme);

  useEffect(() => {
    let cancelled = false;

    async function loadSavedTheme() {
      try {
        const response = await fetch("/api/settings", {
          credentials: "same-origin",
        });
        const data = await response.json().catch(() => null);
        const nextTheme = String(data?.item?.theme || "").trim();

        if (!cancelled && themes[nextTheme]) {
          setTheme(nextTheme);
        }
      } catch {
        // Not logged in or settings unavailable: keep local theme.
      }
    }

    loadSavedTheme();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const value = useMemo(
    () => ({
      theme,
      setTheme,
      themes,
    }),
    [theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
