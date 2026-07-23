import { pool } from './db.js';
import { generateImage } from './image-gen.js';
import { buildChatCompletionsUrl } from './chat.js';

const DEFAULT_DAILY_MAX = 4;
const DEFAULT_MIN_INTERVAL_HOURS = 6;
const FIRST_SCAN_DELAY_MS = 15 * 1000;
const SCAN_INTERVAL_MS = 10 * 60 * 1000;
const AUTO_IMAGE_MAX_ROUNDS = 2;
const AUTO_IMAGE_RETRY_DELAYS_MS = [30 * 1000];

function stripGeneratedText(value) {
  return String(value || '')
    .replace(/^\s*["'“”‘’]+|["'“”‘’]+\s*$/g, '')
    .trim()
    .slice(0, 500);
}

function extractTextFromPayload(payload) {
  return String(
    payload?.choices?.[0]?.message?.content
    || payload?.choices?.[0]?.delta?.content
    || payload?.message?.content
    || payload?.content
    || ''
  );
}

function extractTextFromSse(raw) {
  let content = '';
  for (const rawLine of String(raw || '').split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    try {
      content += extractTextFromPayload(JSON.parse(data));
    } catch {
      content += data;
    }
  }
  return content;
}

async function readGeneratedText(response) {
  const raw = await response.text().catch(() => '');
  if (!raw) return '';
  try {
    return stripGeneratedText(extractTextFromPayload(JSON.parse(raw)));
  } catch {
    return stripGeneratedText(extractTextFromSse(raw));
  }
}

function normalizeDailyMax(value) {
  const parsed = Number(value);
  return [2, 4, 6].includes(parsed) ? parsed : DEFAULT_DAILY_MAX;
}

function normalizeMinInterval(value, dailyMax) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed >= 1) return parsed;
  return Math.max(1, Math.round(24 / (dailyMax || DEFAULT_DAILY_MAX))) || DEFAULT_MIN_INTERVAL_HOURS;
}

function startOfLocalDay(now) {
  const value = new Date(now);
  value.setHours(0, 0, 0, 0);
  return value;
}

function buildMomentMessages(character, context) {
  const name = String(character?.name || '她').trim() || '她';
  const persona = String(character?.persona || '').trim();
  const recentLines = context.messages
    .map(item => `${item.role === 'assistant' ? name : '用户'}：${String(item.content || '').trim()}`)
    .filter(line => line.length > 4)
    .join('\n');
  const memoryLines = context.memories
    .map(item => `- ${String(item.tag || item.category || '记忆').trim()}：${String(item.content || '').trim()}`)
    .filter(line => line.length > 4)
    .join('\n');

  return [
    {
      role: 'system',
      content: [
        `你现在是${name}。请以${name}本人的口吻写一条个人动态。`,
        '写 1 到 2 句自然、生活化、有活人感的中文短句，约 10 到 60 个字。',
        '可以自然呼应最近聊天或记忆，但不要复述隐私，不要解释，不要加标题，不要说自己是 AI。',
        persona ? `人设参考：${persona.slice(0, 1000)}` : ''
      ].filter(Boolean).join('\n')
    },
    {
      role: 'user',
      content: [
        recentLines ? `最近聊天：\n${recentLines}` : '最近聊天：暂时没有。',
        memoryLines ? `长期记忆：\n${memoryLines}` : '长期记忆：暂时没有。',
        '请只输出动态正文。'
      ].join('\n\n')
    }
  ];
}

