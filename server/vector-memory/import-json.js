import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { pool as defaultPool } from '../db.js';
import { chunkMergedChatExport } from './chunker.js';
import { createHashEmbedder, createLocalEmbedder, createOpenAICompatibleEmbedder } from './embedding.js';
import { createVectorMemoryClient } from './qdrant.js';

const DEFAULT_QDRANT_URL = 'http://127.0.0.1:6333';
const DEFAULT_COLLECTION = 'ruobai_memories_local';
const DEFAULT_BATCH_SIZE = 16;
const CHARACTER_ALIASES = new Map([
  ['ISFP人格馆', ['ISFP / 燕云人格馆', 'ISFP']]
]);

function readFlag(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1) return null;
  return argv[index + 1] ?? null;
}

function requirePositiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${label} 必须是正整数`);
  }
  return number;
}

export function parseImportArgs(argv = process.argv.slice(2)) {
  const file = String(readFlag(argv, '--file') || '').trim();
  if (!file) {
    throw new Error('导入向量记忆必须传入 --file');
  }

  return {
    file,
    userId: requirePositiveInteger(readFlag(argv, '--user-id'), 'userId'),
    qdrantUrl: readFlag(argv, '--qdrant-url') || DEFAULT_QDRANT_URL,
    collection: readFlag(argv, '--collection') || DEFAULT_COLLECTION,
    credentialId: readFlag(argv, '--credential-id')
      ? requirePositiveInteger(readFlag(argv, '--credential-id'), 'credentialId')
      : null,
    model: readFlag(argv, '--model') || '',
    vectorSize: readFlag(argv, '--vector-size')
      ? requirePositiveInteger(readFlag(argv, '--vector-size'), 'vectorSize')
      : null,
    hashEmbedding: argv.includes('--hash-embedding'),
    batchSize: readFlag(argv, '--batch-size')
      ? requirePositiveInteger(readFlag(argv, '--batch-size'), 'batchSize')
      : DEFAULT_BATCH_SIZE,
    dryRun: argv.includes('--dry-run')
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

export async function resolveImportEmbedder({ args, pool }) {
  if (args.hashEmbedding) {
    return createHashEmbedder({ vectorSize: args.vectorSize || 512 });
  }
  if (!args.credentialId) {
    return createLocalEmbedder({ batchSize: args.batchSize });
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
    batchSize: args.batchSize,
    vectorSize: args.vectorSize
  });
}

export async function loadCharacterMap({ pool = defaultPool, userId }) {
  const [rows] = await pool.query(
    `
      SELECT id, name, char_key, is_deleted
      FROM characters
      WHERE user_id = ?
    `,
    [userId]
  );

  const sorted = [...rows].sort((left, right) => {
    const leftTest = String(left.char_key || '').startsWith('test_') ? 1 : 0;
    const rightTest = String(right.char_key || '').startsWith('test_') ? 1 : 0;
    const leftDeleted = Number(left.is_deleted || 0);
    const rightDeleted = Number(right.is_deleted || 0);
    return leftTest - rightTest || leftDeleted - rightDeleted || Number(left.id) - Number(right.id);
  });

  const map = new Map();
  for (const row of sorted) {
    const name = String(row.name || '').trim();
    if (name && !map.has(name)) {
      map.set(name, Number(row.id));
    }
  }

  for (const [exportName, candidates] of CHARACTER_ALIASES.entries()) {
    for (const candidate of candidates) {
      if (map.has(candidate)) {
        map.set(exportName, map.get(candidate));
        break;
      }
    }
  }

  return map;
}

async function readMergedExport(file) {
  const raw = await fs.readFile(file, 'utf8');
  return JSON.parse(raw);
}

async function upsertInBatches({ chunks, embedder, client, batchSize, write }) {
  let imported = 0;

  for (let index = 0; index < chunks.length; index += batchSize) {
    const batch = chunks.slice(index, index + batchSize);
    const vectors = await embedder.embedTexts(batch.map(chunk => chunk.text));
    await client.upsertChunks(batch, vectors);
    imported += batch.length;
    write(`已写入 ${imported}/${chunks.length} 个记忆片段`);
  }

  return imported;
}

export async function runImport({
  args = parseImportArgs(),
  pool = defaultPool,
  embedder,
  client,
  readExport = readMergedExport,
  write = console.log
} = {}) {
  const activeEmbedder = embedder || await resolveImportEmbedder({ args, pool });
  const activeClient = client || createVectorMemoryClient({
    baseUrl: args.qdrantUrl,
    collectionName: args.collection,
    vectorSize: activeEmbedder.vectorSize
  });
  const [exportData, characterMap] = await Promise.all([
    readExport(args.file),
    loadCharacterMap({ pool, userId: args.userId })
  ]);

  const { chunks, stats } = chunkMergedChatExport({
    userId: args.userId,
    exportData,
    characterMap
  });

  write(`读取原始消息 ${stats.totalMessages} 条，生成记忆片段 ${chunks.length} 个`);
  for (const item of stats.characters) {
    write(`- ${item.name}：${item.message_count} 条消息，${item.chunk_count} 个片段`);
  }

  if (args.dryRun) {
    write('dry-run 模式：未写入 Qdrant');
    return { stats, chunks, imported: 0 };
  }

  await activeClient.ensureCollection();
  const imported = await upsertInBatches({
    chunks,
    embedder: activeEmbedder,
    client: activeClient,
    batchSize: args.batchSize,
    write
  });

  write(`导入完成：${imported} 个记忆片段`);
  return { stats, chunks, imported };
}

function isDirectRun() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isDirectRun()) {
  runImport()
    .catch(error => {
      console.error(error.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      await defaultPool.end().catch(() => {});
    });
}
