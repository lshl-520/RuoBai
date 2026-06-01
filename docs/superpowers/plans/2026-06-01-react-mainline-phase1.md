# React Mainline Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Safely start the RuoBai React mainline inside the current repository without disturbing the current HTML production path, while establishing backup points, a blocker notebook, and the first React shell with dual-theme foundations.

**Architecture:** Keep `public/` as the old production reference, freeze `src-vue/`, and create a new `frontend-react/` app as the only formal new frontend line. Phase 1 does not replace production; it only creates safety rails plus the first React shell for home/auth/theme switching.

**Tech Stack:** Git, React, Vite, CSS variables, optional GSAP deferred for later phases, existing Node/MariaDB backend left untouched in this phase.

---

### Task 1: Create Safety Rails Before Any Frontend Migration

**Files:**
- Create: `docs/superpowers/specs/2026-06-01-react-mainline-theme-design.md` (already exists; verify only)
- Create: `E:\Ai\nvyou\RuoBai\本地管理\React主线阻塞清单.md`
- Modify: `README.md`
- Modify: `.gitignore`

- [ ] **Step 1: Verify the design spec file exists before execution starts**

Run:

```powershell
Test-Path 'E:\Ai\nvyou\RuoBai\Ruobai\docs\superpowers\specs\2026-06-01-react-mainline-theme-design.md'
```

Expected: `True`

- [ ] **Step 2: Create the blocker notebook file**

Add this exact file content to `E:\Ai\nvyou\RuoBai\本地管理\React主线阻塞清单.md`:

```md
# React 主线阻塞清单

这份文件专门记：

- 暂时搞不定的问题
- 不确定但不能猜的问题
- 风险太高所以先停下的问题
- 以后要请 Claude 或其他 AI 外援接力的问题

使用规则：

1. 不准把“没做成”藏在对话里不记。
2. 不准靠猜继续推进。
3. 每条阻塞都要写：
   - 日期
   - 问题是什么
   - 已做到哪
   - 为什么先停
   - 下次继续要看什么文件

---

## 当前为空

- 还没有正式记录的 React 主线阻塞项。
```

- [ ] **Step 3: Allow future plan/spec files to be versioned without opening all docs**

Update `.gitignore` from:

```gitignore
docs/*
!docs/.gitkeep
!docs/部署指南.md
!docs/开源与隐私说明.md
```

to:

```gitignore
docs/*
!docs/.gitkeep
!docs/部署指南.md
!docs/开源与隐私说明.md
!docs/superpowers/
!docs/superpowers/specs/
!docs/superpowers/specs/*.md
!docs/superpowers/plans/
!docs/superpowers/plans/*.md
```

- [ ] **Step 4: Add a short repository status note to README**

Append this exact section near the “重要目录” section in `README.md`:

```md
## 当前前端状态

- `public/`：当前线上旧版前端的本地镜像，也是原版主题参考来源。
- `src-vue/`：已冻结的过渡版，不再继续作为主线开发。
- `frontend-react/`：后续唯一正式新主线（React），默认微光主题，后续内置原版第二主题。

如果你是新的 AI 接手者，先读：

1. `E:\Ai\nvyou\RuoBai\本地管理\当前可做任务.md`
2. `E:\Ai\nvyou\RuoBai\本地管理\新对话提示词.md`
3. `docs/superpowers/specs/2026-06-01-react-mainline-theme-design.md`
```

- [ ] **Step 5: Run a minimal diff review**

Run:

```powershell
git -C 'E:\Ai\nvyou\RuoBai\Ruobai' diff -- README.md .gitignore
```

Expected: only the README and `.gitignore` changes described above

- [ ] **Step 6: Commit the safety-rail docs changes**

Run:

```powershell
git -C 'E:\Ai\nvyou\RuoBai\Ruobai' add README.md .gitignore
git -C 'E:\Ai\nvyou\RuoBai\Ruobai' commit -m "docs: prepare react mainline safety rails"
```

Expected: commit succeeds without pulling unrelated runtime files into the commit

---

### Task 2: Create a Recoverable Backup and Branch Checkpoint

**Files:**
- Create: `_manual_backups/` zip artifact outside git tracking
- Modify: none in tracked code

- [ ] **Step 1: Create a local timestamped zip backup of the full repository**

Run:

