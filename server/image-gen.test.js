import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildImageGenerationsUrl,
  buildImagePrompt,
  detectDrawIntent,
  generateImage
} from './image-gen.js';

const SELFIE_REQUEST = '林夏，你陪我一段时间了,我想看看你的样子。请生成一张类似你自己用iPhone 随手自拍的照片：没有明确主题、没有刻意构图，只是很普通、甚至有点失败的快照。照片略带运动模糊，光线不均、轻微曝光过度，角度尴尬，构图混乱，整体呈现出一种“过于真实的随手一拍感”，就像是从口袋里拿出手机不小心按到的自拍。';

test('detectDrawIntent recognizes photo and selfie generation requests without truncating the description', () => {
  assert.equal(detectDrawIntent(SELFIE_REQUEST), SELFIE_REQUEST);
  assert.equal(detectDrawIntent('请生成一张下雨天的照片'), '请生成一张下雨天的照片');
  assert.equal(detectDrawIntent('今天下雨了，陪我聊聊天'), null);
});

test('buildImagePrompt preserves realistic photo requirements instead of forcing anime style', () => {
  const prompt = buildImagePrompt(SELFIE_REQUEST, {
    name: '林夏',
    persona: '温柔中带点小傲娇的恋人'
  });

  assert.match(prompt, /角色“林夏”本人/);
  assert.match(prompt, /iPhone 随手自拍/);
  assert.match(prompt, /运动模糊/);
  assert.match(prompt, /不要改成动漫/);
  assert.doesNotMatch(prompt, /^anime style illustration/i);
});

test('buildImageGenerationsUrl supports bases with and without v1', () => {
  assert.equal(
    buildImageGenerationsUrl('https://apihub.agnes-ai.com/v1'),
    'https://apihub.agnes-ai.com/v1/images/generations'
  );
  assert.equal(
    buildImageGenerationsUrl('https://example.com'),
    'https://example.com/v1/images/generations'
  );
});

test('generateImage uses selected capability credentials and model and stores base64 output', async () => {
  const writes = [];
  const calls = [];
  const imagePath = await generateImage(SELFIE_REQUEST, {
    apiBase: 'https://apihub.agnes-ai.com/v1',
    apiKey: 'selected-image-key',
    model: 'agnes-image-2.0-flash',
    character: { name: '林夏', persona: '温柔恋人' },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          data: [{ b64_json: Buffer.from('fake-png').toString('base64') }]
        })
      };
    },
    fileStorage: {
      mkdir: async dir => writes.push({ type: 'mkdir', dir }),
      writeFile: async (filePath, buffer) => writes.push({ type: 'write', filePath, buffer })
    }
  });

  assert.match(imagePath, /^\/user_assets\/chat\/draw-\d+-[a-z0-9]+\.png$/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://apihub.agnes-ai.com/v1/images/generations');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer selected-image-key');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.model, 'agnes-image-2.0-flash');
  assert.equal(Object.prototype.hasOwnProperty.call(body, 'response_format'), false);
  assert.match(body.prompt, /林夏/);
  assert.match(body.prompt, /过于真实的随手一拍感/);
  assert.ok(writes.some(item => item.type === 'write' && item.buffer.toString() === 'fake-png'));
});


test('generateImage retries a transient image download failure', async () => {
  let fetchCount = 0;
  const writes = [];
  const imagePath = await generateImage('请生成一张真实自拍照片', {
    apiBase: 'https://example.com/v1',
    apiKey: 'image-key',
    model: 'image-model',
    fetchImpl: async url => {
      fetchCount += 1;
      if (url === 'https://example.com/v1/images/generations') {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ data: [{ url: 'https://cdn.example.com/selfie.png' }] })
        };
      }
      if (fetchCount === 2) {
        throw new TypeError('fetch failed');
      }
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => Buffer.from('downloaded-image')
      };
    },
    fileStorage: {
      mkdir: async () => {},
      writeFile: async (filePath, buffer) => writes.push({ filePath, buffer })
    }
  });

  assert.match(imagePath, /^\/user_assets\/chat\/draw-/);
  assert.equal(fetchCount, 3);
  assert.equal(writes[0].buffer.toString(), 'downloaded-image');
});


