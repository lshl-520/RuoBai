/**
 * 录音（把用户的声音录成一个音频文件）—— 2026/9/19
 *
 * 从 chat.jsx 里抽出来的一层：以前录音逻辑和界面、上传、识别混在一起，
 * 聊天室那个文件已经太长。这里只负责"开始录 / 结束录，给我音频"。
 *
 * 说明：录音本身一直是在设备本地做的（浏览器/App 的麦克风），
 * 不经过若白服务器；服务器只在"发语音消息"这一步接收文件。
 *
 * ★ 2026/9/19 修：长按"松手就发"没反应
 *   `getUserMedia` 要申请麦克风权限、初始化硬件，需要时间（第一次尤其慢）。
 *   原来 stop() 时录音可能还没真正开始，于是拿到 null、语音发不出去。
 *   现在 stop() 会**等启动完成**再停，保证这次按住真的录到了东西。
 */
export function isVoiceRecordingSupported() {
  return typeof navigator !== "undefined"
    && Boolean(navigator.mediaDevices?.getUserMedia)
    && typeof MediaRecorder !== "undefined";
}

function pickMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  if (MediaRecorder.isTypeSupported("audio/webm")) return "audio/webm";
  if (MediaRecorder.isTypeSupported("audio/mp4")) return "audio/mp4";
  return "";
}

/**
 * 创建一个录音器。
 * 返回 { start(), stop(), cancel(), isRecording() }
 *   start()  → Promise，麦克风就绪、真的开始录了才 resolve
 *   stop()   → { blob, durationMs }，即使刚按下就松手也能安全拿到结果
 *   cancel() → 丢弃这次录音
 */
export function createVoiceRecorder() {
  let stream = null;
  let recorder = null;
  let chunks = [];
  let mimeType = "";
  let startedAt = 0;
  let startingPromise = null;
  let cancelled = false;

  const releaseStream = () => {
    try { stream?.getTracks?.().forEach((track) => track.stop()); } catch { /* 忽略 */ }
    stream = null;
  };

  const reset = () => {
    recorder = null;
    chunks = [];
    startedAt = 0;
    startingPromise = null;
  };

  const start = async () => {
    if (!isVoiceRecordingSupported()) throw new Error("这台设备不支持录音");
    cancelled = false;
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // 用户在申请权限期间已经松手了：直接把麦克风还回去，不要留一条空录音
    if (cancelled) { releaseStream(); reset(); return; }
    mimeType = pickMimeType();
    recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    chunks = [];
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunks.push(event.data);
    };
    recorder.start();
    startedAt = Date.now();
  };

  return {
    isRecording() {
      return recorder?.state === "recording";
    },

    start() {
      startingPromise = start();
      return startingPromise;
    },

    async stop() {
      cancelled = true;
      // ★ 关键：如果还在启动（等权限、等硬件），先等它起完再停。
      //   否则 recorder 还是 null，这次按住就白按了。
      if (startingPromise) {
        try { await startingPromise; } catch { /* 启动失败，按没录到处理 */ }
      }
      if (!recorder || recorder.state === "inactive") {
        releaseStream();
        reset();
        return null;
      }
      const active = recorder;
      const duration = Math.max(0, Date.now() - startedAt);
      const type = active.mimeType || mimeType || "audio/webm";
      return await new Promise((resolve) => {
        active.onstop = () => {
          const blob = chunks.length ? new Blob(chunks, { type }) : null;
          releaseStream();
          reset();
          resolve(blob ? { blob, durationMs: duration } : null);
        };
        try { active.stop(); } catch {
          releaseStream();
          reset();
          resolve(null);
        }
      });
    },

    cancel() {
      cancelled = true;
      try {
        if (recorder && recorder.state !== "inactive") recorder.stop();
      } catch { /* 忽略 */ }
      releaseStream();
      reset();
    },
  };
}

export default { createVoiceRecorder, isVoiceRecordingSupported };