import path from 'node:path';
import fs from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import compression from 'compression';
import session from 'express-session';
import MySQLStoreFactory from 'express-mysql-session';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { dbConfig, pool, testDatabaseConnection } from './db.js';
import { ensureRuntimeSchema } from './schema.js';
import { requireAuth, requireOwner } from './middleware.js';
import { createAdminRouter } from './admin.js';
import { createUpdateService, startDailyBackupScheduler } from './admin-update.js';
import { createFcmSender, startProactiveScheduler } from './proactive.js';
import { startMomentResponseScheduler } from './moment-responses.js';
import { createPushRouter } from './push.js';
import { createPushPollRouter, createPushPollKeyRouter } from './push-poll.js';
import { createAutoMomentsService, startAutoMomentsScheduler } from './auto-moments.js';
import { startDailyDigestScheduler } from './daily-digest.js';
import { createAutoMomentsRouter } from './auto-moments-routes.js';
import authRoutes from './auth.js';
import chatRoutes from './chat.js';
import memoryRoutes from './memory.js';
import rolesRoutes from './roles.js';
import modelConfigRoutes from './model-config.js';
import credentialRoutes from './credentials.js';
import capabilityRoutes from './capabilities.js';
import ttsRoutes from './tts.js';
import postsRoutes from './posts.js';
import momentRoutes from './moments.js';
import lifeEventRoutes from './life-events.js';
import proactiveEventRoutes from './proactive-events.js';
import settingsRoutes from './settings.js';
import walletRoutes from './credential-balance.js';
import mediaRoutes from './media.js';
import appUpdateRoutes from './app-updates.js';
import asrRoutes from './asr.js';
import { attachRealtimeCallServer } from './realtime-call.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
// 旧版 HTML 可选保留，用于对照；当前前端主线是 frontend-react/dist。
const legacyPublicDir = path.join(projectRoot, '旧主题归档', 'legacy-html-3.13-20260803', 'public');
const legacyIndexFile = path.join(legacyPublicDir, 'index.html');
const reactDistDir = path.join(projectRoot, 'frontend-react', 'dist');
const reactIndexFile = path.join(reactDistDir, 'index.html');
// SERVE_REACT=false 时强制走旧版 HTML，哪怕 dist/ 存在也不用。
// 本地比较两套界面时在 .env 里加 SERVE_REACT=false
const serveReactEnv = process.env.SERVE_REACT;
const hasReactBuild = fs.existsSync(reactIndexFile);
const hasLegacyBuild = fs.existsSync(legacyIndexFile);
// 旧归档被移走后，不能因为遗留的 SERVE_REACT=false 把新前端一起关掉。
const serveLegacyFrontend = hasLegacyBuild && (!hasReactBuild || serveReactEnv === 'false');
const activeFrontendIndex = serveLegacyFrontend ? legacyIndexFile : reactIndexFile;
const hasActiveFrontend = fs.existsSync(activeFrontendIndex);
const userAssetsDir = path.join(projectRoot, 'user_assets');
const app = express();
const requestedPort = Number(process.env.PORT) || 3000;
const updateService = createUpdateService();
const adminRoutes = createAdminRouter({ updateService });
const pushRoutes = createPushRouter({ pool });
// 免登录的「待取消息」通道：只认设备密钥，必须排在需要登录的 /api/push 之前，
// 否则前台服务会被 401 挡掉（见 push-poll.js 顶部说明）。
const pushPollRoutes = createPushPollRouter({ pool });
const pushPollKeyRoutes = createPushPollKeyRouter({ pool });
const autoMomentsService = createAutoMomentsService();
const autoMomentsRoutes = createAutoMomentsRouter({ pool, service: autoMomentsService });
// Keep the push module independent from the Firebase Admin SDK's ESM export shape.
const firebaseAdmin = {
  get apps() {
    return getApps();
  },
  credential: { cert },
  initializeApp,
  messaging: getMessaging,
};
const fcmSender = createFcmSender({ admin: firebaseAdmin });
const SKIP_COMPRESSION_EXTENSIONS = /\.(?:avif|webp|png|jpe?g|gif|ico|svg|mp3|mp4|webm|ogg|zip|apk)$/i;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const MySQLStore = MySQLStoreFactory(session);
const sessionStore = new MySQLStore({
  host: dbConfig.host,
  port: dbConfig.port,
  user: dbConfig.user,
  password: dbConfig.password,
  database: dbConfig.database,
  charset: dbConfig.charset,
  createDatabaseTable: false
});

