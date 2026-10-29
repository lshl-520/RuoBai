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

/**
 * ═══ 不依赖谷歌的后台守候（2026/9/21）═══
 *
 * 背景：真机实测 ping mtalk.google.com 100% 丢包、curl 谷歌 443 超时，
 * 而自己的后端正常 —— FCM 那条路在网络层就是断的。
 * 这组测试锁住替代通道的关键约束，防止以后被"优化"掉。
 */
test('★ 后台守候走的是自己的接口，不是 FCM 的 token 通道', async () => {
  const poll = await readProjectFile('frontend-react', 'src', 'lib', 'push-poll.js');

  assert.match(poll, /registerPlugin\("PushPoll"\)/);
  assert.match(poll, /\/api\/push\/poll-key/);
  assert.match(poll, /PushPoll\.start\(/);
  // 这条通道的价值就是绕开谷歌，所以不能再依赖 FCM
  assert.doesNotMatch(poll, /PushNotifications/);
  assert.doesNotMatch(poll, /firebase/i);
});

test('★ 原生侧：前台服务 + 免谷歌的 HTTPS 直连 + 常驻胶囊', async () => {
  const service = await readProjectFile(
    'frontend-react', 'android', 'app', 'src', 'main', 'java', 'fun', 'lshl', 'ruobai', 'PushPollService.java');

  // 前台服务（ColorOS 才不会把 App 冻结掉）
  assert.match(service, /extends Service/);
  assert.match(service, /startForeground|ServiceCompat\.startForeground/);
  assert.match(service, /FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING/);

  // 直接 HTTPS 问若白服务器，完全不经谷歌
  assert.match(service, /HttpURLConnection/);
  assert.match(service, /\/api\/push\/poll\/pending/);
  assert.match(service, /x-device-key/);
  // 只查真正会引入谷歌依赖的代码，别被注释里提到 FCM 误伤
  assert.doesNotMatch(service, /import\s+com\.google\.firebase/);
  assert.doesNotMatch(service, /FirebaseMessaging\.getInstance/);

  // 常驻通知同时就是流体云胶囊
  assert.match(service, /setOngoing\(true\)/);
  assert.match(service, /setRequestPromotedOngoing\(true\)/);
});

test('★ 后台守候要能在深度睡眠和重启后存活', async () => {
  const service = await readProjectFile(
    'frontend-react', 'android', 'app', 'src', 'main', 'java', 'fun', 'lshl', 'ruobai', 'PushPollService.java');
  const boot = await readProjectFile(
    'frontend-react', 'android', 'app', 'src', 'main', 'java', 'fun', 'lshl', 'ruobai', 'PushPollBootReceiver.java');
  const manifest = await readProjectFile(
    'frontend-react', 'android', 'app', 'src', 'main', 'AndroidManifest.xml');

  // Handler.postDelayed 用的是 uptimeMillis，睡眠时不走；必须用闹钟
  assert.match(service, /setAndAllowWhileIdle/);
  assert.match(service, /AlarmManager/);

  assert.match(boot, /BOOT_COMPLETED/);
  assert.match(manifest, /android\.permission\.RECEIVE_BOOT_COMPLETED/);
  assert.match(manifest, /android\.permission\.FOREGROUND_SERVICE_REMOTE_MESSAGING/);
  assert.match(manifest, /\.PushPollService/);
  assert.match(manifest, /\.PushPollBootReceiver/);
  assert.match(manifest, /android:stopWithTask="false"/);

  // 第二道保险：ColorOS 划掉 App 时会连闹钟一起清（真机 logcat 证据：
  // unproxyAlarmsByUid 紧跟着 o-kill(40)），所以还要一个系统托管的 JobScheduler。
  const job = await readProjectFile(
    'frontend-react', 'android', 'app', 'src', 'main', 'java', 'fun', 'lshl', 'ruobai', 'PushPollJobService.java');
  assert.match(job, /extends JobService/);
  assert.match(job, /setPersisted\(true\)/);
  assert.match(manifest, /\.PushPollJobService/);
  assert.match(manifest, /BIND_JOB_SERVICE/);
  // job 必须由服务每次启动时补登记，否则重装/恢复路径会把它漏掉（真机踩过）
  assert.match(service, /PushPollJobService\.schedule\(this\)/);
});

/**
 * 实测踩到的坑（2026/9/21 真机验证）：
 * POST_PROMOTED_NOTIFICATIONS 是 normal|appop 类型 —— **不声明的话系统默认把
 * appop 设成 ignore**，于是 canPostPromotedNotifications() 返回 false、
 * setRequestPromotedOngoing(true) 被丢掉，表现就是"流体云胶囊永远不出现"。
 * 真机证据：声明前 `cmd appops get <你的包名>` 显示 ignore。
 */
test('★ 流体云必须先声明 POST_PROMOTED_NOTIFICATIONS，否则系统默认拒绝', async () => {
  const manifest = await readProjectFile(
    'frontend-react', 'android', 'app', 'src', 'main', 'AndroidManifest.xml');

  assert.match(manifest, /android\.permission\.POST_PROMOTED_NOTIFICATIONS/);
  // 开关打开后系统会把它记成 appop allow，这条留在设置页里给用户拨
  const profile = await readProjectFile('frontend-react', 'src', 'pages', 'profile.jsx');
  assert.match(profile, /isLiveUpdateSupported/);
});

test('★ 通知点开要跳进对应角色的聊天', async () => {
  const poll = await readProjectFile('frontend-react', 'src', 'lib', 'push-poll.js');
  const plugin = await readProjectFile(
    'frontend-react', 'android', 'app', 'src', 'main', 'java', 'fun', 'lshl', 'ruobai', 'PushPollPlugin.java');
  const activity = await readProjectFile(
    'frontend-react', 'android', 'app', 'src', 'main', 'java', 'fun', 'lshl', 'ruobai', 'MainActivity.java');

  assert.match(poll, /consumePendingOpen/);
  assert.match(plugin, /ruobai_character_id|consumePendingOpen/);
  assert.match(activity, /ruobai_character_id/);
  assert.match(activity, /onNewIntent/);

  // 热启动（App 在后台时点通知）要主动敲网页，否则 React 不会自己发现
  assert.match(activity, /ruobai:open-target/);
  assert.match(activity, /evaluateJavascript/);
  const app = await readProjectFile('frontend-react', 'src', 'App.jsx');
  assert.match(app, /addEventListener\("ruobai:open-target"/);
});

test('★ 守候不能偷偷启动：没开过的用户不该莫名多一条常驻通知', async () => {
  const poll = await readProjectFile('frontend-react', 'src', 'lib', 'push-poll.js');
  const profile = await readProjectFile('frontend-react', 'src', 'pages', 'profile.jsx');

  // 恢复只在"以前开过 + 有钥匙"时才做
  assert.match(poll, /if \(!status\.enabled \|\| !status\.hasKey\) return;/);
  // resume 不换钥匙（start 才换）
  assert.match(poll, /PushPoll\.resume\(\)/);
  // 入口是用户自己拨的开关
  assert.match(profile, /toggleWatch/);
  assert.match(profile, /startBackgroundWatch/);
  assert.match(profile, /stopBackgroundWatch/);
});
