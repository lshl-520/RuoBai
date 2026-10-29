export const LOCAL_DATA_SCHEMA_VERSION = 1;

// This is a planning-level schema manifest. It has no SQLite driver dependency yet.
export const LOCAL_DATA_TABLES = Object.freeze([
  'app_meta',
  'characters',
  'character_runtime',
  'memories',
  'messages',
  'moments',
  'moment_comments',
  'attachments',
  'sync_journal',
]);

const INITIAL_SCHEMA_SQL = Object.freeze([
  `CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE characters (local_id TEXT PRIMARY KEY, remote_id INTEGER, char_key TEXT NOT NULL, identity_json TEXT NOT NULL, current_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE character_runtime (character_local_id TEXT PRIMARY KEY, relationship_json TEXT NOT NULL, state_json TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE memories (local_id TEXT PRIMARY KEY, remote_id INTEGER, character_local_id TEXT NOT NULL, content TEXT NOT NULL, memory_type TEXT NOT NULL, source_type TEXT, source_id TEXT, review_status TEXT NOT NULL, confidence REAL, weight INTEGER, is_important INTEGER NOT NULL DEFAULT 0, occurred_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE messages (local_id TEXT PRIMARY KEY, remote_id INTEGER, character_local_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, message_type TEXT NOT NULL, media_ref TEXT, created_at TEXT NOT NULL, sync_state TEXT NOT NULL)`,
  `CREATE TABLE moments (local_id TEXT PRIMARY KEY, remote_id INTEGER, character_local_id TEXT, content TEXT NOT NULL, visibility_mode TEXT NOT NULL, created_at TEXT NOT NULL, sync_state TEXT NOT NULL)`,
  `CREATE TABLE moment_comments (local_id TEXT PRIMARY KEY, remote_id INTEGER, moment_local_id TEXT NOT NULL, author_type TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL, sync_state TEXT NOT NULL)`,
  `CREATE TABLE attachments (local_id TEXT PRIMARY KEY, owner_type TEXT NOT NULL, owner_local_id TEXT NOT NULL, relative_path TEXT NOT NULL, media_type TEXT NOT NULL, sha256 TEXT NOT NULL, byte_size INTEGER NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE sync_journal (batch_id TEXT NOT NULL, object_type TEXT NOT NULL, object_local_id TEXT NOT NULL, operation TEXT NOT NULL, result TEXT NOT NULL, detail TEXT, created_at TEXT NOT NULL, PRIMARY KEY (batch_id, object_type, object_local_id))`,
]);

export const LOCAL_DATA_MIGRATIONS = Object.freeze({
  1: INITIAL_SCHEMA_SQL,
});

export function getMigrationPlan(fromVersion = 0, toVersion = LOCAL_DATA_SCHEMA_VERSION) {
  const from = Number(fromVersion);
  const to = Number(toVersion);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > LOCAL_DATA_SCHEMA_VERSION) {
    throw new Error(`不支持的本地数据版本迁移：${fromVersion} -> ${toVersion}`);
  }
  return Array.from({ length: to - from }, (_, index) => from + index + 1)
    .flatMap(version => LOCAL_DATA_MIGRATIONS[version] || []);
}

export function isConfirmedLocalMemory(memory = {}) {
  return ['active', 'important'].includes(String(memory.review_status || ''))
    && String(memory.source_type || '').trim() !== 'chat_candidate';
}
