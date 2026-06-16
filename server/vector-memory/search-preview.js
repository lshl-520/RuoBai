import { pathToFileURL } from 'node:url';
import { pool as defaultPool } from '../db.js';
import { createHashEmbedder, createLocalEmbedder, createOpenAICompatibleEmbedder } from './embedding.js';
import { createVectorMemoryClient } from './qdrant.js';

const DEFAULT_QDRANT_URL = 'http://127.0.0.1:6333';
const DEFAULT_COLLECTION = 'ruobai_memories_local';
const DEFAULT_TOP = 5;
const DEFAULT_SEARCH_LIMIT = 12;
const DEFAULT_MIN_SCORE = 0.25;

function readFlag(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1) return null;
  return argv[index + 1] ?? null;
}

function requireNumber(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${label} 必须是正整数`);
  }
  return number;
}

export function parsePreviewArgs(argv = process.argv.slice(2)) {
  const query = String(readFlag(argv, '--query') || '').trim();
  if (!query) {
    throw new Error('检索预览必须传入 --query');
  }

  return {
    userId: requireNumber(readFlag(argv, '--user-id'), 'userId'),
    characterId: requireNumber(readFlag(argv, '--character-id'), 'characterId'),
    query,
    top: readFlag(argv, '--top') ? requireNumber(readFlag(argv, '--top'), 'top') : DEFAULT_TOP,
    qdrantUrl: readFlag(argv, '--qdrant-url') || DEFAULT_QDRANT_URL,
    collection: readFlag(argv, '--collection') || DEFAULT_COLLECTION,
    credentialId: readFlag(argv, '--credential-id')
      ? requireNumber(readFlag(argv, '--credential-id'), 'credentialId')
      : null,
    model: readFlag(argv, '--model') || '',
    vectorSize: readFlag(argv, '--vector-size')
      ? requireNumber(readFlag(argv, '--vector-size'), 'vectorSize')
      : null,
    hashEmbedding: argv.includes('--hash-embedding')
  };
}

async function loadCredential({ pool, userId, credentialId }) {
  const [rows] = await pool.query(
    `
      SELECT id, api_base, api_key
      FROM credentials
      WHERE id = ? AND user_id = ?
      LIMIT 1
    `,
    [credentialId, userId]
  );
  if (!rows[0]) {
    throw new Error(`找不到当前用户可用的 credential：${credentialId}`);
  }
  return rows[0];
}

export async function resolvePreviewEmbedder({ args, pool = defaultPool }) {
  if (args.hashEmbedding) {
    return createHashEmbedder({ vectorSize: args.vectorSize || 512 });
  }
  if (!args.credentialId) {
    return createLocalEmbedder();
  }
  if (!args.model) {
    throw new Error('使用 API embedding 时必须传入 --model');
  }

  const credential = await loadCredential({
    pool,
    userId: args.userId,
    credentialId: args.credentialId
  });

  return createOpenAICompatibleEmbedder({
    apiBase: credential.api_base,
    apiKey: credential.api_key,
    model: args.model,
    vectorSize: args.vectorSize
  });
}

export function refineSearchResults(results, {
  minScore = DEFAULT_MIN_SCORE,
  top = DEFAULT_TOP
} = {}) {
  const seen = new Set();
  const refined = [];

  for (const result of results || []) {
    if (Number(result.score || 0) < minScore) continue;

    const payload = result.payload || {};
    const timeBucket = String(payload.start_date || '').slice(0, 16);
    const key = `${payload.character_id || ''}:${timeBucket}`;
    if (seen.has(key)) continue;

    seen.add(key);
    refined.push(result);
    if (refined.length >= top) break;
  }

  return refined;
}

export function formatPreviewResults(results) {
  if (!results?.length) {
    return '没有找到足够相关的旧回忆。';
  }

  return results.map((result, index) => {
    const payload = result.payload || {};
    const dateRange = payload.end_date && payload.end_date !== payload.start_date
      ? `${payload.start_date} ~ ${payload.end_date}`
      : payload.start_date;
    return [
      `${index + 1}. 分数 ${Number(result.score || 0).toFixed(3)}｜${payload.character_name || '未知角色'}｜${dateRange || '无日期'}｜${payload.source || '无来源'}`,
      String(payload.text || '').trim()
    ].join('\n');
  }).join('\n\n---\n\n');
}

export async function runSearchPreview({
  args = parsePreviewArgs(),
  pool = defaultPool,
  embedder,
  client,
  write = console.log
} = {}) {
  const activeEmbedder = embedder || await resolvePreviewEmbedder({ args, pool });
  const activeClient = client || createVectorMemoryClient({
    baseUrl: args.qdrantUrl,
    collectionName: args.collection,
    vectorSize: activeEmbedder.vectorSize
  });
  const vector = await activeEmbedder.embedQuery(args.query);
  const rawResults = await activeClient.search({
    vector,
    userId: args.userId,
    characterId: args.characterId,
    limit: DEFAULT_SEARCH_LIMIT
  });
  const results = refineSearchResults(rawResults, { top: args.top });
  write(formatPreviewResults(results));
  return results;
}

function isDirectRun() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isDirectRun()) {
  runSearchPreview().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  }).finally(async () => {
    await defaultPool.end().catch(() => {});
  });
}
