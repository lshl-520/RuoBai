# RuoBai

RuoBai 是一个私人 AI 伴侣项目，重点不是做一个万能聊天框，而是做一个能长期陪伴、能记住你、能按角色关系慢慢相处的小型网站。

这个项目适合自己部署后给自己和少量朋友使用。注册默认走邀请码模式，每个用户自己配置自己的模型密钥，项目本身不内置公共模型额度。

## 它能做什么

- 聊天：用户可以创建角色，并和角色进行连续对话。
- 长期记忆：可以给角色写入记忆，聊天时会把相关记忆带进去。
- 动态：角色可以写动态草稿，也可以在动态页展示互动内容。
- 角色：支持角色资料、头像、立绘、关系设定等。
- 语音：支持浏览器自带朗读，也支持用户自己接入外部语音模型。
- 多用户：支持邀请码注册，适合自用和少量朋友一起用。

## 适合谁

- 想自己搭一个私人 AI 伴侣网站的人。
- 想保留自己数据，不想把聊天记录放进第三方成品应用的人。
- 愿意自己准备模型密钥、自己管理服务器的人。

如果只是想点开就用的商业软件，这个项目不适合。

## 部署前准备

需要准备这些东西：

- Node.js 20 或更新版本。
- MariaDB 或 MySQL 数据库。
- 一个可以访问的域名。
- 服务器上安装好 npm 和 pm2。
- 你自己的模型密钥，例如 DeepSeek、Grok 或其他兼容接口。

## 第一次部署

先进入后端目录安装依赖：

```bash
cd server
npm install
```

复制配置样例，再按你的服务器情况填写：

```bash
cp .env.example .env
```

至少需要确认这些配置：

```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=你的数据库密码
DB_NAME=ruobai
SESSION_SECRET=换成一串很长的随机字符
PORT=3000
CORS_ORIGINS=https://你的域名,https://www.你的域名
BETA_REGISTRATION_ENABLED=true
OPEN_SOURCE_SINGLE_USER=false
```

初始化数据库：

```bash
node init-db.js
```

编译 React 前端（在项目根目录）：

```bash
cd frontend-react
npm install
npm run build
cd ..
```

本地或服务器直接启动：

```bash
cd server
npm start
```

生产环境建议在项目根目录用 pm2 启动：

```bash
pm2 start ecosystem.config.js
pm2 save
```

## 用户自己的模型密钥

RuoBai 采用 BYOK 模式，也就是“用户自己带密钥”。每个用户登录后，在“我的页”里配置自己的模型密钥。这样项目不会替所有人承担模型费用，也不会把某一个人的密钥共享给其他用户。

公开仓库不会保存任何真实密钥。请不要把 `server/.env`、数据库备份、聊天图片、头像、语音缓存提交到公开仓库。

## 前端说明

- `frontend-react/`：当前正式主线，React + Vite，微光主题。部署时需要编译。
- `public/`：原版 HTML 前端，作为备用第二主题保留。
- `src-vue/`：已冻结的过渡版，不再开发。

## 重要目录

- `frontend-react/`：React 前端主线（部署前需编译）。
- `public/`：原版 HTML 前端（备用第二主题）。
- `server/`：后端服务和数据库初始化脚本。
- `server/vector-memory/`：可选的向量记忆模块（让角色记住长期对话）。
- `docs/`：部署指南和开源说明。
- `user_assets/`：运行时用户上传内容，本地保留，公开仓库不保存。

## 更多文档

- `docs/部署指南.md`
- `docs/开源与隐私说明.md`

## 赞助鸣谢

- A ulak：赞助 Claude Code，支持项目持续开发。
- 次元猫/Ciyuancat：赞助中转旗舰月卡，支持模型调试和连通性测试。
- upup：赞助 Grok 中转，支持日常聊天主力模型。

## 许可证

本项目使用 CC BY-NC 4.0 协议。

你可以非商业使用、学习、修改和分享，但必须保留署名，并说明改动。禁止商业使用，尤其禁止拿这个项目包装成割韭菜类付费陪伴服务。