export function createAutoMomentsService({
  db = pool,
  fetchImpl = fetch,
  generateImageImpl = generateImage,
  sleepImpl = ms => new Promise(resolve => setTimeout(resolve, ms)),
  imageRetryRounds = AUTO_IMAGE_MAX_ROUNDS,
  imageRetryDelaysMs = AUTO_IMAGE_RETRY_DELAYS_MS,
  now = () => new Date(),
  logger = console
} = {}) {
  async function getCapability(userId, capability) {
    const [rows] = await db.query(
      `
        SELECT
          ca.id,
          ca.capability,
          ca.extras,
          c.name,
          c.provider_type,
          c.api_base,
          c.api_aux_base,
          c.api_key,
          ca.model_id AS model
        FROM capability_assignments ca
        INNER JOIN credentials c ON c.id = ca.credential_id
        WHERE ca.user_id = ? AND ca.capability = ? AND ca.enabled = 1 AND c.is_enabled = 1
        ORDER BY ca.id DESC
        LIMIT 1
      `,
      [userId, capability]
    );
    return rows[0] || null;
  }

  async function loadContext(userId, characterId) {
    const [[messages], [memories]] = await Promise.all([
      db.query(
        `
          SELECT role, content, created_at
          FROM messages
          WHERE user_id = ? AND character_id = ? AND is_active = 1
          ORDER BY id DESC
          LIMIT ?
        `,
        [userId, characterId, 6]
      ),
      db.query(
        `
          SELECT tag, category, content
          FROM memories
          WHERE user_id = ? AND character_id = ? AND is_deleted = 0
          ORDER BY is_important DESC, created_at DESC, id DESC
          LIMIT ?
        `,
        [userId, characterId, 4]
      )
    ]);
    return { messages: messages.reverse(), memories };
  }

  async function countTodayMoments(userId, characterId) {
    const [rows] = await db.query(
      `
        SELECT COUNT(*) AS cnt
        FROM moments
        WHERE user_id = ? AND character_id = ? AND is_deleted = 0 AND created_at >= ?
      `,
      [userId, characterId, startOfLocalDay(now())]
    );
    return Number(rows[0]?.cnt || 0);
  }

  async function generateMomentText(character, chatConfig, context) {
    const response = await fetchImpl(buildChatCompletionsUrl(chatConfig.api_base), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${chatConfig.api_key}`
      },
      body: JSON.stringify({
        model: chatConfig.model,
        stream: false,
        temperature: 0.9,
        max_tokens: 180,
        messages: buildMomentMessages(character, context)
      })
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(detail || `聊天模型返回 ${response.status}`);
    }

    const content = await readGeneratedText(response);
    if (!content) throw new Error('聊天模型没有返回动态文字');
    return content;
  }

  async function processCharacter(character, { ignoreLimits = false } = {}) {
    const characterId = Number(character.id);
    const userId = Number(character.user_id);
    const dailyMax = normalizeDailyMax(character.auto_moments_daily_max);
    const minIntervalHours = normalizeMinInterval(character.auto_moments_min_interval_hours, dailyMax);

    if (!ignoreLimits) {
      const todayCount = await countTodayMoments(userId, characterId);
      if (todayCount >= dailyMax) {
        return { characterId, status: 'skipped_daily_limit' };
      }

      if (character.auto_moments_last_posted_at) {
        const lastPost = new Date(character.auto_moments_last_posted_at);
        const elapsedHours = (new Date(now()).getTime() - lastPost.getTime()) / 3600000;
        if (Number.isFinite(elapsedHours) && elapsedHours < minIntervalHours) {
          return { characterId, status: 'skipped_interval' };
        }
      }
    }

    const chatConfig = await getCapability(userId, 'chat');
    if (!chatConfig) {
      logger.warn?.(`[auto-moments] ${character.name} 未启用聊天能力，跳过本次动态`);
      return { characterId, status: 'skipped_no_chat_capability' };
    }

    const context = await loadContext(userId, characterId);
    const content = await generateMomentText(character, chatConfig, context);

    let images = null;
    const imageConfig = await getCapability(userId, 'image');
    if (imageConfig) {
      const rounds = Math.max(1, Math.min(3, Number(imageRetryRounds) || AUTO_IMAGE_MAX_ROUNDS));
      let lastImageError = null;
      for (let round = 1; round <= rounds; round += 1) {
        try {
          const imageUrl = await generateImageImpl(
            `请生成一张适合这条个人动态的真实生活随手照片。画面自然，不要添加文字、水印或界面。动态内容：${content}`,
            {
              providerType: imageConfig.provider_type,
              apiBase: imageConfig.api_base,
              taskApiBase: imageConfig.api_aux_base,
              apiKey: imageConfig.api_key,
              model: imageConfig.model,
              extras: imageConfig.extras,
              fetchImpl
            }
          );
          if (imageUrl) images = JSON.stringify([imageUrl]);
          break;
        } catch (error) {
          lastImageError = error;
          if (round < rounds) {
            const delay = Number(imageRetryDelaysMs[round - 1]) || 30_000;
            logger.warn?.(`[auto-moments] ${character.name} 第 ${round} 轮配图失败，${Math.round(delay / 1000)} 秒后继续尝试：${error.message}`);
            await sleepImpl(delay);
          }
        }
      }
      if (!images && lastImageError) {
        logger.warn?.(`[auto-moments] ${character.name} 配图连续尝试 ${rounds} 轮仍失败，已继续发布纯文字动态：${lastImageError.message}`);
      }
    }

    const [result] = await db.query(
      `
        INSERT INTO moments (user_id, character_id, content, images, mood, likes_count, created_at, is_deleted)
        VALUES (?, ?, ?, ?, ?, 0, NOW(), 0)
      `,
      [userId, characterId, content, images, null]
    );
    await db.query(
      'UPDATE characters SET auto_moments_last_posted_at = NOW() WHERE id = ? AND user_id = ?',
      [characterId, userId]
    );

    logger.log?.(`[auto-moments] ${character.name}(id=${characterId}) 已发布${images ? '图文' : '文字'}动态`);
    return {
      characterId,
      momentId: result?.insertId || null,
      status: 'posted',
      content,
      images: images ? JSON.parse(images) : []
    };
  }

  async function runScan({ characterId = null, ignoreLimits = false } = {}) {
    const params = [];
    let characterFilter = '';
    if (characterId != null) {
      characterFilter = ' AND id = ?';
      params.push(Number(characterId));
    }

    try {
      const [characters] = await db.query(
        `
          SELECT id, user_id, name, persona, auto_moments_daily_max,
                 auto_moments_min_interval_hours, auto_moments_last_posted_at
          FROM characters
          WHERE auto_moments_enabled = 1 AND is_deleted = 0${characterFilter}
          ORDER BY id ASC
        `,
        params
      );

      const results = [];
      for (const character of characters) {
        try {
          results.push(await processCharacter(character, { ignoreLimits }));
        } catch (error) {
          logger.error?.(`[auto-moments] 处理角色 ${character.name || character.id} 失败：${error.message}`);
          results.push({ characterId: Number(character.id), status: 'failed', error: error.message });
        }
      }
      return results;
    } catch (error) {
      logger.error?.(`[auto-moments] 扫描失败：${error.message}`);
      return [{ characterId: characterId == null ? null : Number(characterId), status: 'failed', error: error.message }];
    }
  }

  return { runScan, processCharacter };
}

export function startAutoMomentsScheduler({
  setTimeoutImpl = setTimeout,
  setIntervalImpl = setInterval,
  ...serviceOptions
} = {}) {
  const service = createAutoMomentsService(serviceOptions);
  const runSafely = () => service.runScan().catch(error => {
    (serviceOptions.logger || console).error?.(`[auto-moments] 定时扫描失败：${error.message}`);
  });

  const firstTimer = setTimeoutImpl(runSafely, FIRST_SCAN_DELAY_MS);
  const interval = setIntervalImpl(runSafely, SCAN_INTERVAL_MS);
  firstTimer?.unref?.();
  interval?.unref?.();
  (serviceOptions.logger || console).log?.('[auto-moments] 定时器已启动：15 秒后首次扫描，之后每 10 分钟检查一次');

  return { ...service, firstTimer, interval };
}
