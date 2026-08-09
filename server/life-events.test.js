import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {
  buildLifeEventKey,
  createLifeEventsRouter,
  normalizeLifeEventStatus,
  parseLifeEventSourceRef,
  recordLifeEventSource
} from './life-events.js';

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

test('life event keys normalize a reminder-style follow-up to the same event', () => {
  assert.equal(
    buildLifeEventKey('我们约好 2026年8月6日 一起看电影，记得提醒我。'),
    buildLifeEventKey('你还记得我们约好 2026-08-06 一起看电影吗？')
  );
});

test('life event statuses include explicit expiry but reject unknown values', () => {
  assert.equal(normalizeLifeEventStatus('expired'), 'expired');
  assert.equal(normalizeLifeEventStatus('cancelled'), 'cancelled');
  assert.equal(normalizeLifeEventStatus('unknown'), null);
});

test('life event source keeps an auditable source and deduplicates it', async () => {
  const calls = [];
  const db = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('FROM life_event_sources')) return [[]];
      if (sql.includes('FROM life_events')) return [[]];
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

  assert.deepEqual(created, { id: 41, reused: false, merged: false });
  assert.equal(calls.length, 4);
  assert.equal(calls[3].params[2], 'moment');
});

test('life event source reuses an existing source without rewriting it', async () => {
  const db = {
    query: async (sql) => {
      if (sql.includes('FROM life_event_sources')) return [[{
        id: 41,
        event_id: 41,
        character_id: 6,
        title: '我们约好明天一起看电影',
        event_type: 'appointment',
        status: 'active',
        expires_at: null,
        event_key: null
      }]];
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

  assert.deepEqual(reused, { id: 41, reused: true, merged: false });
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

test('life event source keeps a generated moment even without chat-like keywords', async () => {
  const calls = [];
  const db = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('FROM life_event_sources')) return [[]];
      if (sql.includes('FROM life_events')) return [[]];
      if (sql.includes('INSERT INTO life_events')) return [{ insertId: 42 }];
      if (sql.includes('INSERT INTO life_event_sources')) return [{ insertId: 53 }];
      throw new Error(`Unexpected query: ${sql}`);
    }
  };

  const created = await recordLifeEventSource(db, {
    userId: 1,
    characterId: 6,
    sourceType: 'moment',
    sourceId: 10,
    title: '路上遇到一只慢悠悠的猫，心情也亮起来了。',
    eventType: 'life'
  });

  assert.deepEqual(created, { id: 42, reused: false, merged: false });
  assert.equal(calls.length, 4);
});

test('life event source attaches a comment to the existing moment event', async () => {
  const calls = [];
  const db = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('FROM life_event_sources')) {
        if (params[1] === 'comment') return [[]];
        if (params[1] === 'moment') {
          return [[{
            id: 41,
            event_id: 41,
            character_id: 6,
            title: '路上遇到一只猫',
            event_type: 'life',
            status: 'active',
            expires_at: null,
            event_key: null
          }]];
        }
      }
      if (sql.includes('INSERT IGNORE INTO life_event_sources')) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected query: ${sql}`);
    }
  };

  const merged = await recordLifeEventSource(db, {
    userId: 1,
    characterId: 6,
    sourceType: 'comment',
    sourceId: 99,
    title: '哈哈，这只猫真可爱',
    relatedSourceType: 'moment',
    relatedSourceId: 10
  });

  assert.deepEqual(merged, { id: 41, reused: false, merged: true });
  assert.equal(calls.at(-1).params[0], 41);
});

test('a completed event is not revived by a matching new source', async () => {
  const db = {
    query: async (sql, params) => {
      if (sql.includes('FROM life_event_sources')) {
        if (params[1] === 'chat') return [[]];
        return [[{
          id: 71,
          event_id: 41,
          character_id: 6,
          title: '我们约好明天一起看电影',
          event_type: 'appointment',
          status: 'completed',
          expires_at: null,
          event_key: buildLifeEventKey('我们约好明天一起看电影')
        }]];
      }
      if (sql.includes('FROM life_events')) return [[{
        id: 41,
        character_id: 6,
        title: '我们约好明天一起看电影',
        event_type: 'appointment',
        status: 'completed',
        expires_at: null,
        event_key: buildLifeEventKey('我们约好明天一起看电影')
      }]];
      if (sql.includes('INSERT INTO life_events')) return [{ insertId: 42 }];
      if (sql.includes('INSERT INTO life_event_sources')) return [{ insertId: 53 }];
      throw new Error(`Unexpected query: ${sql} ${JSON.stringify(params)}`);
    }
  };

  const created = await recordLifeEventSource(db, {
    userId: 1,
    characterId: 6,
    sourceType: 'chat',
    sourceId: 100,
    title: '我们约好明天一起看电影'
  });

  assert.deepEqual(created, { id: 42, reused: false, merged: false });
});

test('PATCH life event supports correction notes and expiry status', async () => {
  const calls = [];
  const router = createLifeEventsRouter({
    requireCharacter: async (userId, characterId) => assert.deepEqual([userId, characterId], [1, 6]),
    db: {
      query: async (sql, params) => {
        calls.push({ sql, params });
        if (sql.includes('SELECT id, character_id, title FROM life_events')) {
          return [[{ id: 41, character_id: 6, title: '原来的标题' }]];
        }
        if (sql.includes('UPDATE life_events')) return [{ affectedRows: 1 }];
        throw new Error(`Unexpected query: ${sql}`);
      }
    }
  });

  await withServer(createApp(router), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/life-events/41`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '纠正后的标题', status: 'expired', status_note: '这件事已经过期' })
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.corrected, true);
    assert.equal(payload.status, 'expired');
    assert.match(calls.at(-1).sql, /corrected_at = NOW\(\)/i);
    assert.ok(calls.at(-1).params.includes('这件事已经过期'));
  });
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
