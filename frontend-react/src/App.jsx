import React, { useEffect, useState } from "react";
import { themes } from "./theme/themes";

const THEME_KEY = "ruobai-react-theme";

function readTheme() {
  const saved = window.localStorage.getItem(THEME_KEY);
  return saved && themes[saved] ? saved : "guangwei";
}

export default function App() {
  const [theme, setTheme] = useState("guangwei");

  useEffect(() => {
    const nextTheme = readTheme();
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  return (
    <main className="rb-shell">
      <section className="rb-card hero-card">
        <p className="eyebrow">若白 React 主线</p>
        <h1>微光先落地，原版保留下来。</h1>
        <p className="lead">
          这不是上线替换版，而是新的正式前端主线起点。当前线上旧版继续稳定跑，React 先把骨架和主题系统站起来。
        </p>
        <div className="theme-row">
          <button
            className={theme === "guangwei" ? "theme-btn active" : "theme-btn"}
            onClick={() => setTheme("guangwei")}
          >
            微光
          </button>
          <button
            className={theme === "classic" ? "theme-btn active" : "theme-btn"}
            onClick={() => setTheme("classic")}
          >
            原版
          </button>
        </div>
      </section>

      <section className="rb-grid">
        <article className="rb-card">
          <h2>当前口径</h2>
          <ul>
            <li>React 是唯一正式新主线</li>
            <li>微光是默认主主题</li>
            <li>原版是第二主题</li>
            <li>Vue 已冻结，只保留参考</li>
          </ul>
        </article>

        <article className="rb-card">
          <h2>第一批页面</h2>
          <ul>
            <li>首页 / 登录页</li>
            <li>聊天列表 / 聊天室</li>
            <li>角色页</li>
            <li>我的页基础版</li>
          </ul>
        </article>
      </section>
    </main>
  );
}