const sessionMiddleware = session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET || 'ruobai-secret-change-me',
  resave: false,
  saveUninitialized: false,
  // nginx terminates TLS and forwards plain HTTP to node; trust the proxy so a
  // Secure session cookie is still set (otherwise express-session drops it) and
  // Capacitor's cross-site cookie works (see SESSION_COOKIE_CROSS_SITE).
  proxy: true,
  // Capacitor loads the bundled UI from localhost while the API stays on the
  // deployment's own domain. Enable cross-site cookies only when the deployment
  // explicitly opts in (see .env.example: CORS_ORIGINS + SESSION_COOKIE_CROSS_SITE).
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: String(process.env.SESSION_COOKIE_CROSS_SITE || '').toLowerCase() === 'true' ? 'none' : 'lax',
    secure: String(process.env.SESSION_COOKIE_CROSS_SITE || '').toLowerCase() === 'true'
  }
});

app.use(sessionMiddleware);

const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',')
  : null;

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (!allowedOrigins || !origin || allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin || '*');
    res.header('Vary', 'Origin');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type,x-character-id');
  } else {
    return res.status(403).json({ success: false, error: 'CORS 不允许' });
  }

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  return next();
});

app.use(compression({
  filter: (req, res) => {
    // SSE must reach the browser as individual chunks. Compression buffers
    // small writes and can add seconds to the first visible token.
    if (String(req.headers.accept || '').includes('text/event-stream')) {
      return false;
    }
    if (SKIP_COMPRESSION_EXTENSIONS.test(req.path)) {
      return false;
    }
    return compression.filter(req, res);
  },
}));

if (hasReactBuild && !serveLegacyFrontend) {
  app.use('/assets', express.static(path.join(reactDistDir, 'assets'), {
    maxAge: '1y',
    immutable: true,
  }));
  app.use(express.static(reactDistDir, {
    maxAge: 0,
    etag: true,
  }));
}

if (hasLegacyBuild) {
  app.use(express.static(legacyPublicDir, {
    maxAge: '7d',
    etag: true,
  }));
}
// 2026/10/14：Live2D 的模型（模型/贴图/动作）与运行库体积大、且地址每次上传都换新
// （assetId = randomUUID()；运行库路径自带版本号 cubism-5.1.0），所以给长缓存 + immutable：
// App / 浏览器第一次进房间下载，以后直接读本地缓存 —— 这就是“秒开”的关键。
// 想清掉：安卓「应用信息 → 存储 → 清除缓存」；重新上传模型会换新地址，旧缓存自然不再使用。
app.use('/user_assets/live2d', express.static(path.join(userAssetsDir, 'live2d'), {
  maxAge: '365d',
  immutable: true,
  etag: true,
}));
app.use('/user_assets/live2d-runtime', express.static(path.join(userAssetsDir, 'live2d-runtime'), {
  maxAge: '365d',
  immutable: true,
  etag: true,
}));
app.use('/user_assets', express.static(userAssetsDir, {
  maxAge: '1h',
  etag: true,
}));

app.get(['/admin', '/admin/'], (_req, res) => {
  return res.redirect(302, '/admin.html');
});

