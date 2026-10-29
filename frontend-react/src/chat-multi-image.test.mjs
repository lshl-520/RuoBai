import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

/*
 * 为什么要有这条测试（2026/10/14 回归）：
 *
 * 一次选中多张图发出去时，界面把多张放在**同一条气泡**里（send() 注释：多图显示在一条里），
 * 但后端是**每张各存一条**（send() 注释：多图：每张存一条，最后一条带文字）。
 * 于是退出聊天室再进来（从服务器重新读）时，同一次发的图会散成好几条。
 * 修法是读回来时按「同一批连发」并回一条 —— 只动显示，不动数据库。
 */
const chat = fs.readFileSync(new URL('./pages/chat.jsx', import.meta.url), 'utf8');
const frames = fs.readFileSync(new URL('./lib/visual-frames.js', import.meta.url), 'utf8');

test('读回来的消息会把同一批发出的多张图并回一条', () => {
  assert.ok(chat.includes('function mergeImageRows('), '应有 mergeImageRows');
  assert.ok(chat.includes('function sameImageBatch('), '应有同批判定');
  const applied = chat.match(/mergeImageRows\(/g) || [];
  assert.ok(applied.length >= 4, '合并函数要出现在定义处 + 三处读取处，实际 ' + applied.length);
  assert.ok(chat.includes('Array.isArray(m.__mergedImages)'), 'toMsg 要渲染合并后的全部图片');
});

test('合并显示的多图按整组删除，不会只删掉一张', () => {
  assert.ok(chat.includes('const ids = (Array.isArray(msgId) ? msgId : [msgId]).filter(Boolean);'), '删除要支持一组 id');
  assert.ok(chat.includes('onDelete?.(m.ids || m.id)'), '删除按钮要传整组 id');
  assert.ok(chat.includes('ids: Array.isArray(m.__mergedIds) && m.__mergedIds.length > 1 ? m.__mergedIds : undefined'), 'toMsg 要带上整组 id');
});

test('聊天室默认取景是全身（2026/10/14 用户要求看得更完整）', () => {
  assert.ok(/chatFrame: "full"/.test(frames), "默认 chatFrame 应为 full");
  assert.ok(!/chatFrame: "knee"/.test(frames), "不应再默认膝盖以上");
});
