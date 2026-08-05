import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createLifeEventsRouter, parseLifeEventSourceRef, recordLifeEventSource } from './life-events.js';

function createApp(router) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.userId = 1; next(); });
  app.use('/api/life-events', router);
  app.use((error, _req, res, _next) => res.status(500).json({ success: false, error: error.message }));
  return app;
}

async function withServer(app, run) {
  const server = app.listen(0);
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('life event source references only accept known source types and numeric ids', () => {
  assert.deepEqual(parseLifeEventSourceRef('chat:123'), { sourceType: 'chat', sourceId: '123' });
  assert.deepEqual(parseLifeEventSourceRef('COMMENT:9'), { sourceType: 'comment', sourceId: '9' });
  assert.equal(parseLifeEventSourceRef('role:9'), null);
  assert.equal(parseLifeEventSourceRef('chat:not-a-number'), null);
});

test('life event source keeps an auditable source and deduplicates it', async () => {
  const calls = [];
  const db = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('SELECT event_id')) return [[]];
      if (sql.includes('INSERT INTO life_events')) return [{ insertId: 41 }];
      if (sql.includes('INSERT INTO life_event_sources')) return [{ insertId: 52 }];
      throw new Error(`Unexpected query: ${sql}`);
    }
  };

  const created = await recordLifeEventSource(db, {
    userId: 1,
    characterId: 6,
    sourceType: 'moment',
    sourceId: 9,
    title: '今天和小白一起吃了晚饭',
    eventType: 'life'
  });

  assert.deepEqual(created, { id: 41, reused: false });
  assert.equal(calls.length, 3);
  assert.equal(calls[2].params[2], 'moment');
});

test('life event source reuses an existing source without rewriting it', async () => {
  const db = {
    query: async (sql) => {
      if (sql.includes('SELECT event_id')) return [[{ event_id: 41 }]];
      throw new Error('duplicate source should not write');
    }
  };

  const reused = await recordLifeEventSource(db, {
    userId: 1,
    characterId: 6,
    sourceType: 'chat',
    sourceId: 33,
    title: '我们约好明天一起看电影'
  });

  assert.deepEqual(reused, { id: 41, reused: true });
});

test('life event source ignores content without a personal event signal', async () => {
  let called = false;
  const result = await recordLifeEventSource({ query: async () => { called = true; } }, {
    userId: 1,
    characterId: 6,
    sourceType: 'chat',
    sourceId: 34,
    title: '好的'
  });

  assert.equal(result, null);
  assert.equal(called, false);
});

test('GET life event source returns only the current role chat message', async () => {
  const calls = [];
  const router = createLifeEventsRouter({
    requireCharacter: async (userId, characterId) => {
      assert.deepEqual([userId, characterId], [1, 6]);
    },
    db: {
      query: async (sql, params) => {
        calls.push({ sql, params });
        if (sql.includes('FROM life_events')) return [[{ id: 41, character_id: 6 }]];
        if (sql.includes('FROM life_event_sources')) return [[{ source_type: 'chat', source_id: 7 }]];
        if (sql.includes('FROM messages')) return [[{
          id: 7, character_id: 6, role: 'user', content: '我们约好今天一起吃饭',
          message_type: 'text', media_url: null, created_at: '2026-08-03 12:00:00', is_active: 1
        }]];
        throw new Error(`Unexpected query: ${sql}`);
      }
    }
  });

  await withServer(createApp(router), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/life-events/41/source/chat/7`);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.source.type, 'chat');
    assert.equal(payload.source.content, '我们约好今天一起吃饭');
    assert.equal(calls.length, 3);
  });
});

test('GET life event source rejects a source that is not recorded on the event', async () => {
  const router = createLifeEventsRouter({
    requireCharacter: async () => {},
    db: {
      query: async (sql) => {
        if (sql.includes('FROM life_events')) return [[{ id: 41, character_id: 6 }]];
        if (sql.includes('FROM life_event_sources')) return [[]];
        throw new Error(`Unexpected query: ${sql}`);
      }
    }
  });

  await withServer(createApp(router), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/life-events/41/source/chat/7`);
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error, '来源不存在或不属于这个角色');
  });
});

test('DELETE life event removes only the owned review index', async () => {
  const calls = [];
  const router = createLifeEventsRouter({
    db: {
      query: async (sql, params) => {
        calls.push({ sql, params });
        if (sql.includes('DELETE FROM life_events')) return [{ affectedRows: 1 }];
        throw new Error(`Unexpected query: ${sql}`);
      }
    }
  });

  await withServer(createApp(router), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/life-events/41`, { method: 'DELETE' });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(payload, { success: true, id: 41 });
    assert.deepEqual(calls[0].params, [41, 1]);
  });
});
