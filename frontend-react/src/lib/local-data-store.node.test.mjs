import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { importIdentityPack, migrateDatabase, normalizeAttachmentIndex, openLocalDatabase } from './local-data-store.node.mjs';
import { LOCAL_DATA_SCHEMA_VERSION, LOCAL_DATA_TABLES } from './local-data-schema.mjs';

async function tempRoot() {
  return mkdtemp(join(tmpdir(), 'ruobai-local-data-'));
}

const pack = {
  version: '1.1.0',
  identity: { id: 'xiaobai-test', name: '测试小白', persona: '只用于本机迁移测试' },
  current: { mood: 80, intimacy: 50 },
  relationship: { status: 'stable' },
  state: { mood: '平静' },
  memories: [
    { id: 11, content: '已确认的测试约定', memory_type: 'appointment', source_type: 'chat', review_status: 'active', confidence: 1, weight: 90, is_important: 1 },
    { id: 12, content: '不能导入的人格候选', memory_type: 'life', source_type: 'chat_candidate', review_status: 'active' },
  ],
};

test('creates a real SQLite file and migrates all planned tables', async () => {
  const root = await tempRoot();
  const path = join(root, 'data.sqlite');
  const db = await openLocalDatabase(path);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, LOCAL_DATA_SCHEMA_VERSION);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => row.name);
  assert.deepEqual(tables, [...LOCAL_DATA_TABLES].sort());
  db.close();
  assert.ok((await readFile(path)).length > 0);
  await rm(root, { recursive: true, force: true });
});

test('failed migration rolls back schema and version', async () => {
  const db = new DatabaseSync(':memory:');
  await assert.rejects(() => migrateDatabase(db, {
    targetVersion: 1,
    migrations: { 1: ['CREATE TABLE should_rollback (id INTEGER)', 'THIS IS NOT SQL'] },
  }));
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name = 'should_rollback'").get().count, 0);
  db.close();
});

test('imports through a staging database, backs up target, and excludes candidate memories', async () => {
  const root = await tempRoot();
  const targetPath = join(root, 'data.sqlite');
  const backupDir = join(root, 'backups');
  const initial = await openLocalDatabase(targetPath);
  initial.prepare('INSERT INTO app_meta (key, value) VALUES (?, ?)').run('sentinel', 'keep-me');
  initial.close();

  const result = await importIdentityPack({ targetPath, backupDir, pack });
  assert.ok(result.backupPath);
  const db = await openLocalDatabase(targetPath);
  assert.equal(db.prepare('SELECT value FROM app_meta WHERE key = ?').get('sentinel').value, 'keep-me');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM characters').get().count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM memories').get().count, 1);
  assert.equal(db.prepare('SELECT source_type FROM memories').get().source_type, 'chat');
  db.close();
  await rm(root, { recursive: true, force: true });
});

test('invalid import is rejected before touching the target database', async () => {
  const root = await tempRoot();
  const targetPath = join(root, 'data.sqlite');
  const db = await openLocalDatabase(targetPath);
  db.prepare('INSERT INTO app_meta (key, value) VALUES (?, ?)').run('sentinel', 'keep-me');
  db.close();
  await assert.rejects(() => importIdentityPack({ targetPath, backupDir: join(root, 'backups'), pack: { identity: {}, memories: [] } }), /角色名称/);
  const after = await openLocalDatabase(targetPath);
  assert.equal(after.prepare('SELECT value FROM app_meta WHERE key = ?').get('sentinel').value, 'keep-me');
  after.close();
  await rm(root, { recursive: true, force: true });
});

test('attachment index accepts private relative files and rejects path traversal', () => {
  const item = normalizeAttachmentIndex({
    relative_path: 'attachments/original/photo.webp',
    media_type: 'image',
    sha256: 'a'.repeat(64),
    byte_size: 128,
  });
  assert.equal(item.relative_path, 'attachments/original/photo.webp');
  assert.throws(() => normalizeAttachmentIndex({ ...item, relative_path: '../secrets.txt' }), /相对路径/);
  assert.throws(() => normalizeAttachmentIndex({ ...item, relative_path: 'C:/secrets.txt' }), /相对路径/);
  assert.throws(() => normalizeAttachmentIndex({ ...item, sha256: 'not-a-hash' }), /校验值/);
});
