import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBrowserTtsOptions,
  buildSavedAssistantMessageUpdate,
  isBrowserTtsResponse,
  needsTtsButton
} from './chat-tts-utils.mjs';
import { isHistoricalErrorBubble } from './chat-cleanup-utils.mjs';

test('buildSavedAssistantMessageUpdate returns the saved assistant id for immediate playback', () => {
  assert.deepEqual(
    buildSavedAssistantMessageUpdate(
      {
        id: 108,
        role: 'assistant',
        content: '晚安，已经帮你记住啦。',
        created_at: '2026-05-25T03:10:00.000Z'
      },
      {
        role: 'assistant',
        content: '晚安，已经帮你记住啦。',
        created_at: '2026-05-25T03:09:59.000Z'
      }
    ),
    {
      id: 108,
      role: 'assistant',
      content: '晚安，已经帮你记住啦。',
      created_at: '2026-05-25T03:10:00.000Z',
      message_type: 'text',
      media_url: null
    }
  );
});

test('needsTtsButton only turns on for saved assistant messages', () => {
  assert.equal(needsTtsButton({ role: 'assistant', id: 12 }), true);
  assert.equal(needsTtsButton({ role: 'assistant', id: 0 }), false);
  assert.equal(needsTtsButton({ role: 'user', id: 12 }), false);
});

test('browser tts response is detected and builds warm Chinese playback options', () => {
  const response = {
    success: true,
    use_browser_tts: true,
    text: '晚安，今天辛苦了。',
    voice_id: 'browser'
  };

  assert.equal(isBrowserTtsResponse(response), true);
  assert.deepEqual(buildBrowserTtsOptions(response, [{ lang: 'en-US' }, { lang: 'zh-CN', name: 'Microsoft Xiaoxiao' }]), {
    text: '晚安，今天辛苦了。',
    lang: 'zh-CN',
    rate: 0.9,
    pitch: 1.1,
    voice: { lang: 'zh-CN', name: 'Microsoft Xiaoxiao' }
  });
});

test('historical error bubble detection only targets bad assistant messages', () => {
  assert.equal(isHistoricalErrorBubble({ role: 'assistant', id: 1, content: '' }), true);
  assert.equal(isHistoricalErrorBubble({ role: 'assistant', id: 2, content: '{"detail":"Not Found"}' }), true);
  assert.equal(isHistoricalErrorBubble({ role: 'assistant', id: 3, content: '（出错了：typingRow is not defined）' }), true);
  assert.equal(isHistoricalErrorBubble({ role: 'assistant', id: 4, content: 'Cannot GET /api/chat' }), true);

  assert.equal(isHistoricalErrorBubble({ role: 'user', id: 5, content: '{"detail":"Not Found"}' }), false);
  assert.equal(isHistoricalErrorBubble({ role: 'assistant', id: 6, content: '今晚早点休息，我在这里陪你。' }), false);
  assert.equal(isHistoricalErrorBubble({ role: 'assistant', id: 7, message_type: 'image', media_url: '/user_assets/chat/a.png', content: '' }), false);
});
