import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');
const readProjectFile = (...segments) => readFile(path.join(projectRoot, ...segments), 'utf8');

test('Android APP 注册了原生语音识别桥（走手机自己的识别）', async () => {
  const main = await readProjectFile('frontend-react', 'android', 'app', 'src', 'main', 'java', 'fun', 'lshl', 'ruobai', 'MainActivity.java');
  const plugin = await readProjectFile('frontend-react', 'android', 'app', 'src', 'main', 'java', 'fun', 'lshl', 'ruobai', 'NativeSpeechRecognitionPlugin.java');

  assert.match(main, /registerPlugin\(NativeSpeechRecognitionPlugin\.class\)/);
  assert.match(plugin, /@CapacitorPlugin\(/);
  assert.match(plugin, /name = "NativeSpeechRecognition"/);
  assert.match(plugin, /SpeechRecognizer\.createSpeechRecognizer/);
  // Android 12+ 的设备端离线识别
  assert.match(plugin, /createOnDeviceSpeechRecognizer/);
  assert.match(plugin, /EXTRA_PREFER_OFFLINE/);
  assert.match(plugin, /RECORD_AUDIO/);
  assert.match(plugin, /emit\("final"/);
  assert.match(plugin, /emit\("partial"/);
});

test('识别通道：App 优先设备、网页回退浏览器，上层不用关心底下是谁', async () => {
  const layer = await readProjectFile('frontend-react', 'src', 'lib', 'speech-recognition.js');
  const chat = await readProjectFile('frontend-react', 'src', 'pages', 'chat.jsx');

  assert.match(layer, /NativeSpeechRecognition\.addListener/);
  assert.match(layer, /isNativeSpeechRecognitionAvailable\(\)/);
  assert.match(layer, /return createBrowserRecognizer/);
  assert.match(layer, /transcribeOnServer/);
  assert.match(layer, /\/api\/asr\/transcribe/);
  // 聊天室不再自己 new 浏览器的识别对象，统一走这一层
  assert.match(chat, /createSpeechRecognizer/);
  assert.match(chat, /isNativeSpeechRecognitionAvailable/);
  assert.match(chat, /startNativeListen/);
  assert.doesNotMatch(chat, /new window\.webkitSpeechRecognition/);
  assert.doesNotMatch(chat, /new SR\(\)/);
});

test('Android 安装清单声明系统听写和朗读，否则 Android 11+ 会当成没有这服务', async () => {
  const manifest = await readProjectFile('frontend-react', 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
  assert.match(manifest, /android.speech.RecognitionService/);
  assert.match(manifest, /android.intent.action.TTS_SERVICE/);
});

test('识别失败不再发"（发了语音）"这种假内容骗模型', async () => {
  const chat = await readProjectFile('frontend-react', 'src', 'pages', 'chat.jsx');
  assert.doesNotMatch(chat, /textForAI = transcript \|\| "（发了语音）"/);
  assert.match(chat, /没有转出文字/);
});

test('录音从 chat.jsx 抽成独立模块', async () => {
  const recorder = await readProjectFile('frontend-react', 'src', 'lib', 'voice-recorder.js');
  assert.match(recorder, /createVoiceRecorder/);
  assert.match(recorder, /MediaRecorder/);
  assert.match(recorder, /getUserMedia/);
});

test('微信式语音按钮：点一下转文字、按住发语音', async () => {
  const chat = await readProjectFile('frontend-react', 'src', 'pages', 'chat.jsx');
  assert.match(chat, /function VoiceTalkButton/);
  assert.match(chat, /VOICE_HOLD_MS/);
  assert.match(chat, /点一下转文字/);
  assert.match(chat, /按住说话/);
  assert.match(chat, /松开发送/);
  // 旧的"点语音→弹窗→开始录音"四步流程应该已经不在
  assert.doesNotMatch(chat, /点击录音/);
  assert.doesNotMatch(chat, /准备录音/);
});

test('连发多条：边收边切句，并且一句一条落库', async () => {
  const chat = await readProjectFile('frontend-react', 'src', 'pages', 'chat.jsx');
  // 用切句器，而不是把整段塞进一个气泡
  assert.match(chat, /const createBubbleWriter = /);
  assert.match(chat, /writer\.splitter\.push\(token\)/);
  // 逐条保存，而不是只存一整段（主发送与语音发送都走同一套）
  assert.match(chat, /const bubblesToSave = writer\.emitted\.length \? writer\.emitted : splitReplyIntoBubbles\(fullReply\)/);
  assert.match(chat, /const voiceBubbles = writer\.emitted\.length \? writer\.emitted : splitReplyIntoBubbles\(fullReply\)/);
  assert.match(chat, /for \(let i = 0; i < bubblesToSave\.length; i\+\+\)/);
  assert.match(chat, /content: bubblesToSave\[i\]/);
});

test('长按发语音：按下就开始准备麦克风，并按按住时长区分点按与长按', async () => {
  const chat = await readProjectFile('frontend-react', 'src', 'pages', 'chat.jsx');
  const recorder = await readProjectFile('frontend-react', 'src', 'lib', 'voice-recorder.js');
  // 按下立刻开始录，不再等按住 350ms 才申请麦克风（否则松手时还没开始录）
  assert.match(chat, /const handleDown = \(event\) => \{[\s\S]*?beginRecord\(\);/);
  // 用按住时长区分：短按走转文字，长按才发语音
  assert.match(chat, /heldMs < VOICE_HOLD_MS/);
  assert.match(chat, /enterTranscribeMode\(\)/);
  assert.match(chat, /transcribeOnServer/);
  // 录音器必须等"启动完成"再停，否则刚按下就松手会拿到 null
  assert.match(recorder, /if \(startingPromise\)/);
  assert.match(recorder, /await startingPromise/);
});

test('点一下转文字：第二下必须能结束识别（不能被 gestureDone 拦住）', async () => {
  const chat = await readProjectFile('frontend-react', 'src', 'pages', 'chat.jsx');
  // 第二下按下时，如果正在识别，必须先把 gestureDone 复位再 return，
  // 否则 handleUp 第一行就 return，界面永远卡在"正在听…再点一下转成文字"。
  assert.match(
    chat,
    /if \(transcribingRef\.current\) \{\s*gestureDoneRef\.current = false;\s*return;\s*\}/,
    'handleDown 在识别中必须复位 gestureDone，否则第二下结束不了'
  );
});

test('点一下转文字：默认走服务器识别，不再只依赖手机自带听写', async () => {
  const chat = await readProjectFile('frontend-react', 'src', 'pages', 'chat.jsx');
  // 真机上手机自带听写服务不可用（ColorOS 上 Google 语音被停用、系统默认识别服务为空），
  // 所以点按必须和长按一样优先用服务器识别；只有确实离线时才退到手机听写。
  assert.match(chat, /serverAsrRef/);
  assert.match(chat, /\/api\/asr\/status/);
  assert.match(chat, /if \(serverAsrRef\.current \|\| !isNativeSpeechRecognitionAvailable\(\)\) return;/);
  assert.match(chat, /transcribeOnServer\(result\.blob\)/);
  // 一直没点第二下时不能一直占着麦克风
  assert.match(chat, /TRANSCRIBE_MAX_MS/);
  assert.match(chat, /transcribeTimerRef/);
});
test('上传语音接受带参数的音频类型（audio/webm;codecs=opus）', async () => {
  const server = await readProjectFile('frontend-react', '..', 'server', 'chat.js');
  // 旧正则只认 audio/webm，手机录出来带 ;codecs=opus 会 400
  assert.ok(server.includes('(?:;[a-z0-9=._-]+)*;base64'), '上传语音要允许句柄后面带参数');
});

test('按住发语音也会先转写，再把文字交给她', async () => {
  const chat = await readProjectFile('frontend-react', 'src', 'pages', 'chat.jsx');
  assert.match(chat, /onVoice=\{async \(\{ blob, durationMs, transcript: readyText \}\) => \{[\s\S]*transcribeOnServer\(blob\)[\s\S]*sendVoice/);
  // 录音和系统听写不能同时开：两者都要独占麦克风，会互相抢
  assert.doesNotMatch(chat, /await recorder\.start\(\);\s*\n\s*\/\/[^\n]*\n\s*if \(isNativeSpeechRecognitionAvailable\(\)\) \{\s*\n\s*startNativeListen/);
  assert.doesNotMatch(chat, /transcript: ""/);
  assert.match(chat, /VOICE_MIN_SEND_MS/);
});

test('连发多条时思考只挂第一条，界面按连续分组渲染', async () => {
  const chat = await readProjectFile('frontend-react', 'src', 'pages', 'chat.jsx');
  assert.match(chat, /annotateConsecutiveGroups/);
  assert.match(chat, /applyTurnReasoning/);
  assert.match(chat, /const isFirst = bubbleId === firstId/);
  assert.match(chat, /isFirst && reasoningRequested/);
  assert.match(chat, /paintTurnReasoning\(replyId, fullInnerOs, reasoningRequested/);
});

test('思考自动展开再收起，正文一条一条往外冒', async () => {
  const chat = await readProjectFile('frontend-react', 'src', 'pages', 'chat.jsx');
  assert.match(chat, /想了 \$\{seconds\} 秒/);
  assert.match(chat, /unlockBody\(\)/);
  assert.match(chat, /setTurnTyping\(true\)/);
  assert.match(chat, /_holdBody/);
});