```powershell
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$src = 'E:\Ai\nvyou\RuoBai\Ruobai'
$dst = "E:\Ai\nvyou\RuoBai\Ruobai\_manual_backups\ruobai-pre-react-mainline-$stamp.zip"
Compress-Archive -Path "$src\*" -DestinationPath $dst -Force
Write-Output $dst
```

Expected: prints a `.zip` path under `_manual_backups`

- [ ] **Step 2: Verify the backup archive exists**

Run:

```powershell
Get-ChildItem 'E:\Ai\nvyou\RuoBai\Ruobai\_manual_backups\ruobai-pre-react-mainline-*.zip' | Sort-Object LastWriteTime -Descending | Select-Object -First 1 FullName,Length
```

Expected: one newest backup entry with a non-zero length

- [ ] **Step 3: Create a branch checkpoint before React app creation**

Run:

```powershell
git -C 'E:\Ai\nvyou\RuoBai\Ruobai' branch archive/pre-react-mainline-2026-06-01
git -C 'E:\Ai\nvyou\RuoBai\Ruobai' branch --list 'archive/pre-react-mainline-2026-06-01'
```

Expected: the branch name is listed exactly once

- [ ] **Step 4: Record the backup and branch in the blocker notebook header**

Replace the bottom of `E:\Ai\nvyou\RuoBai\本地管理\React主线阻塞清单.md` with:

```md
## 当前环境记录

- React 主线开工前备份：已创建本地 zip 备份（见 `_manual_backups/` 最新文件）
- React 主线冻结分支：`archive/pre-react-mainline-2026-06-01`

---

## 当前为空

- 还没有正式记录的 React 主线阻塞项。
```

- [ ] **Step 5: Commit the blocker notebook update only**

Run:

```powershell
git -C 'E:\Ai\nvyou\RuoBai\Ruobai' status --short
```

Expected: no repository-tracked changes from the backup zip itself; only tracked notebook changes if the notebook lives outside the repo then there is nothing to commit here

Note: `React主线阻塞清单.md` lives outside the repo, so do **not** try to commit it. This step exists to confirm the backup process did not dirty the repo unexpectedly.

---

### Task 3: Freeze Vue Semantically and Carve Out the React Ownership Boundary

**Files:**
- Create: `docs/superpowers/specs/frontend-ownership-map.md`
- Modify: `src-vue/main.js`

- [ ] **Step 1: Add an explicit freeze comment to the Vue entry**

At the very top of `src-vue/main.js`, prepend:

```javascript
// 已冻结：Vue 版不再继续作为若白前端主线开发。
// 仅保留作过渡参考，后续正式新主线迁移到 React。

```

Resulting file start should be:

```javascript
// 已冻结：Vue 版不再继续作为若白前端主线开发。
// 仅保留作过渡参考，后续正式新主线迁移到 React。

import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
```

- [ ] **Step 2: Create a plain-language ownership map file inside the repo**

Create `docs/superpowers/specs/frontend-ownership-map.md` with:

```md
# 若白前端归属图

## 现在三套东西分别是什么

### `public/`
- 当前线上旧版前端的本地镜像
- 原版主题参考来源
- 过渡期不再做大规模重构

### `src-vue/`
- 已冻结的过渡版
- 不再继续当主线开发
- 只保留作参考，后续再迁去旧主题归档

### `frontend-react/`
- 后续唯一正式新主线
- 默认微光主题
- 后续内置原版第二主题

## 工作纪律

- 不在 `src-vue/` 追加新功能
- 不在 `public/` 做大规模视觉重构
- 新的正式前端页面一律落到 `frontend-react/`
- 看旧逻辑可以参考 HTML/Vue，但不要顺手继续在那里开发
```

- [ ] **Step 3: Review the Vue diff only**

Run:

```powershell
git -C 'E:\Ai\nvyou\RuoBai\Ruobai' diff -- src-vue/main.js docs/superpowers/specs/frontend-ownership-map.md
```

Expected: only the freeze comment and ownership map content

- [ ] **Step 4: Commit the ownership-boundary changes**

Run:

```powershell
git -C 'E:\Ai\nvyou\RuoBai\Ruobai' add -f -- src-vue/main.js docs/superpowers/specs/frontend-ownership-map.md
git -C 'E:\Ai\nvyou\RuoBai\Ruobai' commit -m "docs: freeze vue mainline and map frontend ownership"
```

