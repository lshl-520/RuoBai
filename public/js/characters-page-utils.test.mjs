import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCharactersViewModel,
  buildFilterItems,
  buildPortraitChoices,
  buildRolePayload,
  getPortraitImage,
  escapeHtml,
  getChatHref
} from './characters-page-utils.mjs';

test('buildCharactersViewModel normalizes backend roles for the characters page', () => {
  const roles = buildCharactersViewModel([
    {
      id: 7,
      name: '小白',
      tag: '恋人',
      persona: '温柔治愈系少女',
      avatar: '/user_assets/avatars/xiaobai.webp',
      portrait_id: 5,
      room_background: 'images/custom-room.webp',
      mood: 88,
      intimacy: 92,
      auto_moments_enabled: 1,
      auto_moments_daily_min: 2,
      auto_moments_daily_max: 6,
      auto_moments_min_interval_hours: 4,
      auto_moments_last_posted_at: '2026-05-25 12:00:00',
      delete_after: '2026-05-28T00:00:00.000Z',
      is_active: 1,
      is_deleted: 0
    },
    {
      id: 9,
      name: '糖糖',
      persona: '',
      avatar: '',
      mood: null,
      intimacy: null,
      is_active: 0,
      is_deleted: 1
    }
  ]);

  assert.equal(roles.length, 2);
  assert.deepEqual({
    id: roles[0].id,
    name: roles[0].name,
    tag: roles[0].tag,
    persona: roles[0].persona,
    avatar: roles[0].avatar,
    portraitId: roles[0].portraitId,
    portrait: roles[0].portrait,
    portraitSquare: roles[0].portraitSquare,
    portraitRound: roles[0].portraitRound,
    mood: roles[0].mood,
    intimacy: roles[0].intimacy,
    isActive: roles[0].isActive
  }, {
    id: 7,
    name: '小白',
    tag: '恋人',
    persona: '温柔治愈系少女',
    avatar: '/user_assets/avatars/xiaobai.webp',
    portraitId: 5,
    portrait: '/assets/portraits/full/5.png',
    portraitSquare: '/assets/portraits/square/5.png',
    portraitRound: '/assets/portraits/round/5.png',
    mood: 88,
    intimacy: 92,
    isActive: true
  });
  assert.equal(roles[0].roomBackground, 'images/custom-room.webp');
  assert.equal(roles[0].autoMomentsEnabled, true);
  assert.equal(roles[0].autoMomentsDailyMin, 2);
  assert.equal(roles[0].autoMomentsDailyMax, 6);
  assert.equal(roles[0].autoMomentsMinIntervalHours, 4);
  assert.equal(roles[0].autoMomentsLastPostedAt, '2026-05-25 12:00:00');
  assert.equal(roles[0].createdDays, null);
  assert.equal(roles[0].deleteAfter, '2026-05-28T00:00:00.000Z');
  assert.equal(roles[1].tag, '');
  assert.equal(roles[1].persona, '还没有人设');
  assert.equal(roles[1].mood, 80);
  assert.equal(roles[1].intimacy, 50);
  assert.equal(roles[1].autoMomentsEnabled, false);
  assert.equal(roles[1].autoMomentsDailyMin, 0);
  assert.equal(roles[1].autoMomentsDailyMax, 0);
  assert.equal(roles[1].autoMomentsMinIntervalHours, 4);
  assert.equal(roles[0].isDeleted, false);
  assert.equal(roles[1].isDeleted, true);
  assert.equal(roles[1].roomBackground, 'images/ruobai-theme/room.webp');
});

test('buildFilterItems includes all and real tag counts', () => {
  const filters = buildFilterItems([
    { tag: '恋人' },
    { tag: '恋人' },
    { tag: '朋友' },
    { tag: '' },
    { tag: '自定义' }
  ]);

  assert.deepEqual(filters, [
    { label: '全部', value: 'all', count: 5 },
    { label: '恋人', value: '恋人', count: 2 },
    { label: '朋友', value: '朋友', count: 1 },
    { label: '自定义', value: '自定义', count: 1 }
  ]);
});

