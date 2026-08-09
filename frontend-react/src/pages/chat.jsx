import React from "react";
import { Icon, Bars, greetByHour, STICKERS } from "../store.jsx";
import { getRoles, updateRole, getRolePortraitSrc, getRoleFullPortrait } from "../lib/roles.js";
import { getMessages, streamAssistantReply, saveMessage, saveUserMessage, uploadChatImage, uploadVoice, deleteAllMessages, deleteMessage, detectDrawKeywords, drawImage, speakMessage } from "../lib/chat.js";
import { createRealtimeCallSocket, startRealtimeMicrophone, RealtimePcmPlayer } from "../lib/realtime-call.js";
import { getSessionProfile, getCapabilities } from "../lib/profile.js";
import {
  DEFAULT_USER_AVATAR,
  fallbackToDefaultRoleAvatar,
  fallbackToDefaultUserAvatar,
} from "../lib/default-assets.js";
import { publishGeneratedSelfieMoment, shouldPublishGeneratedSelfie } from "../lib/moments.js";
import { loadVoiceSettings, speechRecognitionErrorMessage } from "../lib/voice-settings.js";
import { speakTextWithSystemVoice, stopSystemTextSpeech } from "../lib/native-tts.js";
import { recordDiagnostic, withDiagnosticId } from "../lib/diagnostics.js";
import { GUIDED_IMAGE_OPTIONS, buildGuidedImageSubject } from "../lib/guided-image.js";
import { getProactiveEvents, markProactiveEventRead } from "../lib/proactive.js";
import { Live2DStage } from "../components/Live2DStage.jsx";
import { getChatLive2DState } from "../lib/live2d-state.js";
import { getRoleVisualFrame, getVisualFrameView } from "../lib/visual-frames.js";
/* 聊天列表 + 聊天室(沉浸: 常驻立绘随情绪变化 / 全屏立绘 / 语音 / 表情包 / 思考过程 / 搜索) */
const { useState: useStateC, useRef: useRefC, useEffect: useEffectC } = React;

/* ====== 模型 + 心情展示面板 ====== */
const THINK_LEVELS = [
  { key: "off", label: "关闭" },
  { key: "low", label: "简短" },
  { key: "mid", label: "细腻" },
  { key: "high", label: "深入" },
];

function normalizeInnerOsLevel(level) {
  return THINK_LEVELS.some((item) => item.key === level)
    ? level
    : level === "ultra" ? "high" : "off";
}

