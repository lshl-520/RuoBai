import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  LOCAL_DATA_SCHEMA_VERSION,
  LOCAL_DATA_TABLES,
  LOCAL_DATA_MIGRATIONS,
  getMigrationPlan,
  isConfirmedLocalMemory,
} from './local-data-schema.mjs';

function asVersion(value) {
  const version = Number(value);
  if (!Number.isInteger(version) || version < 0) throw new Error(`本地数据版本无效：${value}`);
  return version;
}

export async function migrateDatabase(db, {
  targetVersion = LOCAL_DATA_SCHEMA_VERSION,
  migrations = LOCAL_DATA_MIGRATIONS,
} = {}) {
  const target = asVersion(targetVersion);
  const current = asVersion(db.prepare('PRAGMA user_version').get().user_version);
  if (current > target) throw new Error(`本地数据库版本过新：${current} > ${target}`);
  const versions = Array.from({ length: target - current }, (_, index) => current + index + 1);
  try {
    db.exec('BEGIN');
    for (const version of versions) {
      const statements = migrations[version];
      if (!Array.isArray(statements)) throw new Error(`缺少本地数据迁移：${version}`);
      for (const sql of statements) db.exec(sql);
      db.exec(`PRAGMA user_version = ${version}`);
    }
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
  return target;
}

export async function openLocalDatabase(dbPath, options = {}) {
  await mkdir(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  await migrateDatabase(db, options);
  return db;
}

function assertIdentityPack(pack) {
  if (!pack || typeof pack !== 'object') throw new Error('导入包不是对象');
  if (!pack.identity || typeof pack.identity !== 'object') throw new Error('导入包缺少角色身份');
  if (!String(pack.identity.name || '').trim()) throw new Error('导入包缺少角色名称');
  if (!Array.isArray(pack.memories)) throw new Error('导入包记忆格式错误');
}

const SHA256_RE = /^[a-f0-9]{64}$/i;
const MEDIA_TYPES = new Set(['image', 'audio', 'video', 'file']);

export function normalizeAttachmentIndex(input = {}) {
  const relativePath = String(input.relative_path || '').trim().replaceAll('\\', '/');
  if (!relativePath || relativePath.startsWith('/') || relativePath.startsWith('//') || /^[A-Za-z]:\//.test(relativePath) || relativePath.includes('../') || relativePath.includes('/..')) {
    throw new Error('附件路径必须是应用目录内的相对路径');
  }
  const mediaType = String(input.media_type || '').trim().toLowerCase();
  if (!MEDIA_TYPES.has(mediaType)) throw new Error('附件类型不受支持');
  const sha256 = String(input.sha256 || '').trim().toLowerCase();
  if (!SHA256_RE.test(sha256)) throw new Error('附件校验值格式错误');
  const byteSize = Number(input.byte_size);
  if (!Number.isSafeInteger(byteSize) || byteSize < 0) throw new Error('附件大小格式错误');
  return { relative_path: relativePath, media_type: mediaType, sha256, byte_size: byteSize };
}

function insertIdentityPack(db, pack) {
  const now = new Date().toISOString();
  const characterLocalId = `character-${randomUUID()}`;
  db.prepare(`INSERT INTO characters
    (local_id, remote_id, char_key, identity_json, current_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(characterLocalId, Number.isInteger(Number(pack.identity.id)) ? Number(pack.identity.id) : null, String(pack.identity.char_key || pack.identity.name), JSON.stringify(pack.identity), JSON.stringify(pack.current || {}), now, now);

  db.prepare(`INSERT INTO character_runtime
    (character_local_id, relationship_json, state_json, updated_at)
    VALUES (?, ?, ?, ?)`)
    .run(characterLocalId, JSON.stringify(pack.relationship || {}), JSON.stringify(pack.state || {}), now);

  const insertMemory = db.prepare(`INSERT INTO memories
    (local_id, remote_id, character_local_id, content, memory_type, source_type, source_id,
     review_status, confidence, weight, is_important, occurred_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const memory of pack.memories) {
    if (!isConfirmedLocalMemory(memory)) continue;
    insertMemory.run(
      `memory-${randomUUID()}`,
      Number.isInteger(Number(memory.id)) ? Number(memory.id) : null,
      characterLocalId,
      String(memory.content || ''),
      String(memory.memory_type || 'life'),
      memory.source_type || null,
      memory.source_id == null ? null : String(memory.source_id),
      String(memory.review_status || 'active'),
      Number.isFinite(Number(memory.confidence)) ? Number(memory.confidence) : null,
      Number.isFinite(Number(memory.weight)) ? Number(memory.weight) : null,
      memory.is_important ? 1 : 0,
      memory.occurred_at || null,
      now,
      now,
    );
  }
  db.prepare(`INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)`).run('last_import_at', now);
  return characterLocalId;
}

export async function importIdentityPack({ targetPath, backupDir, pack }) {
  assertIdentityPack(pack);
  const tempDir = join(dirname(targetPath), 'temp');
  const stagePath = join(tempDir, `identity-import-${randomUUID()}.sqlite`);
  await mkdir(tempDir, { recursive: true });
  let stage;
  try {
    stage = await openLocalDatabase(stagePath);
    stage.exec('BEGIN');
    const characterLocalId = insertIdentityPack(stage, pack);
    stage.exec('COMMIT');
    stage.close();
    stage = null;

    const targetExisted = await (async () => {
      try { await copyFile(targetPath, targetPath); return true; } catch { return false; }
    })();
    const backupPath = targetExisted
      ? join(backupDir, `data-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`)
      : null;
    if (backupPath) {
      await mkdir(backupDir, { recursive: true });
      await copyFile(targetPath, backupPath);
    }

    let target;
    try {
      target = await openLocalDatabase(targetPath);
      target.prepare('ATTACH DATABASE ? AS staged').run(stagePath);
      target.exec('BEGIN');
      target.exec(`INSERT INTO characters SELECT * FROM staged.characters`);
      target.exec(`INSERT INTO character_runtime SELECT * FROM staged.character_runtime`);
      target.exec(`INSERT INTO memories SELECT * FROM staged.memories`);
      target.exec(`INSERT OR REPLACE INTO app_meta SELECT * FROM staged.app_meta`);
      target.exec('COMMIT');
      target.exec('DETACH DATABASE staged');
      target.close();
      target = null;
    } catch (error) {
      try { target?.exec('ROLLBACK'); } catch {}
      try { target?.close(); } catch {}
      if (backupPath) await copyFile(backupPath, targetPath);
      throw error;
    }
    return { characterLocalId, backupPath };
  } finally {
    try { stage?.close(); } catch {}
    await rm(stagePath, { force: true });
    await rm(`${stagePath}-wal`, { force: true });
    await rm(`${stagePath}-shm`, { force: true });
  }
}

export { LOCAL_DATA_SCHEMA_VERSION, LOCAL_DATA_TABLES, getMigrationPlan };
