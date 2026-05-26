import { parseInteger } from './helpers.js';

export function getRequestCharacterId(req) {
  return parseInteger(
    req.headers['x-character-id'] ?? req.body?.character_id ?? req.query?.character_id ?? null
  );
}

export function requireAuth(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ success: false, error: '请先登录' });
  }

  req.userId = req.session.userId;
  req.username = req.session.username;
  req.userRole = req.session.role;
  req.characterId = getRequestCharacterId(req);
  return next();
}

export function requireOwner(req, res, next) {
  if (req.userRole !== 'owner') {
    return res.status(403).json({ success: false, error: '仅 owner 可访问' });
  }

  return next();
}
