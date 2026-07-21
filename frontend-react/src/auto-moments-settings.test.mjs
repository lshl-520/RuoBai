import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('./pages/agents.jsx', import.meta.url), 'utf8');

test('role editor restores and saves automatic moment frequency', () => {
  assert.match(source, /momentFreq:\s*\[2, 4, 6\]\.includes\(Number\(role\.auto_moments_daily_max\)\)/);
  assert.match(source, /auto_moments_daily_min:\s*auto \? freq : 0/);
  assert.match(source, /auto_moments_daily_max:\s*auto \? freq : 0/);
  assert.match(source, /auto_moments_min_interval_hours:\s*momentIntervalHours/);
});

test('automatic moment image choice is not duplicated in role editor', () => {
  assert.doesNotMatch(source, /auto_moments_with_image/);
  assert.doesNotMatch(source, /动态带图片/);
});
