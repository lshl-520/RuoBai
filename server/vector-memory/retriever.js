/**
 * 向量记忆检索器 —— 阶段3：接入聊天主链
 *
 * 职责：
 * 1. 把当前对话最后几条消息拼成查询
 * 2. 调 embedding 服务生成查询向量
 * 3. 在 Qdrant 里按 user_id + character_id 检索
 * 4. 返回格式化好的提示词块，直接追加到 system prompt
 *
 * 如果 embedding 服务或 Qdrant 没启动，静默返回空字符串，不影响聊天。
 */

const EMBEDDING_URL = process.env.VECTOR_EMBEDDING_URL || 'http://127.0.0.1:8090';
const EMBEDDING_MODEL = process.env.VECTOR_EMBEDDING_MODEL || 'BAAI/bge-small-zh-v1.5';
const QDRANT_URL = process.env.VECTOR_QDRANT_URL || 'http://127.0.0.1:6333';
const COLLECTION = process.env.VECTOR_COLLECTION || 'ruobai_memories_local';

const TOP_K = 12;          // 初始检索数量
const MAX_RESULTS = 6;     // 最终注入数量
const SCORE_THRESHOLD = 0.35;  // 最低相关分数
const MAX_INJECT_CHARS = 1800; // 注入总字数上限
const CACHE_TTL = 2 * 60 * 1000;
const resultCache = new Map();

/**
 * 把最近几条消息拼成检索查询
 */
function buildQueryFromRecent(recentMessages, currentContent) {
  // 取最近3条 + 当前输入
  const tail = (recentMessages || []).slice(-3).map(m => {
    const c = String(m.content || '').trim();
    return c.length > 150 ? c.slice(0, 150) : c;
  });
  const current = String(currentContent || '').trim().slice(0, 200);
  if (current) tail.push(current);
  return tail.join('\n');
}

/**
 * 调 embedding 服务
 */
async function getQueryVector(text) {
  const resp = await fetch(`${EMBEDDING_URL}/v1/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: [text.slice(0, 480)] }),
    signal: AbortSignal.timeout(5000)
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  return data?.data?.[0]?.embedding || null;
}

/**
 * 在 Qdrant 检索
 */
async function searchQdrant(vector, userId, characterId) {
  const resp = await fetch(`${QDRANT_URL}/collections/${COLLECTION}/points/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      vector,
      limit: TOP_K,
      score_threshold: SCORE_THRESHOLD,
      filter: {
        must: [
          { key: 'user_id', match: { value: Number(userId) } },
          { key: 'character_id', match: { value: Number(characterId) } }
        ]
      },
      with_payload: true
    }),
    signal: AbortSignal.timeout(5000)
  });
  if (!resp.ok) return [];
  const data = await resp.json();
  return data?.result || [];
}

/**
 * 去重 + 截断 + 格式化
 */
function formatResults(results) {
  // 按分数排序（Qdrant已排）
  const seen = new Set();
  const picked = [];
  let totalChars = 0;

  for (const r of results) {
    const text = String(r.payload?.text || '').trim();
    const date = String(r.payload?.start_date || '').slice(0, 10);

    // 去重：同一天+内容前50字相同就跳过
    const key = date + '|' + text.slice(0, 50);
    if (seen.has(key)) continue;
    seen.add(key);

    // 截断单条
    const snippet = text.length > 300 ? text.slice(0, 300) + '…' : text;

    if (totalChars + snippet.length > MAX_INJECT_CHARS) break;
    if (picked.length >= MAX_RESULTS) break;

    picked.push({ date, snippet, score: r.score });
    totalChars += snippet.length;
  }

  return picked;
}

/**
 * 构建向量记忆提示词块
 */
function buildVectorMemoryBlock(picked) {
  if (!picked.length) return '';

  const lines = picked.map(p => `[${p.date}] ${p.snippet}`);
  return '\n\n【相关旧聊天回忆 · 你们之前聊过这些】\n'
    + '下面是从你们过去的聊天记录里找到的、跟当前话题相关的片段。\n'
    + '自然地参考这些回忆来回复，不要生硬地背诵或列举，像真的记得一样。\n'
    + '如果这些回忆跟当前话题无关，就忽略它们。\n\n'
    + lines.join('\n\n');
}

/**
 * 主入口：获取向量记忆提示词块
 *
 * @param {object} params
 * @param {number} params.userId
 * @param {number} params.characterId
 * @param {Array} params.recentMessages - 最近消息列表
 * @param {string} params.currentContent - 用户当前输入
 * @returns {Promise<string>} 提示词块（可能为空字符串）
 */
export async function getVectorMemoryBlock({ userId, characterId, recentMessages, currentContent }) {
  try {
    const query = buildQueryFromRecent(recentMessages, currentContent);
    if (!query.trim()) return '';
    const cacheKey = `${Number(userId)}:${Number(characterId)}:${query}`;
    const cached = resultCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.value;

    const vector = await getQueryVector(query);
    if (!vector) return '';

    const results = await searchQdrant(vector, userId, characterId);
    if (!results.length) return '';

    const picked = formatResults(results);
    const value = buildVectorMemoryBlock(picked);
    resultCache.set(cacheKey, { value, ts: Date.now() });
    return value;
  } catch (err) {
    // 向量记忆失败不影响聊天，只在日志里记一下
    console.warn('[向量记忆] 检索失败，跳过:', err.message);
    return '';
  }
}

export function getCachedVectorMemoryBlock({ userId, characterId, currentContent }) {
  const query = buildQueryFromRecent([], currentContent);
  const key = `${Number(userId)}:${Number(characterId)}:${query}`;
  const cached = resultCache.get(key);
  return cached && Date.now() - cached.ts < CACHE_TTL ? cached.value : '';
}
