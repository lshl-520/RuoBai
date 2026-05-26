import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCommentPayload,
  buildMomentImageItems,
  buildMomentPayload,
  buildMomentDetailViewModel,
  buildMomentViewModel,
  formatMomentDate,
  normalizeMomentImages
} from './moments-page-utils.mjs';

test('normalizeMomentImages accepts arrays and JSON strings', () => {
  assert.deepEqual(normalizeMomentImages(['a.png', ' ', 'b.png']), ['a.png', 'b.png']);
  assert.deepEqual(normalizeMomentImages('["x.png","y.png"]'), ['x.png', 'y.png']);
  assert.deepEqual(normalizeMomentImages('bad json'), []);
});

test('buildMomentImageItems prepares clickable image preview data', () => {
  assert.deepEqual(buildMomentImageItems([' a.png ', '', 'b.png']), [
    { src: 'a.png', index: 0, alt: '动态图片 1' },
    { src: 'b.png', index: 1, alt: '动态图片 2' }
  ]);
});

test('buildMomentViewModel maps backend moments to role cards', () => {
  const moments = buildMomentViewModel([
    {
      id: 2,
      character_id: 7,
      content: '今天想一起看晚霞',
      images: '["sunset.png"]',
      likes_count: 3,
      comments_count: 1,
      liked: true,
      created_at: '2026-05-25T08:00:00.000Z'
    },
    {
      id: 1,
      character_id: null,
      content: '我发的动态',
      images: [],
      likes_count: 0,
      comments: [{ id: 9 }],
      liked: false,
      created_at: '2026-05-24T08:00:00.000Z'
    }
  ], [
    { id: 7, name: '若白', avatar: 'images/ruobai.png', portraitRound: '/assets/portraits/round/7.png', tag: '恋人' }
  ], { viewerName: '江湖小白' });

  assert.equal(moments[0].authorName, '若白');
  assert.equal(moments[0].avatar, '/assets/portraits/round/7.png');
  assert.equal(moments[0].tagText, '恋人');
  assert.equal(moments[0].isMine, false);
  assert.deepEqual(moments[0].images, ['sunset.png']);
  assert.equal(moments[0].liked, true);
  assert.equal(moments[1].authorName, '江湖小白');
  assert.equal(moments[1].commentsCount, 1);
  assert.deepEqual(moments[1].comments, [{ id: 9 }]);
  assert.equal(moments[1].isMine, true);
});

test('buildMomentViewModel uses latest viewer avatar for my moments', () => {
  const moments = buildMomentViewModel([
    {
      id: 3,
      character_id: null,
      content: '换了新头像',
      images: [],
      created_at: '2026-05-26T08:00:00.000Z'
    }
  ], [], { viewerName: '江湖小白', viewerAvatar: '/assets/avatar-squares/7.png' });

  assert.equal(moments[0].authorName, '江湖小白');
  assert.equal(moments[0].avatar, '/assets/avatar-squares/7.png');
  assert.equal(moments[0].isMine, true);
});

test('buildMomentDetailViewModel prepares one moment for detail modal', () => {
  const detail = buildMomentDetailViewModel({
    id: 9,
    character_id: 7,
    content: 'detail moment',
    images: '["detail.png"]',
    likes_count: 4,
    comments: [{ id: 3, content: 'nice' }],
    created_at: '2026-05-25T08:00:00.000Z'
  }, [
    { id: 7, name: 'Ruobai', avatar: 'images/ruobai.png', tag: 'lover' }
  ]);

  assert.equal(detail.id, 9);
  assert.equal(detail.authorName, 'Ruobai');
  assert.deepEqual(detail.images, ['detail.png']);
  assert.equal(detail.likesCount, 4);
  assert.equal(detail.commentsCount, 1);
  assert.equal(detail.comments[0].content, 'nice');
  assert.equal(detail.canRender, true);
});

test('formatMomentDate keeps invalid dates readable', () => {
  assert.equal(formatMomentDate('not-a-date'), 'not-a-date');
  assert.match(formatMomentDate('2026-05-25T08:00:00.000Z'), /2026/);
});

test('buildMomentPayload trims content and keeps images normalized', () => {
  const payload = buildMomentPayload({
    content: '  今天想发一条动态  ',
    images: [' a.png ', '', 'b.png']
  });

  assert.deepEqual(payload, {
    content: '今天想发一条动态',
    images: ['a.png', 'b.png']
  });
});

test('buildMomentPayload reports missing content', () => {
  const payload = buildMomentPayload({
    content: ' ',
    images: []
  });

  assert.equal(payload.error, '动态内容不能为空');
});

test('buildCommentPayload trims content and rejects empty comments', () => {
  assert.deepEqual(buildCommentPayload('  好喜欢这条动态  '), {
    content: '好喜欢这条动态'
  });
  assert.equal(buildCommentPayload(' ').error, '评论内容不能为空');
});
