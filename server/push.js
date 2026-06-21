import express from 'express';

const VALID_PLATFORMS = new Set(['android', 'ios', 'web']);

function getUserId(req) {
  return req.userId || req.session?.userId || null;
}

function asBool(value, fallback = true) {
  if (typeof value === 'boolean') return value;
  if (value === 0 || value === '0' || value === 'false') return false;
  if (value === 1 || value === '1' || value === 'true') return true;
  return fallback;
}

function cleanToken(token) {
  return String(token || '').trim();
}

function validateToken(token) {
  return token.length >= 6 && token.length <= 768;
}

function normalizePlatform(platform) {
  const value = String(platform || 'android').trim().toLowerCase();
  return VALID_PLATFORMS.has(value) ? value : 'android';
}

function unauthorized(res) {
  return res.status(401).json({ success: false, error: '请先登录' });
}

export function createPushRouter({ pool } = {}) {
  if (!pool) throw new Error('createPushRouter 缺少数据库连接池');

  const router = express.Router();

  router.post('/devices', async (req, res, next) => {
    try {
      const userId = getUserId(req);
      if (!userId) return unauthorized(res);

      const token = cleanToken(req.body?.token);
      if (!validateToken(token)) {
        return res.status(422).json({ success: false, error: '推送 token 无效' });
      }

      const platform = normalizePlatform(req.body?.platform);
      const appVersion = String(req.body?.app_version || '').trim().slice(0, 50);

      await pool.query(
        `
          INSERT INTO push_devices
            (user_id, fcm_token, platform, app_version, enabled, last_seen_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, 1, NOW(), NOW(), NOW())
          ON DUPLICATE KEY UPDATE
            user_id = VALUES(user_id),
            platform = VALUES(platform),
            app_version = VALUES(app_version),
            enabled = 1,
            last_seen_at = NOW(),
            updated_at = NOW()
        `,
        [userId, token, platform, appVersion],
      );

      return res.status(201).json({ success: true, item: { platform, enabled: true } });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/heartbeat', async (req, res, next) => {
    try {
      const userId = getUserId(req);
      if (!userId) return unauthorized(res);

      const token = cleanToken(req.body?.token);
      if (!validateToken(token)) {
        return res.status(422).json({ success: false, error: '推送 token 无效' });
      }

      await pool.query(
        `
          UPDATE push_devices
          SET last_seen_at = NOW(), updated_at = NOW()
          WHERE user_id = ?
            AND fcm_token = ?
            AND enabled = 1
        `,
        [userId, token],
      );

      return res.json({ success: true });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/preferences', async (req, res, next) => {
    try {
      const userId = getUserId(req);
      if (!userId) return unauthorized(res);

      const [rows] = await pool.query(
        `
          SELECT proactive_enabled, bedtime_enabled, quiet_night_enabled
          FROM push_preferences
          WHERE user_id = ?
          LIMIT 1
        `,
        [userId],
      );

      const row = rows[0] || {};
      return res.json({
        success: true,
        item: {
          proactive_enabled: row.proactive_enabled == null ? true : Number(row.proactive_enabled) === 1,
          bedtime_enabled: row.bedtime_enabled == null ? true : Number(row.bedtime_enabled) === 1,
          quiet_night_enabled: row.quiet_night_enabled == null ? false : Number(row.quiet_night_enabled) === 1,
        },
      });
    } catch (error) {
      return next(error);
    }
  });

  router.patch('/preferences', async (req, res, next) => {
    try {
      const userId = getUserId(req);
      if (!userId) return unauthorized(res);

      const proactive = asBool(req.body?.proactive_enabled, true) ? 1 : 0;
      const bedtime = asBool(req.body?.bedtime_enabled, true) ? 1 : 0;
      const quietNight = asBool(req.body?.quiet_night_enabled, false) ? 1 : 0;

      await pool.query(
        `
          INSERT INTO push_preferences
            (user_id, proactive_enabled, bedtime_enabled, quiet_night_enabled, updated_at)
          VALUES (?, ?, ?, ?, NOW())
          ON DUPLICATE KEY UPDATE
            proactive_enabled = VALUES(proactive_enabled),
            bedtime_enabled = VALUES(bedtime_enabled),
            quiet_night_enabled = VALUES(quiet_night_enabled),
            updated_at = NOW()
        `,
        [userId, proactive, bedtime, quietNight],
      );

      return res.json({
        success: true,
        item: {
          proactive_enabled: proactive === 1,
          bedtime_enabled: bedtime === 1,
          quiet_night_enabled: quietNight === 1,
        },
      });
    } catch (error) {
      return next(error);
    }
  });

  router.delete('/devices/current', async (req, res, next) => {
    try {
      const userId = getUserId(req);
      if (!userId) return unauthorized(res);

      const token = cleanToken(req.body?.token);
      if (!validateToken(token)) {
        return res.status(422).json({ success: false, error: '推送 token 无效' });
      }

      await pool.query(
        `
          UPDATE push_devices
          SET enabled = 0, updated_at = NOW()
          WHERE user_id = ?
            AND fcm_token = ?
        `,
        [userId, token],
      );

      return res.json({ success: true });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}
