import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { requireAuth } from './middleware.js';
import defaultTtsRouter, { createTtsRouter, isQwenDashscopeTts, isVolcDoubaoTts, parseVolcTtsStream } from './tts.js';

test('默认导出是已经创建好的 TTS 路由，而不是路由工厂', () => {
  assert.equal(typeof defaultTtsRouter, 'function');
  assert.ok(Array.isArray(defaultTtsRouter.stack));
  assert.ok(defaultTtsRouter.stack.some(layer => layer.route?.path === '/preview'));
  assert.ok(defaultTtsRouter.stack.some(layer => layer.route?.path === '/speak'));
});

function createApp({ router, sessionUser = { userId: 7, username: 'user-7', role: 'user' } }) {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use((req, _res, next) => {
    req.session = sessionUser
      ? {
          userId: sessionUser.userId,
          username: sessionUser.username,
          role: sessionUser.role
        }
      : null;
    next();
  });
  app.use('/api/tts', requireAuth, router);
  app.use((error, _req, res, _next) => {
    res.status(500).json({
      success: false,
      error: error.message
    });
  });
  return app;
}

async function withServer(app, run) {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

function createPool({ model = 'qwen3-tts-vd-2026-01-26', apiBase = 'https://dashscope.aliyuncs.com/compatible-mode/v1', voiceId = 'longwan' } = {}) {
  return {
    query: async (sql, params) => {
      if (sql.includes('FROM messages')) {
        assert.deepEqual(params, [91, 7]);
        return [[{
          id: 91,
          user_id: 7,
          role: 'assistant',
          content: '晚安，今天辛苦啦。',
          character_id: 3
        }]];
      }

      if (sql.includes('FROM capability_assignments ca')) {
        assert.deepEqual(params, [7, 'tts']);
        return [[{
          capability: 'tts',
          enabled: 1,
          extras: JSON.stringify({ voice_id: voiceId }),
          api_base: apiBase,
          api_key: 'sk-qwen',
          model
        }]];
      }

      throw new Error(`Unexpected query: ${sql}`);
    }
  };
}

test('isQwenDashscopeTts matches qwen tts models and dashscope api_base', () => {
  assert.equal(isQwenDashscopeTts('qwen-tts-vd-bailian-voice-xxx', ''), true);
  assert.equal(isQwenDashscopeTts('qwen3-tts-vd-2026-01-26', ''), true);
  assert.equal(isQwenDashscopeTts('custom-model', 'https://dashscope.aliyuncs.com/compatible-mode/v1'), true);
  assert.equal(isQwenDashscopeTts('gpt-4o-mini-tts', 'https://api.openai.com/v1'), false);
});

test('POST /api/tts/speak downloads qwen audio url and caches mp3', async () => {
  const writes = [];
  const upstreamCalls = [];

  const router = createTtsRouter({
    fileStorage: {
      mkdir: async dir => {
        writes.push({ type: 'mkdir', dir });
      },
      writeFile: async (filePath, content) => {
        writes.push({ type: 'write', filePath, size: content.length });
      },
      access: async () => {
        throw new Error('not cached');
      }
    },
    fetchImpl: async (url, options) => {
      upstreamCalls.push({ url, options });
      if (url === 'https://audio.example.com/tts-91.mp3') {
        return {
          ok: true,
          arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
          text: async () => ''
        };
      }

      return {
        ok: true,
        text: async () => JSON.stringify({
          output: {
            audio: {
              url: 'https://audio.example.com/tts-91.mp3'
            }
          },
          request_id: 'req-91'
        })
      };
    },
    pool: createPool()
  });

  await withServer(createApp({ router }), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/tts/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message_id: 91 })
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.match(payload.audio_url, /^\/user_assets\/tts\/91-[a-f0-9]{14}\.mp3$/);
    assert.equal(payload.voice_id, 'longwan');
    assert.equal(upstreamCalls.length, 2);
    assert.equal(upstreamCalls[0].url, 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation');
    assert.equal(upstreamCalls[1].url, 'https://audio.example.com/tts-91.mp3');
    const body = JSON.parse(upstreamCalls[0].options.body);
    assert.equal(body.model, 'qwen3-tts-vd-2026-01-26');
    assert.equal(body.input.text, '晚安，今天辛苦啦。');
    assert.equal(body.input.voice, 'longwan');
    assert.equal(body.parameters.format, 'mp3');
    assert.equal(body.parameters.response_format, 'mp3');
    assert.ok(writes.some(item => item.type === 'write' && /91-[a-f0-9]{14}\.mp3$/.test(item.filePath) && item.size === 4));
  });
});

