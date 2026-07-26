import { randomBytes } from 'node:crypto';
import express from 'express';
import bcrypt from 'bcryptjs';
import { pool, withTransaction } from './db.js';
import { asyncHandler, parseInteger } from './helpers.js';
import { createUpdateService } from './admin-update.js';
import { getVectorMemoryStatus } from './vector-memory/status.js';

function buildInviteCode(now = new Date()) {
  const year = now.getFullYear();
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = randomBytes(6);
  let suffix = '';

  for (const byte of bytes) {
    suffix += alphabet[byte % alphabet.length];
  }

  return `RB-${year}-${suffix}`;
}

function mapInvite(row) {
  return {
    code: row.code,
    note: row.note || '',
    status: row.status,
    created_at: row.created_at,
    used_by: row.used_by,
    used_at: row.used_at
  };
}

async function getInviteByCode(db, code) {
  const [rows] = await db.query(
    `
      SELECT code, note, status, created_at, used_by, used_at
      FROM invites
      WHERE code = ?
      LIMIT 1
    `,
    [code]
  );

  return rows[0] || null;
}

export function createAdminRouter({
  pool: db = pool,
  withTransaction: transaction = withTransaction,
  now = () => new Date(),
  updateService = createUpdateService(),
  vectorMemoryStatus = getVectorMemoryStatus
} = {}) {
  const router = express.Router();

  router.get('/invites', asyncHandler(async (_req, res) => {
    const [rows] = await db.query(
      `
        SELECT code, note, status, created_at, used_by, used_at
        FROM invites
        ORDER BY created_at DESC, code DESC
      `,
      []
    );

    return res.json({
      success: true,
      items: rows.map(mapInvite)
    });
  }));

  router.post('/invites', asyncHandler(async (req, res) => {
    const note = String(req.body?.note || '').trim();
    const code = buildInviteCode(now());

    await db.query(
      `
        INSERT INTO invites (code, note, status, created_at, used_by, used_at)
        VALUES (?, ?, 'unused', NOW(), NULL, NULL)
      `,
      [code, note]
    );

    const created = await getInviteByCode(db, code);

    return res.status(201).json({
      success: true,
      item: mapInvite(created)
    });
  }));

  router.delete('/invites/:code', asyncHandler(async (req, res) => {
    const code = String(req.params.code || '').trim();
    if (!code) {
      return res.status(400).json({ success: false, error: '邀请码不能为空' });
    }

    const [result] = await db.query(
      `UPDATE invites SET status = 'revoked' WHERE code = ?`,
      [code]
    );

    if (!result.affectedRows) {
      return res.status(404).json({ success: false, error: '邀请码不存在' });
    }

    return res.json({ success: true });
  }));

  router.get('/users', asyncHandler(async (_req, res) => {
    const [rows] = await db.query(
      `
        SELECT
          u.id,
          u.username,
          u.role,
          u.is_enabled,
          u.created_at,
          u.last_login,
          COUNT(DISTINCT c.id) AS roles_count,
          COUNT(DISTINCT m.id) AS messages_count
        FROM users u
        LEFT JOIN characters c
          ON c.user_id = u.id AND c.is_deleted = 0
        LEFT JOIN messages m
          ON m.user_id = u.id AND m.is_active = 1
        GROUP BY u.id, u.username, u.role, u.is_enabled, u.created_at, u.last_login
        ORDER BY u.created_at DESC, u.id DESC
      `
    );

    const items = rows.map(row => ({
      id: row.id,
      username: row.username,
      role: row.role,
      status: Number(row.is_enabled || 0) === 1 ? 'active' : 'banned',
      created_at: row.created_at,
      last_login: row.last_login,
      roles_count: Number(row.roles_count || 0),
      messages_count: Number(row.messages_count || 0)
    }));

    const stats = items.reduce(
      (accumulator, item) => {
        accumulator.role_counts[item.role] = (accumulator.role_counts[item.role] || 0) + 1;
        accumulator.total_messages += item.messages_count;
        return accumulator;
      },
      { role_counts: {}, total_messages: 0 }
    );

    return res.json({
      success: true,
      items,
      stats
    });
  }));

  router.patch('/users/:id', asyncHandler(async (req, res) => {
    const userId = parseInteger(req.params.id);
    if (!userId) {
      return res.status(400).json({ success: false, error: '用户 ID 非法' });
    }

    const { status, username, password } = req.body || {};
    const updates = [];
    const params = [];

    if (status && ['active', 'banned'].includes(status)) {
      updates.push('is_enabled = ?');
      params.push(status === 'active' ? 1 : 0);
    }

    if (username && typeof username === 'string' && username.trim()) {
      const trimmed = username.trim();
      const [existing] = await pool.query('SELECT id FROM users WHERE username = ? AND id != ?', [trimmed, userId]);
      if (existing.length) {
        return res.status(400).json({ success: false, error: '用户名已被占用' });
      }
      updates.push('username = ?');
      params.push(trimmed);
    }

    if (password && typeof password === 'string') {
      if (password.length < 6) {
        return res.status(400).json({ success: false, error: '密码至少6位' });
      }
      const hash = await bcrypt.hash(password, 12);
      updates.push('password_hash = ?');
      params.push(hash);
    }

    if (!updates.length) {
      return res.status(400).json({ success: false, error: '没有可更新的字段' });
    }

    params.push(userId);
    const [result] = await pool.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
      params
    );

    if (!result.affectedRows) {
      return res.status(404).json({ success: false, error: '用户不存在' });
    }

    return res.json({ success: true });
  }));

  router.delete('/users/:id', asyncHandler(async (req, res) => {
    const userId = parseInteger(req.params.id);

    if (!userId) {
      return res.status(400).json({ success: false, error: '用户 ID 非法' });
    }
    if (userId === req.userId) {
      return res.status(400).json({ success: false, error: '不能删除 owner 自己' });
    }

    await transaction(async connection => {
      const [result] = await connection.query(
        'DELETE FROM users WHERE id = ?',
        [userId]
      );

      if (!result.affectedRows) {
        throw new Error('用户不存在');
      }
    });

    return res.json({ success: true });
  }));

  router.get('/system/status', asyncHandler(async (_req, res) => {
    const startTime = process.uptime();
    const days = Math.floor(startTime / 86400);
    const hours = Math.floor((startTime % 86400) / 3600);
    const minutes = Math.floor((startTime % 3600) / 60);

    const memUsage = process.memoryUsage();
    const memUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    const memTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);

    let dbStatus = 'normal';
    let dbVersion = 'unknown';
    try {
      const [rows] = await db.query('SELECT VERSION() as version');
      dbVersion = rows[0]?.version || 'unknown';
    } catch (err) {
      dbStatus = 'error';
    }

    const [[userCount], [characterCount], vectorMemory] = await Promise.all([
      db.query('SELECT COUNT(*) as count FROM users'),
      db.query('SELECT COUNT(*) as count FROM characters WHERE is_deleted = 0'),
      vectorMemoryStatus()
    ]);

    return res.json({
      success: true,
      data: {
        uptime: {
          days,
          hours,
          minutes,
          total_seconds: Math.floor(startTime)
        },
        memory: {
          used_mb: memUsedMB,
          total_mb: memTotalMB
        },
        database: {
          status: dbStatus,
          version: dbVersion
        },
        environment: {
          node_version: process.version,
          platform: process.platform,
          arch: process.arch
        },
        statistics: {
          total_users: userCount.count,
          total_characters: characterCount.count
        },
        vector_memory: vectorMemory,
        version: 'v1.0.0'
      }
    });
  }));

  router.post('/update-check', asyncHandler(async (_req, res) => {
    const data = await updateService.checkForUpdates();
    return res.json({ success: true, data });
  }));

  router.post('/update-apply', asyncHandler(async (_req, res) => {
    const data = await updateService.applyUpdate();
    return res.json({ success: true, data });
  }));

  router.get('/update-history', asyncHandler(async (_req, res) => {
    const items = await updateService.listHistory(10);
    return res.json({ success: true, items });
  }));

  return router;
}

export default createAdminRouter();