test('getChatHref points at the real character id and escapes the name', () => {
  assert.equal(
    getChatHref({ id: 7, name: '小白 & 糖糖' }),
    'chat-room.html?id=7&name=%E5%B0%8F%E7%99%BD%20%26%20%E7%B3%96%E7%B3%96'
  );
});

test('escapeHtml protects rendered role text', () => {
  assert.equal(escapeHtml('<小白 & 糖糖>'), '&lt;小白 &amp; 糖糖&gt;');
});

test('buildRolePayload trims form values and applies safe defaults', () => {
  assert.deepEqual(
    buildRolePayload({
      name: '  小白  ',
      tag: '',
      persona: '  温柔陪伴  ',
      avatar: '  /avatar.png  ',
      portrait_id: '5',
      mood: '88',
      intimacy: '92',
      auto_moments_enabled: 'on',
      auto_moments_daily_min: '2',
      auto_moments_daily_max: '6',
      auto_moments_min_interval_hours: '4'
    }),
    {
      name: '小白',
      tag: '',
      persona: '温柔陪伴',
      avatar: '/avatar.png',
      portrait_id: 5,
      portrait_custom_url: null,
      mood: 88,
      intimacy: 92,
      auto_moments_enabled: true,
      auto_moments_daily_min: 2,
      auto_moments_daily_max: 6,
      auto_moments_min_interval_hours: 4
    }
  );
});

test('buildRolePayload supports uploaded custom portraits', () => {
  const payload = buildRolePayload({
    name: '小白',
    tag: '恋人',
    persona: '温柔陪伴',
    portrait_id: '999',
    portrait_custom_url: '  /user_assets/portraits/1/custom.png  '
  });

  assert.equal(payload.portrait_id, 999);
  assert.equal(payload.portrait_custom_url, '/user_assets/portraits/1/custom.png');
});

test('portrait helpers expose preset and custom image paths', () => {
  const choices = buildPortraitChoices({
    portraitId: 2,
    customUrl: '/user_assets/portraits/1/custom.png'
  });

  assert.equal(choices.length, 19);
  assert.deepEqual(choices[0], {
    id: 999,
    label: '我上传的',
    src: '/user_assets/portraits/1/custom.png',
    uploaded: true,
    active: false
  });
  assert.equal(choices[3].id, 2);
  assert.equal(choices[3].src, '/assets/portraits/square/2.png');
  assert.equal(choices[3].active, true);
  assert.equal(getPortraitImage({ portraitId: 2 }, 'full'), '/assets/portraits/full/2.png');
  assert.equal(getPortraitImage({ portraitId: 999, portraitCustomUrl: '/user_assets/portraits/1/custom.png' }, 'round'), '/user_assets/portraits/1/custom.png');
  assert.equal(getPortraitImage({ portraitId: null, avatar: '/avatar.png' }, 'square'), '/avatar.png');
});

test('buildRolePayload keeps automatic moments disabled unless explicitly checked', () => {
  assert.deepEqual(
    buildRolePayload({
      name: '塔罗助手',
      tag: '工具',
      persona: '只在被问到时回答',
      auto_moments_enabled: '',
      auto_moments_daily_min: '9',
      auto_moments_daily_max: '99',
      auto_moments_min_interval_hours: '1'
    }),
    {
      name: '塔罗助手',
      tag: '工具',
      persona: '只在被问到时回答',
      avatar: '',
      portrait_id: null,
      portrait_custom_url: null,
      mood: 80,
      intimacy: 50,
      auto_moments_enabled: false,
      auto_moments_daily_min: 0,
      auto_moments_daily_max: 0,
      auto_moments_min_interval_hours: 4
    }
  );
});

test('buildRolePayload reports missing required fields', () => {
  assert.deepEqual(buildRolePayload({ name: '', persona: '人设' }), {
    error: '请先填写角色名字'
  });
  assert.deepEqual(buildRolePayload({ name: '小白', persona: '' }), {
    error: '请先填写角色人设'
  });
});
