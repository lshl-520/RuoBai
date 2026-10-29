import assert from 'node:assert/strict';
import { test } from 'node:test';

const storage = new Map();
globalThis.localStorage = {
  getItem(key) { return storage.has(key) ? storage.get(key) : null; },
  setItem(key, value) { storage.set(String(key), String(value)); },
  removeItem(key) { storage.delete(String(key)); },
  clear() { storage.clear(); },
};

const { appendCachedMessages, clearCachedMessages, readCachedMessages } = await import('./local-message-cache.js');

function setSession(userId) {
  localStorage.setItem('ruobai_session_snapshot', JSON.stringify({
    loggedIn: true,
    user: { id: userId },
    savedAt: Date.now(),
  }));
}

function message(id, role, content, createdAt) {
  return {
    id,
    role,
    content,
    message_type: 'text',
    character_id: 12,
    created_at: createdAt,
  };
}

test('persists user and assistant messages for the signed-in account', async () => {
  localStorage.clear();
  setSession(7);

  await appendCachedMessages(12, [
    message(101, 'user', '你好', '2026-09-22T10:00:00.000Z'),
    message(102, 'assistant', '我在呢', '2026-09-22T10:00:01.000Z'),
  ]);

  const cached = await readCachedMessages(12);
  assert.deepEqual(cached?.items.map(item => [item.id, item.role, item.content]), [
    [101, 'user', '你好'],
    [102, 'assistant', '我在呢'],
  ]);
});

test('deduplicates repeated remote ids while retaining new messages', async () => {
  setSession(7);

  await appendCachedMessages(12, [
    message(101, 'user', '你好', '2026-09-22T10:00:00.000Z'),
    message(103, 'user', '继续', '2026-09-22T10:00:02.000Z'),
  ]);

  const cached = await readCachedMessages(12);
  assert.deepEqual(cached?.items.map(item => item.id), [101, 102, 103]);
});

test('clears the conversation cache without affecting another account', async () => {
  setSession(8);
  await appendCachedMessages(12, [message(201, 'user', '另一个账号', '2026-09-22T11:00:00.000Z')]);

  setSession(7);
  await clearCachedMessages(12);
  assert.equal(await readCachedMessages(12), null);

  setSession(8);
  const otherAccount = await readCachedMessages(12);
  assert.deepEqual(otherAccount?.items.map(item => item.id), [201]);
});
