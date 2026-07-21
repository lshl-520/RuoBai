import assert from 'node:assert/strict';
import test from 'node:test';
import {
  publishGeneratedSelfieMoment,
  shouldPublishGeneratedSelfie,
} from './lib/moments.js';

test('只让角色自拍类生图自动发布动态', () => {
  assert.equal(shouldPublishGeneratedSelfie('林夏，我想看看你的样子，请生成一张类似你自己用 iPhone 随手自拍的照片'), true);
  assert.equal(shouldPublishGeneratedSelfie('给我拍一张你的自拍'), true);
  assert.equal(shouldPublishGeneratedSelfie('帮我画一只小猫'), false);
  assert.equal(shouldPublishGeneratedSelfie('画一张下雨的街道'), false);
  assert.equal(shouldPublishGeneratedSelfie('把我的自拍改成油画风'), false);
});

test('自拍动态使用聊天里的同一张图片和生成文案', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (path, options) => {
    calls.push({ path, options, body: JSON.parse(options.body) });
    if (path === '/api/moments/draft') {
      return new Response(JSON.stringify({
        success: true,
        item: { character_id: 6, content: '刚刚手滑拍到一张，居然有点舍不得删。' },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (path === '/api/moments') {
      return new Response(JSON.stringify({ success: true, item: { id: 9 } }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    throw new Error(`unexpected path: ${path}`);
  };

  try {
    const result = await publishGeneratedSelfieMoment({
      characterId: 6,
      mediaUrl: '/user_assets/chat/the-same-selfie.png',
    });

    assert.equal(result.content, '刚刚手滑拍到一张，居然有点舍不得删。');
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1].body, {
      character_id: 6,
      content: '刚刚手滑拍到一张，居然有点舍不得删。',
      images: ['/user_assets/chat/the-same-selfie.png'],
      mood: '随手自拍',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('文案生成失败时仍用自然兜底文案发布同一张自拍', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (path, options) => {
    calls.push({ path, body: JSON.parse(options.body) });
    if (path === '/api/moments/draft') {
      throw new Error('temporary upstream error');
    }
    return new Response(JSON.stringify({ success: true, item: { id: 10 } }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const result = await publishGeneratedSelfieMoment({
      characterId: 6,
      mediaUrl: '/user_assets/chat/fallback-selfie.png',
    });

    assert.match(result.content, /随手拍了一张/);
    assert.deepEqual(calls[1].body.images, ['/user_assets/chat/fallback-selfie.png']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
