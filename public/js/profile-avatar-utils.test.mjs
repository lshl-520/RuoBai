import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAvatarChoices } from './profile-avatar-utils.mjs';

test('buildAvatarChoices puts uploaded avatar first and marks it as uploaded', () => {
  const items = buildAvatarChoices({
    uploadedAvatarUrl: '/user_assets/avatars/21-123.png',
    selectedAvatarUrl: '/user_assets/avatars/21-123.png'
  });

  assert.equal(items[0].url, '/user_assets/avatars/21-123.png');
  assert.equal(items[0].label, '我上传的');
  assert.equal(items[0].uploaded, true);
  assert.equal(items[0].selected, true);
  assert.deepEqual(items[0].actions, ['delete', 'reset']);
  assert.equal(items[1].url, '/assets/avatar-squares/0.png');
});

test('buildAvatarChoices falls back to only preset avatars when no upload exists', () => {
  const items = buildAvatarChoices({
    presetCount: 3,
    selectedAvatarUrl: '/assets/avatar-squares/1.png'
  });

  assert.deepEqual(
    items.map(item => [item.url, item.label, item.selected, item.uploaded]),
    [
      ['/assets/avatar-squares/0.png', '0 号', false, false],
      ['/assets/avatar-squares/1.png', '1 号', true, false],
      ['/assets/avatar-squares/2.png', '2 号', false, false]
    ]
  );
});
