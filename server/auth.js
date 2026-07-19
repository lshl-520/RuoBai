import express from 'express';
import bcrypt from 'bcryptjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, withTransaction } from './db.js';
import { DEFAULT_CHARACTERS, DEFAULT_MODEL_CONFIG } from './defaults.js';
import { asyncHandler } from './helpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const userAvatarDir = path.join(projectRoot, 'user_assets', 'avatars');

function getUserStatus(user) {
  if (!user) {
    return null;
  }

  if (user.status) {
    return String(user.status);
  }

  return Number(user.is_enabled || 0) === 1 ? 'active' : 'banned';
}

async function insertDefaultCharacters(connection, userId) {
  for (const character of DEFAULT_CHARACTERS) {
    await connection.query(
      `
        INSERT INTO characters
          (user_id, char_key, name, tag, persona, avatar, mood, intimacy, is_active, is_deleted)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
      `,
      [
        userId,
        character.char_key,
        character.name,
        character.tag,
        character.persona,
        character.avatar,
        character.mood,
        character.intimacy,
        character.is_active
      ]
    );
  }
}

async function createUserSettings(connection, userId) {
  await connection.query(
    `
      INSERT INTO user_settings
        (user_id, theme, tts_enabled, tts_engine, tts_voice_uri, qwen_voice_id, temperature, max_tokens)
      VALUES (?, 'purple', 0, 'browser', '', '', 0.80, 2048)
      ON DUPLICATE KEY UPDATE user_id = VALUES(user_id)
    `,
    [userId]
  );
}

async function insertDefaultModelConfig(connection, userId) {
  await connection.query(
    `
      INSERT INTO model_configs
        (user_id, name, provider_type, api_base, api_key, model, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
    `,
    [
      userId,
      DEFAULT_MODEL_CONFIG.name,
      DEFAULT_MODEL_CONFIG.provider_type,
      DEFAULT_MODEL_CONFIG.api_base,
      DEFAULT_MODEL_CONFIG.api_key,
      DEFAULT_MODEL_CONFIG.model,
      DEFAULT_MODEL_CONFIG.is_active
    ]
  );
}