app.get('/healthz', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    return res.json({
      status: 'ok',
      uptime: process.uptime()
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

app.use('/api/app-updates', appUpdateRoutes);
app.use('/api/asr', asrRoutes);

app.use('/api/auth', authRoutes);
app.use('/api/users', authRoutes);
app.use('/api/admin', requireAuth, requireOwner, adminRoutes);
app.use('/api/chat', requireAuth, chatRoutes);
app.use('/api/messages', requireAuth, chatRoutes);
app.use('/api/memories', requireAuth, memoryRoutes);
app.use('/api/roles', requireAuth, rolesRoutes);
app.use('/api/model-configs', requireAuth, modelConfigRoutes);
app.use('/api/credentials', requireAuth, credentialRoutes);
app.use('/api/capabilities', requireAuth, capabilityRoutes);
app.use('/api/tts', requireAuth, ttsRoutes);
app.use('/api/posts', requireAuth, postsRoutes);
app.use('/api/moments', requireAuth, momentRoutes);
app.use('/api/auto-moments', requireAuth, autoMomentsRoutes);
app.use('/api/life-events', requireAuth, lifeEventRoutes);
app.use('/api/proactive-events', requireAuth, proactiveEventRoutes);
app.use('/api/settings', requireAuth, settingsRoutes);
app.use('/api/relationship', requireAuth, settingsRoutes);
app.use('/api/usage', requireAuth, settingsRoutes);
// ⑤ 钱包：渠道余额查询（只读 GET 到各凭据自己的 api_base，只存数字）
app.use('/api/wallet', requireAuth, walletRoutes);
// 免登录的待取消息接口必须排在前面：它自带设备密钥鉴权（见 push-poll.js）。
app.use('/api/push/poll', pushPollRoutes);
app.use('/api/push', requireAuth, pushPollKeyRoutes, pushRoutes);
app.use('/api/media', requireAuth, mediaRoutes);

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, error: 'API not found' });
  }

  if (!hasActiveFrontend) {
    return res.status(503).json({
      success: false,
      error: '前端构建不存在，请先运行 frontend-react 的 npm run build'
    });
  }

  return res.sendFile(activeFrontendIndex);
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(Number(error?.statusCode) || 500).json({
    success: false,
    error: error.message || '服务器内部错误'
  });
});

function listenOnPort(port) {
  return new Promise((resolve, reject) => {
    const server = createServer(app);
    attachRealtimeCallServer({ server, sessionMiddleware, pool });
    server.listen(port, () => resolve({ server, port }));
    server.on('error', reject);
  });
}

async function start() {
  try {
    await testDatabaseConnection();
    await ensureRuntimeSchema(pool);

    const fallbackLimit = process.env.PORT ? 1 : 10;
    let lastError = null;

    for (let offset = 0; offset < fallbackLimit; offset += 1) {
      const port = requestedPort + offset;

      try {
        await listenOnPort(port);
        console.log(`\n  ✨ RuoBai 启动成功`);
        console.log(`  ─────────────────────────────────`);
        console.log(`  后端接口：http://localhost:${port}/api/`);
        console.log(`  正式前台：http://localhost:${port}/`);
        console.log(`  React 开发：http://127.0.0.1:4175/`);
        console.log(`  管理后台：http://localhost:${port}/admin.html`);
        console.log(`  ─────────────────────────────────`);
        console.log(`  管理员账号：${process.env.ADMIN_INITIAL_USERNAME || 'admin'}`);
        console.log(`  初始密码：只在首次初始化时显示一次（Docker 部署见 deploy/.env 的 ADMIN_INITIAL_PASSWORD）`);
        console.log(`  ⚠️  登录后台后请尽快改成你自己的密码`);
        console.log(`  ─────────────────────────────────\n`);
        startDailyBackupScheduler(updateService);
        startProactiveScheduler({ pool, sendPush: fcmSender });
        startAutoMomentsScheduler({ service: autoMomentsService });
        startMomentResponseScheduler({ pool });
        // 每天把当天对话压成一张纸条（让她"记得住"，见 daily-digest.js 顶部说明）
        startDailyDigestScheduler({ db: pool });
        return;
      } catch (error) {
        lastError = error;
        if (error?.code !== 'EADDRINUSE') {
          throw error;
        }
      }
    }

    throw lastError || new Error('No available port found');
  } catch (error) {
    console.error(`Server startup failed: ${error.message}`);
    process.exit(1);
  }
}

await start();