Expected: commit succeeds and does not stage unrelated Vue files

---

### Task 4: Scaffold the New React Mainline Without Touching Production

**Files:**
- Create: `frontend-react/package.json`
- Create: `frontend-react/index.html`
- Create: `frontend-react/src/main.jsx`
- Create: `frontend-react/src/App.jsx`
- Create: `frontend-react/src/styles/tokens.css`
- Create: `frontend-react/src/styles/app.css`
- Create: `frontend-react/src/theme/themes.js`

- [ ] **Step 1: Create the React app package manifest**

Create `frontend-react/package.json`:

```json
{
  "name": "ruobai-frontend-react",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.7.0",
    "vite": "^5.4.19"
  }
}
```

- [ ] **Step 2: Create the Vite HTML entry**

Create `frontend-react/index.html`:

```html
<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>若白 React 主线</title>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </head>
  <body></body>
</html>
```

Then immediately correct it in the next step so the worker notices and fixes structure intentionally.

- [ ] **Step 3: Fix the HTML structure before first run**

Replace `frontend-react/index.html` with:

```html
<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>若白 React 主线</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

- [ ] **Step 4: Create the React entry**

Create `frontend-react/src/main.jsx`:

```jsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./styles/tokens.css";
import "./styles/app.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 5: Create the first React shell with theme toggle only**

Create `frontend-react/src/App.jsx`:

```jsx
import { useEffect, useState } from "react";
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
```

- [ ] **Step 6: Create the theme definition file**

Create `frontend-react/src/theme/themes.js`:

```javascript
export const themes = {
  guangwei: {
    name: "微光",
  },
  classic: {
    name: "原版",
  },
};
```

- [ ] **Step 7: Create the shared theme token CSS**

Create `frontend-react/src/styles/tokens.css`:

```css
:root {
  --bg: #faf6f2;
  --bg-accent: #f3ebf6;
  --card: rgba(255, 255, 255, 0.88);
  --ink: #2b2528;
  --muted: #7a6f73;
  --line: rgba(43, 37, 40, 0.08);
  --primary: #c16579;
  --primary-deep: #a64f64;
  --shadow: 0 18px 50px rgba(60, 40, 45, 0.12);
  --radius: 24px;
}

:root[data-theme="guangwei"] {
  --bg: #faf6f2;
  --bg-accent: #f0edf7;
  --card: rgba(255, 255, 255, 0.88);
  --ink: #2b2528;
  --muted: #7a6f73;
  --line: rgba(43, 37, 40, 0.08);
  --primary: #c16579;
  --primary-deep: #a64f64;
}

:root[data-theme="classic"] {
  --bg: #fdf7f6;
  --bg-accent: #fbeaf0;
  --card: rgba(255, 250, 246, 0.92);
  --ink: #4b1528;
  --muted: #993556;
  --line: rgba(244, 192, 209, 0.55);
  --primary: #d4537e;
  --primary-deep: #b73d67;
}
```

- [ ] **Step 8: Create the shell styling**

Create `frontend-react/src/styles/app.css`:

