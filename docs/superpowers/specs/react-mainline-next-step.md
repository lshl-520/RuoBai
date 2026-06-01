# React 主线下一步

如果你是下一个接手的 AI，现在已经完成：

- React 主线设计文档
- React 主线第一阶段实施计划
- React 主线阻塞小本本
- 前端归属图
- React 主线最小壳子
- 微光 / 原版主题切换基础版
- Vue 冻结口径已在文档里定清，但 `src-vue/` 没有整体正式纳入 Git

## 现在不要误判的事

### 1. `public/`
- 还是当前线上旧版前端参考
- 暂时不要大规模重构

### 2. `src-vue/`
- 是冻结中的过渡版
- 不再继续作为主线开发
- 用户已经拍板：**不要为了冻结说明把整套 Vue 强行纳入 Git**

### 3. `frontend-react/`
- 这是现在唯一正式的新主线
- 以后新的正式前端页面都往这里做

## 下一步正确顺序

1. 先把 `public/index.html` 那套首页视觉和现有文案翻成 React 正式首页
2. 再继续登录页细化
3. React 聊天列表页壳子
4. React 聊天室壳子
5. React 角色页壳子
6. 再考虑“我的”页基础版细化

## 现在不要做的事

- 不要接通生产环境
- 不要替换线上 `lshl.fun`
- 不要大规模重写 `public/`
- 不要重做动态和记忆深层逻辑
- 不要一上来加重型 GSAP 动画
- 不要为了“看起来完整”去硬补 Vue 主线
- 不要把当前临时 React 首页占位页误当成最终首页方向

## 如果遇到问题

不要猜。

先看：

1. `E:\Ai\nvyou\RuoBai\本地管理\当前可做任务.md`
2. `E:\Ai\nvyou\RuoBai\本地管理\新对话提示词.md`
3. `E:\Ai\nvyou\RuoBai\本地管理\React主线阻塞清单.md`
4. `docs/superpowers/specs/2026-06-01-react-mainline-theme-design.md`
5. `docs/superpowers/plans/2026-06-01-react-mainline-phase1.md`

如果当前回合解决不了，就把问题记进阻塞小本本，再继续推进别的安全块。
