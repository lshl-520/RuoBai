import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('./pages/agents.jsx', import.meta.url), 'utf8');

test('role editor restores and saves automatic moment frequency', () => {
  assert.match(source, /momentFreq:\s*normalizeMomentFrequency\(role\.auto_moments_daily_max\)/);
  assert.match(source, /auto_moments_daily_min:\s*auto \? freq : 0/);
  assert.match(source, /auto_moments_daily_max:\s*auto \? freq : 0/);
  assert.match(source, /auto_moments_min_interval_hours:\s*momentIntervalHours/);
  assert.match(source, /MOMENT_FREQ_PRESETS = \[2, 4, 6\]/);
  assert.match(source, /每天最多/);
  assert.match(source, /type="number" min="1" max="12"/);
});

test('automatic moment image choice is not duplicated in role editor', () => {
  assert.doesNotMatch(source, /auto_moments_with_image/);
  assert.doesNotMatch(source, /动态带图片/);
});
