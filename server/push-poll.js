import crypto from 'node:crypto';
import express from 'express';

/**
 * ═══ 不依赖谷歌的「待取消息」通道（2026/9/21）═══
 *
 * 背景（已实测确认，不是猜的）：
 *   FCM 推送必须靠一条通往 Google 的长连接（mtalk.google.com:5228）。
 *   用户的网络环境下这条连接是断的 —— 真机上 ping mtalk.google.com 100% 丢包、
 *   curl 谷歌 443 端口 8 秒超时，而自己的后端正常 200。
 *   结果就是：服务器 `sendEachForMulticast` 返回 success，通知却永远到不了手机。
 *
 * 所以这里做一条绕开谷歌的备用通道：
 *   App 里跑一个前台服务，每隔几分钟用「设备密钥」来问一次
 *   「有没有她新说的话」。有就本地弹通知。
 *
 * 为什么用设备密钥而不是登录 Cookie：
 *   前台服务在 WebView 之外（Java 侧），拿不到浏览器会话；而且会话 30 天会过期。
 *   设备密钥是一个随机 64 位十六进制串，只在注册时下发一次，长期有效，
 *   泄漏了也只是能读到你自己的主动消息，不含账号密码。
 *
 * 安全边界（写下来免得以后误判）：
 *   · /pending 是**唯一**不要求登录的推送接口，鉴权完全靠 x-device-key；
 *   · 密钥按用户唯一，轮换一次旧密钥立刻失效；
 *   · 只返回 proactive_events 里她自己主动发的消息，不返回聊天正文之外的任何数据。
 */

const KEY_BYTES = 32;
const MAX_ITEMS = 20;
// 超过这个天数还没被取走的旧消息就不再补通知了，避免换机后一次炸出一堆
const MAX_BACKLOG_DAYS = 3;

export function generatePollKey() {
  return crypto.randomBytes(KEY_BYTES).toString('hex');
}

function readDeviceKey(req) {
  return String(req.headers['x-device-key'] || req.query?.key || '').trim();
}

function parseCursor(value) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

/**
 * 公开路由：不用登录，只认设备密钥。
 * 挂载在 `/api/push/poll`，并且**必须**排在 `/api/push`（要登录的那组）前面。
 */
export function createPushPollRouter({ pool } = {}) {
  if (!pool) throw new Error('createPushPollRouter 缺少数据库连接池');

  const router = express.Router();

  router.get('/pending', async (req, res, next) => {
    try {
      const key = readDeviceKey(req);
      if (key.length < 32) {
        return res.status(401).json({ success: false, error: '设备密钥无效' });
      }

      const [devices] = await pool.query(
        `
          SELECT user_id
          FROM push_poll_devices
          WHERE poll_key = ?
            AND enabled = 1
          LIMIT 1
        `,
        [key],
      );
      const device = devices[0];
      if (!device) {
        return res.status(401).json({ success: false, error: '设备密钥无效或已停用' });
      }
      const userId = device.user_id;

      await pool.query(
        'UPDATE push_poll_devices SET last_seen_at = NOW() WHERE user_id = ?',
        [userId],
      );

      const hasCursor = req.query?.since !== undefined && req.query?.since !== null;
      if (!hasCursor) {
        // 第一次来（App 刚装/刚开这个开关）：只报当前进度，不补发历史，
        // 否则用户会被一串旧消息糊一脸。
        const [latest] = await pool.query(
          'SELECT COALESCE(MAX(id), 0) AS max_id FROM proactive_events WHERE user_id = ?',
          [userId],
        );
        return res.json({
          success: true,
          items: [],
          cursor: Number(latest[0]?.max_id || 0),
        });
      }

      const since = parseCursor(req.query.since);
      const [rows] = await pool.query(
        `
          SELECT
            e.id,
            e.character_id,
            e.content,
            e.created_at,
            c.name AS character_name
          FROM proactive_events e
          LEFT JOIN characters c ON c.id = e.character_id
          WHERE e.user_id = ?
            AND e.id > ?
            AND e.viewed_at IS NULL
            AND e.status IN ('sent', 'stored', 'notification_failed')
            AND e.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
          ORDER BY e.id ASC
          LIMIT ?
        `,
        [userId, since, MAX_BACKLOG_DAYS, MAX_ITEMS],
      );

      const items = rows.map((row) => ({
        id: Number(row.id),
        character_id: Number(row.character_id),
        character_name: row.character_name || '小白',
        body: String(row.content || ''),
        created_at: row.created_at,
      }));
      const cursor = items.length ? items[items.length - 1].id : since;

      return res.json({ success: true, items, cursor });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

/**
 * 需要登录的路由：给当前用户发一把新钥匙（旧钥匙立即作废）。
 * 挂载在 `/api/push` 下面，所以路径是 `/poll-key`。
 */
export function createPushPollKeyRouter({ pool } = {}) {
  if (!pool) throw new Error('createPushPollKeyRouter 缺少数据库连接池');

  const router = express.Router();

  router.post('/poll-key', async (req, res, next) => {
    try {
      const userId = req.userId || req.session?.userId;
      if (!userId) return res.status(401).json({ success: false, error: '请先登录' });

      const platform = String(req.body?.platform || 'android').trim().slice(0, 20) || 'android';
      const key = generatePollKey();

      await pool.query(
        `
          INSERT INTO push_poll_devices
            (user_id, poll_key, platform, enabled, last_seen_at, created_at, updated_at)
          VALUES (?, ?, ?, 1, NULL, NOW(), NOW())
          ON DUPLICATE KEY UPDATE
            poll_key = VALUES(poll_key),
            platform = VALUES(platform),
            enabled = 1,
            last_seen_at = NULL,
            updated_at = NOW()
        `,
        [userId, key, platform],
      );

      return res.json({ success: true, key });
    } catch (error) {
      return next(error);
    }
  });

  router.delete('/poll-key', async (req, res, next) => {
    try {
      const userId = req.userId || req.session?.userId;
      if (!userId) return res.status(401).json({ success: false, error: '请先登录' });

      await pool.query(
        'UPDATE push_poll_devices SET enabled = 0, updated_at = NOW() WHERE user_id = ?',
        [userId],
      );
      return res.json({ success: true });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}
