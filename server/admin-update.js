import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { dbConfig as defaultDbConfig } from './db.js';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultProjectRoot = path.resolve(__dirname, '..');
const DEFAULT_BACKUP_DIR = process.env.BACKUP_DIR || path.join(defaultProjectRoot, '_manual_backups');

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatTimestamp(date) {
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate())
  ].join('') + '-' + [
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds())
  ].join('');
}

function joinBackupPath(directory, fileName) {
  if (directory.startsWith('/')) {
    return `${directory.replace(/\/+$/, '')}/${fileName}`;
  }

  return path.join(directory, fileName);
}

function trimOutput(result) {
  return String(result?.stdout || '').trim();
}

function splitLines(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
}

function formatElapsed(from, to) {
  const diffMs = Math.max(0, to.getTime() - from.getTime());
  const minutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days} 天前`;
  }
  if (hours > 0) {
    return `${hours} 小时前`;
  }
  if (minutes > 0) {
    return `${minutes} 分钟前`;
  }
  return '刚刚';
}

function sanitizeError(error) {
  const message = String(error?.message || error || '更新失败');
  return message
    .replace(/--password[=\s]\S+/gi, '--password=***')
    .replace(/MYSQL_PWD=\S+/gi, 'MYSQL_PWD=***');
}

async function defaultRunCommand(command, args, options = {}) {
  return execFileAsync(command, args, {
    cwd: options.cwd,
    env: options.env,
    timeout: options.timeout || 120000,
    maxBuffer: options.maxBuffer || 1024 * 1024 * 200
  });
}

async function defaultHealthCheck({ port = process.env.PORT || 3000, timeoutMs = 3000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/healthz`, {
      signal: controller.signal
    });
    return { ok: response.ok, status: response.status };
  } finally {
    clearTimeout(timer);
  }
}

