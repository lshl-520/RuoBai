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
