import express from 'express';
import { pool as defaultPool } from './db.js';
import { asyncHandler, parseInteger } from './helpers.js';

function describeResult(result) {
  switch (result?.status) {
    case 'posted':
      if (result.imageStatus === 'generated') return '动态发图渠道正常：已发出一条测试图文动态';
      return '已试发一条文字动态';
    case 'skipped_image_unconfigured':
      return '没有发出测试动态：请先配置动态发图渠道，系统不会用纯文字顶替';
    case 'skipped_image_disabled':
      return '没有发出测试动态：请先开启动态发图，系统不会用纯文字顶替';
    case 'skipped_image_failed':
      return `图片渠道没有返回图片，本次没有用文字动态顶替${result.imageError ? `（${result.imageError}）` : ''}`;
    case 'skipped_planner':
      return '这次没有发：她判断当前聊天不适合变成动态';
    case 'skipped_no_chat_capability':
      return '无法试发：文字聊天能力还没有启用';
    default:
      return result?.error || '试发没有完成';
  }
}

function describeStatus(outcome, attemptCount, postedToday) {
  if (postedToday > 0) return '运行正常';
  if (!attemptCount) return '等待下一次判断';
  if (outcome === 'planner_skipped') return '她判断暂时不适合发';
  if (outcome === 'planner_failed') return '最近一次判断失败，稍后重试';
  if (outcome === 'image_failed') return '最近一次配图失败，稍后重试';
  if (outcome === 'image_unconfigured') return '动态发图渠道尚未配置';
  if (outcome === 'planner_started') return '正在判断';
  return '等待下一次判断';
}

export function createAutoMomentsRouter({
  pool = defaultPool,
  service
} = {}) {
  if (!service?.runScan) throw new Error('自动动态服务未初始化');

  const router = express.Router();

  router.get('/characters/:id/status', asyncHandler(async (req, res) => {
    const characterId = parseInteger(req.params.id, null);
    if (!characterId) return res.status(400).json({ success: false, error: '角色不存在' });

    const [[roles], [momentRows], [attemptRows]] = await Promise.all([
      pool.query(
        'SELECT id, auto_moments_enabled, auto_moments_daily_min, auto_moments_daily_max FROM characters WHERE id = ? AND user_id = ? AND is_deleted = 0 LIMIT 1',
        [characterId, req.userId]
      ),
      pool.query(
        'SELECT COUNT(*) AS cnt FROM moments WHERE character_id = ? AND user_id = ? AND is_deleted = 0 AND created_at >= CURDATE()',
        [characterId, req.userId]
      ),
      pool.query(
        'SELECT COUNT(*) AS cnt, SUBSTRING_INDEX(GROUP_CONCAT(outcome ORDER BY id DESC), ?, 1) AS last_outcome FROM auto_moment_attempts WHERE character_id = ? AND user_id = ? AND created_at >= CURDATE()',
        [',', characterId, req.userId]
      )
    ]);
    const role = roles[0];
    if (!role) return res.status(404).json({ success: false, error: '角色不存在或不属于当前用户' });
    const postedToday = Number(momentRows[0]?.cnt || 0);
    const attemptCount = Number(attemptRows[0]?.cnt || 0);
    const lastOutcome = String(attemptRows[0]?.last_outcome || '');

    return res.json({
      success: true,
      status: {
        enabled: Boolean(role.auto_moments_enabled),
        mode: Number(role.auto_moments_daily_min || 0) === 0 ? 'system' : 'target',
        dailyTarget: Number(role.auto_moments_daily_min || 0),
        dailyMax: Number(role.auto_moments_daily_max || 0),
        postedToday,
        attemptCount,
        lastOutcome,
        summary: describeStatus(lastOutcome, attemptCount, postedToday)
      }
    });
  }));

  router.post('/characters/:id/test', asyncHandler(async (req, res) => {
    const characterId = parseInteger(req.params.id, null);
    if (!characterId) return res.status(400).json({ success: false, error: '角色不存在' });

    const [roles] = await pool.query(
      'SELECT id, name, auto_moments_enabled FROM characters WHERE id = ? AND user_id = ? AND is_deleted = 0 LIMIT 1',
      [characterId, req.userId]
    );
    const role = roles[0];
    if (!role) return res.status(404).json({ success: false, error: '角色不存在或不属于当前用户' });
    if (!Number(role.auto_moments_enabled)) {
      return res.status(400).json({ success: false, error: '请先保存并开启主动发动态' });
    }

    const [result] = await service.runScan({ characterId, ignoreLimits: true, forceChannelTest: true });
    if (!result || result.status === 'failed') {
      return res.status(502).json({ success: false, error: result?.error || '试发失败' });
    }

    return res.json({ success: true, result, message: describeResult(result) });
  }));

  return router;
}