test('POST /api/tts/speak sends xiaobai dedicated voice to qwen model', async () => {
  let requestBody;

  const router = createTtsRouter({
    fileStorage: {
      mkdir: async () => {},
      writeFile: async () => {},
      access: async () => {
        throw new Error('not cached');
      }
    },
    fetchImpl: async (url, options) => {
      requestBody = JSON.parse(options.body);
      return {
        ok: true,
        text: async () => JSON.stringify({
          output: {
            audio: {
              base64: Buffer.from('xiaobai-audio').toString('base64')
            }
          }
        })
      };
    },
    pool: createPool({
      model: 'qwen3-tts-vd-2026-01-26',
      voiceId: 'qwen-tts-vd-bailian-voice-20260511143305690-0d51'
    })
  });

  await withServer(createApp({ router }), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/tts/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message_id: 91 })
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.voice_id, 'qwen-tts-vd-bailian-voice-20260511143305690-0d51');
    assert.equal(requestBody.model, 'qwen3-tts-vd-2026-01-26');
    assert.equal(requestBody.input.voice, 'qwen-tts-vd-bailian-voice-20260511143305690-0d51');
  });
});

test('POST /api/tts/speak decodes qwen base64 audio and caches mp3', async () => {
  const writes = [];
  const router = createTtsRouter({
    fileStorage: {
      mkdir: async () => {},
      writeFile: async (filePath, content) => {
        writes.push({ filePath, content });
      },
      access: async () => {
        throw new Error('not cached');
      }
    },
    fetchImpl: async () => ({
      ok: true,
      text: async () => JSON.stringify({
        output: {
          audio: {
            base64: Buffer.from([7, 8, 9]).toString('base64')
          }
        }
      })
    }),
    pool: createPool()
  });

  await withServer(createApp({ router }), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/tts/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message_id: 91 })
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(writes.length, 1);
    assert.deepEqual([...writes[0].content], [7, 8, 9]);
  });
});

test('POST /api/tts/speak uses qwen path when only api_base contains dashscope', async () => {
  const upstreamCalls = [];
  const router = createTtsRouter({
    fileStorage: {
      mkdir: async () => {},
      writeFile: async () => {},
      access: async () => {
        throw new Error('not cached');
      }
    },
    fetchImpl: async (url, options) => {
      upstreamCalls.push({ url, options });
      return {
        ok: true,
        text: async () => JSON.stringify({
          output: {
            audio: {
              data: Buffer.from([5, 6]).toString('base64')
            }
          }
        })
      };
    },
    pool: createPool({ model: 'custom-tts-model', apiBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1' })
  });

  await withServer(createApp({ router }), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/tts/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message_id: 91 })
    });

    assert.equal(response.status, 200);
    assert.equal(upstreamCalls.length, 1);
    assert.equal(upstreamCalls[0].url, 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation');
  });
});

test('POST /api/tts/speak returns human qwen error by upstream status', async () => {
  const cases = [
    [401, 'API key 不对或没权限调用 qwen3-tts-vd-2026-01-26'],
    [403, 'API key 不对或没权限调用 qwen3-tts-vd-2026-01-26'],
    [404, 'TTS 模型名拼错了，去千问后台核对：qwen3-tts-vd-2026-01-26'],
    [422, '音色 ID 不对（当前用 bad-voice），常用千问音色：longwan / longfeifei_v3 / longxing_v3'],
    [400, '音色 ID 不对（当前用 bad-voice），常用千问音色：longwan / longfeifei_v3 / longxing_v3'],
    [503, '千问 TTS 服务暂时挂了，过会儿再试']
  ];

  for (const [status, expected] of cases) {
    const router = createTtsRouter({
      fileStorage: {
        mkdir: async () => {},
        writeFile: async () => {},
        access: async () => {
          throw new Error('not cached');
        }
      },
      fetchImpl: async () => ({
        ok: false,
        status,
        text: async () => JSON.stringify({ message: 'upstream failed' })
      }),
      pool: createPool({ voiceId: 'bad-voice' })
    });

    await withServer(createApp({ router }), async baseUrl => {
      const response = await fetch(`${baseUrl}/api/tts/speak`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message_id: 91 })
      });
      const payload = await response.json();

      assert.equal(response.status, 400);
      assert.equal(payload.success, false);
      assert.equal(payload.error, expected);
    });
  }
});

