import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import "./styles/weiguang.css";
import "./styles/components.css";
import "./styles/components2.css";
import "./styles/classic-theme.css";
import { createLive2DRuntime } from "./lib/live2d-runtime.js";

// 运行时只负责播放当前角色自己的模型文件，缺少 Cubism Core 时由舞台回退为预览图。
try {
  globalThis.__RUOBAI_LIVE2D_RUNTIME__ = createLive2DRuntime();
} catch {}

// 在 React 首次绘制前恢复主题，避免刷新时先闪一下微光再切到原版。
try {
  const savedTheme = localStorage.getItem("ruobai_theme");
  if (savedTheme === "classic") document.documentElement.dataset.theme = "classic";
  else delete document.documentElement.dataset.theme;
} catch {}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
