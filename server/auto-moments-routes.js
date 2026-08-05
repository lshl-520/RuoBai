import express from 'express';
import { pool as defaultPool } from './db.js';
import { asyncHandler, parseInteger } from './helpers.js';

function describeResult(result) {
  switch (result?.status) {
    case 'posted':
      if (result.imageStatus === 'generated') return '动态发图渠道正常：已发出一条测试图文动态';
      if (result.imageStatus === 'dynamic_unconfigured') return '已发测试文字动态：动态发图还没有配置';
      if (result.imageStatus === 'failed') return `已发测试文字动态：图片渠道调用失败${result.imageError ? `（${result.imageError}）` : ''}`;
      if (result.imageStatus === 'planner_text_only') return '已试发文字动态：这次由她决定不配图';
      return '已试发一条文字动态';
    case 'skipped_planner':
      return '这次没有发：她判断当前聊天不适合变成动态';
    case 'skipped_no_chat_capability':
      return '无法试发：文字聊天能力还没有启用';
    default:
      return result?.error || '试发没有完成';
  }
}

export function createAutoMomentsRouter({
  pool = defaultPool,
  service
} = {}) {
  if (!service?.runScan) throw new Error('自动动态服务未初始化');

  const router = express.Router();

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
