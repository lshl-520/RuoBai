import test from 'node:test';
import assert from 'node:assert/strict';
import { createBubbleSplitter, splitReplyIntoBubbles, MAX_BUBBLES, firstBubbleId, annotateConsecutiveGroups, applyTurnReasoning, isActionBubble } from './lib/chat-bubbles.js';

test('短回复不切：一句话就是一个气泡', () => {
  assert.deepEqual(splitReplyIntoBubbles('今天还不错呀'), ['今天还不错呀']);
  assert.deepEqual(splitReplyIntoBubbles('在呢'), ['在呢']);
});

test('不机械地每个句号都切 —— 太短的并到下一句', () => {
  const out = splitReplyIntoBubbles('嗯。好呀。那就这样吧。');
  assert.ok(out.length <= 2, `不该切成 ${out.length} 条：${JSON.stringify(out)}`);
  assert.equal(out.join(''), '嗯。好呀。那就这样吧。');
});

test('正常多句会切成多条，且内容不丢字', () => {
  const text = '今天还不错呀～刚刚还在想你呢。不过你突然这么问，是不是自己今天心情不太好？';
  const out = splitReplyIntoBubbles(text);
  assert.ok(out.length >= 2, `应该切成多条，实际 ${JSON.stringify(out)}`);
  assert.equal(out.join(''), text);
});

test('★ 最后一个气泡不许当"垃圾桶"（2026/9/22 用户截图里的真实毛病）', () => {
  // 旧行为：切到第 4 条就硬停，剩下没说完的全塞进最后一条 →
  //       前三条很短、第四条特别长。这不是聊天，是按条数配额发。
  const text = '我知道你今天挺累的，也不是想跟你讲道理。其实你说那件事的时候我就在想你这个人怎么总是把什么都自己扛着。你也不用急着回答我，先吃点东西，别又空着肚子。等你缓过来了再慢慢跟我说，我就在这儿等着，哪儿也不去。';
  const out = splitReplyIntoBubbles(text);
  assert.ok(out.length >= 3, `内容这么多不该只切成 ${out.length} 条`);
  assert.equal(out.join(''), text);

  const lens = out.map((b) => b.length);
  const last = lens[lens.length - 1];
  const avg = lens.reduce((a, b) => a + b, 0) / lens.length;
  assert.ok(last <= 60, `最后一个气泡不该长到不像微信：${last} 字（${JSON.stringify(lens)}）`);
  assert.ok(last <= 1.6 * avg, `最后一个气泡比平均值胖太多：${JSON.stringify(lens)}`);
  // 最后一条不该是"最胖的那条"（除非所有条一样长）
  const uniform = lens.every((n) => n === lens[0]);
  assert.ok(uniform || last < Math.max(...lens), `最后一个气泡不该是最胖的那条：${JSON.stringify(lens)}`);
});

test('★ 内容再多也不会把尾巴堆进最后一条', () => {
  const text = Array.from({ length: 15 }, (_, i) => `这是第${i + 1}句话，我想跟你说清楚这件事`).join('。') + '。';
  const out = splitReplyIntoBubbles(text);
  assert.equal(out.join(''), text);
  const lens = out.map((b) => b.length);
  // 关键：最后一条不许是"剩下的都塞这儿"；也不许无限刷屏
  const last = lens[lens.length - 1];
  const avg = lens.reduce((a, b) => a + b, 0) / lens.length;
  assert.ok(last <= 1.6 * avg, `最后一条成了垃圾桶：${JSON.stringify(lens)}`);
  assert.ok(out.length <= 20, `不该无限刷屏：${out.length}`);
});

test('★ 短回复不硬凑条数（1 条就够就 1 条）', () => {
  assert.deepEqual(splitReplyIntoBubbles('今天还不错呀'), ['今天还不错呀']);
  assert.ok(splitReplyIntoBubbles('还没有字出来，我在这儿等你回来。').length <= 2);
  // MAX_BUBBLES 只是"普通回复大概几条"的参考值，不是硬上限
  assert.ok(MAX_BUBBLES >= 5);
});

test('同一条回复：流式和一次性切分结果必须一模一样', () => {
  // 否则屏幕上看到的和刷新之后的会变成两种样子。
  const samples = [
    '今天还不错呀～刚刚还在想你呢。不过你突然这么问，是不是自己今天心情不太好？',
    '第一句话在这里。第二句话在这里。第三句话在这里。第四句话在这里。第五句话在这里。第六句话在这里。第七句话在这里。',
    '（把被子往上拉了拉）都这个点了你还全吃完了？',
    '都中午了还说早上好\n（看了一眼窗外）\n午饭打算吃啥？',
    '我知道你今天挺累的，也不是想跟你讲道理。其实你说那件事的时候我就在想你这个人怎么总是把什么都自己扛着。你也不用急着回答我，先吃点东西，别又空着肚子。',
  ];
  for (const text of samples) {
    const splitter = createBubbleSplitter();
    const streamed = [];
    for (const ch of text) streamed.push(...splitter.push(ch));
    streamed.push(...splitter.flush());
    assert.deepEqual(streamed, splitReplyIntoBubbles(text), JSON.stringify(text));
  }
});

