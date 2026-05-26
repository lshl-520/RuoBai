import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

test('profile exposes chat card style picker with all five styles', async () => {
  const html = await readFile(new URL('../profile.html', import.meta.url), 'utf8');

  assert.match(html, /id="cardStyleRow"/);
  assert.match(html, /id="cardStyleLabel"/);
  assert.match(html, /id="stylePicker"/);

  for (const style of ['card-a', 'card-c3', 'card-b', 'card-c1', 'card-c2']) {
    assert.match(html, new RegExp(`data-style="${style}"`));
  }
});

test('chat list cards render intimacy progress and level label', async () => {
  const html = await readFile(new URL('../chat.html', import.meta.url), 'utf8');

  assert.match(html, /\.intimacy\s*\{/);
  assert.match(html, /\.intimacy-bar\s*\{/);
  assert.match(html, /\.intimacy-fill\s*\{/);
  assert.match(html, /\.intimacy-label\s*\{/);
  assert.match(html, /Lv\.\$\{intimacy\}/);
});

test('chat room derives companionship labels from first chat time', async () => {
  const html = await readFile(new URL('../chat-room.html', import.meta.url), 'utf8');

  assert.match(html, /first_chat_at|firstChatAt/);
  assert.match(html, /function companionshipDays/);
  assert.match(html, /function companionshipText/);
  assert.match(html, /还没开始陪伴/);
  assert.match(html, /intimacyBar\.style\.width = `\$\{intimacy\}%`/);
  assert.match(html, /querySelector\('\.topbar-status'\)\.textContent/);
  assert.match(html, /querySelector\('\.c3-anniversary'\)\.hidden = true/);
  assert.doesNotMatch(html, />72 天</);
  assert.doesNotMatch(html, /陪伴 72 天/);
  assert.doesNotMatch(html, /亲密 88/);
  assert.doesNotMatch(html, /92°C/);
  assert.doesNotMatch(html, /6 月 30 日/);
});
