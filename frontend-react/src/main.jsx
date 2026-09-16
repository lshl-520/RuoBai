import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import { openNativeLocalDatabase } from "./lib/local-sqlite.js";
import "./styles/weiguang.css";
import "./styles/components.css";
import "./styles/components2.css";
import "./styles/classic-theme.css";

// 在 React 首次绘制前恢复主题，避免刷新时先闪一下微光再切到原版。
try {
  const savedTheme = localStorage.getItem("ruobai_theme");
  if (savedTheme === "classic") document.documentElement.dataset.theme = "classic";
  else delete document.documentElement.dataset.theme;
} catch {}

// 第一阶段只在原生壳里创建空库与表结构。初始化失败不阻断现有远程页面，
// 便于先通过本机日志验证插件，再继续做离线页面接入。
openNativeLocalDatabase().catch((error) => {
  console.warn("[local-storage] SQLite 初始化失败", error?.message || error);
});

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
