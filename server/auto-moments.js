import { pool } from './db.js';
import { generateImage } from './image-gen.js';

const AGNES_AI_KEY = process.env.AGNES_AI_KEY || '';
const AGNES_AI_BASE = (process.env.AGNES_AI_BASE || 'https://apihub.agnes-ai.com/v1').replace(/\/+$/, '');

// 30分钟间隔（毫秒）
const SCAN_INTERVAL_MS = 30 * 60 * 1000;

// 安静时段：23:00~08:00
function isQuietHours() {
  const h = new Date().getHours();
  return h >= 23 || h < 8;
}

// 统计今天已发条数
async function countTodayMoments(userId, characterId) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS cnt FROM moments
     WHERE user_id=? AND character_id=? AND is_deleted=0
       AND created_at >= ?`,
    [userId, characterId, today]
  );
  return Number(rows[0]?.cnt || 0);
}

// 调 Agnes AI 聊天模型生成动态文字
async function generateMomentText(character) {
  if (!AGNES_AI_KEY) return null;
  const name = character.name || '她';
  const persona = String(character.persona || '').slice(0, 500);
  const prompt = `你是${name}。${persona ? '人设：' + persona + '。' : ''}请以${name}的口吻发一条朋友圈动态，内容要自然、生活化、有活人感，10到50个字，不要带任何系统提示或解释，直接输出动态正文。`;
  const url = `${AGNES_AI_BASE}/chat/completions`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AGNES_AI_KEY}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 150,
      temperature: 1.0,
    }),
  });
  if (!response.ok) return null;
  const payload = await response.json().catch(() => null);
  const text = payload?.choices?.[0]?.message?.content?.trim() || null;
  return text && text.length >= 5 ? text : null;
}

// 处理单个角色的自动发动态
async function processCharacter(character) {
  const { id: characterId, user_id: userId, auto_moments_daily_max, auto_moments_min_interval_hours, auto_moments_last_posted_at } = character;
  const dailyMax = Number(auto_moments_daily_max) || 6;
  const minIntervalHours = Number(auto_moments_min_interval_hours) || 4;

  // 检查每日上限
  const todayCount = await countTodayMoments(userId, characterId);
  if (todayCount >= dailyMax) return;

  // 检查间隔
  if (auto_moments_last_posted_at) {
    const lastPost = new Date(auto_moments_last_posted_at);
    const hoursSince = (Date.now() - lastPost.getTime()) / 3600000;
    if (hoursSince < minIntervalHours) return;
  }

  // 生成动态文字
  const content = await generateMomentText(character);
  if (!content) return;

  // 30% 概率附图
  let images = null;
  if (Math.random() < 0.3) {
    try {
      const subject = content.slice(0, 40);
      const imgUrl = await generateImage(subject);
      images = JSON.stringify([imgUrl]);
    } catch { /* 附图失败不影响发动态 */ }
  }

  // 插入 moments 表
  await pool.query(
    `INSERT INTO moments (user_id, character_id, content, images, mood) VALUES (?, ?, ?, ?, ?)`,
    [userId, characterId, content, images, null]
  );

  // 更新 last_posted_at
  await pool.query(
    `UPDATE characters SET auto_moments_last_posted_at = NOW() WHERE id = ?`,
    [characterId]
  );

  console.log(`[auto-moments] 角色 ${character.name}(id=${characterId}) 发了新动态`);
}

// 每次扫描：查出所有开启了自动动态的角色
async function runScan() {
  if (isQuietHours()) return;
  try {
    const [characters] = await pool.query(
      `SELECT id, user_id, name, persona, auto_moments_daily_max,
              auto_moments_min_interval_hours, auto_moments_last_posted_at
       FROM characters
       WHERE auto_moments_enabled = 1 AND is_deleted = 0`
    );
    for (const char of characters) {
      try { await processCharacter(char); } catch (e) { console.error('[auto-moments] 处理角色失败:', e.message); }
    }
  } catch (e) {
    console.error('[auto-moments] 扫描失败:', e.message);
  }
}

// 启动定时器，挂载到 server.js 里
export function startAutoMomentsScheduler() {
  if (!AGNES_AI_KEY) {
    console.log('[auto-moments] 未配置 AGNES_AI_KEY，跳过启动');
    return;
  }
  console.log('[auto-moments] 定时器已启动，每30分钟扫描一次');
  // 启动后3分钟先跑一次，再按间隔循环（避免开机太多任务同时堆积）
  setTimeout(() => {
    runScan();
    setInterval(runScan, SCAN_INTERVAL_MS);
  }, 3 * 60 * 1000);
}