export function createAuthRouter({
  pool: db = pool,
  withTransaction: transaction = withTransaction,
  bcryptLib = bcrypt,
  fileStorage = fs
} = {}) {
  const router = express.Router();

  router.get('/session', asyncHandler(async (req, res) => {
    if (!req.session?.userId) {
      return res.json({
        success: true,
        loggedIn: false,
        user: null
      });
    }

    const [rows] = await db.query(
      `
        SELECT
          u.id,
          u.username,
          COALESCE(u.nickname, u.username) AS nickname,
          COALESCE(u.avatar, '') AS avatar,
          COALESCE(u.city, '') AS city,
          u.role,
          u.is_enabled,
          u.created_at,
          u.last_login,
          (
            SELECT COUNT(*)
            FROM characters c
            WHERE c.user_id = u.id AND c.is_deleted = 0
          ) AS character_count,
          (
            SELECT COALESCE(MAX(DATEDIFF(CURDATE(), c.created_at)), 0)
            FROM characters c
            WHERE c.user_id = u.id AND c.is_deleted = 0
          ) AS longest_companionship_days,
          (
            SELECT COUNT(*)
            FROM memories m
            WHERE m.user_id = u.id AND m.is_deleted = 0
          ) AS memory_count
        FROM users u
        WHERE u.id = ?
        LIMIT 1
      `,
      [req.session.userId]
    );

    const user = rows[0];
    if (!user || getUserStatus(user) !== 'active') {
      req.session.destroy?.(() => {});
      return res.json({
        success: true,
        loggedIn: false,
        user: null
      });
    }

    return res.json({
      success: true,
      loggedIn: true,
      user: {
        id: user.id,
        username: user.username,
        nickname: user.nickname || user.username,
        avatar: user.avatar || '',
        role: user.role,
        status: getUserStatus(user),
        created_at: user.created_at,
        last_login: user.last_login,
        character_count: Number(user.character_count || 0),
        longest_companionship_days: Number(user.longest_companionship_days || 0),
        memory_count: Number(user.memory_count || 0)
      }
    });
  }));

  router.post('/login', asyncHandler(async (req, res) => {
    const password = String(req.body?.password || '');
    const username = String(req.body?.username || '').trim();

    if (!username || !password) {
      return res.status(400).json({ success: false, error: '请输入用户名和密码' });
    }

    const [rows] = await db.query(
      'SELECT id, username, password_hash, role, is_enabled FROM users WHERE username = ? LIMIT 1',
      [username]
    );
    const user = rows[0];

    if (!user) {
      return res.status(401).json({ success: false, error: '用户名或密码错误' });
    }

    if (getUserStatus(user) !== 'active') {
      return res.status(403).json({ success: false, error: '账号已被封禁' });
    }

    const matched = await bcryptLib.compare(password, user.password_hash);
    if (!matched) {
      return res.status(401).json({ success: false, error: '用户名或密码错误' });
    }

    await db.query('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.role = user.role;

    return res.json({
      success: true,
      message: '登录成功',
      user: { id: user.id, username: user.username, role: user.role }
    });
  }));

  router.post('/register', asyncHandler(async (req, res) => {
    const inviteCode = String(req.body?.inviteCode || '').trim();
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');

    if (!inviteCode) {
      return res.status(400).json({ success: false, error: '请输入邀请码' });
    }
    if (!username || username.length < 2) {
      return res.status(400).json({ success: false, error: '用户名至少 2 个字' });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ success: false, error: '密码至少 6 位' });
    }

    const [inviteRows] = await db.query(
      'SELECT code, status FROM invites WHERE code = ? LIMIT 1',
      [inviteCode]
    );
    const invite = inviteRows[0];

    if (!invite || invite.status !== 'unused') {
      return res.status(400).json({ success: false, error: '邀请码无效或已失效' });
    }

    const [existingUsers] = await db.query(
      'SELECT id FROM users WHERE username = ? LIMIT 1',
      [username]
    );
    if (existingUsers.length > 0) {
      return res.status(400).json({ success: false, error: '用户名已被使用' });
    }

    const passwordHash = await bcryptLib.hash(password, 12);
    let newUserId = null;
    let role = 'user';

    await transaction(async connection => {
      const [countRows] = await connection.query('SELECT COUNT(*) AS total FROM users');
      role = Number(countRows[0]?.total || 0) === 0 ? 'owner' : 'user';

      const [result] = await connection.query(
        `
          INSERT INTO users
            (username, password_hash, role, is_enabled, daily_chat_used, created_at, last_login)
          VALUES (?, ?, ?, 1, 0, NOW(), NOW())
        `,
        [username, passwordHash, role]
      );
      newUserId = result.insertId;

      await insertDefaultCharacters(connection, newUserId);
      await insertDefaultModelConfig(connection, newUserId);
      await createUserSettings(connection, newUserId);

      const [inviteResult] = await connection.query(
        `
          UPDATE invites
          SET status = 'used', used_by = ?, used_at = NOW()
          WHERE code = ? AND status = 'unused'
        `,
        [newUserId, inviteCode]
      );

      if (!inviteResult.affectedRows) {
        throw new Error('邀请码无效或已失效');
      }
    });

    req.session.userId = newUserId;
    req.session.username = username;
    req.session.role = role;

    return res.json({
      success: true,
      message: '注册成功',
      user: { id: newUserId, username, role }
    });
  }));

  router.post('/logout', asyncHandler(async (req, res) => {
    if (!req.session) {
      return res.json({ success: true, message: '已退出登录' });
    }

    return req.session.destroy(error => {
      if (error) {
        return res.status(500).json({
          success: false,
          error: `退出失败: ${error.message}`
        });
      }

      res.clearCookie?.('connect.sid');
      return res.json({
        success: true,
        message: '已退出登录'
      });
    });
  }));

  router.post('/change-password', asyncHandler(async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ success: false, error: '请先登录' });
    }

    const oldPassword = String(req.body?.old_password || '');
    const newPassword = String(req.body?.new_password || '');
    const confirmPassword = String(req.body?.confirm_password || '');

    if (!oldPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({ success: false, error: '旧密码、新密码、确认新密码都要填' });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ success: false, error: '两次新密码不一致' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, error: '新密码至少 6 位' });
    }

    const [rows] = await db.query(
      'SELECT id, username, password_hash FROM users WHERE id = ? LIMIT 1',
      [req.session.userId]
    );
    const user = rows[0];
    if (!user) {
      return res.status(401).json({ success: false, error: '用户不存在' });
    }

    const matched = await bcryptLib.compare(oldPassword, user.password_hash);
    if (!matched) {
      return res.status(400).json({ success: false, error: '旧密码不对' });
    }

    const nextHash = await bcryptLib.hash(newPassword, 12);
    await db.query(
      'UPDATE users SET password_hash = ? WHERE id = ?',
      [nextHash, user.id]
    );

    await db.query('DELETE FROM sessions WHERE data LIKE ?', [`%"userId":${user.id}%`]);

    return res.json({
      success: true,
      message: '密码已更新'
    });
  }));

  router.patch('/me', asyncHandler(async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ success: false, error: '请先登录' });
    }

    const nickname = String(req.body?.nickname || '').trim();
    const avatarUrl = String(req.body?.avatar_url || '').trim();
    const city = String(req.body?.city ?? '').trim();

    const nextFields = [];
    const nextParams = [];

    if (nickname && nickname.length > 20) {
      return res.status(400).json({ success: false, error: '昵称最多 20 个字' });
    }

    if (nickname) {
      nextFields.push('nickname = ?');
      nextParams.push(nickname);
    }

    if (
      avatarUrl &&
      !/^\/assets\/avatar-squares\/([0-9]|1[0-7])\.png$/.test(avatarUrl) &&
      !/^\/user_assets\/avatars\/\d+-\d+\.(png|jpg|jpeg|webp)$/.test(avatarUrl)
    ) {
      return res.status(400).json({ success: false, error: '头像不在预设列表里' });
    }

    if (avatarUrl) {
      nextFields.push('avatar = ?');
      nextParams.push(avatarUrl);
    }

    if (city !== undefined) {
      if (city.length > 50) return res.status(400).json({ success: false, error: '城市名最多 50 个字' });
      nextFields.push('city = ?');
      nextParams.push(city);
    }

    if (!nextFields.length) {
      return res.status(400).json({ success: false, error: '没有需要更新的内容' });
    }

    await db.query(
      `UPDATE users SET ${nextFields.join(', ')} WHERE id = ?`,
      [...nextParams, req.session.userId]
    );

    const [rows] = await db.query(
      'SELECT id, username, nickname, avatar, city FROM users WHERE id = ? LIMIT 1',
      [req.session.userId]
    );
    const user = rows[0];

    return res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        nickname: user.nickname || user.username,
        avatar: user.avatar || ''
      }
    });
  }));

  router.post('/avatar', asyncHandler(async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ success: false, error: '请先登录' });
    }

    const imageData = String(req.body?.image_data || '').trim();
    const match = imageData.match(/^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/);
    if (!match) {
      return res.status(400).json({ success: false, error: '只支持 PNG、JPG、JPEG、WEBP 图片上传' });
    }

    const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
    const buffer = Buffer.from(match[2], 'base64');
    if (!buffer.length) {
      return res.status(400).json({ success: false, error: '图片内容是空的' });
    }

    await fileStorage.mkdir(userAvatarDir, { recursive: true });
    const filename = `${req.session.userId}-${Date.now()}.${ext}`;
    const filePath = path.join(userAvatarDir, filename);
    await fileStorage.writeFile(filePath, buffer);

    return res.json({
      success: true,
      avatar_url: `/user_assets/avatars/${filename}`
    });
  }));

  router.delete('/avatar', asyncHandler(async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ success: false, error: '请先登录' });
    }

    const avatarUrl = String(req.body?.avatar_url || '').trim();
    if (!/^\/user_assets\/avatars\/\d+-\d+\.(png|jpg|jpeg|webp)$/.test(avatarUrl)) {
      return res.status(400).json({ success: false, error: '只能删除你上传的头像' });
    }

    const filename = avatarUrl.split('/').pop();
    const [rows] = await db.query(
      'SELECT id, username, nickname, avatar FROM users WHERE id = ? LIMIT 1',
      [req.session.userId]
    );
    const user = rows[0];

    try {
      await fileStorage.unlink(path.join(userAvatarDir, filename));
    } catch {}

    if (user?.avatar === avatarUrl) {
      await db.query("UPDATE users SET avatar = '' WHERE id = ?", [req.session.userId]);
    }

    return res.json({
      success: true,
      avatar: user?.avatar === avatarUrl ? '' : (user?.avatar || '')
    });
  }));

  router.patch('/password', asyncHandler(async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ success: false, error: '请先登录' });
    }

    const currentPassword = String(req.body?.current_password || req.body?.currentPassword || '');
    const newPassword = String(req.body?.new_password || req.body?.newPassword || '');
    const newUsername = String(req.body?.new_username || req.body?.newUsername || '').trim();

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        error: '请填写当前密码和新密码'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        error: '新密码至少 6 位'
      });
    }

    const [rows] = await db.query(
      'SELECT id, username, password_hash, role FROM users WHERE id = ? LIMIT 1',
      [req.session.userId]
    );
    const user = rows[0];
    if (!user) {
      return res.status(401).json({ success: false, error: '用户不存在' });
    }

    const matched = await bcryptLib.compare(currentPassword, user.password_hash);
    if (!matched) {
      return res.status(400).json({ success: false, error: '当前密码不正确' });
    }

    // 如果要改用户名，检查是否重复
    if (newUsername && newUsername !== user.username) {
      const [existing] = await db.query(
        'SELECT id FROM users WHERE username = ? AND id != ? LIMIT 1',
        [newUsername, user.id]
      );
      if (existing.length > 0) {
        return res.status(400).json({ success: false, error: '用户名已被使用' });
      }
    }

    const nextHash = await bcryptLib.hash(newPassword, 12);
    const finalUsername = (newUsername && newUsername !== user.username) ? newUsername : user.username;

    await db.query(
      'UPDATE users SET username = ?, password_hash = ? WHERE id = ?',
      [finalUsername, nextHash, user.id]
    );

    // 清除该用户所有会话（踢下线）
    await db.query('DELETE FROM sessions WHERE data LIKE ?', [`%"userId":${user.id}%`]);

    return res.json({
      success: true,
      message: '账号信息已更新，请用新账号密码重新登录'
    });
  }));

  return router;
}

export default createAuthRouter();
