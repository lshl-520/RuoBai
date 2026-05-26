/**
 * 从旧库 ailshl 迁移数据到新库 ruobai
 *
 * 使用方法：
 *   1. 确保新库已初始化（node server/init-db.js）
 *   2. 确保 lshl 账号已注册
 *   3. 确保旧库 ailshl 在同一个MySQL实例上可访问
 *   4. 运行: node server/migrate-old-data.js
 *
 * 如果旧库不在本地，修改下面的 OLD_DB_CONFIG
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(__dirname, '.env') });
dotenv.config({ path: path.join(projectRoot, '.env'), override: false });

// ===== 配置 =====
const NEW_DB = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'ruobai',
  charset: 'utf8mb4',
  dateStrings: true
};

// 旧库配置（和新库在同一个MySQL实例）
const OLD_DB = {
  ...NEW_DB,
  database: 'ailshl'  // ← 旧库名
};

// 旧库角色name → 新库char_key的映射
// 需要你确认旧库 characters 表里的name字段值
const CHAR_NAME_TO_KEY = {
  '小白': 'xiaobai',
  '若白': 'ruobai',
  '林夏': 'linxia',
  '七七': 'qiqi',
  '绫音': 'lingyin',
  '星璃': 'xingli',
  '君瑛': 'junying'
};

// 旧库 role 值映射
const ROLE_MAP = {
  'ai': 'assistant',
  'user': 'user',
  'system': 'system',
  'assistant': 'assistant'
};

async function migrate() {
  const oldPool = mysql.createPool(OLD_DB);
  const newPool = mysql.createPool(NEW_DB);

  try {
    // 1. 获取新库 lshl 用户ID
    const [lshlRows] = await newPool.query(
      "SELECT id FROM users WHERE username = 'lshl' LIMIT 1"
    );
    if (!lshlRows.length) {
      throw new Error('新库中找不到 lshl 用户，请先注册');
    }
    const newUserId = lshlRows[0].id;
    console.log(`新库 lshl user_id = ${newUserId}`);

    // 2. 获取新库角色ID映射 (char_key → new character id)
    const [newChars] = await newPool.query(
      'SELECT id, char_key FROM characters WHERE user_id = ? AND is_deleted = 0',
      [newUserId]
    );
    const newCharIdByKey = {};
    for (const c of newChars) {
      newCharIdByKey[c.char_key] = c.id;
    }
    console.log('新库角色映射:', newCharIdByKey);

    // 3. 获取旧库角色映射 (old character id → name)
    const [oldChars] = await oldPool.query(
      'SELECT id, name FROM characters WHERE deleted_at IS NULL'
    );
    const oldCharNameById = {};
    for (const c of oldChars) {
      oldCharNameById[c.id] = c.name;
    }
    console.log('旧库角色:', oldCharNameById);

    // 建立 旧character_id → 新character_id 的映射
    const charIdMap = {};
    for (const [oldId, name] of Object.entries(oldCharNameById)) {
      const key = CHAR_NAME_TO_KEY[name];
      if (key && newCharIdByKey[key]) {
        charIdMap[oldId] = newCharIdByKey[key];
      }
    }
    // 默认映射：如果旧角色没找到对应，全部归到小白
    const defaultNewCharId = newCharIdByKey['xiaobai'];
    console.log('角色ID映射:', charIdMap, '默认:', defaultNewCharId);

    // 4. 迁移消息
    console.log('\n--- 迁移消息 ---');
    const [oldMessages] = await oldPool.query(
      'SELECT id, role, content, created_at, character_id, message_type, media_url, user_id FROM messages ORDER BY id ASC'
    );
    console.log(`旧库消息数: ${oldMessages.length}`);

    let msgCount = 0;
    for (const msg of oldMessages) {
      const newCharId = charIdMap[msg.character_id] || defaultNewCharId;
      const newRole = ROLE_MAP[msg.role] || 'user';

      if (!msg.content || !msg.content.trim()) continue;

      try {
        await newPool.query(
          `INSERT INTO messages (user_id, character_id, role, content, message_type, media_url, is_active, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
          [
            newUserId,
            newCharId,
            newRole,
            msg.content,
            msg.message_type || 'text',
            msg.media_url || null,
            msg.created_at
          ]
        );
        msgCount++;
      } catch (err) {
        console.warn(`跳过消息 #${msg.id}: ${err.message}`);
      }
    }
    console.log(`成功迁移 ${msgCount} 条消息`);

    // 5. 迁移记忆 (memory_important_items)
    console.log('\n--- 迁移记忆 ---');
    let memCount = 0;
    try {
      const [oldMemories] = await oldPool.query(
        `SELECT id, character_id, category, summary, detail, importance, is_active, deleted_at, created_at
         FROM memory_important_items
         WHERE is_active = 1 AND deleted_at IS NULL
         ORDER BY id ASC`
      );
      console.log(`旧库活跃记忆数: ${oldMemories.length}`);

      for (const mem of oldMemories) {
        const newCharId = charIdMap[mem.character_id] || defaultNewCharId;
        const content = mem.detail || mem.summary || '';
        if (!content.trim()) continue;

        const isImportant = (mem.importance || 0) >= 7 ? 1 : 0;

        try {
          await newPool.query(
            `INSERT INTO memories (user_id, character_id, content, tag, category, is_important, is_deleted, created_at)
             VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
            [
              newUserId,
              newCharId,
              content,
              mem.category || '普通记忆',
              mem.category || '',
              isImportant,
              mem.created_at
            ]
          );
          memCount++;
        } catch (err) {
          console.warn(`跳过记忆 #${mem.id}: ${err.message}`);
        }
      }
    } catch (err) {
      console.warn(`记忆表不存在或读取失败: ${err.message}`);
    }
    console.log(`成功迁移 ${memCount} 条记忆`);

    // 6. 迁移简单记忆 (memories 表，如果有数据的话)
    console.log('\n--- 迁移简单记忆碎片 ---');
    let simpleMemCount = 0;
    try {
      const [simpleMemories] = await oldPool.query(
        'SELECT id, content, tag, created_at FROM memories ORDER BY id ASC'
      );
      for (const mem of simpleMemories) {
        if (!mem.content || !mem.content.trim()) continue;
        try {
          await newPool.query(
            `INSERT INTO memories (user_id, character_id, content, tag, category, is_important, is_deleted, created_at)
             VALUES (?, ?, ?, ?, '', 0, 0, ?)`,
            [newUserId, defaultNewCharId, mem.content, mem.tag || '普通记忆', mem.created_at]
          );
          simpleMemCount++;
        } catch (err) {
          console.warn(`跳过简单记忆 #${mem.id}: ${err.message}`);
        }
      }
    } catch (err) {
      console.warn(`简单记忆表读取失败: ${err.message}`);
    }
    console.log(`成功迁移 ${simpleMemCount} 条简单记忆`);

    // 7. 迁移模型配置
    console.log('\n--- 迁移模型配置 ---');
    let modelCount = 0;
    try {
      const [oldModels] = await oldPool.query(
        'SELECT name, type, api_key, base_url, model_name, is_active FROM model_configs WHERE user_id = 1'
      );
      for (const m of oldModels) {
        try {
          await newPool.query(
            `INSERT INTO model_configs (user_id, name, provider_type, api_base, api_key, model, is_active)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              newUserId,
              m.name || 'default',
              m.type || 'openai-compatible',
              m.base_url || '',
              m.api_key || '',
              m.model_name || '',
              m.is_active || 0
            ]
          );
          modelCount++;
        } catch (err) {
          console.warn(`跳过模型配置 "${m.name}": ${err.message}`);
        }
      }
    } catch (err) {
      console.warn(`模型配置表读取失败: ${err.message}`);
    }
    console.log(`成功迁移 ${modelCount} 条模型配置`);

    console.log('\n========== 迁移完成 ==========');
    console.log(`消息: ${msgCount}, 记忆: ${memCount + simpleMemCount}, 模型: ${modelCount}`);

  } catch (error) {
    console.error('迁移失败:', error.message);
    process.exitCode = 1;
  } finally {
    await oldPool.end();
    await newPool.end();
  }
}

await migrate();
