import { useTheme } from "../theme/ThemeProvider.jsx";

export function ThemeToggle() {
  const { theme, setTheme, themes } = useTheme();

  return (
    <div className="theme-row" aria-label="Theme switcher">
      {Object.entries(themes).map(([key, meta]) => (
        <button
          key={key}
          className={theme === key ? "theme-btn active" : "theme-btn"}
          onClick={() => setTheme(key)}
          type="button"
        >
          {meta.name}
        </button>
      ))}
    </div>
  );
}
