import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('./lib/app-updater.js', import.meta.url), 'utf8');
const buildGradle = fs.readFileSync(new URL('../android/app/build.gradle', import.meta.url), 'utf8');
const updaterPlugin = fs.readFileSync(new URL('../android/app/src/main/java/fun/lshl/ruobai/AppUpdaterPlugin.java', import.meta.url), 'utf8');

test('legacy Android shell can discover version two and fall back to browser download', () => {
  assert.match(source, /versionCode: 1, versionName: "1\.0"/);
  assert.match(source, /window\.location\.assign\(update\.apkUrl\)/);
  assert.match(source, /not implemented\|unavailable\|not available/);
});

test('Android release build uses private signing properties and a configured update host', () => {
  assert.match(buildGradle, /rootProject\.file\('key\.properties'\)/);
  assert.match(buildGradle, /versionCode 7/);
  assert.match(buildGradle, /versionName "1\.2\.4"/);
  assert.match(buildGradle, /signingConfig signingConfigs\.release/);
  assert.match(buildGradle, /buildConfigField "String", "APP_UPDATE_HOST"/);
  assert.match(updaterPlugin, /BuildConfig\.APP_UPDATE_HOST/);
  assert.match(updaterPlugin, /getUriForDownloadedFile/);
  assert.match(updaterPlugin, /FLAG_GRANT_READ_URI_PERMISSION/);
  assert.doesNotMatch(updaterPlugin, /your-domain\.example\.com/);
});