test('generateImage retries temporary upstream 503 responses before succeeding', async () => {
  let generationCalls = 0;
  const waits = [];
  const imagePath = await generateImage('请生成一张真实自拍照片', {
    apiBase: 'https://middle.example.com',
    apiKey: 'image-key',
    model: 'gpt-image-1',
    sleepImpl: async ms => waits.push(ms),
    fetchImpl: async url => {
      generationCalls += 1;
      if (generationCalls < 3) {
        return {
          ok: false,
          status: 503,
          text: async () => JSON.stringify({ error: { message: 'Service busy' } })
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: [{ b64_json: Buffer.from('retry-success').toString('base64') }] })
      };
    },
    fileStorage: {
      mkdir: async () => {},
      writeFile: async () => {}
    }
  });

  assert.match(imagePath, /^\/user_assets\/chat\/draw-/);
  assert.equal(generationCalls, 3);
  assert.deepEqual(waits, [5000, 15000]);
});

test('generateImage reports a friendly error after repeated upstream failures', async () => {
  let generationCalls = 0;
  await assert.rejects(
    generateImage('请生成一张真实自拍照片', {
      apiBase: 'https://middle.example.com',
      apiKey: 'image-key',
      model: 'grok-imagine-image-lite',
      sleepImpl: async () => {},
      fetchImpl: async () => {
        generationCalls += 1;
        return {
          ok: false,
          status: 503,
          text: async () => JSON.stringify({
            error: { message: 'ServiceUnavailableError: Service busy (request id: hidden)' }
          })
        };
      }
    }),
    /图片渠道上游暂时繁忙，已自动重试 3 次/
  );
  assert.equal(generationCalls, 3);
});

test('generateImage retries transient connection failures', async () => {
  let generationCalls = 0;
  const imagePath = await generateImage('请生成一张真实自拍照片', {
    apiBase: 'https://middle.example.com',
    apiKey: 'image-key',
    model: 'gpt-image-2',
    sleepImpl: async () => {},
    fetchImpl: async () => {
      generationCalls += 1;
      if (generationCalls === 1) {
        throw new TypeError('fetch failed', { cause: new Error('Connect Timeout Error') });
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: [{ b64_json: Buffer.from('network-retry-success').toString('base64') }] })
      };
    },
    fileStorage: {
      mkdir: async () => {},
      writeFile: async () => {}
    }
  });

  assert.match(imagePath, /^\/user_assets\/chat\/draw-/);
  assert.equal(generationCalls, 2);
});


test('generateImage supports Z-Image task polling without an API key', async () => {
  const calls = [];
  const writes = [];
  let historyCalls = 0;
  const imagePath = await generateImage('请生成一张真实生活随手照片', {
    providerType: 'z-image-comfy',
    apiBase: 'https://zit-web.qixunmm.xyz',
    model: 'z-image-initial',
    extras: { width: 768, height: 1280, poll_interval_ms: 1 },
    sleepImpl: async () => {},
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (url === 'https://zit-web.qixunmm.xyz/api/prompt/initial') {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ prompt_id: 'task-1', output_node: '9' })
        };
      }
      if (url === 'https://zit-api.qixunmm.xyz/history/task-1') {
        historyCalls += 1;
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify(historyCalls === 1 ? {} : {
            'task-1': {
              status: { completed: true },
              outputs: { '9': { images: [{ filename: 'result.png', subfolder: '', type: 'output' }] } }
            }
          })
        };
      }
      if (url.startsWith('https://zit-api.qixunmm.xyz/view?')) {
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => Buffer.from('z-image-result')
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
    fileStorage: {
      mkdir: async () => {},
      writeFile: async (filePath, buffer) => writes.push({ filePath, buffer })
    }
  });

  assert.match(imagePath, /^\/user_assets\/chat\/draw-/);
  const submitBody = JSON.parse(calls[0].options.body);
  assert.match(submitBody.prompt, /请生成一张真实生活随手照片/);
  assert.match(submitBody.prompt, /不要改成动漫/);
  assert.equal(submitBody.width, 768);
  assert.equal(submitBody.height, 1280);
  assert.ok(submitBody.client_id);
  assert.equal(historyCalls, 2);
  assert.equal(writes[0].buffer.toString(), 'z-image-result');
});

test('generateImage reports Z-Image completed tasks that contain no image', async () => {
  await assert.rejects(generateImage('画一张风景图', {
    providerType: 'z-image-comfy',
    apiBase: 'https://zit-web.qixunmm.xyz',
    model: 'z-image-initial',
    sleepImpl: async () => {},
    fetchImpl: async url => {
      if (url.endsWith('/api/prompt/initial')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ prompt_id: 'bad-task', output_node: '9' }) };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          'bad-task': {
            status: { completed: true, messages: [['execution_error', { exception_message: '显存不足' }]] },
            outputs: {}
          }
        })
      };
    }
  }), /Z-Image 生成失败：显存不足/);
});
