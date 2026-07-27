import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');
const readProjectFile = (...segments) => readFile(path.join(projectRoot, ...segments), 'utf8');

test('Android APP registers a native text-to-speech bridge', async () => {
  const main = await readProjectFile('frontend-react', 'android', 'app', 'src', 'main', 'java', 'fun', 'lshl', 'ruobai', 'MainActivity.java');
  const plugin = await readProjectFile('frontend-react', 'android', 'app', 'src', 'main', 'java', 'fun', 'lshl', 'ruobai', 'NativeTextToSpeechPlugin.java');

  assert.match(main, /registerPlugin\(NativeTextToSpeechPlugin\.class\)/);
  assert.match(plugin, /@CapacitorPlugin\(name = "NativeTextToSpeech"\)/);
  assert.match(plugin, /new TextToSpeech/);
  assert.match(plugin, /TextToSpeech\.QUEUE_FLUSH/);
  assert.match(plugin, /waitingForInitialization/);
  assert.match(plugin, /drainInitializationQueue\(\)/);
  assert.match(plugin, /@PluginMethod\s+public void stop/);
});

test('chat and voice settings prefer Android native speech and keep browser fallback', async () => {
  const nativeTts = await readProjectFile('frontend-react', 'src', 'lib', 'native-tts.js');
  const chat = await readProjectFile('frontend-react', 'src', 'pages', 'chat.jsx');
  const models = await readProjectFile('frontend-react', 'src', 'pages', 'models.jsx');

  assert.match(nativeTts, /Capacitor\.isNativePlatform\(\)/);
  assert.match(nativeTts, /NativeTextToSpeech\.speak/);
  assert.match(nativeTts, /return await speakBrowserText/);
  assert.match(chat, /speakTextWithSystemVoice/);
  assert.match(chat, /云端语音或音频播放临时失败/);
  assert.match(models, /Android APP 会优先使用手机自带朗读/);
});