test('括号里的动作描写不会被从中间劈开', () => {
  const text = '（把被子往上拉了拉）都这个点了你还全吃完了？';
  const out = splitReplyIntoBubbles(text);
  assert.equal(out.join(''), text);
  for (const bubble of out) {
    const open = (bubble.match(/（/g) || []).length;
    const close = (bubble.match(/）/g) || []).length;
    assert.equal(open, close, `括号被劈开了：${bubble}`);
  }
});

test('流式边收边切，与一次性切分结果一致', () => {
  const text = '今天还不错呀～刚刚还在想你呢。不过你突然这么问，是不是自己今天心情不太好？';
  const splitter = createBubbleSplitter();
  const streamed = [];
  for (const ch of text) streamed.push(...splitter.push(ch));
  streamed.push(...splitter.flush());
  assert.deepEqual(streamed, splitReplyIntoBubbles(text));
});

test('空内容与纯空白不会产生空气泡', () => {
  assert.deepEqual(splitReplyIntoBubbles(''), []);
  assert.deepEqual(splitReplyIntoBubbles('   '), []);
  assert.deepEqual(splitReplyIntoBubbles(null), []);
});

test('流式更新尾巴不会把回复切碎，也不会丢字（2026/9/19 真实 bug）', () => {
  // 这里严格照 chat.jsx 的真实用法模拟：
  //   每冒出一条（不管是流式中途的还是收尾的）就算"已发出"，尾巴随之清空。
  const text = '还是没有字出来，我在这儿等你回来。';
  const splitter = createBubbleSplitter();
  const finished = [];
  let tail = '';
  for (const ch of text) {
    for (const ready of splitter.push(ch)) { finished.push(ready); tail = ''; }
    tail = splitter.pending();
  }
  for (const rest of splitter.flush()) { finished.push(rest); tail = ''; }
  if (tail.trim()) finished.push(tail.trim());
  assert.equal(finished.join(''), text);
  for (const b of finished) {
    assert.ok(b.trim().length >= 2, '气泡太碎：' + b);
  }
  assert.deepEqual(finished, splitReplyIntoBubbles(text), '流式结果必须和一次性切分一致');
});

test('连发分组：同一人连续几条只在第一条出头像', () => {
  const msgs = [
    { who: 'me', type: 'text', text: '在吗' },
    { who: 'her', type: 'text', text: '在' },
    { who: 'her', type: 'text', text: '刚醒' },
    { who: 'her', type: 'text', text: '你怎么还不睡' },
    { who: 'me', type: 'text', text: '马上' },
  ];
  const grouped = annotateConsecutiveGroups(msgs);
  assert.equal(grouped[1]._hideAvatar, false);
  assert.equal(grouped[1]._lastInGroup, false);
  assert.equal(grouped[2]._hideAvatar, true);
  assert.equal(grouped[2]._continue, true);
  assert.equal(grouped[3]._hideAvatar, true);
  assert.equal(grouped[3]._lastInGroup, true);
  assert.equal(grouped[4]._hideAvatar, false);
});

test('思考只写回这一轮第一条，后面的气泡不会带着思考标记', () => {
  const replyId = 99;
  const msgs = [
    { _id: firstBubbleId(replyId), who: 'her', text: '第一句' },
    { _id: replyId + '_1', who: 'her', text: '第二句' },
    { _id: 'other', who: 'me', text: '我的' },
  ];
  const next = applyTurnReasoning(msgs, replyId, {
    think: '她在想要不要骂他',
    requested: true,
    pending: false,
    unavailable: false,
    streaming: false,
  });
  assert.equal(next[0].think, '她在想要不要骂他');
  assert.equal(next[0].reasoningRequested, true);
  assert.equal(next[1].think, '');
  assert.equal(next[1].reasoningRequested, false);
  assert.equal(next[2].think, undefined);
});

test('换行按她有意断开，动作单独成一条', () => {
  const text = '都中午了还说早上好\n（看了一眼窗外）\n午饭打算吃啥？';
  assert.deepEqual(splitReplyIntoBubbles(text), ['都中午了还说早上好', '（看了一眼窗外）', '午饭打算吃啥？']);
  assert.equal(isActionBubble('（看了一眼窗外）'), true);
  assert.equal(isActionBubble('午饭打算吃啥？'), false);
});

test('同一句里的动作也会先拆出来', () => {
  const out = splitReplyIntoBubbles('（看了一眼窗外）午饭打算吃啥？');
  assert.deepEqual(out, ['（看了一眼窗外）', '午饭打算吃啥？']);
});

test('一整段里的动作和逗号也会切成连发', () => {
  const text = '都中午了还说早上好，这是刚睁眼吧（看了一眼窗外）午饭打算吃啥？';
  const out = splitReplyIntoBubbles(text);
  assert.ok(out.length >= 3, JSON.stringify(out));
  assert.ok(out.includes('（看了一眼窗外）'));
  assert.equal(out.join(''), text.replace(/（看了一眼窗外）/, '（看了一眼窗外）'));
  assert.equal(out.join(''), text);
});