```css
* {
  box-sizing: border-box;
}

html,
body,
#root {
  margin: 0;
  min-height: 100%;
}

body {
  font-family: "Microsoft YaHei", "PingFang SC", sans-serif;
  background:
    radial-gradient(circle at top right, color-mix(in srgb, var(--primary) 8%, transparent), transparent 32%),
    radial-gradient(circle at bottom left, color-mix(in srgb, var(--bg-accent) 70%, transparent), transparent 42%),
    var(--bg);
  color: var(--ink);
}

.rb-shell {
  width: min(1120px, calc(100% - 40px));
  margin: 0 auto;
  padding: 48px 0 64px;
}

.rb-card {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}

.hero-card {
  padding: 32px;
}

.eyebrow {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--primary);
  font-weight: 700;
}

.hero-card h1 {
  margin: 0 0 14px;
  font-size: clamp(32px, 4vw, 56px);
  line-height: 1.1;
}

.lead {
  margin: 0;
  max-width: 760px;
  color: var(--muted);
  line-height: 1.8;
}

.theme-row {
  display: flex;
  gap: 12px;
  margin-top: 24px;
}

.theme-btn {
  border: 1px solid var(--line);
  background: transparent;
  color: var(--ink);
  border-radius: 999px;
  padding: 10px 18px;
  cursor: pointer;
}

.theme-btn.active {
  background: var(--primary);
  color: white;
  border-color: var(--primary);
}

.rb-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
  margin-top: 24px;
}

.rb-grid .rb-card {
  padding: 24px;
}

.rb-grid h2 {
  margin-top: 0;
  margin-bottom: 12px;
}

.rb-grid ul {
  margin: 0;
  padding-left: 18px;
  color: var(--muted);
  line-height: 1.9;
}

@media (max-width: 760px) {
  .rb-shell {
    width: min(100% - 24px, 100%);
    padding: 20px 0 36px;
  }

  .hero-card,
  .rb-grid .rb-card {
    padding: 20px;
  }

  .rb-grid {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 9: Install the React dependencies**

Run:

```powershell
cd 'E:\Ai\nvyou\RuoBai\Ruobai\frontend-react'
npm install
```

Expected: `package-lock.json` created under `frontend-react/` and install exits with code 0

- [ ] **Step 10: Start the React dev server and verify it boots**

Run:

```powershell
cd 'E:\Ai\nvyou\RuoBai\Ruobai\frontend-react'
npm run dev -- --host 127.0.0.1 --port 4173
```

Expected: Vite reports a local URL on `http://127.0.0.1:4173/`

- [ ] **Step 11: Verify the page visually in the in-app browser**

Open:

```text
http://127.0.0.1:4173/
```

Expected:
- page loads
- “微光 / 原版” two buttons visible
- clicking theme buttons changes colors
- no blank screen

- [ ] **Step 12: Commit the React shell scaffold**

Run:

```powershell
git -C 'E:\Ai\nvyou\RuoBai\Ruobai' add -f -- frontend-react
git -C 'E:\Ai\nvyou\RuoBai\Ruobai' commit -m "feat: scaffold react mainline shell"
```

Expected: commit contains only the new `frontend-react/` files

---

### Task 5: Add a Plain-Language Phase Gate for the Next Worker

**Files:**
- Create: `docs/superpowers/specs/react-mainline-next-step.md`

- [ ] **Step 1: Create the next-step handoff note**

Create `docs/superpowers/specs/react-mainline-next-step.md`:

```md
# React 主线下一步

如果你是下一个接手的 AI，现在已经完成：

- 安全设计文档
- 阻塞小本本
- Vue 冻结口径
- React 主线目录
- 微光 / 原版主题切换基础壳

下一步不要乱跳，按这个顺序继续：

1. React 首页细化
2. React 登录页接入
3. React 聊天列表页壳子
4. React 聊天室壳子

不要现在就：

- 接通生产环境
- 替换线上前端
- 大规模重写 public
- 重做动态和记忆深层逻辑
- 一上来加重型 GSAP 动画
```

- [ ] **Step 2: Review all phase-1 docs together**

Run:

```powershell
git -C 'E:\Ai\nvyou\RuoBai\Ruobai' diff -- docs/superpowers/specs docs/superpowers/plans
```

Expected: only the newly created plan/spec helper docs from this phase

- [ ] **Step 3: Commit the next-step handoff note**

Run:

```powershell
git -C 'E:\Ai\nvyou\RuoBai\Ruobai' add -f -- docs/superpowers/specs/react-mainline-next-step.md docs/superpowers/plans/2026-06-01-react-mainline-phase1.md
git -C 'E:\Ai\nvyou\RuoBai\Ruobai' commit -m "docs: add react mainline phase 1 plan and handoff"
```

Expected: commit succeeds with only the plan/handoff docs

---

## Spec Coverage Check

- React 作为唯一主框架：Task 3 and Task 4
- 微光默认主题 + 原版第二主题：Task 4
- Vue 冻结：Task 3
- 安全备份 / 冻结点 / 小本本：Task 1 and Task 2
- 新对话可快速理解：Task 1 and Task 5
- GSAP 暂不作为第一阶段重点： preserved by omission in Task 4 and explicit note in Task 5

## Placeholder Scan

- No `TODO`
- No `TBD`
- No “implement later” placeholders
- Commands and exact file paths provided for every actionable change

## Type and Naming Consistency

- New React app directory consistently named `frontend-react/`
- Theme ids consistently named `guangwei` and `classic`
- Safety branch consistently named `archive/pre-react-mainline-2026-06-01`