export function createUpdateService(options = {}) {
  const projectRoot = options.projectRoot || defaultProjectRoot;
  const backupDir = options.backupDir || DEFAULT_BACKUP_DIR;
  const appName = options.appName || process.env.PM2_APP_NAME || 'ruobai';
  const dbConfig = options.dbConfig || defaultDbConfig;
  const runCommand = options.runCommand || defaultRunCommand;
  const fileSystem = options.fileSystem || fs;
  const now = options.now || (() => new Date());
  const healthCheck = options.healthCheck || defaultHealthCheck;
  const historyFile = options.historyFile || path.join(projectRoot, 'logs', 'update-history.json');

  async function run(command, args, extra = {}) {
    return runCommand(command, args, {
      cwd: extra.cwd || projectRoot,
      env: extra.env || process.env,
      timeout: extra.timeout,
      maxBuffer: extra.maxBuffer
    });
  }

  async function ensureParentDirectory(filePath) {
    await fileSystem.mkdir(path.dirname(filePath), { recursive: true });
  }

  async function pruneBackups(prefix, retentionDays) {
    const cutoff = now().getTime() - retentionDays * 24 * 60 * 60 * 1000;
    let entries = [];

    try {
      entries = await fileSystem.readdir(backupDir);
    } catch {
      return;
    }

    await Promise.all(entries
      .filter(name => name.startsWith(`${prefix}-`) && name.endsWith('.sql'))
      .map(async name => {
        const filePath = path.join(backupDir, name);
        const stat = await fileSystem.stat(filePath);
        if (stat.mtimeMs < cutoff) {
          await fileSystem.unlink(filePath);
        }
      }));
  }

  async function createDatabaseBackup({ prefix = 'update', retentionDays = 7 } = {}) {
    await fileSystem.mkdir(backupDir, { recursive: true });
    const backupFile = joinBackupPath(backupDir, `${prefix}-${formatTimestamp(now())}.sql`);
    const args = [
      '--host', dbConfig.host,
      '--port', String(dbConfig.port || 3306),
      '--user', dbConfig.user,
      '--single-transaction',
      '--routines',
      '--triggers',
      dbConfig.database
    ];

    const env = { ...process.env };
    if (dbConfig.password) {
      env.MYSQL_PWD = dbConfig.password;
    }

    const dump = await runCommand('mysqldump', args, {
      cwd: projectRoot,
      env,
      timeout: 300000,
      maxBuffer: 1024 * 1024 * 500
    });
    await fileSystem.writeFile(backupFile, dump.stdout || '', 'utf8');
    await pruneBackups(prefix, retentionDays);
    return backupFile;
  }

  async function readHistory() {
    try {
      const raw = await fileSystem.readFile(historyFile, 'utf8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async function writeHistory(items) {
    await ensureParentDirectory(historyFile);
    await fileSystem.writeFile(historyFile, JSON.stringify(items.slice(0, 50), null, 2), 'utf8');
  }

  async function appendHistory(item) {
    const history = await readHistory();
    await writeHistory([item, ...history]);
  }

  async function checkForUpdates() {
    await run('git', ['fetch', 'origin', 'main']);

    const currentHash = trimOutput(await run('git', ['rev-parse', 'HEAD']));
    const remoteHash = trimOutput(await run('git', ['rev-parse', 'origin/main']));
    const currentTimeRaw = trimOutput(await run('git', ['show', '-s', '--format=%cI', 'HEAD']));
    const remoteTimeRaw = trimOutput(await run('git', ['show', '-s', '--format=%cI', 'origin/main']));
    const behindCount = Number(trimOutput(await run('git', ['rev-list', '--count', 'HEAD..origin/main'])) || 0);
    const changedFiles = splitLines(trimOutput(await run('git', ['diff', '--name-only', 'HEAD..origin/main'])));
    const currentTime = new Date(currentTimeRaw);

    return {
      is_behind: currentHash !== remoteHash && behindCount > 0,
      current: {
        hash: currentHash,
        committed_at: currentTimeRaw
      },
      remote: {
        hash: remoteHash,
        committed_at: remoteTimeRaw
      },
      behind_count: behindCount,
      changed_files: changedFiles,
      time_since_current: Number.isNaN(currentTime.getTime())
        ? ''
        : formatElapsed(currentTime, now())
    };
  }

  async function applyUpdate() {
    const started = now();
    let previousHash = '';
    let backupFile = '';
    let packageChanged = false;

    try {
      backupFile = await createDatabaseBackup({ prefix: 'update', retentionDays: 7 });
      previousHash = trimOutput(await run('git', ['rev-parse', 'HEAD']));

      await run('git', ['pull', '--ff-only', 'origin', 'main']);
      const changedFiles = splitLines(trimOutput(await run('git', ['diff', '--name-only', previousHash, 'HEAD'])));
      packageChanged = changedFiles.some(file => /(^|\/)package(-lock)?\.json$/.test(file));

      if (packageChanged) {
        await runCommand('npm', ['install', '--production'], {
          cwd: path.join(projectRoot, 'server'),
          env: process.env,
          timeout: 300000,
          maxBuffer: 1024 * 1024 * 200
        });
      }

      await run('node', ['server/init-db.js']);
      await run('pm2', ['reload', appName]);

      const health = await healthCheck({ timeoutMs: 3000 });
      if (!health?.ok) {
        throw new Error('更新后健康检查没有通过');
      }

      const newHash = trimOutput(await run('git', ['rev-parse', 'HEAD']));
      const result = {
        success: true,
        previous_hash: previousHash,
        new_hash: newHash,
        backup_file: backupFile,
        package_changed: packageChanged,
        duration_ms: now().getTime() - started.getTime()
      };

      await appendHistory({
        status: 'success',
        at: now().toISOString(),
        previous_hash: previousHash,
        new_hash: newHash,
        backup_file: backupFile,
        duration_ms: result.duration_ms
      });

      return result;
    } catch (error) {
      const friendly = sanitizeError(error);

      if (previousHash) {
        try {
          await run('git', ['reset', '--hard', previousHash]);
          await run('pm2', ['reload', appName]);
        } catch (rollbackError) {
          await appendHistory({
            status: 'failed',
            at: now().toISOString(),
            previous_hash: previousHash,
            backup_file: backupFile,
            error: friendly,
            rollback_error: sanitizeError(rollbackError)
          });
          throw new Error(`更新失败，回滚也失败：${friendly}`);
        }
      }

      await appendHistory({
        status: 'failed',
        at: now().toISOString(),
        previous_hash: previousHash,
        backup_file: backupFile,
        error: friendly
      });
      throw new Error(`更新失败，已回滚到上一版：${friendly}`);
    }
  }

  async function listHistory(limit = 10) {
    return (await readHistory()).slice(0, limit);
  }

  return {
    checkForUpdates,
    applyUpdate,
    createDatabaseBackup,
    listHistory
  };
}

export function startDailyBackupScheduler(updateService, {
  logger = console,
  disabled = process.env.DISABLE_DAILY_BACKUP === 'true'
} = {}) {
  if (disabled) {
    return null;
  }

  let timer = null;
  const scheduleNext = () => {
    const current = new Date();
    const next = new Date(current);
    next.setHours(3, 0, 0, 0);
    if (next <= current) {
      next.setDate(next.getDate() + 1);
    }

    timer = setTimeout(async () => {
      try {
        await updateService.createDatabaseBackup({ prefix: 'daily', retentionDays: 30 });
      } catch (error) {
        logger.error(`每日数据库备份失败：${sanitizeError(error)}`);
      } finally {
        scheduleNext();
      }
    }, next.getTime() - current.getTime());
  };

  scheduleNext();
  return {
    stop() {
      if (timer) {
        clearTimeout(timer);
      }
    }
  };
}
