import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTranscript,
  parseDigestOutput,
  localDayKey,
  humanDayLabel,
  DIGEST_CONSTANTS
} from './daily-digest.js';
import { buildDigestPromptBlock } from './chat.js';

/* ── 对话正文拼接 ── */

test('buildTranscript 把消息拼成"他/她"的对话正文', () => {
  const text = buildTranscript([
    { role: 'user', content: '今天好累', created_at: '2026-08-04 21:10:00' },
    { role: 'assistant', content: '那就早点休息', created_at: '2026-08-04 21:10:30' }
  ]);
  assert.match(text, /\[21:10\] 他：今天好累/);
  assert.match(text, /\[21:10\] 她：那就早点休息/);
});

test('buildTranscript 跳过空内容，并在超长时保留头尾', () => {
  const rows = [
    { role: 'user', content: '开头这句要留住', created_at: '2026-08-04 09:00:00' },
    { role: 'assistant', content: '   ', created_at: '2026-08-04 09:01:00' },
    { role: 'user', content: 'x'.repeat(9000), created_at: '2026-08-04 09:02:00' },
    { role: 'user', content: '结尾这句也要留', created_at: '2026-08-04 23:59:00' }
  ];
  const text = buildTranscript(rows);
  assert.ok(text.length <= DIGEST_CONSTANTS.MAX_TRANSCRIPT_CHARS + 40, '不能超过上限太多');
  assert.match(text, /开头这句要留住/);
  assert.match(text, /中间省略/);
  assert.match(text, /结尾这句也要留/);
  assert.doesNotMatch(text, /她：/, '空内容不应产生一行');
});

/* ── 输出解析：三种情况 ── */

test('parseDigestOutput 解析正常 JSON', () => {
  const out = parseDigestOutput('{"summary":"短摘要","detail":"详细内容"}');
  assert.equal(out.summary, '短摘要');
  assert.equal(out.detail, '详细内容');
});

test('parseDigestOutput 容忍 ```json 代码块包裹', () => {
  const out = parseDigestOutput('```json\n{"summary":"S","detail":"D"}\n```');
  assert.equal(out.summary, 'S');
  assert.equal(out.detail, 'D');
});

test('parseDigestOutput 能救回被截断的 JSON（推理模型吃光 token 时的真实情况）', () => {
  // 这是线上实测到的形态：detail 写到一半就断了，连结尾引号都没有
  const truncated = '{"summary":"他今天出门走了走，回来心情不错。","detail":"他今天出门走了走。下午顺路去了一趟书店，翻了会儿书，还';
  const out = parseDigestOutput(truncated);
  assert.ok(out, '截断的输出也必须能救回来，否则纸条全丢');
  assert.match(out.summary, /出门走了走/);
  assert.match(out.detail, /顺路去了一趟书店/);
});

test('parseDigestOutput 对完全无用的输出返回 null', () => {
  assert.equal(parseDigestOutput(''), null);
  assert.equal(parseDigestOutput('抱歉，我不能处理这个请求。'), null);
  assert.equal(parseDigestOutput('{"foo":"bar"}'), null);
});

test('parseDigestOutput 缺 detail 时用 summary 兜底，反之亦然', () => {
  const onlySummary = parseDigestOutput('{"summary":"只有摘要"}');
  assert.equal(onlySummary.summary, '只有摘要');
  assert.equal(onlySummary.detail, '只有摘要');
  const onlyDetail = parseDigestOutput('{"detail":"只有详细"}');
  assert.equal(onlyDetail.summary, '只有详细');
});

/* ── 日期 ── */

test('localDayKey 用本地时区，不会因 UTC 偏移串天', () => {
  assert.equal(localDayKey(new Date(2026, 7, 4, 0, 5, 0)), '2026-08-04');
  assert.equal(localDayKey(new Date(2026, 7, 4, 23, 55, 0)), '2026-08-04');
});

test('humanDayLabel 输出中国人看得懂的日期', () => {
  assert.equal(humanDayLabel('2026-08-04'), '2026 年 8 月 4 日');
});

/* ── 注入提示词的纸条块 ── */

test('buildDigestPromptBlock 输出 YYYY-MM-DD（不能是 JS 的英文 Date 格式）', () => {
  const block = buildDigestPromptBlock([
    { content: '他今天出门走了走。', occurred_at: new Date(2026, 8, 10, 12, 0, 0) }
  ]);
  assert.match(block, /2026-09-10/, '必须格式化成 YYYY-MM-DD');
  assert.doesNotMatch(block, /Thu Sep|GMT/, '绝不能把 JS Date 的英文格式喂给模型');
  assert.match(block, /【你自己记下的最近几天】/);
});

test('buildDigestPromptBlock 明确禁止机械复读', () => {
  const block = buildDigestPromptBlock([{ content: '某件事', occurred_at: '2026-08-04 12:00:00' }]);
  assert.match(block, /不要复述/);
  assert.match(block, /不要说我记得|不要复述/);
});

test('buildDigestPromptBlock 没有纸条时返回空字符串', () => {
  assert.equal(buildDigestPromptBlock([]), '');
  assert.equal(buildDigestPromptBlock([{ content: '   ' }]), '');
});
