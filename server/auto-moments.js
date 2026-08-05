import { pool } from './db.js';
import { supportsDynamicSingleImage } from './capabilities.js';
import { generateImage } from './image-gen.js';
import { buildChatCompletionsUrl } from './chat.js';
import { recordLifeEventSource } from './life-events.js';

const DEFAULT_DAILY_MAX = 4;
const DEFAULT_MIN_INTERVAL_HOURS = 6;
const FIRST_SCAN_DELAY_MS = 15 * 1000;
const SCAN_INTERVAL_MS = 10 * 60 * 1000;
const AUTO_IMAGE_MAX_ROUNDS = 2;
const AUTO_IMAGE_RETRY_DELAYS_MS = [30 * 1000];
const MAX_MOMENT_LENGTH = 120;
const MOMENT_IMAGE_MODES = new Set(['none', 'auto', 'selfie', 'third_person']);

export function sanitizeGeneratedMoment(value) {
  const text = stripGeneratedText(value).replace(/\s*\n+\s*/g, ' ').trim();
  if (!text) return '';

  const looksLikeConversation = /(?:用户|助手|assistant|system|系统|角色)\s*[:：]/i.test(text);
  const looksLikeCode = /```|\b(?:python|import|from|def|class|function|const|let|var|console\.)\b/i.test(text);
  const looksLikeStructuredDump = /^[{[]/.test(text) || /[{}][\s\S]*[{}]/.test(text);
  if (text.length > MAX_MOMENT_LENGTH || looksLikeConversation || looksLikeCode || looksLikeStructuredDump) {
    return '';
  }
  return text;
}

export function parseGeneratedMomentPlan(value) {
  const raw = stripGeneratedText(value);
  const json = raw.replace(/^```(?:json)?\s*|\s*```$/gi, '').trim();
  try {
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === 'object') {
      if (parsed.should_post === false) {
        return { shouldPost: false, content: '', imageMode: 'none', imageBrief: '' };
      }
      const content = sanitizeGeneratedMoment(parsed.content);
      if (!content) return { shouldPost: false, content: '', imageMode: 'none', imageBrief: '' };
      const requestedMode = String(parsed.image_mode || 'none').trim().toLowerCase();
      const imageMode = MOMENT_IMAGE_MODES.has(requestedMode) ? requestedMode : 'none';
      return {
        shouldPost: true,
        content,
        imageMode,
        imageBrief: stripGeneratedText(parsed.image_brief).slice(0, 240)
      };
    }
  } catch {
    // 兼容尚未按结构返回的旧聊天模型。
  }

  const content = sanitizeGeneratedMoment(raw);
  return content
    ? { shouldPost: true, content, imageMode: 'auto', imageBrief: '' }
    : { shouldPost: false, content: '', imageMode: 'none', imageBrief: '' };
}

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

function parseDynamicSetting(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function describeDynamicProfile(character) {
  const profile = parseDynamicSetting(character?.auto_moments_image_profile);
  if (!profile) return '';
  const labels = { temperament: '气质', face: '脸型', eyes: '眼睛', hair: '头发', skin: '皮肤', expression: '表情', other: '补充' };
  const lines = [];
  if (profile.name) lines.push(`姓名：${String(profile.name).slice(0, 60)}`);
  if (profile.age_feel) lines.push(`年龄感：${String(profile.age_feel).slice(0, 60)}`);
  for (const [key, label] of Object.entries(labels)) {
    if (Array.isArray(profile[key]) && profile[key].length) lines.push(`${label}：${profile[key].slice(0, 16).join('、')}`);
  }
  return lines.join('；');
}

function describeDynamicTemplates(character) {
  const templates = parseDynamicSetting(character?.auto_moments_templates);
  if (!templates) return '';
  const labels = { categories: '动态类别', selfie_scenes: '自拍场景', poses: '姿势', moods: '心情', custom: '自定义' };
  return Object.entries(labels)
    .filter(([key]) => Array.isArray(templates[key]) && templates[key].length)
    .map(([key, label]) => `${label}：${templates[key].slice(0, 16).join('、')}`)
    .join('；');
}

function chooseOne(values, random = Math.random) {
  const choices = (Array.isArray(values) ? values : [])
    .map(value => String(value || '').trim())
    .filter(Boolean);
  if (!choices.length) return '';
  return choices[Math.min(choices.length - 1, Math.max(0, Math.floor(random() * choices.length)))];
}

export function resolveDynamicImageTemplate(character, plan, random = Math.random) {
  const templates = parseDynamicSetting(character?.auto_moments_templates) || {};
  const isSelfie = plan?.imageMode !== 'third_person';
  const sceneChoices = isSelfie
    ? templates.selfie_scenes
    : [...(templates.custom || []), ...(templates.categories || [])];

  return {
    scene: chooseOne(sceneChoices, random) || (isSelfie ? '自然日常自拍' : '自然生活片段'),
    pose: chooseOne(templates.poses, random) || '自然放松的姿势',
    mood: chooseOne(templates.moods, random) || '放松',
    isSelfie
  };
}

function buildMomentMessages(character, context) {
  const name = String(character?.name || '她').trim() || '她';
  const persona = String(character?.persona || '').trim();
  const profile = describeDynamicProfile(character);
  const templates = describeDynamicTemplates(character);
  const recentLines = context.messages
    .map(item => `${item.role === 'assistant' ? name : '用户'}：${String(item.content || '').trim()}`)
    .filter(line => line.length > 4)
    .join('\n');
  const memoryLines = context.memories
    .map(item => `- ${String(item.tag || item.category || '记忆').trim()}：${String(item.content || '').trim()}`)
    .filter(line => line.length > 4)
    .join('\n');
  const previousMomentLines = context.recentMoments
    .map(item => `- ${String(item.content || '').trim()}`)
    .filter(line => line.length > 4)
    .join('\n');

  return [
    {
      role: 'system',
      content: [
        `你现在是${name}的动态规划器，请决定她此刻是否适合发一条个人动态。`,
        '不要照抄聊天；涉及隐私、冲突、敏感内容、只有无意义寒暄，或与最近动态明显重复时，选择不发。',
        '若发，正文写 1 到 2 句自然生活化中文，10 到 60 字，最长不超过 120 字；不解释、不加标题、不说自己是 AI。',
        '只输出 JSON：{"should_post":true,"content":"正文","image_mode":"none|selfie|third_person","image_brief":"给图片的简短生活场景"}。不发时输出 {"should_post":false}。',
        persona ? `人设参考：${persona.slice(0, 1000)}` : '',
        profile ? `固定形象：${profile}` : '',
        templates ? `可选生活模板：${templates}` : ''
      ].filter(Boolean).join('\n')
    },
    {
      role: 'user',
      content: [
        recentLines ? `最近聊天：\n${recentLines}` : '最近聊天：暂时没有。',
        memoryLines ? `长期记忆：\n${memoryLines}` : '长期记忆：暂时没有。',
        previousMomentLines ? `最近已发动态：\n${previousMomentLines}` : '最近已发动态：暂时没有。'
      ].join('\n\n')
    }
  ];
}

export function buildAutoImagePrompt(character, content, plan, resolvedTemplate = {}) {
  const name = String(character?.name || '她').trim() || '她';
  const profile = describeDynamicProfile(character);
  const scene = String(resolvedTemplate.scene || '').trim() || '自然生活片段';
  const pose = String(resolvedTemplate.pose || '').trim() || '自然放松的姿势';
  const mood = String(resolvedTemplate.mood || '').trim() || '放松';
  return [
    `任务：生成${name}今天发布的一条个人动态配图。`,
    '【输出规则】只生成一张完整的单幅照片，单一连续构图。严禁九宫格、拼贴、分镜、接触表、网格、多张照片、多人并排、重复的人脸或身体。不要出现文字、水印或界面。',
    '【固定身份】角色是已成年的女性。年龄感、脸型、五官、眼睛、发色和整体气质必须与设定一致；衣服只可随本次场景自然变化，不能借此把角色画成另一个人。',
    resolvedTemplate.isSelfie === false
      ? '使用第三人称单人生活抓拍构图，只出现角色本人。'
      : '使用角色自己的第一人称手机视角或单人自拍构图。',
    '不要出现陌生男性、男性的手或身体、男性影子、男性倒影，也不要要求用户上传自己的照片。',
    profile ? `角色固定形象：${profile}` : '',
    `【本次事件】场景：${scene}；姿势：${pose}；心情：${mood}。`,
    plan?.imageBrief ? `画面建议：${plan.imageBrief}` : '',
    `动态内容（只用于理解今天的生活主题，不要把文字放进图片）：${content}`
  ].join('\n');
}

function getDynamicGenerationAttemptLimit(imageConfig) {
  // 常见 gpt-image 中转偶发 502；限定为最多五次，且仅在用户已选该渠道时发生。
  return /^gpt-image-/i.test(String(imageConfig?.model || '')) ? 5 : 3;
}

function buildDynamicImageMetadata({ imageConfig, plan, resolvedTemplate, outputHandling, imageStatus, resolution }) {
  return JSON.stringify({
    version: 'dynamic-image-v1',
    image_mode: 'single',
    channel: String(imageConfig?.name || ''),
    model: String(imageConfig?.model || ''),
    resolution: String(resolution || 'channel'),
    composition: plan?.imageMode === 'third_person' ? 'third_person' : 'selfie',
    template: {
      scene: String(resolvedTemplate?.scene || ''),
      pose: String(resolvedTemplate?.pose || ''),
      mood: String(resolvedTemplate?.mood || '')
    },
    output_handling: outputHandling || 'none',
    status: imageStatus
  });
}

function buildChannelTestPlan(character) {
  const name = String(character?.name || '她').trim() || '她';
  return {
    shouldPost: true,
    content: `想趁现在和你打个招呼。${name}今天也在慢慢过自己的小日子。`,
    imageMode: 'selfie',
    imageBrief: '一张自然的日常自拍，用于确认动态发图渠道是否正常'
  };
}

export function createAutoMomentsService({
  db = pool,
  fetchImpl = fetch,
  generateImageImpl = generateImage,
  sleepImpl = ms => new Promise(resolve => setTimeout(resolve, ms)),
  imageRetryRounds = AUTO_IMAGE_MAX_ROUNDS,
  imageRetryDelaysMs = AUTO_IMAGE_RETRY_DELAYS_MS,
  now = () => new Date(),
  random = Math.random,
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
    const item = rows[0] || null;
    return capability === 'dynamic' && item && !supportsDynamicSingleImage(item.model) ? null : item;
  }

  async function loadContext(userId, characterId) {
    const [[messages], [memories], [recentMoments]] = await Promise.all([
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
      ),
      db.query(
        `
          SELECT content
          FROM moments
          WHERE user_id = ? AND character_id = ? AND is_deleted = 0
          ORDER BY created_at DESC, id DESC
          LIMIT ?
        `,
        [userId, characterId, 4]
      )
    ]);
    return { messages: messages.reverse(), memories, recentMoments };
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

  async function generateMomentPlan(character, chatConfig, context) {
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

    return parseGeneratedMomentPlan(await readGeneratedText(response));
  }

  async function processCharacter(character, { ignoreLimits = false, forceChannelTest = false } = {}) {
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

    let plan;
    if (forceChannelTest) {
      plan = buildChannelTestPlan(character);
    } else {
      const chatConfig = await getCapability(userId, 'chat');
      if (!chatConfig) {
        logger.warn?.(`[auto-moments] ${character.name} 未启用聊天能力，跳过本次动态`);
        return { characterId, status: 'skipped_no_chat_capability' };
      }
      const context = await loadContext(userId, characterId);
      plan = await generateMomentPlan(character, chatConfig, context);
    }
    if (!plan.shouldPost) {
      return { characterId, status: 'skipped_planner' };
    }
    const content = plan.content;

    let images = null;
    let imageStatus = 'disabled';
    let imageError = '';
    let imageMetadata = null;
    const imagesEnabled = Number(character.auto_moments_images_enabled || 0) === 1;
    const imageConfig = imagesEnabled && plan.imageMode !== 'none' ? await getCapability(userId, 'dynamic') : null;
    if (imagesEnabled && plan.imageMode === 'none') imageStatus = 'planner_text_only';
    if (imagesEnabled && plan.imageMode !== 'none' && !imageConfig) imageStatus = 'dynamic_unconfigured';
    if (imagesEnabled && imageConfig) {
      imageStatus = 'pending';
      const resolvedTemplate = resolveDynamicImageTemplate(character, plan, random);
      const imagePrompt = buildAutoImagePrompt(character, content, plan, resolvedTemplate);
      let outputHandling = 'none';
      const rounds = forceChannelTest ? 1 : Math.max(1, Math.min(3, Number(imageRetryRounds) || AUTO_IMAGE_MAX_ROUNDS));
      let lastImageError = null;
      for (let round = 1; round <= rounds; round += 1) {
        try {
          const generated = await generateImageImpl(
            imagePrompt,
            {
              providerType: imageConfig.provider_type,
              apiBase: imageConfig.api_base,
              taskApiBase: imageConfig.api_aux_base,
              apiKey: imageConfig.api_key,
              model: imageConfig.model,
              extras: imageConfig.extras,
              resolution: character.auto_moments_image_resolution || 'channel',
              fetchImpl,
              expectedSingleImage: true,
              generationMaxAttempts: getDynamicGenerationAttemptLimit(imageConfig),
              returnResult: true
            }
          );
          const imageUrl = typeof generated === 'string' ? generated : generated?.url;
          if (imageUrl) {
            images = JSON.stringify([imageUrl]);
            imageStatus = 'generated';
            outputHandling = typeof generated === 'object' ? generated.outputHandling || 'single' : 'single';
          }
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
        imageStatus = 'failed';
        imageError = String(lastImageError.message || 'unknown').slice(0, 200);
        logger.warn?.({
          code: 'AUTO_MOMENT_IMAGE_FAILED',
          capability: 'dynamic',
          characterId,
          rounds,
          reason: String(lastImageError.message || 'unknown').slice(0, 200)
        });
      }
      imageMetadata = buildDynamicImageMetadata({
        imageConfig,
        plan,
        resolvedTemplate,
        outputHandling,
        imageStatus,
        resolution: character.auto_moments_image_resolution || 'channel'
      });
    }

    const [result] = await db.query(
      `
        INSERT INTO moments
          (user_id, character_id, visibility_mode, content, images, image_generation_status, image_generation_error, mood, likes_count, image_mode, image_generation_metadata, created_at, is_deleted)
        VALUES (?, ?, 'publisher', ?, ?, ?, ?, ?, 0, 'single', ?, NOW(), 0)
      `,
      [userId, characterId, content, images, imageStatus, imageError || null, null, imageMetadata]
    );
    await db.query(
      'UPDATE characters SET auto_moments_last_posted_at = NOW() WHERE id = ? AND user_id = ?',
      [characterId, userId]
    );
    void recordLifeEventSource(db, {
      userId,
      characterId,
      sourceType: 'moment',
      sourceId: result?.insertId,
      title: content,
      eventType: 'life'
    });

    logger.log?.(`[auto-moments] ${character.name}(id=${characterId}) 已发布${images ? '图文' : '文字'}动态`);
    return {
      characterId,
      momentId: result?.insertId || null,
      status: 'posted',
      content,
      images: images ? JSON.parse(images) : [],
      imageStatus,
      imageError,
      testMode: forceChannelTest
    };
  }

  async function runScan({ characterId = null, ignoreLimits = false, forceChannelTest = false } = {}) {
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
                 auto_moments_min_interval_hours, auto_moments_last_posted_at,
                 auto_moments_images_enabled, auto_moments_image_resolution, auto_moments_image_profile, auto_moments_templates
          FROM characters
          WHERE auto_moments_enabled = 1 AND is_deleted = 0${characterFilter}
          ORDER BY id ASC
        `,
        params
      );

      const results = [];
      for (const character of characters) {
        try {
          results.push(await processCharacter(character, { ignoreLimits, forceChannelTest }));
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
  service = null,
  ...serviceOptions
} = {}) {
  const autoMomentsService = service || createAutoMomentsService(serviceOptions);
  const runSafely = () => autoMomentsService.runScan().catch(error => {
    (serviceOptions.logger || console).error?.(`[auto-moments] 定时扫描失败：${error.message}`);
  });

  const firstTimer = setTimeoutImpl(runSafely, FIRST_SCAN_DELAY_MS);
  const interval = setIntervalImpl(runSafely, SCAN_INTERVAL_MS);
  firstTimer?.unref?.();
  interval?.unref?.();
  (serviceOptions.logger || console).log?.('[auto-moments] 定时器已启动：15 秒后首次扫描，之后每 10 分钟检查一次');

  return { ...autoMomentsService, firstTimer, interval };
}