function ModelPanel({ current, onPick, onClose }) {
  const [caps, setCaps] = useStateC(null);
  const [thinkLevel, setThinkLevel] = useStateC(normalizeInnerOsLevel(current?.thinkLevel));
  const [saving, setSaving] = useStateC(false);
  const [error, setError] = useStateC("");

  useEffectC(() => {
    getCapabilities().then((res) => {
      if (res?.success && Array.isArray(res.items)) setCaps(res.items);
    }).catch(() => setError("模型列表加载失败，请稍后再试"));
  }, []);

  const chatCap = caps?.find((c) => c.capability === "chat");
  const groups = {};
  (chatCap?.options || []).forEach((o) => {
    const key = o.credential_name || `供应商#${o.credential_id}`;
    if (!groups[key]) groups[key] = { credId: o.credential_id, name: key, models: [] };
    groups[key].models.push(o.model_id);
  });
  const allGroups = Object.values(groups);

  const save = async (choice, closeAfter = false) => {
    setSaving(true);
    setError("");
    try {
      await onPick(choice);
      if (closeAfter) onClose();
    } catch (e) {
      setError(e?.message || "保存失败，请稍后再试");
    } finally {
      setSaving(false);
    }
  };

  const pick = (credId, modelId) => {
    save({ credentialId: credId, modelId, thinkLevel }, true);
  };

  const pickThink = (level) => {
    setThinkLevel(level);
    save({ ...current, thinkLevel: level }, false);
  };

  return (
    <div className="model-panel-mask" onClick={onClose}>
      <div className="model-panel" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="mp-cols">
          <div className="mp-left">
            <div className="mp-title">切换聊天模型</div>
            {!caps && !error && <div className="mp-loading">加载中...</div>}
            {caps && allGroups.length === 0 && <div className="mp-empty">先去「我的」页配置一个聊天模型</div>}
            {allGroups.map((g) => (
              <div key={g.credId} className="mp-group">
                <div className="mp-group-name">{g.name}</div>
                {g.models.length <= 5 ? (
                  <div className="model-chips">
                    {g.models.map((m) => (
                      <button key={m} disabled={saving} className={"model-chip" + (current?.credentialId === g.credId && current?.modelId === m ? " on" : "")}
                        onClick={() => pick(g.credId, m)}>{m}</button>
                    ))}
                  </div>
                ) : (
                  <>
                    <div className="model-chips">
                      {g.models.slice(0, 3).map((m) => (
                        <button key={m} disabled={saving} className={"model-chip" + (current?.credentialId === g.credId && current?.modelId === m ? " on" : "")}
                          onClick={() => pick(g.credId, m)}>{m}</button>
                      ))}
                    </div>
                    <select disabled={saving} className="fld mp-select" value={current?.credentialId === g.credId ? (current?.modelId || "") : ""}
                      onChange={(e) => { if (e.target.value) pick(g.credId, e.target.value); }}>
                      <option value="">更多 ({g.models.length - 3} 个)...</option>
                      {g.models.slice(3).map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </>
                )}
              </div>
            ))}
            {error && <div className="mp-error">{error}</div>}
            <div className="mp-hint">可以给长期陪伴角色固定更合适的模型，其他角色继续使用默认模型</div>
          </div>
          <div className="mp-divider" />
          <div className="mp-right">
            <div className="mp-title">🌱 心情展示</div>
            {THINK_LEVELS.map((t) => (
              <button disabled={saving} key={t.key} className={"mp-think" + (thinkLevel === t.key ? " on" : "")} onClick={() => pickThink(t.key)}>
                <span className="mp-radio" />{t.label}
              </button>
            ))}
            <div className="mp-hint">
              {thinkLevel === "off"
                ? "关闭后只显示她的回复，不展示角色心情。"
                : `当前为${THINK_LEVELS.find((item) => item.key === thinkLevel)?.label || ""}：展示角色当下的心情与小心思，不展示模型原始思考链；不同中转的回传能力可能不同。`}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* 小白拥有的情绪立绘 */
const EMO_SET = {
  "01_默认温柔": "/images/xiaobai-emotions/01_默认温柔.png",
  "02_开心明亮": "/images/xiaobai-emotions/02_开心明亮.png",
  "03_害羞微笑": "/images/xiaobai-emotions/03_害羞微笑.png",
  "05_关心担忧": "/images/xiaobai-emotions/05_关心担忧.png",
  "11_撒娇期待": "/images/xiaobai-emotions/11_撒娇期待.png",
  "12_晚安微笑": "/images/xiaobai-emotions/12_晚安微笑.png",
};

/* 后端角色 → 2.0 agent 格式 */
function toAgent(role) {
  const visualMode = String(role.visual_mode || role.visualMode || "builtin");
  return {
    id: role.id,
    name: role.name,
    avatar: getRolePortraitSrc(role) || `/assets/portraits/round/0.png`,
    cover: getRoleFullPortrait(role),
    live2dModelUrl: visualMode === "live2d" ? String(role.live2d_model_url || role.live2dModelUrl || "") : "",
    live2dManifest: role.live2d_manifest || role.live2dManifest || null,
    visualFrame: getRoleVisualFrame(role),
    tag: role.tag || "",
    online: Boolean(role.is_active),
    isDefault: Boolean(role.is_active),
    _raw: role,
  };
}

function openAgentFromQuery(agents, onOpen, openedRef) {
  const params = new URLSearchParams(window.location.search);
  const characterId = params.get("character_id");
  const messageId = params.get("message_id") || "";
  if (!characterId) return;

  const marker = `${characterId}:${messageId}`;
  if (openedRef.current === marker) return;

  const match = agents.find((agent) => String(agent.id) === characterId);
  if (!match) return;

  openedRef.current = marker;
  onOpen(match);
}

/* ---------------- 聊天列表 ---------------- */
function ChatListScreen({ onOpen }) {
  const [agents, setAgents] = useStateC(null);
  const seqRef = useRefC(0);
  const openedFromQueryRef = useRefC("");

  useEffectC(() => {
    let cancelled = false;
    async function load() {
      const id = ++seqRef.current;
      try {
        const data = await getRoles();
        if (cancelled || seqRef.current !== id) return;
        if (Array.isArray(data)) {
          const nextAgents = data.map(toAgent);
          setAgents(nextAgents);
          openAgentFromQuery(nextAgents, onOpen, openedFromQueryRef);
        } else if (data?.success !== false && Array.isArray(data?.items)) {
          const nextAgents = data.items.map(toAgent);
          setAgents(nextAgents);
          openAgentFromQuery(nextAgents, onOpen, openedFromQueryRef);
        }
      } catch {
        if (!cancelled && seqRef.current === id) setAgents([]);
      }
    }
    load();
    const onFocus = () => load();
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    window.addEventListener("focus", onFocus);
    window.addEventListener("ruobai:role-saved", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("ruobai:role-saved", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const list = agents ?? [];
  const displayList = list;
  const onlineCount = list.filter((agent) => agent.online).length;

  return (
    <div className="screen anim-screen cl-screen">
      <div className="topbar cl-topbar">
        <div>
          <h1>{greetByHour()}</h1>
          <div className="sub">{agents === null ? "加载中…" : `${onlineCount} 位在线 · 随时可以说话`}</div>
        </div>
      </div>
      <div className="chat-list pad">
        {displayList.map((a, i) => (
          <button key={a.id} className={"cl-card" + (a.isDefault ? " cl-primary" : "")} onClick={() => onOpen(a)} style={{ animationDelay: `${i * 50}ms` }}>
            <div className="cl-avatar">
              <img src={a.avatar} alt={a.name} onError={fallbackToDefaultRoleAvatar} />
              {a.online && <span className="cl-online" />}
            </div>
            <div className="cl-main">
              <div className="cl-top">
                <span className="cl-name">{a.name}</span>
                {a.isDefault && <span className="cl-star">主陪伴</span>}
              </div>
              <div className="cl-bottom">
                <span className="cl-msg">{a.tag || "点击开始聊天"}</span>
              </div>
            </div>
            <div className="cl-arrow"><Icon name="chevron" /></div>
          </button>
        ))}
        {list.length === 0 && agents !== null && (
          <div className="empty-immersive">
            <img className="empty-immersive-img" src="/assets/empty-chat.webp" alt="" />
            <div className="empty-immersive-scrim" />
            <div className="empty-immersive-guide">
              <div className="empty-state-title">这里还空着</div>
              <div className="empty-state-desc">但她已经准备好了，随时等你开口。</div>
              <button className="empty-state-btn" onClick={() => window.location.href = '/characters'}>去创建第一个她</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- 思考过程 ---------------- */
// 同时支持 <think>（Claude/通用）和 <thinking>（Grok）两种标签
function extractThink(text) {
  if (!text) return { content: text, think: "" };
  const re = /<(think|thinking)>([\s\S]*?)<\/\1>/gi;
  let think = "";
  let match;
  while ((match = re.exec(text)) !== null) {
    think += match[2].trim() + "\n";
  }
  const content = text.replace(/<(think|thinking)>[\s\S]*?<\/\1>/gi, "").trim();
  return { content, think: think.trim() };
}

function ThinkCard({ text, pending = false, unavailable = false }) {
  const [open, setOpen] = useStateC(false);
  const hasSummary = Boolean(text?.trim());
  const body = hasSummary
    ? text
    : "这一轮的小心思暂时没有写出来。";

  return (
    <div className={"think" + (open ? " open" : "") + (pending ? " pending" : "") + (unavailable && !hasSummary ? " unavailable" : "")}>
      <button className="think-toggle" onClick={() => setOpen(!open)} disabled={pending} aria-expanded={open}>
        <span className="think-label"><Icon name="brain" /> 🌱 心情展示</span>
        {pending
          ? <span className="think-pending-dot" aria-label="正在写下她的心情" />
          : unavailable && !hasSummary
            ? <span className="think-empty-mark">暂时没写出</span>
            : <Icon name="chevronD" className="think-chev" />}
      </button>
      {open && <div className="think-body">{body}</div>}
    </div>
  );
}

/* ---------------- 语音气泡 ---------------- */
function VoiceBubble({ mine, dur, src }) {
  const [playing, setPlaying] = useStateC(false);
  const [measuredDur, setMeasuredDur] = useStateC("");
  const audioRef = useRefC(null);
  const bars = [8, 14, 10, 17, 12, 9, 15, 11, 7, 13, 9, 16, 10, 8, 12];

  useEffectC(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onEnd = () => setPlaying(false);
    const onMeta = () => {
      if (Number.isFinite(audio.duration)) setMeasuredDur(`${Math.max(1, Math.round(audio.duration))}\"`);
    };
    audio.addEventListener("ended", onEnd);
    audio.addEventListener("loadedmetadata", onMeta);
    return () => {
      audio.removeEventListener("ended", onEnd);
      audio.removeEventListener("loadedmetadata", onMeta);
    };
  }, [src]);

  const toggle = (e) => {
    e.stopPropagation();
    const audio = audioRef.current;
    if (!audio || !src) return;
    if (playing) { audio.pause(); setPlaying(false); }
    else { audio.play().then(() => setPlaying(true)).catch(() => {}); }
  };

  return (
    <button className={"voice" + (mine ? " mine" : "")} onClick={toggle}>
      {src && <audio ref={audioRef} src={src} preload="metadata" />}
      <span className="voice-play"><Icon name={playing ? "pause" : "play"} /></span>
      <span className="voice-wave">
        {bars.map((h, i) => <i key={i} style={{ height: h, opacity: playing ? 1 : 0.5, animationDelay: `${i * 60}ms` }} className={playing ? "on" : ""} />)}
      </span>
      <span className="voice-dur">{dur || measuredDur || "…"}</span>
    </button>
  );
}

/* ---------------- 文字转语音(TTS) ---------------- */
function TTSButton({ messageId, text, voice }) {
  const [status, setStatus] = useStateC("idle");
  const audioRef = useRefC(null);

  const speakWithFreeSystemVoice = async () => {
    setStatus("playing");
    await speakTextWithSystemVoice(text, {
      language: "zh-CN",
      pitch: 1.1,
      rate: Number(voice?.rate) || 0.95,
      browserVoiceURI: voice?.browserVoiceURI,
    });
    setStatus("idle");
  };

  const speak = async (e) => {
    e.stopPropagation();
    if (status === "loading") return;
    if (status === "playing") {
      await stopSystemTextSpeech();
      audioRef.current?.pause();
      setStatus("idle");
      return;
    }

    try {
      // 免费语音在 Android APP 里优先使用系统原生朗读，网页里继续使用浏览器朗读。
      if (voice?.engine === "browser") {
        await speakWithFreeSystemVoice();
        return;
      }

      if (!messageId) throw new Error("这条消息还没有保存，稍后再试");
      setStatus("loading");
      const result = await speakMessage(messageId, {
        voiceOverride: voice?.engine === "volcengine" ? voice?.volcVoice : voice?.voiceId,
        rate: Number(voice?.rate) || 0.9,
      });
      if (!result?.success) throw new Error(result?.error || "语音生成失败");
      if (result.use_browser_tts) {
        await speakWithFreeSystemVoice();
        return;
      }
      const audio = new Audio(result.audio_url);
      audioRef.current = audio;
      audio.onended = () => setStatus("idle");
      audio.onerror = async () => {
        try { await speakWithFreeSystemVoice(); }
        catch { setStatus("error"); }
      };
      await audio.play();
      setStatus("playing");
    } catch {
      // 云端语音或音频播放临时失败时，APP 会退回 Android 原生朗读，网页退回浏览器朗读。
      try { await speakWithFreeSystemVoice(); }
      catch { setStatus("error"); }
    }
  };

  const label = status === "loading" ? "生成中…" : status === "playing" ? "正在读…" : status === "error" ? "再试一次" : "读出来";
  return (
    <button className={"tts-btn" + (status === "playing" ? " on" : "")} onClick={speak}>
      <Icon name="wave" /><span>{label}</span>
    </button>
  );
}

/* 语音气泡 → 转文字 */
function VoiceTranscriptButton({ transcript, error }) {
  const [open, setOpen] = useStateC(false);
  return (
    <div className="voice-transcript">
      <button className="tts-btn" onClick={() => setOpen(!open)}>
        <Icon name="book" /><span>{open ? "收起" : "转文字"}</span>
      </button>
      {open && (
        <div className="voice-transcript-text">
          {transcript || error || "未识别到文字内容"}
        </div>
      )}
    </div>
  );
}

/* ---------------- 语音转文字(STT) + 录音 ---------------- */
function VoiceRecorder({ onCancel, onDone }) {
  const [status, setStatus] = useStateC("idle"); // idle | recording | uploading
  const [seconds, setSeconds] = useStateC(0);
  const [errMsg, setErrMsg] = useStateC("");
  const mediaRef = useRefC(null);
  const chunksRef = useRefC([]);
  const timerRef = useRefC(null);
  const recognRef = useRefC(null);
  const transcriptRef = useRefC("");
  const recognitionErrorRef = useRefC("");
  const secondsRef = useRefC(0);
  const cancelledRef = useRefC(false);

  useEffectC(() => {
    return () => {
      cancelledRef.current = true;
      if (timerRef.current) clearInterval(timerRef.current);
      if (mediaRef.current?.state === "recording") mediaRef.current.stop();
      if (recognRef.current) { try { recognRef.current.stop(); } catch {} }
    };
  }, []);

  const startRec = async () => {
    setErrMsg(""); transcriptRef.current = ""; recognitionErrorRef.current = "";
    secondsRef.current = 0; cancelledRef.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
      const mr = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (cancelledRef.current) return;
        if (!chunksRef.current.length) { setStatus("idle"); return; }
        setStatus("uploading");
        try {
          const blob = new Blob(chunksRef.current, { type: mimeType });
          const audioUrl = await uploadVoice(blob);
          const dur = Math.max(1, secondsRef.current);
          onDone({ audioUrl, dur, transcript: transcriptRef.current.trim(), recognitionError: recognitionErrorRef.current });
        } catch {
          setErrMsg("上传失败，请重试"); setStatus("idle");
        }
      };
      mr.start();
      mediaRef.current = mr;
      setStatus("recording");
      setSeconds(0);
      timerRef.current = setInterval(() => {
        secondsRef.current += 1;
        setSeconds(secondsRef.current);
      }, 1000);

      // SpeechRecognition 尽力识别；与 MediaRecorder 可能抢麦，失败时静默，不阻断录音
      try {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SR) {
          const r = new SR();
          r.lang = "zh-CN"; r.continuous = true; r.interimResults = true;
          r.onresult = (e) => {
            const t = Array.from(e.results).map((x) => x[0].transcript).join("");
            if (t.length > transcriptRef.current.length) transcriptRef.current = t;
          };
          r.onerror = (event) => {
            recognitionErrorRef.current = speechRecognitionErrorMessage(event.error);
            if (recognitionErrorRef.current) setErrMsg(recognitionErrorRef.current);
          };
          r.onend = () => { recognRef.current = null; };
          try {
            r.start();
            recognRef.current = r;
          } catch { /* 识别启动失败不影响录音 */ }
        }
      } catch { /* 识别不可用不影响录音 */ }
    } catch {
      setErrMsg("请允许麦克风权限");
    }
  };

  const stopRec = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (recognRef.current) { try { recognRef.current.stop(); } catch {} recognRef.current = null; }
    if (mediaRef.current?.state === "recording") mediaRef.current.stop();
  };

  return (
    <div className="vin-mask" onClick={status === "idle" ? onCancel : undefined}>
      <div className="vin" onClick={(e) => e.stopPropagation()}>
        <div className="vin-title">
          {status === "idle" && "准备录音"}
          {status === "recording" && <><span className="vin-rec-dot" />录音中… {seconds}&quot;</>}
          {status === "uploading" && "上传中…"}
        </div>
        <div className={"vin-wave" + (status === "recording" ? " active" : "")}>
          {Array.from({ length: 26 }).map((_, i) => <i key={i} style={{ animationDelay: `${i * 45}ms` }} />)}
        </div>
        {errMsg && <div className="vin-partial" style={{ color: "var(--rose)" }}>{errMsg}</div>}
        <div className="vin-actions">
          <button className="vin-cancel" onClick={() => { cancelledRef.current = true; stopRec(); onCancel(); }}>取消</button>
          {status === "idle" && <button className="vin-done" onClick={startRec}><Icon name="mic" /> 开始录音</button>}
          {status === "recording" && <button className="vin-done" onClick={stopRec}><Icon name="check" /> 完成</button>}
          {status === "uploading" && <button className="vin-done" disabled>上传中…</button>}
        </div>
        <div className="vin-hint">录完后她会用语音回复你 · 同时识别文字让她听懂你说了什么</div>
      </div>
    </div>
  );
}

async function saveChatImage(src) {
  const response = await fetch(src, { credentials: "same-origin" });
  if (!response.ok) throw new Error(`图片下载失败：${response.status}`);
  const blob = await response.blob();
  const typeExt = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
  }[blob.type];
  const pathExt = String(src).split("?")[0].match(/\.([a-z0-9]{2,5})$/i)?.[1];
  const ext = typeExt || pathExt || "png";
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = `ruobai-${new Date().toISOString().replace(/[:.]/g, "-")}.${ext}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

function ChatImagePreview({ src, onClose }) {
  const [saving, setSaving] = useStateC(false);
  const [saveError, setSaveError] = useStateC("");

  useEffectC(() => {
    const oldOverflow = document.body.style.overflow;
    const onKeyDown = (event) => { if (event.key === "Escape") onClose(); };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = oldOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setSaveError("");
    try {
      await saveChatImage(src);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "保存失败，请打开原图后长按保存");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="chat-image-preview" onClick={onClose}>
      <button className="cip-close" onClick={onClose} aria-label="关闭图片预览">×</button>
      <div className="cip-stage" onClick={(event) => event.stopPropagation()}>
        <img src={src} alt="聊天图片原图" />
      </div>
      <div className="cip-actions" onClick={(event) => event.stopPropagation()}>
        <button className="cip-save" onClick={save} disabled={saving}>{saving ? "正在保存…" : "保存图片"}</button>
        <a className="cip-original" href={src} target="_blank" rel="noreferrer">打开原图</a>
      </div>
      {saveError && <div className="cip-error" onClick={(event) => event.stopPropagation()}>{saveError}</div>}
      <div className="cip-hint">手机也可以长按大图保存</div>
    </div>
  );
}

function MessageImages({ images, onOpenImage }) {
  if (!images?.length) return null;
  return (
    <div className={"msg-imgs c" + Math.min(images.length, 3)}>
      {images.map((src, index) => (
        <button
          type="button"
          className="msg-img-button"
          key={`${src}-${index}`}
          onClick={(event) => { event.stopPropagation(); onOpenImage?.(src); }}
          onMouseDown={(event) => event.stopPropagation()}
          onTouchStart={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.stopPropagation()}
          aria-label="打开图片预览"
        >
          <img src={src} alt="聊天图片" loading="lazy" decoding="async" />
        </button>
      ))}
    </div>
  );
}

/* ---------------- 单条消息 ---------------- */
function Bubble({ m, agent, tts, voice, myAvatar, onDelete, onOpenImage, onRetry }) {
  const [menuPos, setMenuPos] = useStateC(null); // {x, y} 或 null
  const pressRef = useRefC(null);

  if (m.type === "time") return <div className="time-div">{m.text}</div>;
  const isMe = m.who === "me";

  const openMenu = (x, y) => {
    if (!m.id) return;
    setMenuPos({ x, y });
  };
  const startPress = (e) => {
    if (!m.id) return;
    const x = e.clientX || (e.touches?.[0]?.clientX ?? 200);
    const y = e.clientY || (e.touches?.[0]?.clientY ?? 200);
    pressRef.current = setTimeout(() => openMenu(x, y), 500);
  };
  const cancelPress = () => { if (pressRef.current) { clearTimeout(pressRef.current); pressRef.current = null; } };

  const menuEl = menuPos && (
    <div className="msg-menu-mask" onMouseDown={() => setMenuPos(null)} onClick={() => setMenuPos(null)}>
      <div className="msg-menu" style={{ left: menuPos.x, top: menuPos.y }} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
        <button className="msg-menu-del" onClick={() => { setMenuPos(null); onDelete?.(m.id); }}>
          <Icon name="trash" /> 删除
        </button>
      </div>
    </div>
  );

  const longPressProps = m.id ? {
    onContextMenu: (e) => { e.preventDefault(); openMenu(e.clientX, e.clientY); },
    onTouchStart: startPress,
    onTouchEnd: cancelPress,
    onTouchMove: cancelPress,
    onMouseDown: startPress,
    onMouseUp: cancelPress,
    onMouseLeave: cancelPress,
  } : {};

  if (m.type === "sticker") {
    return (
      <div className={"row " + (isMe ? "me" : "her")}>
        {!isMe && <div className="row-avatar"><img src={agent.avatar} alt="" onError={fallbackToDefaultRoleAvatar} /></div>}
        <div className="sticker-wrap">
          <div className="sticker"><span className="st-emo">{m.sticker}</span>{m.label && <span className="st-label">{m.label}</span>}</div>
          {m.time && <span className="msg-time">{m.time}</span>}
        </div>
        {isMe && <div className="row-avatar"><img src={myAvatar} alt="" onError={fallbackToDefaultUserAvatar} /></div>}
      </div>
    );
  }

  if (isMe) {
    return (
      <>
        {menuEl}
        <div className="row me" {...longPressProps}>
          <div className="me-stack">
            {m.type === "voice" ? (
              <VoiceBubble mine dur={m.dur} src={m.audioUrl} />
            ) : (
              <div className="bubble me-bubble">
                <MessageImages images={m.images} onOpenImage={onOpenImage} />
                {m.text && <span className="msg-text">{m.text}</span>}
              </div>
            )}
            {m.time && <span className="msg-time">{m.time}</span>}
            {m.failed && <button className="msg-retry" onClick={() => onRetry?.(m._clientId)}>重新发送</button>}
            {m.type === "voice" && <VoiceTranscriptButton transcript={m.transcript || ""} error={m.recognitionError || ""} />}
          </div>
          <div className="row-avatar"><img src={myAvatar} alt="" onError={fallbackToDefaultUserAvatar} /></div>
        </div>
      </>
    );
  }

  const { content: herText } = !isMe ? extractThink(m.text) : { content: m.text };
  const hasAssistantBubble = m.type === "voice" || Boolean(herText) || Boolean(m.images?.length);

  return (
    <>
      {menuEl}
      <div className="her-block" {...longPressProps}>
        {m.type === "proactive" && <div className="proactive-tag"><Icon name="sparkSm" /> {m.tag}</div>}
        <div className="row her">
          <div className="row-avatar"><img src={agent.avatar} alt="" onError={fallbackToDefaultRoleAvatar} /></div>
          <div className="her-stack">
            {hasAssistantBubble && (
              <div className={"bubble her-bubble" + (m.type === "proactive" ? " proactive" : "")}>
                <MessageImages images={m.images} onOpenImage={onOpenImage} />
                {m.type === "voice" ? <VoiceBubble dur={m.dur} src={m.audioUrl} /> : (herText && <span className="msg-text">{herText}</span>)}
              </div>
            )}
            {m.time && <span className="msg-time">{m.time}</span>}
            {tts && m.type === "text" && herText && <TTSButton messageId={m.id} text={herText} voice={voice} />}
            {m.type === "voice" && herText && <VoiceTranscriptButton transcript={herText} />}
            {(m.think || m.reasoningRequested) && (
              <ThinkCard
                text={m.think}
                pending={Boolean(m.reasoningPending)}
                unavailable={Boolean(m.reasoningUnavailable)}
              />
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function Typing({ agent }) {
  return (
    <div className="row her">
      <div className="row-avatar"><img src={agent.avatar} alt="" onError={fallbackToDefaultRoleAvatar} /></div>
      <div className="her-stack">
        <div className="typing-status">{agent.name}正在输入…</div>
        <div className="bubble her-bubble typing"><span /><span /><span /></div>
      </div>
    </div>
  );
}

/* ---------------- 聊天陪伴立绘：同一舞台切换半身/全屏 ---------------- */
function ChatFigure({ agent, figSrc, expanded, live2dState, onOpen, onClose }) {
  const viewFrame = getVisualFrameView(agent.visualFrame, expanded ? "fullscreen" : "chat");
  const figureFrameStyle = {
    "--chat-figure-scale": String(viewFrame.zoom),
    "--chat-figure-offset-x": `${viewFrame.offsetX * 100}%`,
    "--chat-figure-offset-y": `${viewFrame.offsetY * 100}%`,
  };

  return (
    <div className={`chat-figure${expanded ? " is-expanded" : ""}`} data-frame={viewFrame.mode} style={figureFrameStyle} onClick={expanded ? onClose : undefined}>
      <div className="chat-fig-glow" aria-hidden="true" />
      <div
        className="chat-figure-stage"
        role="button"
        tabIndex={0}
        aria-label={expanded ? `返回聊天，${agent.name}` : `查看${agent.name}的动态立绘`}
        onClick={(event) => {
          if (!expanded) {
            event.stopPropagation();
            onOpen();
          }
        }}
        onKeyDown={(event) => {
          if (!expanded && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            onOpen();
          }
        }}
      >
        <Live2DStage
          className="chat-live2d-stage"
          modelUrl={agent.live2dModelUrl}
          manifest={agent.live2dManifest}
          framing={viewFrame}
          state={live2dState}
          staticSrc={figSrc}
          fallbackSrc={figSrc}
          alt={agent.name}
        />
      </div>
      {!expanded && <div className="chat-fig-fade" aria-hidden="true" />}
      {expanded && (
        <>
          <div className="chat-figure-caption">
            <div className="chat-figure-name serif">{agent.name}</div>
            <div className="chat-figure-hint">轻触任意处返回聊天</div>
          </div>
          <button className="chat-figure-close" onClick={(event) => { event.stopPropagation(); onClose(); }} aria-label="返回聊天" title="返回聊天"><Icon name="back" /></button>
        </>
      )}
    </div>
  );
}

/* 后端消息 → 2.0 UI 格式 */
function toMsg(m) {
  const d = new Date(m.created_at);
  const time = d.getHours() + ":" + String(d.getMinutes()).padStart(2, "0");
  const today = new Date();
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
  let _date;
  if (d.toDateString() === today.toDateString()) _date = "今天";
  else if (d.toDateString() === yesterday.toDateString()) _date = "昨天";
  else _date = `${d.getMonth() + 1}月${d.getDate()}日`;
  // AI 生成图的旧记录里可能存着完整提示词或“生成了一张…”技术说明；
  // 这些都不属于聊天正文，统一只显示图片。用户自己发图时附带的文字仍保留。
  const messageType = m.message_type || "text";
  const isGeneratedImageCaption = m.role !== "user" && messageType === "image";
  return {
    id: m.id,
    who: m.role === "user" ? "me" : "her",
    type: messageType,
    tag: messageType === "proactive" ? "主动消息" : "",
    text: isGeneratedImageCaption ? "" : (m.content || ""),
    // 旧 reasoning_summary 可能是英文原始摘要，不能冒充角色内心。
    think: m.inner_os_source === "character_reflection" ? (m.inner_os_content || "") : "",
    images: (messageType === "image" && m.media_url) ? [m.media_url] : [],
    audioUrl: messageType === "voice" ? (m.media_url || m.audio_url || "") : "",
    dur: m.dur || "",
    time,
    _date,
  };
}
/* 按天插入时间分隔 */
function withTimeDividers(msgs) {
  const result = [];
  let lastDate = "";
  for (const m of msgs) {
    if (m._date && m._date !== lastDate) {
      result.push({ type: "time", text: m._date });
      lastDate = m._date;
    }
    result.push(m);
  }
  return result;
}

const REPLIES = [
  { text: "嗯,我在。你慢慢说,我不打断。", emo: "01_默认温柔", think: "他主动开口了,这很珍贵。我要做的不是回应得多漂亮,是让他觉得说出来是安全的。" },
  { text: "听到了。这件事搁在你心里多久了?", emo: "05_关心担忧", think: "顺着他的情绪往下,而不是急着给建议。先把『多久』问出来,他自己也许会松动。" },
  { text: "没关系的。你不用现在就想明白,我陪你一起拖一会儿也行。", emo: "11_撒娇期待", think: "他要的是允许,不是答案。给他一个能喘气的缝隙。" },
];
const STICKER_REPLIES = ["🥰", "🥺", "😘", "🌙", "😋", "🌸"];

const XIAOBAI_EMOTIONS = [
  { file: "01_默认温柔.png", name: "温柔" },
  { file: "02_开心明亮.png", name: "开心" },
  { file: "03_害羞微笑.png", name: "害羞" },
  { file: "04_认真倾听.png", name: "认真" },
  { file: "05_关心担忧.png", name: "担忧" },
  { file: "06_委屈小嘴.png", name: "委屈" },
  { file: "07_轻微惊讶.png", name: "惊讶" },
  { file: "08_无奈温柔.png", name: "无奈" },
  { file: "09_困倦慵懒.png", name: "困了" },
  { file: "10_生气但不凶.png", name: "生气" },
  { file: "11_撒娇期待.png", name: "撒娇" },
  { file: "12_晚安微笑.png", name: "晚安" },
];

const COMMON_EMOJIS = ["😊","😀","😁","😌","😉","🥹","😳","😘","👍","👏","❤️","🌭","✅","🎀","😻","🥰","🙄","🙏","🫶","🙂","🤗","😫","😴","☀️","🥳","💆","🎰","🍃","☁️","🌫","💐","💏","🫰","🎜","🌛"];

function EmojiPanel({ agent, onSendSticker, onInsertEmoji }) {
  const [tab, setTab] = useStateC(0);
  return (
    <div className="sticker-panel">
      <div className="sp-tabs">
        <button className={"sp-tab" + (tab === 0 ? " on" : "")} onClick={() => setTab(0)}>{agent.name}表情</button>
        <button className={"sp-tab" + (tab === 1 ? " on" : "")} onClick={() => setTab(1)}>通用Emoji</button>
      </div>
      {tab === 0 && (
        <div className="sp-grid">
          {XIAOBAI_EMOTIONS.map((em, i) => (
            <button key={i} className="sp-item sp-img" title={em.name} onClick={() => onSendSticker({ e: "", label: em.name, img: `/images/xiaobai-emotions/${em.file}` })}>
              <img src={`/images/xiaobai-emotions/${em.file}`} alt={em.name} />
            </button>
          ))}
        </div>
      )}
      {tab === 1 && (
        <div className="sp-grid sp-emoji-grid">
          {COMMON_EMOJIS.map((em, i) => (
            <button key={i} className="sp-item sp-emoji" onClick={() => onInsertEmoji(em)}><span>{em}</span></button>
          ))}
        </div>
      )}
    </div>
  );
}

const GUIDED_IMAGE_FIELDS = [
  { key: "scene", label: "想看她做什么" },
  { key: "style", label: "想要什么感觉" },
  { key: "place", label: "场景在哪里" },
  { key: "state", label: "她是什么状态" },
  { key: "outfit", label: "她穿什么" },
];
const GUIDED_IMAGE_RESOLUTIONS = [
  { value: "channel", label: "跟随渠道" },
  { value: "1k", label: "1K" },
  { value: "2k", label: "2K" },
  { value: "4k", label: "4K" },
];

function GuidedImageSheet({ agent, onClose, onSubmit, submitting }) {
  const [values, setValues] = useStateC(() => Object.fromEntries(
    GUIDED_IMAGE_FIELDS.map(({ key }) => [key, GUIDED_IMAGE_OPTIONS[key][0]])
  ));
  const [resolution, setResolution] = useStateC("channel");

  const update = (key, value) => setValues((current) => ({ ...current, [key]: value }));

  return (
    <div className="sheet-mask guided-image-mask" onClick={() => { if (!submitting) onClose(); }}>
      <section className="sheet guided-image-sheet" role="dialog" aria-modal="true" aria-labelledby="guided-image-title" onClick={(event) => event.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="sheet-head">
          <div>
            <h2 id="guided-image-title">给她拍一张</h2>
            <div className="guided-image-sub">选几个日常选项，{agent.name}就知道怎么画了</div>
          </div>
          <button type="button" className="icon-btn" style={{ width: 34, height: 34 }} onClick={onClose} disabled={submitting} aria-label="关闭引导画图">×</button>
        </div>
        <div className="sheet-body guided-image-body">
          <div className="guided-image-note">不用写提示词。使用“画图发图”渠道，可能产生费用。</div>
          <label className="guided-image-field">
            <span>这次图片清晰度</span>
            <select className="fld" value={resolution} disabled={submitting} onChange={(event) => setResolution(event.target.value)}>
              {GUIDED_IMAGE_RESOLUTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          {GUIDED_IMAGE_FIELDS.map(({ key, label }) => (
            <label className="guided-image-field" key={key}>
              <span>{label}</span>
              <select className="fld" value={values[key]} disabled={submitting} onChange={(event) => update(key, event.target.value)}>
                {GUIDED_IMAGE_OPTIONS[key].map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
          ))}
        </div>
        <div className="sheet-foot">
          <button type="button" className="pill pill-ghost" onClick={onClose} disabled={submitting}>先不画</button>
          <button type="button" className="pill pill-primary guided-image-submit" onClick={() => onSubmit({ ...values, resolution })} disabled={submitting}>
            {submitting ? "正在画…" : "开始画图"}
          </button>
        </div>
      </section>
    </div>
  );
}

/* ---------------- 聊天室 ---------------- */
function ChatRoom({ agent, onBack }) {
  const hasEmo = false; // 统一用 portrait_id 那套逻辑，所有角色一视同仁
  const roleId = agent._raw?.id || agent.id;
  const [msgs, setMsgs] = useStateC([]);
  const [myAvatar, setMyAvatar] = useStateC(DEFAULT_USER_AVATAR);
  const [draft, setDraft] = useStateC("");
  const [typing, setTyping] = useStateC(false);
  const [showFig, setShowFig] = useStateC(true);
  const [big, setBig] = useStateC(false);
  const [stickerOpen, setStickerOpen] = useStateC(false);
  const [searching, setSearching] = useStateC(false);
  const [q, setQ] = useStateC("");
  const [emo, setEmo] = useStateC("01_默认温柔");
  const [calling, setCalling] = useStateC(false);
  const [atts, setAtts] = useStateC([]);
  const [listening, setListening] = useStateC(false);
  const [voiceMode, setVoiceMode] = useStateC(false); // 语音/文字切换
  const [voiceSettings, setVoiceSettings] = useStateC(loadVoiceSettings);
  const [moreOpen, setMoreOpen] = useStateC(false); // 更多菜单
  const [inputActionsOpen, setInputActionsOpen] = useStateC(false); // 手机输入栏更多操作
  const [modelOpen, setModelOpen] = useStateC(false);
  const [previewImage, setPreviewImage] = useStateC("");
  const [guidedImageOpen, setGuidedImageOpen] = useStateC(false);
  const [guidedImageBusy, setGuidedImageBusy] = useStateC(false);
  const [modelChoice, setModelChoice] = useStateC(() => ({
    credentialId: agent._raw?.chat_credential_id || null,
    modelId: agent._raw?.chat_model_id || null,
    thinkLevel: agent._raw?.chat_thinking_level || "off",
  }));

  useEffectC(() => {
    const syncVoiceSettings = (event) => setVoiceSettings(event?.detail || loadVoiceSettings());
    const syncStorage = (event) => {
      if (event.key === "ruobai_voice_v2") setVoiceSettings(loadVoiceSettings());
    };
    window.addEventListener("ruobai:voice-settings", syncVoiceSettings);
    window.addEventListener("storage", syncStorage);
    return () => {
      window.removeEventListener("ruobai:voice-settings", syncVoiceSettings);
      window.removeEventListener("storage", syncStorage);
    };
  }, []);

  useEffectC(() => {
    setModelChoice({
      credentialId: agent._raw?.chat_credential_id || null,
      modelId: agent._raw?.chat_model_id || null,
      thinkLevel: agent._raw?.chat_thinking_level || "off",
    });
  }, [roleId, agent._raw?.chat_credential_id, agent._raw?.chat_model_id, agent._raw?.chat_thinking_level]);

  const saveModelChoice = async (choice) => {
    const response = await updateRole(roleId, {
      chat_credential_id: choice.credentialId || null,
      chat_model_id: choice.modelId || null,
      chat_thinking_level: choice.thinkLevel || "off",
    });
    if (response?.success === false) throw new Error(response.error || "保存角色模型失败");
    const saved = response?.item || {};
    const next = {
      credentialId: saved.chat_credential_id || null,
      modelId: saved.chat_model_id || null,
      thinkLevel: saved.chat_thinking_level || "off",
    };
    Object.assign(agent._raw, {
      chat_credential_id: next.credentialId,
      chat_model_id: next.modelId,
      chat_thinking_level: next.thinkLevel,
    });
    setModelChoice(next);
  };
  const modelLabel = modelChoice.modelId || "对话模型";
  const [chatError, setChatError] = useStateC("");
  const [failedSend, setFailedSend] = useStateC(null);
  const [momentNotice, setMomentNotice] = useStateC("");
  const [uploading, setUploading] = useStateC(false);
  const areaRef = useRefC(null);
  const fileRef = useRefC(null);
  const draftRef = useRefC(null);

  const resizeDraft = (node) => {
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(Math.max(node.scrollHeight, 22), 90)}px`;
  };

  useEffectC(() => {
    resizeDraft(draftRef.current);
  }, [draft]);

  /* 加载用户头像 */
  useEffectC(() => {
    getSessionProfile().then(d => {
      if (d?.user?.avatar) setMyAvatar(d.user.avatar);
    }).catch(() => {});
  }, []);

  /* 加载历史消息 */
  useEffectC(() => {
    let cancelled = false;
    async function load() {
      try {
        const [data, proactive] = await Promise.all([
          getMessages(roleId, 80),
          getProactiveEvents({ characterId: roleId, limit: 100 }).catch(() => null),
        ]);
        if (cancelled) return;
        const items = Array.isArray(data) ? data : (data?.items || []);
        if (items.length > 0) {
          const converted = items.map(toMsg);
          setMsgs(withTimeDividers(converted));
        } else {
          setMsgs([{ type: "time", text: "今天" }, { who: "her", type: "text", time: "刚刚", text: `你好，我是${agent.name}。` }]);
        }
        const pendingEvents = (proactive?.items || []).filter((item) => item["un" + "read"] && item.id);
        await Promise.all(pendingEvents.map((item) => markProactiveEventRead(item.id).catch(() => null)));
      } catch {
        if (!cancelled) {
          setMsgs([{ type: "time", text: "今天" }, { who: "her", type: "text", time: "刚刚", text: `你好，我是${agent.name}。` }]);
        }
      }
    }
    load();
    return () => { cancelled = true; };
  }, [roleId]);

  const figSrc = hasEmo ? (EMO_SET[emo] || agent.cover) : agent.cover;
  const live2dState = React.useMemo(
    () => getChatLive2DState(msgs, { isResponding: typing }),
    [msgs, typing],
  );

  const scroll = () => requestAnimationFrame(() => { const el = areaRef.current; if (el) el.scrollTop = el.scrollHeight; });
  useEffectC(() => { scroll(); }, [msgs, typing]);

  const now = () => { const n = new Date(); return n.getHours() + ":" + String(n.getMinutes()).padStart(2, "0"); };

  const runGuidedImage = async (options) => {
    if (typing || uploading || guidedImageBusy) return;
    const subject = buildGuidedImageSubject({ characterName: agent.name, ...options });
    const displayText = `我想看看${agent.name}现在的样子。`;
    const clientId = `guided-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setGuidedImageOpen(false);
    setGuidedImageBusy(true);
    setChatError("");
    setMomentNotice("");
    setMsgs((current) => [...current, { who: "me", type: "text", text: displayText, time: now(), _clientId: clientId }]);
    setTyping(true);

    try {
      const result = await drawImage(roleId, subject, displayText, { resolution: options.resolution });
      const aiMsg = result?.ai_message;
      setMsgs((current) => {
        const next = current.map((message) => message._clientId === clientId
          ? { ...message, id: result?.user_message?.id, _clientId: undefined }
          : message);
        return [...next, {
          who: "her",
          type: "image",
          images: [result.media_url],
          text: "",
          id: aiMsg?.id,
          time: now(),
        }];
      });
    } catch (error) {
      setChatError("画图失败：" + (error instanceof Error ? error.message : String(error)));
    } finally {
      setTyping(false);
      setGuidedImageBusy(false);
    }
  };

  const openGuidedImage = () => {
    if (typing || uploading || guidedImageBusy) return;
    setStickerOpen(false);
    setInputActionsOpen(false);
    setGuidedImageOpen(true);
  };

  /* 真实图片：选图/粘贴 → 上传后端拿到 media_url（支持多张） */
  const handleImageFiles = async (files) => {
    const validFiles = Array.from(files).filter(f => ["image/png", "image/jpeg", "image/webp"].includes(f.type));
    if (validFiles.length === 0) { setChatError("先支持 PNG、JPG、WEBP 图片"); return; }
    setUploading(true); setChatError("");
    try {
      const urls = [];
      for (const file of validFiles) {
        const url = await uploadChatImage(file);
        urls.push(url);
      }
      setAtts((prev) => [...prev, ...urls]);
    } catch (e) {
      const baseText = e instanceof Error ? e.message : "上传图片失败";
      setChatError(withDiagnosticId(baseText, recordDiagnostic({ area: "image", action: "upload-chat-image", error: e })));
    } finally {
      setUploading(false);
    }
  };
  const openPicker = () => { if (!uploading) { setInputActionsOpen(false); fileRef.current?.click(); } };
  const onPickImage = (e) => { handleImageFiles(e.target.files); e.target.value = ""; };
  const removeAtt = (i) => setAtts((p) => p.filter((_, x) => x !== i));

  /* 粘贴图片 */
  useEffectC(() => {
    const onPaste = (e) => {
      const items = Array.from(e.clipboardData?.items || []);
      const imageItem = items.find((it) => it.kind === "file" && it.type.startsWith("image/"));
      if (!imageItem) return;
      const file = imageItem.getAsFile();
      if (file) { e.preventDefault(); handleImageFiles([file]); }
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

  const send = async (retryPayload = null) => {
    const t = retryPayload ? String(retryPayload.text || "").trim() : draft.trim();
    const images = retryPayload
      ? (Array.isArray(retryPayload.images) ? retryPayload.images : [])
      : (Array.isArray(atts) ? [...atts] : []);
    if ((!t && images.length === 0) || typing || uploading) return;
    const tm = now();
    const clientId = retryPayload?.clientId || `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let userSaved = Boolean(retryPayload?.userSaved);
    setChatError("");
    setFailedSend(null);
    setMomentNotice("");

    // UI 显示用户消息（多图显示在一条里）
    setMsgs((p) => retryPayload
      ? p.map((m) => m._clientId === clientId ? { ...m, failed: false, time: tm } : m)
      : [...p, { who: "me", type: images.length > 0 ? "image" : "text", text: t, images, time: tm, _clientId: clientId }]);
    setDraft(""); setAtts([]);
    setTyping(true);

    try {
      // 1) 存用户消息到数据库（多图：每张存一条，最后一条带文字）
      if (!userSaved && images.length > 0) {
        for (let i = 0; i < images.length; i++) {
          const isLast = i === images.length - 1;
          const payload = { role: "user", content: isLast ? t : "", message_type: "image", media_url: images[i] };
          try {
            const saved = await saveUserMessage(roleId, payload);
            userSaved = userSaved || Boolean(saved?.item?.id || saved?.success);
          } catch {}
        }
      } else if (!userSaved) {
        // 检测绘画意图，走画图流程
        if (images.length === 0 && detectDrawKeywords(t)) {
          try {
            const result = await drawImage(roleId, t);
            const aiMsg = result?.ai_message;
            setMsgs((p) => {
              const copy = [...p];
              // 更新用户消息 id
              for (let i = copy.length - 1; i >= 0; i--) {
                if (copy[i].who === "me" && !copy[i].id) {
                  if (result?.user_message?.id) copy[i] = { ...copy[i], id: result.user_message.id };
                  break;
                }
              }
              // 追加 AI 图片消息
              return [...copy, {
                who: "her", type: "image",
                images: [result.media_url],
                text: "",
                id: aiMsg?.id,
                time: now(),
              }];
            });
            setTyping(false);

            if (shouldPublishGeneratedSelfie(t)) {
              try {
                const published = await publishGeneratedSelfieMoment({
                  characterId: roleId,
                  mediaUrl: result.media_url,
                });
                setMomentNotice(`已发布到动态：${published.content}`);
              } catch (momentError) {
                setChatError("图片已经生成，但发布动态失败：" + (momentError instanceof Error ? momentError.message : String(momentError)));
              }
            }
          } catch (err) {
            setChatError("画图失败：" + (err instanceof Error ? err.message : String(err)));
            setTyping(false);
          }
          return;
        }

        try {
          const saved = await saveUserMessage(roleId, { role: "user", content: t });
          userSaved = Boolean(saved?.item?.id || saved?.success);
          if (saved?.item?.id) {
            setMsgs((p) => {
              const copy = [...p];
              for (let i = copy.length - 1; i >= 0; i--) {
                if (copy[i].who === "me" && !copy[i].id) {
                  copy[i] = { ...copy[i], id: saved.item.id };
                  break;
                }
              }
              return copy;
            });
          }
        } catch {}
      }

      // 2) 流式请求 AI 回复
      // 图片已存到数据库，后端 loadRecentMessages 会拉到全部图，不需要再单独传
      let fullReply = "";
      let fullInnerOs = "";
      const replyId = Date.now();
      const reasoningRequested = modelChoice.thinkLevel && modelChoice.thinkLevel !== "off";
      const reasoningLevel = THINK_LEVELS.find((item) => item.key === modelChoice.thinkLevel)?.label || "";

      setMsgs((p) => [...p, {
        who: "her", type: "text", text: "", time: "", _streaming: true, _id: replyId,
        reasoningRequested,
        reasoningPending: reasoningRequested,
        reasoningLevel,
      }]);
      setTyping(false);

      const basePayload = images.length > 0
        ? { content: t || "看看这些图", role: "user", message_type: "image", media_url: images[images.length - 1], skip_server_persistence: true }
        : { content: t, role: "user", skip_server_persistence: true };
      const streamPayload = {
        ...basePayload,
        ...(modelChoice.credentialId && modelChoice.modelId ? { credential_id: modelChoice.credentialId, model_id: modelChoice.modelId } : {}),
        ...(modelChoice.thinkLevel && modelChoice.thinkLevel !== "off" ? { thinking_level: modelChoice.thinkLevel } : {}),
      };
      let streamError = "";

      await streamAssistantReply(roleId, streamPayload, {
        onToken: (token) => {
          fullReply += token;
          setMsgs((p) => p.map((m) => m._id === replyId ? { ...m, text: fullReply } : m));
        },
        onInnerOs: (content) => {
          fullInnerOs = content;
          setMsgs((p) => p.map((m) => m._id === replyId ? {
            ...m, think: fullInnerOs, reasoningPending: false, reasoningUnavailable: false,
          } : m));
        },
        onInnerOsError: () => {
          setMsgs((p) => p.map((m) => m._id === replyId ? {
            ...m, reasoningPending: false, reasoningUnavailable: true,
          } : m));
        },
        onError: (errMsg) => {
          streamError = String(errMsg || "发送失败，请检查后端和模型配置。");
        },
      });
      if (streamError) throw new Error(streamError);

      // 流式结束，更新时间和去掉 streaming 标记
      setMsgs((p) => p.map((m) => m._id === replyId ? {
        ...m,
        time: now(),
        _streaming: false,
        reasoningPending: false,
        reasoningUnavailable: reasoningRequested && !fullInnerOs.trim(),
      } : m));

      // 3) 把 AI 回复也存进数据库（保存失败不阻断），并把真实 id 写回 state 供删除使用
      if (fullReply.trim()) {
        try {
          const saved = await saveMessage(roleId, {
            role: "assistant",
            content: fullReply,
            ...(fullInnerOs.trim() ? {
              inner_os_content: fullInnerOs,
              inner_os_source: "character_reflection",
            } : {}),
          });
          if (saved?.item?.id) {
            setMsgs((p) => p.map((m) => m._id === replyId ? { ...m, id: saved.item.id } : m));
          }
        } catch (e) { /* 保存回复失败仍继续 */ }
      }
    } catch (err) {
      const baseText = err instanceof Error ? err.message : "发送失败，请检查后端和模型配置。";
      setChatError(withDiagnosticId(baseText, recordDiagnostic({ area: "chat", action: "send-message", error: err })));
      setFailedSend({ clientId, text: t, images, userSaved });
      setMsgs((p) => p.map((m) => m._clientId === clientId ? { ...m, failed: true } : m));
    } finally {
      setTyping(false);
    }
  };

  /* 清空对话 */
  const clearChat = async () => {
    if (!window.confirm(`确认清空和${agent.name}的全部聊天记录吗？`)) return;
    try {
      await deleteAllMessages(roleId);
      setMsgs([{ type: "time", text: "今天" }, { who: "her", type: "text", time: now(), text: `嗯，我们重新开始吧。` }]);
      setMoreOpen(false);
    } catch (e) { setChatError("清空失败：" + String(e)); }
  };

  /* 删除单条消息 */
  const deleteMsg = async (msgId) => {
    if (!msgId) return;
    try {
      await deleteMessage(msgId);
      setMsgs((p) => p.filter((m) => m.id !== msgId));
    } catch (e) { setChatError("删除失败：" + String(e)); }
  };

  const sendSticker = (s) => {
    setStickerOpen(false);
    setMsgs((p) => [...p, { who: "me", type: "sticker", sticker: s.e, label: s.label, time: now() }]);
    setTyping(true);
    if (hasEmo) setEmo("02_开心明亮");
    const rs = STICKER_REPLIES[Math.floor(Math.random() * STICKER_REPLIES.length)];
    setTimeout(() => { setTyping(false); setMsgs((p) => [...p, { who: "her", type: "sticker", sticker: rs, label: "", time: now() }]); }, 1400);
  };

  /* 发语音消息 */
  const sendVoice = async ({ audioUrl, dur, transcript, recognitionError }) => {
    const durLabel = `${dur}"`;
    setChatError("");
    setMsgs((p) => [...p, {
      who: "me", type: "voice", audioUrl, dur: durLabel,
      transcript: transcript || "", recognitionError: recognitionError || "", time: now()
    }]);
    setTyping(true);

    // 无论识别成功与否都发送；无识别时用自然中文告知AI
    const textForAI = transcript || "（发了语音）";

    try {
      await saveUserMessage(roleId, {
        role: "user", message_type: "voice",
        content: textForAI, media_url: audioUrl,
      });
      const replyId = "_voice_" + Date.now();
      let fullReply = "";
      let fullInnerOs = "";
      const reasoningRequested = modelChoice.thinkLevel && modelChoice.thinkLevel !== "off";
      const reasoningLevel = THINK_LEVELS.find((item) => item.key === modelChoice.thinkLevel)?.label || "";
      setMsgs((p) => [...p, {
        who: "her", type: "text", text: "", time: now(), _id: replyId,
        reasoningRequested,
        reasoningPending: reasoningRequested,
        reasoningLevel,
      }]);
      await streamAssistantReply(roleId, {
        content: textForAI,
        role: "user",
        skip_server_persistence: true,
        ...(modelChoice.credentialId && modelChoice.modelId ? { credential_id: modelChoice.credentialId, model_id: modelChoice.modelId } : {}),
        ...(modelChoice.thinkLevel && modelChoice.thinkLevel !== "off" ? { thinking_level: modelChoice.thinkLevel } : {}),
      }, {
        onToken: (token) => {
          fullReply += token;
          setMsgs((p) => p.map((m) => m._id === replyId ? { ...m, text: fullReply } : m));
        },
        onInnerOs: (content) => {
          fullInnerOs = content;
          setMsgs((p) => p.map((m) => m._id === replyId ? {
            ...m, think: fullInnerOs, reasoningPending: false, reasoningUnavailable: false,
          } : m));
        },
        onInnerOsError: () => {
          setMsgs((p) => p.map((m) => m._id === replyId ? {
            ...m, reasoningPending: false, reasoningUnavailable: true,
          } : m));
        },
        onError: (err) => { setTyping(false); setChatError(String(err)); },
      });
      setTyping(false);

      setMsgs((p) => p.map((m) => m._id === replyId ? {
        ...m,
        reasoningPending: false,
        reasoningUnavailable: reasoningRequested && !fullInnerOs.trim(),
      } : m));

      if (!fullReply.trim()) return;

      // 先保存文字回复，云端语音需要用真实消息 ID 生成并持久化音频。
      let savedReply = null;
      try {
        savedReply = await saveMessage(roleId, {
          role: "assistant",
          content: fullReply,
          ...(fullInnerOs.trim() ? {
            inner_os_content: fullInnerOs,
            inner_os_source: "character_reflection",
          } : {}),
        });
        if (savedReply?.item?.id) {
          setMsgs((p) => p.map((m) => m._id === replyId ? { ...m, id: savedReply.item.id } : m));
        }
      } catch {
        setChatError("她已经回复了，但这条回复保存失败，暂时不能生成可保存的语音。");
      }

      if (!voiceMode || !voiceSettings.enabled) return;

      if (voiceSettings.engine === "browser") {
        try {
          await speakTextWithSystemVoice(fullReply, {
            language: "zh-CN",
            rate: Number(voiceSettings.rate) || 0.95,
            pitch: 1.1,
            browserVoiceURI: voiceSettings.browserVoiceURI,
          });
        } catch {
          setChatError("手机和网页朗读都没有成功，她的文字回复已经保留。");
        }
        return;
      }

      if (!savedReply?.item?.id) {
        try {
          await speakTextWithSystemVoice(fullReply, {
            language: "zh-CN",
            rate: Number(voiceSettings.rate) || 0.95,
            pitch: 1.1,
            browserVoiceURI: voiceSettings.browserVoiceURI,
          });
        } catch {}
        return;
      }

      try {
        const speech = await speakMessage(savedReply.item.id, {
          voiceOverride: voiceSettings.engine === "volcengine" ? voiceSettings.volcVoice : voiceSettings.voiceId,
          rate: Number(voiceSettings.rate) || 0.9,
          convertToVoice: true,
        });
        if (!speech?.success || !speech.audio_url) {
          throw new Error(speech?.error || "没有生成语音文件");
        }
        setMsgs((p) => p.map((m) => m._id === replyId ? {
          ...m,
          id: savedReply.item.id,
          type: "voice",
          audioUrl: speech.audio_url,
          text: fullReply,
          transcript: fullReply,
          dur: "",
          _streaming: false,
        } : m));
      } catch (speechError) {
        try {
          await speakTextWithSystemVoice(fullReply, {
            language: "zh-CN",
            rate: Number(voiceSettings.rate) || 0.95,
            pitch: 1.1,
            browserVoiceURI: voiceSettings.browserVoiceURI,
          });
        } catch {
          const detail = speechError instanceof Error ? speechError.message : String(speechError);
          setChatError(`她的文字回复已经保留，但云端和手机朗读都失败了：${detail}`);
        }
      }
    } catch (err) {
      setTyping(false);
      setChatError(withDiagnosticId("语音消息发送失败，请重试。", recordDiagnostic({ area: "voice", action: "send-voice-message", error: err })));
    }
  };

  const shown = q.trim() ? msgs.filter((m) => (m.text || "").includes(q.trim())) : msgs;
  const canSend = Boolean(draft.trim() || atts.length > 0);

  return (
    <div className="screen chat-screen anim-screen">
      {/* 常驻立绘 — 当前角色只保留一个舞台，点击后切换为全屏陪伴视图 */}
      {(showFig || big) && <ChatFigure agent={agent} figSrc={figSrc} expanded={big} live2dState={live2dState} onOpen={() => setBig(true)} onClose={() => setBig(false)} />}

      <header className="chat-top">
        <button className="ct-back" onClick={onBack} aria-label="返回聊天列表" title="返回聊天列表"><Icon name="back" /></button>
        <div className="ct-avatar" role="button" tabIndex={0} aria-label={`查看${agent.name}的立绘`} onClick={() => setBig(true)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setBig(true); }}><img src={agent.avatar} alt="" onError={fallbackToDefaultRoleAvatar} />{agent.online && <span className="cl-online" />}</div>
        <div className="ct-info">
          <div className="ct-name">{agent.name}</div>
          <button className="ct-model" onClick={() => setModelOpen(!modelOpen)} aria-label="切换聊天模型">
            <Icon name="cpu" /> {modelLabel}<Icon name="chevronD" className={"cm-chev" + (modelOpen ? " open" : "")} />
          </button>
        </div>
        <button className="ct-ic" onClick={() => setSearching(!searching)} style={searching ? { color: "var(--rose)" } : null} aria-label="搜索聊天记录" title="搜索聊天记录"><Icon name="search" /></button>
        <button className="ct-ic" onClick={() => setShowFig(!showFig)} style={showFig ? { color: "var(--rose)" } : null} aria-label={showFig ? "隐藏常驻立绘" : "显示常驻立绘"} title={showFig ? "隐藏常驻立绘" : "显示常驻立绘"}><Icon name="flower" /></button>
        <button className="ct-ic" onClick={() => setMoreOpen(!moreOpen)} style={moreOpen ? { color: "var(--rose)" } : null} aria-label="更多聊天操作" title="更多聊天操作"><Icon name="more" /></button>
      </header>

      {moreOpen && (
        <div className="chat-more-menu" onClick={() => setMoreOpen(false)}>
          <div className="cmm-inner" onClick={(e) => e.stopPropagation()}>
            <button className="cmm-item danger" onClick={clearChat}>清空对话</button>
          </div>
        </div>
      )}

      {modelOpen && (
        <ModelPanel current={modelChoice} onPick={saveModelChoice} onClose={() => setModelOpen(false)} />
      )}

      {searching && (
        <div className="chat-search">
          <Icon name="search" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索和她的聊天记录…" />
          {q && <button onClick={() => setQ("")} aria-label="清空搜索">×</button>}
        </div>
      )}

      <div className="msg-area" ref={areaRef}>
        {q.trim() && <div className="search-note">找到 {shown.filter((m) => m.type !== "time").length} 条包含"{q.trim()}"的记录</div>}
        {shown.map((m, i) => (m.type === "time" && q.trim()) ? null : <Bubble key={i} m={m} agent={agent} tts={voiceSettings.enabled && !q.trim()} voice={voiceSettings} myAvatar={myAvatar} onDelete={deleteMsg} onOpenImage={setPreviewImage} onRetry={(clientId) => { if (failedSend?.clientId === clientId) send(failedSend); }} />)}
        {typing && !q.trim() && <Typing agent={agent} />}
        {momentNotice && <div className="chat-notice" onClick={() => setMomentNotice("")}>{momentNotice}<span style={{marginLeft:8,opacity:0.6}}>点击关闭</span></div>}
        {chatError && <div className="chat-error" onClick={() => setChatError("")}>{chatError}<span style={{marginLeft:8,opacity:0.6}}>点击关闭</span></div>}
        <div style={{ height: 8 }} />
      </div>

      {!showFig && !big && (
        <button className="call-her" onClick={() => setShowFig(true)}>
          <span className="ch-av"><img src={agent.avatar} alt="" onError={fallbackToDefaultRoleAvatar} /></span>叫她出来
        </button>
      )}

      {previewImage && <ChatImagePreview src={previewImage} onClose={() => setPreviewImage("")} />}

      {guidedImageOpen && (
        <GuidedImageSheet
          agent={agent}
          submitting={guidedImageBusy}
          onClose={() => setGuidedImageOpen(false)}
          onSubmit={runGuidedImage}
        />
      )}

      {calling && <CallScreen agent={agent} figSrc={figSrc} onClose={() => setCalling(false)} />}

      <footer className="input-bar">
        {(atts.length > 0 || uploading) && (
          <div className="att-tray">
            {atts.map((src, i) => (
              <div className="att-thumb" key={i}>
                <img src={src} alt="" />
                <button className="att-x" onClick={() => removeAtt(i)} aria-label={`移除第${i + 1}张图片`}>×</button>
              </div>
            ))}
            <div className="att-hint">{uploading ? "图片上传中…" : `配好图,再打字,一起发给${agent.name}`}</div>
          </div>
        )}
        <div className="input-row">
          {/* 左侧：语音/键盘切换 */}
          <button
            className={"ib-tool" + (voiceMode ? " on" : "")}
            onClick={() => { setVoiceMode(!voiceMode); setStickerOpen(false); setInputActionsOpen(false); }}
            title={voiceMode ? "切换到文字" : "切换到语音"}
            aria-label={voiceMode ? "切换到文字" : "切换到语音"}
          >
            <Icon name={voiceMode ? "keyboard" : "mic"} />
          </button>

          {voiceMode ? (
            /* 语音模式：大按钮，点击打开录音 */
            <>
              <button
                className="ib-voice-bar"
                onClick={() => setListening(true)}
                disabled={typing}
              >
                <Icon name="mic" />
                <span>{typing ? `${agent.name}正在回复…` : "点击录音"}</span>
              </button>
              <button className="ib-tool ib-voice-sticker" onClick={() => setStickerOpen(!stickerOpen)} style={stickerOpen ? { color: "var(--rose)" } : null} aria-label="打开表情包" title="打开表情包"><Icon name="star" /></button>
            </>
          ) : (
            /* 文字模式：原有布局 */
            <>
              <button className="ib-tool ib-desktop-tool" onClick={() => setCalling(true)} aria-label="开始实时通话" title="开始实时通话"><Icon name="phone" /></button>
              <button className="ib-tool ib-desktop-tool" onClick={openPicker} disabled={uploading} style={(atts.length || uploading) ? { color: "var(--rose)" } : null} aria-label="选择图片" title="选择图片"><Icon name="image" /></button>
              <button className={"ib-tool ib-desktop-tool" + (guidedImageOpen ? " on" : "")} onClick={openGuidedImage} disabled={typing || uploading || guidedImageBusy} aria-label="引导画图" title="不用写提示词，选几个选项让她画"><Icon name="spark" /></button>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={onPickImage} />
              <button className="ib-tool ib-desktop-tool" onClick={() => setStickerOpen(!stickerOpen)} style={stickerOpen ? { color: "var(--rose)" } : null} aria-label="打开表情包" title="打开表情包"><Icon name="star" /></button>
              <div className="ib-field">
                <textarea ref={draftRef} value={draft} rows={1} enterKeyHint="send" onFocus={() => { setStickerOpen(false); setInputActionsOpen(false); }}
                  onChange={(e) => { setDraft(e.target.value); resizeDraft(e.currentTarget); }}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                  placeholder={typing ? `${agent.name}正在回复…` : `和${agent.name}说点什么…`} />
              </div>
              <button className={"ib-tool ib-mobile-action" + (stickerOpen ? " on" : "")} onClick={() => { setStickerOpen(!stickerOpen); setInputActionsOpen(false); }} aria-label="打开表情包" title="打开表情包"><Icon name="star" /></button>
              {!canSend && <button className={"ib-tool ib-mobile-action ib-mobile-more" + (inputActionsOpen ? " on" : "")} onClick={() => { setInputActionsOpen(!inputActionsOpen); setStickerOpen(false); }} aria-label="更多聊天操作" title="更多聊天操作"><Icon name="plus" /></button>}
              {canSend
                ? <button className={"ib-send on" + (typing ? " busy" : "")} onClick={() => send()} disabled={typing || uploading} aria-label="发送消息" title="发送消息"><Icon name="send" /></button>
                : null}
            </>
          )}
        </div>
        {inputActionsOpen && !voiceMode && (
          <div className="mobile-input-actions" aria-label="更多聊天操作">
            <button className="mobile-input-action" onClick={() => { setCalling(true); setInputActionsOpen(false); }} aria-label="开始实时通话"><Icon name="phone" /><span>通话</span></button>
            <button className="mobile-input-action" onClick={openPicker} disabled={uploading} aria-label="选择图片"><Icon name="image" /><span>图片</span></button>
            <button className="mobile-input-action" onClick={openGuidedImage} disabled={typing || uploading || guidedImageBusy} aria-label="引导画图"><Icon name="spark" /><span>画图</span></button>
            <button className="mobile-input-action" onClick={() => { setStickerOpen(true); setInputActionsOpen(false); }} aria-label="打开表情包"><Icon name="star" /><span>表情</span></button>
          </div>
        )}
      </footer>

      {listening && (
        <VoiceRecorder
          onCancel={() => setListening(false)}
          onDone={({ audioUrl, dur, transcript, recognitionError }) => {
            setListening(false);
            if (voiceMode) {
              sendVoice({ audioUrl, dur, transcript, recognitionError });
            } else {
              if (transcript) setDraft((d) => (d ? d + " " : "") + transcript);
            }
          }}
        />
      )}

      {stickerOpen && (
        <EmojiPanel agent={agent} onSendSticker={sendSticker} onInsertEmoji={(em) => { setDraft((d) => d + em); setStickerOpen(false); }} />
      )}

    </div>
  );
}

/* ---------------- 火山端到端实时语音通话 ---------------- */
function CallScreen({ agent, figSrc, onClose }) {
  const [sec, setSec] = useStateC(0);
  const [phase, setPhase] = useStateC("connecting"); // connecting | live | recording | thinking | speaking | error
  const [transcript, setTranscript] = useStateC("");
  const [reply, setReply] = useStateC("");
  const [err, setErr] = useStateC("");
  const [micMuted, setMicMuted] = useStateC(false);
  const [speakerMuted, setSpeakerMuted] = useStateC(false);
  const socketRef = useRefC(null);
  const microphoneRef = useRefC(null);
  const playerRef = useRefC(null);
  const closingRef = useRefC(false);
  const transcriptRef = useRefC("");
  const assistantSpeakingRef = useRefC(false);
  const roleId = agent.id;

  useEffectC(() => {
    let active = true;
    const player = new RealtimePcmPlayer();
    playerRef.current = player;

    const stopRealtimeMedia = () => {
      const microphone = microphoneRef.current;
      microphoneRef.current = null;
      Promise.resolve(microphone?.stop?.()).catch(() => {});
      player.interrupt();
    };
    const markDisconnected = (message) => {
      stopRealtimeMedia();
      setErr((current) => current || message);
      setPhase("error");
    };

    const socket = createRealtimeCallSocket(roleId, {
      onOpen: () => {
        if (active) setPhase("connecting");
      },
      onAudio: (audio) => {
        if (!active) return;
        assistantSpeakingRef.current = true;
        player.enqueue(audio);
        setPhase("speaking");
      },
      onEvent: (event) => {
        if (!active) return;
        if (event.type === "session_started") {
          setPhase("live");
          setErr("");
          return;
        }
        if (event.type === "user_speaking") {
          // 火山的 450 只是“疑似听到声音”，模拟器的回声或底噪也会触发。
          // 等拿到非空识别文字后才真打断，避免用户没说话也把她的声音掐掉。
          return;
        }
        if (event.type === "asr") {
          const speech = String(event.text || "").trim();
          if (!speech) return;
          if (assistantSpeakingRef.current) {
            assistantSpeakingRef.current = false;
            player.interrupt();
            socket.interrupt();
            setReply("");
          }
          transcriptRef.current = speech;
          setTranscript(speech);
          setPhase("recording");
          return;
        }
        if (event.type === "asr_end") {
          if (transcriptRef.current) setPhase("thinking");
          return;
        }
        if (event.type === "assistant_text") {
          setReply((current) => current + (event.delta || ""));
          setPhase((current) => current === "speaking" ? current : "thinking");
          return;
        }
        if (event.type === "tts_start") {
          assistantSpeakingRef.current = true;
          transcriptRef.current = "";
          setTranscript("");
          setPhase("speaking");
          return;
        }
        if (event.type === "tts_end") {
          assistantSpeakingRef.current = false;
          transcriptRef.current = "";
          setPhase("live");
          setTranscript("");
          return;
        }
        if (event.type === "interrupted") {
          // 真实语音识别分支已经切到“正在听你说”，这里不再二次改变状态。
          return;
        }
        if (event.type === "error") {
          markDisconnected(event.message || "实时通话暂时没有接通");
        }
      },
      onError: (error) => {
        if (!active) return;
        markDisconnected(error.message || "实时通话连接失败");
      },
      onClose: () => {
        if (!active || closingRef.current) return;
        markDisconnected("通话连接断开了，挂断后再重试一次");
      },
    });
    socketRef.current = socket;

    const start = async () => {
      try {
        await player.resume();
        const microphone = await startRealtimeMicrophone((chunk) => socket.sendAudio(chunk));
        if (!active) {
          await microphone.stop();
          return;
        }
        microphoneRef.current = microphone;
      } catch (error) {
        if (!active) return;
        markDisconnected(error?.name === "NotAllowedError" ? "请允许麦克风权限后再拨一次" : "麦克风启动失败，请重试");
      }
    };
    start();

    return () => {
      active = false;
      closingRef.current = true;
      socket.close();
      microphoneRef.current?.stop?.();
      microphoneRef.current = null;
      player.close();
      playerRef.current = null;
    };
  }, [roleId]);

  useEffectC(() => {
    if (phase === "connecting") return undefined;
    const id = setInterval(() => setSec((current) => current + 1), 1000);
    return () => clearInterval(id);
  }, [phase === "connecting"]);

  const mm = String(Math.floor(sec / 60)).padStart(2, "0");
  const ss = String(sec % 60).padStart(2, "0");
  const isConnected = phase !== "connecting";
  const isLive = phase !== "connecting" && phase !== "error";

  const toggleMic = () => {
    const next = !micMuted;
    setMicMuted(next);
    microphoneRef.current?.setMuted(next);
    if (next) {
      setPhase("live");
    }
  };

  const toggleSpeaker = () => {
    const next = !speakerMuted;
    setSpeakerMuted(next);
    playerRef.current?.setMuted(next);
  };

  const hangup = () => {
    closingRef.current = true;
    socketRef.current?.close();
    microphoneRef.current?.stop?.();
    microphoneRef.current = null;
    playerRef.current?.close?.();
    playerRef.current = null;
    onClose();
  };

  const phaseLabel = {
    connecting: "正在接通实时语音…",
    live: micMuted ? "通话中 · 麦克风已静音" : "通话中 · 可以直接说话",
    recording: "正在听你说…",
    thinking: "她在回应…",
    speaking: "她在说…",
    error: "通话没有接通",
  }[phase] || "通话中";
  const bars = Array.from({ length: 30 });

  return (
    <div className="call-screen">
      <div className={"call-glow" + (!isLive ? " ring" : "")} />
      <img className={"call-fig" + (isLive ? " live" : "")} src={figSrc} alt={agent.name} />
      <div className="call-scrim" />
      <div className="call-top">
        <div className="call-status">
          {phase === "connecting" ? <><Icon name="phone" /> 正在接通…</> : phase === "error" ? <><Icon name="phone" /> {phaseLabel}</> : <><span className="live-dot" /> {phaseLabel}</>}
        </div>
        <div className="call-name serif">{agent.name}</div>
        <div className="call-timer">{phase === "connecting" ? "她正赶来接电话" : phase === "error" ? "请挂断后重试" : `${mm}:${ss}`}</div>
      </div>
      {isConnected && (
        <div className="call-wave">
          {bars.map((_, i) => <i key={i} style={{ height: (8 + Math.abs(Math.sin(i * 1.3) * 28)) + "px", animationDelay: `${i * 50}ms`, opacity: phase === "recording" || phase === "speaking" ? 1 : 0.4 }} />)}
        </div>
      )}
      {isConnected && (
        <div className="call-caption">
          {phase === "recording" && transcript && `「${transcript}」`}
          {phase !== "recording" && reply && `「${reply}」`}
          {err && <span style={{ color: "#fca5a5" }}>{err}</span>}
          {!transcript && !reply && !err && phase === "live" && (micMuted ? "点一下麦克风恢复收音" : "直接说话，她会自动听见，也可以随时插话")}
          {phase === "thinking" && !reply && "她在回应…"}
        </div>
      )}
      <div className="call-controls">
        <button className={"call-btn" + (micMuted ? " on" : "")} onClick={toggleMic} disabled={!isLive}>
          <span className="cb"><Icon name="mic" /></span>
          <span>{micMuted ? "取消静音" : "麦克风"}</span>
        </button>
        <button className="call-btn" onClick={hangup}>
          <span className="call-hangup"><Icon name="phone" /></span>
          <span style={{ opacity: 0 }}>挂断</span>
        </button>
        <button className={"call-btn" + (speakerMuted ? " on" : "")} onClick={toggleSpeaker} disabled={!isLive}>
          <span className="cb"><Icon name="wave" /></span>
          <span>{speakerMuted ? "打开声音" : "扬声器"}</span>
        </button>
      </div>
    </div>
  );
}

export { ChatListScreen, ChatRoom, Bubble, CallScreen };
