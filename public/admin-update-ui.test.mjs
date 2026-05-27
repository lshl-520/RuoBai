import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const html = await fs.readFile(new URL('./admin.html', import.meta.url), 'utf8');

test('admin system page exposes update controls', () => {
  assert.match(html, /id="updateCard"/);
  assert.match(html, /id="checkUpdateBtn"/);
  assert.match(html, /id="applyUpdateBtn"/);
  assert.match(html, /id="updateHistoryList"/);
});

test('admin page calls update APIs without showing raw stack traces', () => {
  assert.match(html, /\/api\/admin\/update-check/);
  assert.match(html, /\/api\/admin\/update-apply/);
  assert.match(html, /\/api\/admin\/update-history/);
  assert.doesNotMatch(html, /error\.stack/);
});
