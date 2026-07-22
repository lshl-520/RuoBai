import path from 'node:path';
import fs from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import compression from 'compression';
import session from 'express-session';
import MySQLStoreFactory from 'express-mysql-session';
import firebaseAdmin from 'firebase-admin';
import { dbConfig, pool, testDatabaseConnection } from './db.js';
import { ensureRuntimeSchema } from './schema.js';
import { requireAuth, requireOwner } from './middleware.js';
import { createAdminRouter } from './admin.js';
import { createUpdateService, startDailyBackupScheduler } from './admin-update.js';
import { createFcmSender, startProactiveScheduler } from './proactive.js';
import { createPushRouter } from './push.js';
import { startAutoMomentsScheduler } from './auto-moments.js';
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
import settingsRoutes from './settings.js';
import { attachRealtimeCallServer } from './realtime-call.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const publicDir = path.join(projectRoot, 'public');
const reactDistDir = path.join(projectRoot, 'frontend-react', 'dist');
const reactIndexFile = path.join(reactDistDir, 'index.html');
// SERVE_REACT=false 时强制走旧版HTML，哪怕dist/存在也不用
// 本地比较两套界面时在 .env 里加 SERVE_REACT=false
const serveReactEnv = process.env.SERVE_REACT;
const hasReactBuild = serveReactEnv !== 'false' && fs.existsSync(reactIndexFile);
const userAssetsDir = path.join(projectRoot, 'user_assets');
const app = express();
const requestedPort = Number(process.env.PORT) || 3000;
const updateService = createUpdateService();
const adminRoutes = createAdminRouter({ updateService });
const pushRoutes = createPushRouter({ pool });
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
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax'
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
    if (SKIP_COMPRESSION_EXTENSIONS.test(req.path)) {
      return false;
    }
    return compression.filter(req, res);
  },
}));

if (hasReactBuild) {
  app.use('/assets', express.static(path.join(reactDistDir, 'assets'), {
    maxAge: '1y',
    immutable: true,
  }));
  app.use(express.static(reactDistDir, {
    maxAge: 0,
    etag: true,
  }));
}

app.use(express.static(publicDir, {
  maxAge: '7d',
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
app.use('/api/settings', requireAuth, settingsRoutes);
app.use('/api/relationship', requireAuth, settingsRoutes);
app.use('/api/usage', requireAuth, settingsRoutes);
app.use('/api/push', requireAuth, pushRoutes);

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, error: 'API not found' });
  }

  return res.sendFile(hasReactBuild ? reactIndexFile : path.join(publicDir, 'index.html'));
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({
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
        console.log(`  默认管理员账号：admin`);
        console.log(`  默认管理员密码：123456`);
        console.log(`  ⚠️  请尽快登录后台更改账号密码`);
        console.log(`  ─────────────────────────────────\n`);
        startDailyBackupScheduler(updateService);
        startProactiveScheduler({ pool, sendPush: fcmSender });
        startAutoMomentsScheduler();
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