test('POST /api/tts/speak returns browser tts signal without upstream call or cache write', async () => {
  let fetchCalled = false;
  let writeCalled = false;

  const router = createTtsRouter({
    fileStorage: {
      mkdir: async () => {},
      writeFile: async () => {
        writeCalled = true;
      },
      access: async () => {
        throw new Error('not cached');
      }
    },
    fetchImpl: async () => {
      fetchCalled = true;
      throw new Error('fetch should not be called');
    },
    pool: createPool({ voiceId: 'browser' })
  });

  await withServer(createApp({ router }), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/tts/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message_id: 91 })
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.use_browser_tts, true);
    assert.equal(payload.text, '晚安，今天辛苦啦。');
    assert.equal(payload.voice_id, 'browser');
    assert.equal(fetchCalled, false);
    assert.equal(writeCalled, false);
  });
});

test('POST /api/tts/speak returns cached audio when mp3 already exists', async () => {
  let fetchCalled = false;

  const router = createTtsRouter({
    fileStorage: {
      mkdir: async () => {},
      writeFile: async () => {},
      access: async filePath => {
        assert.match(filePath, /91-[a-f0-9]{14}\.mp3$/);
      }
    },
    fetchImpl: async () => {
      fetchCalled = true;
      throw new Error('fetch should not be called');
    },
    pool: {
      query: async (sql, params) => {
        if (sql.includes('FROM messages')) {
          return [[{
            id: 91,
            user_id: 7,
            role: 'assistant',
            content: '已经缓存好了。',
            character_id: 3
          }]];
        }

        if (sql.includes('FROM capability_assignments ca')) {
          assert.deepEqual(params, [7, 'tts']);
          return [[{
            capability: 'tts',
            enabled: 1,
            extras: '{"voice_id":"longwan"}',
            api_base: 'https://api.openai.com/v1',
            api_key: 'sk-openai',
            model: 'gpt-4o-mini-tts'
          }]];
        }

        throw new Error(`Unexpected query: ${sql}`);
      }
    }
  });

  await withServer(createApp({ router }), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/tts/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message_id: 91 })
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.match(payload.audio_url, /^\/user_assets\/tts\/91-[a-f0-9]{14}\.mp3$/);
    assert.equal(fetchCalled, false);
  });
});


test('isVolcDoubaoTts identifies the merged doubao voice channel', () => {
  assert.equal(isVolcDoubaoTts({ provider_type: 'volc-realtime', model: 'seed-tts-2.0' }), true);
  assert.equal(isVolcDoubaoTts({ model: 'seed-tts-2.0' }), true);
  assert.equal(isVolcDoubaoTts({ api_base: 'https://openspeech.bytedance.com/api/v3' }), true);
  assert.equal(isVolcDoubaoTts({ provider_type: 'openai-compatible', model: 'qwen3-tts-vd' }), false);
});

test('parseVolcTtsStream joins multiple base64 audio chunks', () => {
  const result = parseVolcTtsStream([
    JSON.stringify({ code: 0, data: Buffer.from([1, 2]).toString('base64') }),
    JSON.stringify({ code: 0, data: Buffer.from([3, 4, 5]).toString('base64') }),
    JSON.stringify({ code: 20000000, usage: { characters: 6 } })
  ].join('\n'));

  assert.deepEqual([...result.audioBuffer], [1, 2, 3, 4, 5]);
  assert.equal(result.finished, true);
  assert.deepEqual(result.usage, { characters: 6 });
});

