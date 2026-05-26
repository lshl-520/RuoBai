import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCapabilityViewModel,
  buildQuickChatChoices
} from './profile-capability-utils.mjs';

test('buildCapabilityViewModel marks enabled card with current model and grouped options', () => {
  const item = buildCapabilityViewModel({
    capability: 'chat',
    enabled: true,
    current: {
      credential_id: 3,
      credential_name: '饼干姐姐高配',
      model_id: 'gpt-5.5',
      extras: null
    },
    options: [
      { credential_id: 3, credential_name: '饼干姐姐高配', model_id: 'gpt-5.5' },
      { credential_id: 3, credential_name: '饼干姐姐高配', model_id: 'gpt-5.4' },
      { credential_id: 4, credential_name: '阿里千问', model_id: 'qwen-max' }
    ]
  });

  assert.equal(item.capability, 'chat');
  assert.equal(item.enabled, true);
  assert.equal(item.stateText, '开启');
  assert.equal(item.currentLabel, '饼干姐姐高配 / gpt-5.5');
  assert.equal(item.optionGroups.length, 2);
  assert.deepEqual(
    item.optionGroups.map(group => [group.credentialId, group.credentialName, group.models.length]),
    [
      [3, '饼干姐姐高配', 2],
      [4, '阿里千问', 1]
    ]
  );
});

test('buildCapabilityViewModel keeps current usage copy plain and non-dropdown-like', () => {
  const item = buildCapabilityViewModel({
    capability: 'vision',
    enabled: true,
    current: {
      credential_id: 8,
      credential_name: '火山引擎',
      model_id: 'doubao-vision-pro-32k-241028'
    },
    options: [
      { credential_id: 8, credential_name: '火山引擎', model_id: 'doubao-vision-pro-32k-241028' }
    ]
  });

  assert.equal(item.stateText, '开启');
  assert.equal(item.currentLabel.includes('▼'), false);
  assert.equal(item.currentLabel, '火山引擎 / doubao-vision-pro-32k-241028');
});

test('buildCapabilityViewModel marks disabled card with available models prompt', () => {
  const item = buildCapabilityViewModel({
    capability: 'image',
    enabled: false,
    current: null,
    options: [
      { credential_id: 5, credential_name: '豆包图像', model_id: 'doubao-seed-image' },
      { credential_id: 6, credential_name: '万相官方', model_id: 'wanx2.1' }
    ]
  });

  assert.equal(item.enabled, false);
  assert.equal(item.stateText, '关闭');
  assert.equal(item.emptyHint, '想开启？检测到');
  assert.deepEqual(item.suggestedModels, ['doubao-seed-image', 'wanx2.1']);
  assert.equal(item.canEnableQuickly, true);
  assert.equal(item.firstAvailable.modelId, 'doubao-seed-image');
});

test('buildQuickChatChoices returns up to three sibling chat models from the same credential', () => {
  const chips = buildQuickChatChoices(
    {
      credential_id: 3,
      credential_name: '饼干姐姐高配',
      model_id: 'gpt-5.5'
    },
    [
      { credential_id: 3, credential_name: '饼干姐姐高配', model_id: 'gpt-5.5' },
      { credential_id: 3, credential_name: '饼干姐姐高配', model_id: 'gpt-5.4' },
      { credential_id: 3, credential_name: '饼干姐姐高配', model_id: 'claude-4.7' },
      { credential_id: 3, credential_name: '饼干姐姐高配', model_id: 'grok-4.1-fast' },
      { credential_id: 4, credential_name: '阿里千问', model_id: 'qwen-max' }
    ]
  );

  assert.deepEqual(
    chips.map(item => [item.modelId, item.active]),
    [
      ['gpt-5.4', false],
      ['claude-4.7', false],
      ['grok-4.1-fast', false]
    ]
  );
});
