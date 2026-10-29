import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import { openNativeLocalDatabase } from "./lib/local-sqlite.js";
import "./styles/weiguang.css";
import "./styles/components.css";
import "./styles/components2.css";
import "./styles/classic-theme.css";
import "./styles/shell-v2.css";
import "./styles/qingyu-skin.css";
import "./styles/qingyu-call.css";

// 在 React 首次绘制前恢复主题，避免刷新时先闪一下微光再切到原版。
try {
  const savedTheme = localStorage.getItem("ruobai_theme");
  if (savedTheme === "classic") document.documentElement.dataset.theme = "classic";
  else delete document.documentElement.dataset.theme;

  // 轻语是默认外观；?ui=classic 或主题里选回旧皮肤时摘掉，旧外观不受影响。
  const query = new URLSearchParams(window.location.search);
  // 先把显式选择记下来，再判断，否则旧的 localStorage 会顶住 ?ui=classic。
  if (query.get("ui") === "classic") localStorage.setItem("ruobai_shell", "classic");
  if (query.get("ui") === "v2") localStorage.setItem("ruobai_shell", "v2");
  const wantV2 = localStorage.getItem("ruobai_shell") !== "classic";
  if (wantV2) document.documentElement.dataset.skin = "qingyu";
  else delete document.documentElement.dataset.skin;
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