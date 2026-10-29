import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');

async function readProjectFile(...segments) {
  return readFile(path.join(projectRoot, ...segments), 'utf8');
}

test('native push boot registers notification action listener before settings sheet is opened', async () => {
  const push = await readProjectFile('frontend-react', 'src', 'lib', 'push.js');
  const app = await readProjectFile('frontend-react', 'src', 'App.jsx');

  assert.match(push, /async function ensurePushListeners\(\)/);
  assert.match(push, /pushNotificationActionPerformed/);
  assert.match(push, /ensurePushListeners\(\)\.catch/);
  assert.match(app, /bootNativePushIfPossible\(\);/);
});

/**
 * ═══ 通知渠道 + 流体云（2026/9/21）═══
 *
 * 用户问「通知和流体云可以有吗」，并同意通知图标用若白 App 图标缩小、
 * 顺便试流体云。这组测试锁住三件容易悄悄坏掉的事：
 *   ① 渠道 id 必须和服务端 proactive.js 里推的 channelId 完全一致，
 *      否则安卓会把通知丢进系统兜底渠道（名字显示成「其他」）；
 *   ② 通知小图标必须是**单色剪影**，而且清单里三个 FCM 元数据键都要在；
 *   ③ 流体云那条路要有"系统不支持就如实上报"的降级，
 *      不能硬弹、也不能假装成功。
 */
test('★ 通知渠道 id 与服务端推送保持一致', async () => {
  const push = await readProjectFile('frontend-react', 'src', 'lib', 'push.js');
  const proactive = await readProjectFile('server', 'proactive.js');

  const clientChannel = /PROACTIVE_CHANNEL_ID\s*=\s*"([^"]+)"/.exec(push)?.[1];
  const serverChannel = /channelId:\s*'([^']+)'/.exec(proactive)?.[1];
  assert.ok(clientChannel, '前端要定义通知渠道 id');
  assert.equal(clientChannel, serverChannel, '两端渠道 id 必须一致，否则通知进兜底渠道');
  assert.match(push, /PushNotifications\.createChannel/);
  assert.match(push, /ensureProactiveChannel\(\)/, '启动时就要建好渠道');
});

test('★ 通知小图标是单色剪影，且 FCM 三个元数据键都在', async () => {
  const manifest = await readProjectFile('frontend-react', 'android', 'app', 'src', 'main', 'AndroidManifest.xml');

  assert.match(manifest, /com\.google\.firebase\.messaging\.default_notification_icon/);
  assert.match(manifest, /@drawable\/ic_notification/);
  assert.match(manifest, /com\.google\.firebase\.messaging\.default_notification_color/);
  assert.match(manifest, /com\.google\.firebase\.messaging\.default_notification_channel_id/);

  // 图标必须是普通 drawable，不能用自适应图标（FCM 会忽略并回落成白方块）
  assert.doesNotMatch(manifest, /default_notification_icon[^>]*@mipmap/);
});

test('★ 流体云：系统不支持时如实上报并降级，不假装成功', async () => {
  const live = await readProjectFile('frontend-react', 'src', 'lib', 'live-update.js');
  const java = await readProjectFile('frontend-react', 'android', 'app', 'src', 'main', 'java', 'fun', 'lshl', 'ruobai', 'LiveUpdatePlugin.java');
  const profile = await readProjectFile('frontend-react', 'src', 'pages', 'profile.jsx');

  // 低版本 / 系统没开放时不能返回 supported=true
  assert.match(java, /Build\.VERSION\.SDK_INT < 36/);
  assert.match(java, /canPostPromotedNotifications\(\)/);
  assert.match(live, /supported: false, notificationsAllowed: false/);

  // 用 Android 16 的「实时更新」那套 API
  assert.match(java, /setRequestPromotedOngoing\(true\)/);
  assert.match(java, /setOngoing\(true\)/);

  // 入口只在系统支持时才露出来
  assert.match(profile, /isLiveUpdateSupported/);
  assert.match(profile, /liveSupport\?\.supported/);
});
