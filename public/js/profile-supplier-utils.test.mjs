import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSupplierCapabilitySummary,
  buildSupplierPresetDraft,
  listSupplierPresets,
  pickRecommendedModel
} from './profile-supplier-utils.mjs';

test('buildSupplierCapabilitySummary summarizes detected abilities with Chinese labels and recommendations', () => {
  const items = buildSupplierCapabilitySummary({
    summary: {
      chat: ['gpt-5.4', 'gpt-5.5', 'grok-4.1-fast'],
      vision: ['qwen-vl-plus'],
      image: ['wanx2.1'],
      tts: ['qwen-tts-latest'],
      realtime: []
    }
  });

  assert.equal(items.length, 5);
  assert.deepEqual(
    items.map(item => [item.capability, item.label, item.count, item.recommendedModel, item.available]),
    [
      ['chat', '文字聊天', 3, 'gpt-5.5', true],
      ['vision', '看懂图片', 1, 'qwen-vl-plus', true],
      ['image', '画图发图', 1, 'wanx2.1', true],
      ['tts', '听她说话', 1, 'qwen-tts-latest', true],
      ['realtime', '实时通话', 0, '', false]
    ]
  );
});

test('pickRecommendedModel falls back to the first discovered model when no special preference matches', () => {
  assert.equal(
    pickRecommendedModel('image', ['flux-dev', 'sdxl']),
    'flux-dev'
  );
});

test('listSupplierPresets keeps the 6 built-in supplier presets in the expected order', () => {
  const presets = listSupplierPresets();

  assert.deepEqual(
    presets.map(item => [item.id, item.label, item.apiBase]),
    [
      ['deepseek', 'DeepSeek 官方', 'https://api.deepseek.com'],
      ['dashscope', '阿里千问官方', 'https://dashscope.aliyuncs.com/compatible-mode/v1'],
      ['volcengine', '火山豆包', 'https://ark.cn-beijing.volces.com/api/v3'],
      ['grok', 'Grok 官方', 'https://api.x.ai/v1'],
      ['openai', 'OpenAI 官方', 'https://api.openai.com/v1'],
      ['custom', '自定义 / 中转', '']
    ]
  );
});

test('buildSupplierPresetDraft hides the interface address for official presets', () => {
  assert.deepEqual(
    buildSupplierPresetDraft('deepseek'),
    {
      providerId: 'deepseek',
      providerLabel: 'DeepSeek 官方',
      name: '',
      apiBase: 'https://api.deepseek.com',
      isCustom: false,
      showApiBaseField: false,
      apiBaseReadonly: true
    }
  );
});

test('buildSupplierPresetDraft keeps the interface address editable for custom relay presets', () => {
  assert.deepEqual(
    buildSupplierPresetDraft('custom'),
    {
      providerId: 'custom',
      providerLabel: '自定义 / 中转',
      name: '',
      apiBase: '',
      isCustom: true,
      showApiBaseField: true,
      apiBaseReadonly: false
    }
  );
});