test('POST /api/tts/preview calls doubao seed tts and returns cached mp3', async () => {
  const upstreamCalls = [];
  const writes = [];
  const pool = {
    query: async (sql, params) => {
      if (sql.includes('FROM capability_assignments ca')) {
        assert.deepEqual(params, [7, 'tts']);
        return [[{
          capability: 'tts',
          enabled: 1,
          extras: JSON.stringify({ voice_id: 'saturn_zh_female_wenrouwenya_tob', resource_id: 'seed-tts-2.0' }),
          provider_type: 'volc-realtime',
          api_base: 'wss://openspeech.bytedance.com/api/v3/realtime/dialogue',
          api_key: 'volc-test-key',
          model: 'seed-tts-2.0'
        }]];
      }
      throw new Error(`Unexpected query: ${sql}`);
    }
  };

  const router = createTtsRouter({
    pool,
    fileStorage: {
      mkdir: async () => {},
      access: async () => { throw new Error('not cached'); },
      writeFile: async (filePath, content) => writes.push({ filePath, content })
    },
    fetchImpl: async (url, options) => {
      upstreamCalls.push({ url, options });
      return {
        ok: true,
        status: 200,
        text: async () => [
          JSON.stringify({ code: 0, data: Buffer.from([9, 8]).toString('base64') }),
          JSON.stringify({ code: 20000000 })
        ].join('\n')
      };
    }
  });

  await withServer(createApp({ router }), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/tts/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '我在呢。', voice_override: 'saturn_zh_female_wenrouwenya_tob', rate: 0.9 })
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.match(payload.audio_url, /^\/user_assets\/tts\/preview-7-[a-f0-9]{14}\.mp3$/);
    assert.equal(upstreamCalls.length, 1);
    assert.equal(upstreamCalls[0].url, 'https://openspeech.bytedance.com/api/v3/tts/unidirectional');
    assert.equal(upstreamCalls[0].options.headers['X-Api-Key'], 'volc-test-key');
    assert.equal(upstreamCalls[0].options.headers['X-Api-Resource-Id'], 'seed-tts-2.0');
    const body = JSON.parse(upstreamCalls[0].options.body);
    assert.equal(body.req_params.text, '我在呢。');
    assert.equal(body.req_params.speaker, 'saturn_zh_female_wenrouwenya_tob');
    assert.equal(body.req_params.audio_params.format, 'mp3');
    assert.equal(body.req_params.audio_params.sample_rate, 24000);
    assert.equal(body.req_params.audio_params.speech_rate, -10);
    assert.deepEqual([...writes[0].content], [9, 8]);
  });
});

test('POST /api/tts/speak can convert an assistant text message into a persistent voice message', async () => {
  const updates = [];
  const pool = {
    query: async (sql, params) => {
      if (sql.includes('FROM messages')) {
        return [[{
          id: 91,
          user_id: 7,
          role: 'assistant',
          content: '这次换我说给你听。',
          character_id: 3,
          message_type: 'text',
          media_url: null
        }]];
      }
      if (sql.includes('FROM capability_assignments ca')) {
        return [[{
          capability: 'tts',
          enabled: 1,
          extras: JSON.stringify({ voice_id: 'alloy' }),
          provider_type: 'openai-compatible',
          api_base: 'https://api.example.com/v1',
          api_key: 'tts-test-key',
          model: 'gpt-4o-mini-tts'
        }]];
      }
      if (sql.includes("UPDATE messages") && sql.includes("message_type = 'voice'")) {
        updates.push(params);
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected query: ${sql}`);
    }
  };
  const router = createTtsRouter({
    pool,
    fileStorage: {
      mkdir: async () => {},
      access: async () => { throw new Error('not cached'); },
      writeFile: async () => {}
    },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new Uint8Array([6, 6, 6]).buffer,
      text: async () => ''
    })
  });

  await withServer(createApp({ router }), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/tts/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message_id: 91, convert_to_voice: true, voice_override: 'alloy', rate: 1 })
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.converted_to_voice, true);
    assert.equal(updates.length, 1);
    assert.deepEqual(updates[0], [payload.audio_url, 91, 7]);
  });
});
