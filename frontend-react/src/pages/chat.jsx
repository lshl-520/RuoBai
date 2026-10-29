import React from "react";
import { Icon, Bars, greetByHour } from "../store.jsx";
import { getRoles, getCachedRoles, updateRole, getRolePortraitSrc, getRoleFullPortrait } from "../lib/roles.js";
import { assetUrl } from "../lib/api-base.js";
import { getMessages, getCachedMessages, streamAssistantReply, saveMessage, saveUserMessage, uploadChatImage, uploadVoice, deleteAllMessages, deleteMessage, detectDrawKeywords, drawImage, speakMessage, friendlyChatNetworkError } from "../lib/chat.js";
import { createRealtimeCallSocket, startRealtimeMicrophone, RealtimePcmPlayer } from "../lib/realtime-call.js";
import { getSessionProfile, getCapabilities } from "../lib/profile.js";
import {
  DEFAULT_USER_AVATAR,
  fallbackToDefaultRoleAvatar,
  fallbackToDefaultUserAvatar,
} from "../lib/default-assets.js";
import { publishGeneratedSelfieMoment, shouldPublishGeneratedSelfie } from "../lib/moments.js";
import { loadVoiceSettings, speechRecognitionErrorMessage } from "../lib/voice-settings.js";
import { createSpeechRecognizer, isNativeSpeechRecognitionAvailable, isSpeechRecognitionAvailable, speechRecognitionChannelLabel, transcribeOnServer } from "../lib/speech-recognition.js";
import { createVoiceRecorder } from "../lib/voice-recorder.js";
import { preloadLive2DRuntime } from "../lib/live2d-loader.js";
import { createBubbleSplitter, splitReplyIntoBubbles, firstBubbleId, annotateConsecutiveGroups, applyTurnReasoning, isActionBubble } from "../lib/chat-bubbles.js";
import { isNativeTextToSpeechAvailable, speakTextWithSystemVoice, stopSystemTextSpeech } from "../lib/native-tts.js";
import { recordDiagnostic, withDiagnosticId } from "../lib/diagnostics.js";
import { GUIDED_IMAGE_OPTIONS, buildGuidedImageSubject } from "../lib/guided-image.js";
import { getProactiveEvents, markProactiveEventRead } from "../lib/proactive.js";
import { Live2DStage } from "../components/Live2DStage.jsx";
import { getChatLive2DState } from "../lib/live2d-state.js";
import { getRoleVisualFrame, getVisualFrameView } from "../lib/visual-frames.js";
import { detectPortraitBackground, PORTRAIT_BACKGROUND_UNKNOWN } from "../lib/portrait-background.js";
import { CHAT_HISTORY_INITIAL, CHAT_HISTORY_PAGE, getChatHistoryMessageCount, getChatHistoryWindow, getChatRenderKey } from "../lib/chat-history-window.js";
import { apiFetch } from "../lib/api-base.js";
/* 聊天列表 + 聊天室(沉浸: 常驻立绘随情绪变化 / 全屏立绘 / 语音 / 表情包 / 思考过程 / 搜索) */
const { useState: useStateC, useRef: useRefC, useEffect: useEffectC, useLayoutEffect: useLayoutEffectC } = React;

/* ====== 模型 + 心情展示面板 ====== */
/**
 * ★ 2026/9/17 改：这个开关的语义变了。
 *
 * 以前：开 = 额外调一次模型去"写内心 OS"（多花一份钱），主聊天不推理。
 * 现在：开 = 让**主聊天自己思考**，并把真思考显示在「她在想什么」里；
 *       代价是思考本身也耗 token，所以**默认关闭**，想要更好的体验自己调。
 *
 * 部署方要求：不想多花钱就默认关闭；想要更好的体验，自己切换思考等级。
 */
const THINK_LEVELS = [
  { key: "off", label: "关闭" },
  { key: "low", label: "低" },
  { key: "mid", label: "中" },
  { key: "high", label: "高" },
];

function normalizeInnerOsLevel(level) {
  return THINK_LEVELS.some((item) => item.key === level)
    ? level
    : level === "ultra" ? "high" : "off";
}

/**
 * ═══ 模型面板（2026/9/17 拆分）═══
 *
 * 以前「模型」和「心情展示」挤在同一个面板里，导致：
 *   只想改个思考等级 → 面板一打开就去拉**全部模型列表** → 要等很久。
 *
 * 部署方反馈：只是想改个思考等级，却每次都要等聊天模型列表加载很久；
 *   选模型和选思考等级当时还没有正式 UI，只有代码开关。
 *
 * 现在拆成两个独立入口：
 *   · 本面板 = 只管**模型**（需要拉列表，慢，但只在换模型时才用）；
 *   · 页头的思考图标 = 只管**思考等级**（本地四档，几乎瞬间，不拉任何东西）。
 */
function ModelPanel({ current, onPick, onClose }) {
  const [caps, setCaps] = useStateC(null);
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

  // 换模型时保留当前思考等级，不要顺手把它重置掉
  const pick = (credId, modelId) => {
    save({ credentialId: credId, modelId, thinkLevel: normalizeInnerOsLevel(current?.thinkLevel) }, true);
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
          {/* 思考等级已拆到页头独立入口，这里不再重复出现 */}
        </div>
      </div>
    </div>
  );
}

/** 四档的一句话说明（给「思考等级」面板用） */
const THINK_LEVEL_NOTES = {
  off: "默认 · 最省钱",
  low: "想得少一点",
  mid: "推荐",
  high: "想得多一点",
};

/**
 * ═══ 思考等级面板（2026/9/17 新增）═══
 *
 * 独立的轻量面板：**不拉模型列表、不联网、点开就是四档**，所以是瞬间的。
 * 用户只想改这个的时候，不该被迫等模型列表加载。
 *
 * 档位含义（用户已确认的措辞）：
 *   关闭 = 默认，最省钱，她直接回你
 *   低/中/高 = 她思考时你能看见她想什么；思考会多花一点 token
 */
function ThinkPanel({ current, onPick, onClose }) {
  const [level, setLevel] = useStateC(normalizeInnerOsLevel(current?.thinkLevel));
  const [saving, setSaving] = useStateC(false);
  const [error, setError] = useStateC("");

  const choose = async (next) => {
    setLevel(next);
    setSaving(true);
    setError("");
    try {
      // 只改思考等级，模型保持不动
      await onPick({ credentialId: current?.credentialId || null, modelId: current?.modelId || null, thinkLevel: next });
    } catch (e) {
      setError(e?.message || "保存失败，请稍后再试");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="model-panel-mask" onClick={onClose}>
      <div className="model-panel think-panel" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="tp-body">
          <div className="tp-title-row">
            <span className="tp-title"><Icon name="brain" /> 思考等级</span>
            <span className="tp-sub">改这个不用等模型列表</span>
          </div>
          {THINK_LEVELS.map((t) => (
            <button key={t.key} disabled={saving} className={"tp-row" + (level === t.key ? " on" : "")} onClick={() => choose(t.key)}>
              <span className="mp-radio" />
              <span className="tp-label">{t.label}</span>
              <span className="tp-note">{THINK_LEVEL_NOTES[t.key] || ""}</span>
            </button>
          ))}
          {error && <div className="mp-error">{error}</div>}
          <div className="mp-hint">
            默认「关闭」= 不展示思考过程，也最省钱。开了之后，她思考时你能在「她在想什么」里看到。
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

  // 2026/10/14：列表出来之后就在空闲时预热 Live2D（运行库 + Cubism 核心库 + 模型入口），
  // 这样点进聊天室时不必再从零等待（Live2D 首次加载较慢）。
  useEffectC(() => {
    if (!Array.isArray(agents) || !agents.length) return undefined;
    const withLive2D = agents.find((item) => item.live2dModelUrl);
    if (!withLive2D) return undefined;
    const timer = setTimeout(() => {
      preloadLive2DRuntime({ modelUrl: withLive2D.live2dModelUrl }).catch(() => {});
    }, 1500);
    return () => clearTimeout(timer);
  }, [agents]);

  useEffectC(() => {
    let cancelled = false;
    async function load() {
      const id = ++seqRef.current;
      const cached = await getCachedRoles().catch(() => null);
      if (!cancelled && seqRef.current === id && cached?.items?.length) {
        const cachedAgents = cached.items.map(toAgent);
        setAgents(cachedAgents);
        openAgentFromQuery(cachedAgents, onOpen, openedFromQueryRef);
      }
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
        if (!cancelled && seqRef.current === id && !cached?.items?.length) setAgents([]);
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
  /**
   * ★ 2026/10/6 修：聊天列表「主陪伴必须第一」。
   *
   * 部署方反馈：主陪伴角色一直排第一，某次新建角色后变成会跳到末尾。
   * 查到两层原因：
   *   ① 服务端本来就把主陪伴/当前角色排最前（roles.js 的 is_active DESC）；
   *   ② 但手机 App 读的是本地缓存，缓存旧代码按「最近写入」排，会覆盖成另一种顺序
   *      → 先显示缓存的乱序，再被服务端数据纠正，看起来就是"跳"。
   * 缓存那边已按服务端规则修好；这里再兜一次，保证**无论如何主陪伴都在最上面**。
   */
  const displayList = [...list].sort((a, b) => {
    const primaryDiff = (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0);
    if (primaryDiff !== 0) return primaryDiff;
    return Number(a.id) - Number(b.id);
  });
  const today = new Date();
  const dateLabel = `${today.getMonth() + 1} 月 ${today.getDate()} 日 · 周${"日一二三四五六"[today.getDay()]}`;

  if (document.documentElement.dataset.skin !== "qingyu") {
    return (
      <div className="screen anim-screen cl-screen">
        <div className="topbar cl-topbar">
          <div>
            <h1>{greetByHour()}</h1>
            <div className="sub">{agents === null ? "加载中…" : `${list.filter((agent) => agent.online).length} 位在线 · 随时可以说话`}</div>
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
              <div className="cl-side">
                <span className={"cl-status" + (a.online ? " on" : "")}><i />{a.online ? "在线" : "离线"}</span>
                <span className="cl-chev"><Icon name="chevron" /></span>
              </div>
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

  /* 轻语结构：这一页不是"联系人列表"，是"家里有谁在"。
     —— 去掉在线人数、在线/离线圆点、金牌样式、卡片阴影；
     —— 改成日期 + 一句问候 + 一行一行的人，中间只用一条细线隔开。 */
  return (
    <div className="screen anim-screen cl-screen">
      <div className="qy-cl-head">
        <div className="qy-cl-date">{dateLabel}</div>
        <h1 className="qy-cl-title">{greetByHour()}</h1>
        <p className="qy-cl-sub">{agents === null ? "正在回到这里…" : "她们各自在过自己的日子，想说话了就点开"}</p>
      </div>
      <div className="chat-list qy-cl-list">
        {displayList.map((a, i) => (
          <button key={a.id} className="cl-card qy-cl-row" onClick={() => onOpen(a)} style={{ animationDelay: `${i * 40}ms` }}>
            <div className="cl-avatar">
              <img src={a.avatar} alt={a.name} onError={fallbackToDefaultRoleAvatar} />
            </div>
            <div className="cl-main">
              <div className="qy-cl-line">
                <span className="cl-name">{a.name}</span>
                {a.isDefault && <span className="qy-cl-tag">主陪伴</span>}
              </div>
              <div className="cl-msg">{a.tag || "点击开始聊天"}</div>
            </div>
            <span className="cl-chev"><Icon name="chevron" /></span>
          </button>
        ))}
        {list.length === 0 && agents !== null && (
          <div className="qy-cl-empty">
            <img className="qy-cl-empty-img" src="/assets/empty-chat.webp" alt="" />
            <div className="qy-cl-empty-title">这里还空着</div>
            <div className="qy-cl-empty-desc">先给她一个名字，她才好住进来。</div>
            <button className="qy-cl-empty-btn" onClick={() => window.location.href = "/characters"}>去接她回来</button>
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

/**
 * 「她在想什么」（2026/9/17 改）
 *
 * 以前这里显示的是**额外调一次模型**生成的"心情展示"（事后补写的假内心）。
 * 现在显示的是主聊天自带的**真思考**（上游 reasoning），只在用户主动开了
 * 思考等级时才有内容；关着的时候就整块不出现。
 */
function ThinkCard({ text, pending = false, unavailable = false, startedAt = 0 }) {
  const [open, setOpen] = useStateC(Boolean(pending));
  const [pinned, setPinned] = useStateC(false);
  const [seconds, setSeconds] = useStateC(1);
  const hasSummary = Boolean(text?.trim());
  const body = hasSummary ? text : "";

  useEffectC(() => {
    if (pending) {
      if (!pinned) setOpen(true);
      return;
    }
    if (!pinned) setOpen(false);
  }, [pending, pinned]);

  useEffectC(() => {
    if (!pending) return;
    const t0 = startedAt || Date.now();
    const id = setInterval(() => setSeconds(Math.max(1, Math.round((Date.now() - t0) / 1000))), 250);
    return () => clearInterval(id);
  }, [pending, startedAt]);

  const label = pending ? "她在想什么" : `想了 ${seconds} 秒`;
  const showBody = hasSummary && (pending || open);

  return (
    <div className={"think" + (showBody ? " open" : "") + (pending ? " pending" : "") + (unavailable && !hasSummary ? " unavailable" : "")}>
      <button className="think-toggle" onClick={() => { setPinned(true); setOpen(!open); }} disabled={pending} aria-expanded={showBody}>
        <span className="think-label"><Icon name="brain" /> {label}</span>
        {pending
          ? <span className="think-pending-dot" aria-label="正在思考" />
          : unavailable && !hasSummary
            ? <span className="think-empty-mark">没有回传</span>
            : <Icon name="chevronD" className="think-chev" />}
      </button>
      {showBody && <div className="think-body">{body}</div>}
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
      // Android APP：读出来优先走手机自带朗读，不先去撞已经到期/失败的云端语音。
      if (isNativeTextToSpeechAvailable() || voice?.engine === "browser") {
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

/* ---------------- 微信式语音：点一下转文字 / 按住发语音 ---------------- */
/* 2026/9/19：以前是"点语音→弹窗→开始录音→结束录音"四步，用户嫌绕。
   现在按微信的习惯：
     · 点一下      → 开始识别；再点一下 → 把识别出的文字放进输入框
     · 按住不放    → 录音；松手 → 直接发一条语音给她
   ★ 2026/9/21 改：识别默认走**服务器识别**（千问，和长按发语音同一条通道）。
   原因：真机上手机自带听写服务不可用，点按必定失败。只有服务器识别没配好
   （真离线）时，才退到手机自带听写。 */
const VOICE_HOLD_MS = 350;
const VOICE_MIN_SEND_MS = 700;
/** 点按转文字最长听多久：超时自动收尾，避免一直占着麦克风。 */
const TRANSCRIBE_MAX_MS = 20000;

function VoiceTalkButton({ disabled, onTranscript, onVoice, onError }) {
  const [phase, setPhase] = useStateC("idle"); // idle | transcribing | recording | uploading
  const [liveText, setLiveText] = useStateC("");
  const holdTimerRef = useRefC(null);
  const recorderRef = useRefC(null);
  const recognizerRef = useRefC(null);
  const nativeFinalRef = useRefC("");
  const transcribingRef = useRefC(false);
  const recordingRef = useRefC(false);
  const downAtRef = useRefC(0);
  const gestureDoneRef = useRefC(false);
  const nativeListenRef = useRefC(false);
  // 服务器识别（千问）默认为可用；只为"确实离线"时才退到手机自带听写。
  const serverAsrRef = useRefC(true);
  const transcribeTimerRef = useRefC(null);

  useEffectC(() => () => {
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    if (transcribeTimerRef.current) clearTimeout(transcribeTimerRef.current);
    recorderRef.current?.cancel();
    recognizerRef.current?.cancel();
  }, []);

  // 问一次"服务器识别配置好了吗"，决定点按转文字走哪条路。
  useEffectC(() => {
    let alive = true;
    apiFetch("/api/asr/status")
      .then((response) => response.json())
      .then((payload) => {
        if (alive) serverAsrRef.current = Boolean(payload?.success && payload?.configured);
      })
      .catch(() => { /* 探不到就按可用处理，真失败时下面还有兜底 */ });
    return () => { alive = false; };
  }, []);

  /**
   * 点一下 = 开始听；再点一下 = 把字填进输入框。
   * 默认走服务器识别；服务器识别不可用时才用手机自带听写。
   */
  const startNativeListen = async () => {
    recognizerRef.current?.cancel();
    nativeFinalRef.current = "";
    const recognizer = createSpeechRecognizer({
      onPartial: (text) => { if (text) setLiveText(text); },
      onFinal: (text) => { if (text) { nativeFinalRef.current = text; setLiveText(text); } },
      onError: () => {},
      onEnd: () => {},
    });
    recognizerRef.current = recognizer;
    await recognizer.start();
  };

  const stopNativeListen = async () => {
    const recognizer = recognizerRef.current;
    recognizerRef.current = null;
    if (!recognizer) return String(nativeFinalRef.current || "").trim();
    try { await recognizer.stop(); } catch { /* 忽略 */ }
    await new Promise((resolve) => setTimeout(resolve, 350));
    try { await recognizer.cancel(); } catch { /* 忽略 */ }
    return String(nativeFinalRef.current || "").trim();
  };

  /**
   * 进入"转文字"。
   *
   * ★ 2026/9/21 修：以前 App 里点按会放弃录音、改走手机自带听写。
   *   真机实测这台 ColorOS 的听写服务根本不可用（Google 语音被停用、
   *   系统默认识别服务为空、连 listen 界面都解析不到），所以点按必定失败；
   *   而长按走的"录音 → 服务器识别"是好的。
   *   现在改成：只要服务器识别可用，点按就和网页一样继续用这段录音；
   *   只有确实离线（服务器识别没配好）才退到手机自带听写。
   */
  const enterTranscribeMode = () => {
    transcribingRef.current = true;
    setPhase("transcribing");
    setLiveText("正在听…再点一下转成文字");
    // 安全阀：一直没点第二下就别一直占着麦克风，到点自动收尾。
    if (transcribeTimerRef.current) clearTimeout(transcribeTimerRef.current);
    transcribeTimerRef.current = setTimeout(() => {
      if (transcribingRef.current) stopTranscribe().catch(() => {});
    }, TRANSCRIBE_MAX_MS);
    if (serverAsrRef.current || !isNativeSpeechRecognitionAvailable()) return;
    // 离线兜底：让出麦克风，改走手机自带听写
    recordingRef.current = false;
    recorderRef.current?.cancel();
    recorderRef.current = null;
    nativeListenRef.current = true;
    startNativeListen().catch(() => onError("手机听写开不了，先打字吧"));
  };

  const stopTranscribe = async () => {
    transcribingRef.current = false;
    if (transcribeTimerRef.current) { clearTimeout(transcribeTimerRef.current); transcribeTimerRef.current = null; }
    recordingRef.current = false;
    const recorder = recorderRef.current;
    recorderRef.current = null;
    setPhase("uploading");
    try {
      // 离线兜底那条路：识别结果来自手机自带听写
      if (nativeListenRef.current) {
        nativeListenRef.current = false;
        const text = await stopNativeListen();
        if (text) onTranscript(text);
        else onError("没有听清，再说一次试试");
        return;
      }
      // 主路：这段录音交给服务器识别（和长按发语音同一条通道）
      const result = await recorder?.stop();
      if (result?.blob) {
        const text = await transcribeOnServer(result.blob);
        if (text) onTranscript(text);
        else onError("没有听清，再说一次试试");
        return;
      }
      // 没拿到录音：让设备自己再听一次（App 走手机听写，网页走浏览器）
      const deviceText = await transcribeWithDevice().catch(() => "");
      if (deviceText) { onTranscript(deviceText); return; }
      onError("没有听清，再说一次试试");
    } catch (error) {
      // 服务器这条路也失败了：让设备自己再听一次
      const deviceText = await transcribeWithDevice().catch(() => "");
      if (deviceText) onTranscript(deviceText);
      else onError(String(error?.message || "语音识别失败，先打字吧"));
    } finally {
      setPhase("idle");
      setLiveText("");
    }
  };

  /**
   * 兜底：让设备自己听一次。
   * App 里会走手机自带听写；网页/电脑走浏览器识别（国内多半不可用，
   * 所以只在服务器识别这条路失败时才用）。
   */
  const transcribeWithDevice = () => new Promise((resolve, reject) => {
    if (!isSpeechRecognitionAvailable()) { resolve(""); return; }
    let finalText = "";
    const recognizer = createSpeechRecognizer({
      onFinal: (text) => { finalText = text; },
      onError: () => {},
      onEnd: () => resolve(finalText),
    });
    recognizer.start().catch(reject);
    setTimeout(() => { recognizer.stop().catch(() => {}); }, 8000);
  });

  /**
   * ★ 2026/9/19 修：按下就立刻准备麦克风。
   *   原来要等按住 350ms 才去申请麦克风，用户松手时录音还没开始，
   *   结果"长按发语音"经常没反应。现在按下就开录，声音小也不丢。
   */
  const beginRecord = async () => {
    if (recordingRef.current) return;
    recordingRef.current = true;
    setPhase("recording");
    const recorder = createVoiceRecorder();
    recorderRef.current = recorder;
    try {
      await recorder.start();
      // 注意：不要在这里同时开手机听写。录音和系统听写都要独占麦克风，
      // 同时开只会互相抢，结果两个都失败。按住发送的转写走录音文件这条路。
    } catch {
      recordingRef.current = false;
      recorderRef.current = null;
      setPhase("idle");
      onError("请允许麦克风权限，再按住说话");
    }
  };

  const finishRecord = async () => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    recordingRef.current = false;
    if (!recorder) { setPhase("idle"); return; }
    setPhase("uploading");
    try {
      const result = await recorder.stop();
      if (!result?.blob) {
        onError("没录上，再按住说一次");
        return;
      }
      if (result.durationMs < VOICE_MIN_SEND_MS) {
        onError("说话时间太短，再按住说一次");
        return;
      }
      await onVoice(result);
    } finally {
      setPhase("idle");
    }
  };

  const handleDown = (event) => {
    if (disabled) return;
    event.preventDefault?.();
    // 正在识别：这一下是"结束识别"，抬起时处理。
    // ★ 必须先把 gestureDone 复位：否则 handleUp 第一行 `if (gestureDoneRef.current) return`
    //   会直接拦掉，第二下永远结束不了识别，界面卡在"正在听…再点一下转成文字"。
    if (transcribingRef.current) {
      gestureDoneRef.current = false;
      return;
    }
    if (recordingRef.current) return;
    gestureDoneRef.current = false;
    downAtRef.current = Date.now();
    try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* 有的浏览器没有 */ }
    // 按下就把麦克风准备好：这样无论"按住说话"还是"点一下转文字"都不会丢开头。
    // 抬起时再按按住时长分流：短按→继续录音、等第二下转文字；长按→松手直接发语音。
    beginRecord();
  };

  const handleUp = async () => {
    if (gestureDoneRef.current) return;
    gestureDoneRef.current = true;
    if (disabled) {
      if (recordingRef.current) await finishRecord();
      return;
    }
    // 第二下：结束"转文字"录音并送去识别
    if (transcribingRef.current) { await stopTranscribe(); return; }
    const heldMs = Date.now() - (downAtRef.current || 0);
    // 点一下：这段录音继续录着，进入"再点一下转文字"状态
    if (heldMs < VOICE_HOLD_MS) { enterTranscribeMode(); return; }
    // 按住：直接发语音
    await finishRecord();
  };

  const handleCancel = async () => {
    if (gestureDoneRef.current) return;
    // 手指被系统抢走时：已经按住够久就当发送；太短则当成点按，继续录、等第二下转文字。
    if (transcribingRef.current) return;
    const heldMs = Date.now() - (downAtRef.current || 0);
    if (heldMs >= VOICE_HOLD_MS) {
      await handleUp();
      return;
    }
    gestureDoneRef.current = true;
    enterTranscribeMode();
  };

  const label = phase === "recording"
    ? "松开发送"
    : phase === "uploading"
      ? "正在发送…"
      : phase === "transcribing"
        ? (liveText || "正在听…再点一下转成文字")
        : "点一下转文字 · 按住说话";

  return (
    <button
      type="button"
      className={"ib-voice-bar" + (phase === "recording" ? " recording" : "") + (phase === "transcribing" ? " transcribing" : "")}
      onPointerDown={handleDown}
      onPointerUp={handleUp}
      onPointerCancel={handleCancel}
      onContextMenu={(e) => e.preventDefault()}
      disabled={disabled || phase === "uploading"}
      title="点一下：语音转文字；按住：录一条语音发给她"
    >
      <Icon name="mic" />
      <span>{label}</span>
    </button>
  );
}

async function saveChatImage(src) {
  const response = await apiFetch(src);
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
      await saveChatImage(assetUrl(src));
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
        <img src={assetUrl(src)} alt="聊天图片原图" />
      </div>
      <div className="cip-actions" onClick={(event) => event.stopPropagation()}>
        <button className="cip-save" onClick={save} disabled={saving}>{saving ? "正在保存…" : "保存图片"}</button>
        <a className="cip-original" href={assetUrl(src)} target="_blank" rel="noreferrer">打开原图</a>
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
          onClick={(event) => { event.stopPropagation(); onOpenImage?.(assetUrl(src)); }}
          onMouseDown={(event) => event.stopPropagation()}
          onTouchStart={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.stopPropagation()}
          aria-label="打开图片预览"
        >
          <img src={assetUrl(src)} alt="聊天图片" loading="lazy" decoding="async" />
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
  const hideAvatar = Boolean(m._hideAvatar);
  const continueGroup = Boolean(m._continue);
  const lastInGroup = m._lastInGroup !== false;
  const rowClass = "row " + (isMe ? "me" : "her") + (continueGroup ? " continue" : " group-start");

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
        <button className="msg-menu-del" onClick={() => { setMenuPos(null); onDelete?.(m.ids || m.id); }}>
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
    // 2026/9/15：表情包改成**透明贴纸**——不再套白色方块气泡。
    // 有 img 就渲染图片（透明 PNG），没有就退回原来的 emoji 贴纸。
    const stickerImg = m.img || m.stickerImg;
    return (
      <div className={rowClass}>
        {!isMe && <div className={"row-avatar" + (hideAvatar ? " ghost" : "")}><img src={agent.avatar} alt="" onError={fallbackToDefaultRoleAvatar} /></div>}
        <div className="sticker-wrap">
          {stickerImg
            ? <div className="sticker sticker-plain"><img src={assetUrl(stickerImg)} alt={m.label || "表情"} loading="lazy" /></div>
            : <div className="sticker"><span className="st-emo">{m.sticker}</span>{m.label && <span className="st-label">{m.label}</span>}</div>}
          {lastInGroup && m.time && <span className="msg-time">{m.time}</span>}
        </div>
        {isMe && <div className={"row-avatar" + (hideAvatar ? " ghost" : "")}><img src={assetUrl(myAvatar)} alt="" onError={fallbackToDefaultUserAvatar} /></div>}
      </div>
    );
  }

  if (isMe) {
    return (
      <>
        {menuEl}
        <div className={rowClass} {...longPressProps}>
          <div className="me-stack">
            {m.type === "voice" ? (
              <VoiceBubble mine dur={m.dur} src={assetUrl(m.audioUrl)} />
            ) : (
              <div className="bubble me-bubble">
                <MessageImages images={m.images} onOpenImage={onOpenImage} />
                {m.text && <span className="msg-text">{m.text}</span>}
              </div>
            )}
            {lastInGroup && m.time && <span className="msg-time">{m.time}</span>}
            {m.failed && <button className="msg-retry" onClick={() => onRetry?.(m._clientId)}>重新发送</button>}
            {m.type === "voice" && <VoiceTranscriptButton transcript={m.transcript || ""} error={m.recognitionError || ""} />}
          </div>
          <div className={"row-avatar" + (hideAvatar ? " ghost" : "")}><img src={assetUrl(myAvatar)} alt="" onError={fallbackToDefaultUserAvatar} /></div>
        </div>
      </>
    );
  }

  if (m._holdBody && !m.think && !m.reasoningRequested) return null;

  const { content: herText } = !isMe ? extractThink(m.text) : { content: m.text };
  const hasAssistantBubble = !m._holdBody && (m.type === "voice" || Boolean(herText) || Boolean(m.images?.length));

  return (
    <>
      {menuEl}
      <div className={"her-block" + (continueGroup ? " continue" : "")} {...longPressProps}>
        {m.type === "proactive" && <div className="proactive-tag"><Icon name="sparkSm" /> {m.tag}</div>}
        <div className={rowClass}>
          <div className={"row-avatar" + (hideAvatar ? " ghost" : "")}><img src={agent.avatar} alt="" onError={fallbackToDefaultRoleAvatar} /></div>
          <div className="her-stack">
            {(m.reasoningPending || (m.think && String(m.think).trim())) && (
              <ThinkCard
                text={m.think}
                pending={Boolean(m.reasoningPending)}
                unavailable={Boolean(m.reasoningUnavailable)}
                startedAt={m.reasoningStartedAt || 0}
              />
            )}
            {hasAssistantBubble && (
              <div className={"bubble her-bubble" + (m.type === "proactive" ? " proactive" : "") + (isActionBubble(herText) ? " action" : "")}>
                <MessageImages images={m.images} onOpenImage={onOpenImage} />
                {m.type === "voice" ? <VoiceBubble dur={m.dur} src={assetUrl(m.audioUrl)} /> : (herText && <span className="msg-text">{herText}</span>)}
              </div>
            )}
            {lastInGroup && m.time && <span className="msg-time">{m.time}</span>}
            {tts && m.type === "text" && herText && <TTSButton messageId={m.id} text={herText} voice={voice} />}
            {m.type === "voice" && herText && <VoiceTranscriptButton transcript={herText} />}
          </div>
        </div>
      </div>
    </>
  );
}

// Streaming changes only the active bubble. Keep the rest of a long chat
// list out of React's render work, while still updating changed message data.
const MemoBubble = React.memo(Bubble, (prev, next) => (
  prev.m === next.m
  && prev.agent === next.agent
  && prev.tts === next.tts
  && prev.voice === next.voice
  && prev.myAvatar === next.myAvatar
));

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
function ChatFigure({ agent, figSrc, expanded, live2dState, live2dReady = true, onOpen, onClose }) {
  const viewFrame = getVisualFrameView(agent.visualFrame, expanded ? "fullscreen" : "chat");
  const figureFrameStyle = {
    "--chat-figure-scale": String(viewFrame.zoom),
    "--chat-figure-offset-x": `${viewFrame.offsetX * 100}%`,
    "--chat-figure-offset-y": `${viewFrame.offsetY * 100}%`,
  };
  /* 2026/10/14（用户拍板）：整幅有背景的图铺满聊天区/全屏，透明剪影保持"完整显示"。
     判定按图片地址缓存，同一张图只算一次；拿不准（unknown）就走原来的样子。
     用 Live2D 的角色不判 —— 那时候画面上是 canvas，静态图只是"运行库没起来"时的兜底，
     拿模型预览图去判会误伤（预览图整张不透明，会让 Live2D 也变成铺满）。 */
  const isLive2DRole = Boolean(agent.live2dModelUrl);
  const [portraitBackground, setPortraitBackground] = useStateC(PORTRAIT_BACKGROUND_UNKNOWN);
  useEffectC(() => {
    if (!figSrc || isLive2DRole) {
      setPortraitBackground(PORTRAIT_BACKGROUND_UNKNOWN);
      return undefined;
    }
    let active = true;
    setPortraitBackground(PORTRAIT_BACKGROUND_UNKNOWN);
    detectPortraitBackground(figSrc)
      .then((next) => { if (active) setPortraitBackground(next); })
      .catch(() => {});
    return () => { active = false; };
  }, [figSrc, isLive2DRole]);

  return (
    <div className={`chat-figure${expanded ? " is-expanded" : ""}`} data-frame={viewFrame.mode} data-portrait-bg={portraitBackground} style={figureFrameStyle} onClick={expanded ? onClose : undefined}>
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
        {/* 历史消息回来前先保留静态预览，避免 Live2D 初始化阻塞聊天室首屏。 */}
        <Live2DStage
          className="chat-live2d-stage"
          modelUrl={live2dReady ? agent.live2dModelUrl : ""}
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

/* 2026/10/14：一次发出去的多张图，后端是每张各存一条（见 send() 的注释），
   于是"退出重进"就会从一条气泡变成好几条。这里按"同一批连发"并回一条：
   同是本人的图片消息、且两者创建时间相差不超过 3 秒。（只影响显示，不改数据库） */
function sameImageBatch(a, b) {
  const ta = Date.parse(a?.created_at || "");
  const tb = Date.parse(b?.created_at || "");
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return false;
  return Math.abs(tb - ta) <= 3000;
}

function mergeImageRows(rows) {
  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const prev = out[out.length - 1];
    const isMine = (row?.message_type || "text") === "image" && row?.role === "user";
    const prevIsMine = prev && (prev.message_type || "text") === "image" && prev.role === "user";
    if (isMine && prevIsMine && sameImageBatch(prev, row)) {
      prev.__mergedImages = [
        ...(prev.__mergedImages || (prev.media_url ? [prev.media_url] : [])),
        row.media_url,
      ].filter(Boolean);
      prev.__mergedIds = [
        ...(prev.__mergedIds || (prev.id ? [prev.id] : [])),
        row.id,
      ].filter(Boolean);
      if (row.content) prev.content = row.content;
      if (row.id) prev.id = row.id;
      continue;
    }
    out.push({ ...row });
  }
  return out;
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
    // ★ 2026/9/17：优先显示真思考（reasoning_summary）；
    //   旧的 inner_os_content 仍兼容读取，避免老消息的"心情展示"直接消失。
    think: (m.reasoning_summary || "") || (m.inner_os_source === "character_reflection" ? (m.inner_os_content || "") : ""),
    // 合并过的多图（见 mergeImageRows）要全部渲染，不能只显示第一条
    images: messageType === "image"
      ? (Array.isArray(m.__mergedImages) ? m.__mergedImages : (m.media_url ? [m.media_url] : []))
      : [],
    ids: Array.isArray(m.__mergedIds) && m.__mergedIds.length > 1 ? m.__mergedIds : undefined,
    // 2026/9/15：表情包（贴纸）靠 media_url 指到透明 PNG，和图片分开处理。
    img: messageType === "sticker" ? (m.media_url || m.sticker_img || "") : "",
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
/**
 * 小白的表情包（2026/9/15 用户确认）
 * ────────────────────────────────────────────
 * 来源：用户用 GPT 生成的 4×4 Q 版表情图（16 格），本机已切成 16 张并抠掉白底成透明 PNG。
 * 素材位置：/images/xiaobai-stickers/
 *
 * ★ 为什么不按"每张一个精确名字"分组：
 *   用户的实际用法是"看一眼就知道该发哪张"，不需要记住 16 个名字。
 *   所以这里只按**场景**分 4 组 —— 她（和人）在这个场景里随便挑一张都对，
 *   既不会发错场（不会在安慰时丢一张大笑的），也不会永远发同一张。
 *
 * ★ 与旧素材的区别（重要，别再拿旧的当表情包）：
 *   旧的 `/images/xiaobai-emotions/` 那 12 张**不是表情包** ——
 *   它们是半身立绘切成的方块（放大右下角能看到头发和蕾丝领子），放进聊天气泡里像贴照片。
 *   它们仍可用在角色选择/状态展示，但**不用于聊天表情**。
 *
 * ★ 已知缺口（等补充素材）：
 *   目前没有「委屈/难过」「生气鼓嘴」「困/想睡」「惊讶」四类。
 *   所以"安慰"场景只能用 gentle 组（安静陪着你）—— 方向对，但做不出"心疼"的表情。
 */
const XIAOBAI_STICKER_GROUPS = [
  {
    key: "gentle", name: "静静陪你",
    hint: "他累了、难过、要收场的时候",
    files: ["gentle-01.png", "gentle-02.png", "gentle-03.png", "gentle-04.png",
            "gentle-05.png", "gentle-06.png", "gentle-07.png", "gentle-08.png"],
  },
  {
    key: "happy", name: "开心",
    hint: "他说了甜话、她自己高兴",
    files: ["happy-01.png", "happy-02.png"],
  },
  {
    key: "shy", name: "害羞",
    hint: "他被夸、不好意思",
    files: ["shy-01.png", "shy-02.png", "shy-03.png", "shy-04.png"],
  },
  {
    key: "playful", name: "俏皮",
    hint: "撒娇、逗他、想他",
    files: ["playful-01.png", "playful-02.png"],
  },
];

const XIAOBAI_STICKER_BASE = "/images/xiaobai-stickers";

const COMMON_EMOJIS = ["😊","😀","😁","😌","😉","🥹","😳","😘","👍","👏","❤️","🌭","✅","🎀","😻","🥰","🙄","🙏","🫶","🙂","🤗","😫","😴","☀️","🥳","💆","🎰","🍃","☁️","🌫","💐","💏","🫰","🎜","🌛"];

function EmojiPanel({ agent, onSendSticker, onInsertEmoji }) {
  // tab 用字符串：组 key，或 "emoji"
  const [tab, setTab] = useStateC("gentle");
  const group = XIAOBAI_STICKER_GROUPS.find((g) => g.key === tab);
  return (
    <div className="sticker-panel">
      <div className="sp-chips">
        {XIAOBAI_STICKER_GROUPS.map((g) => (
          <button
            key={g.key}
            className={"sp-chip" + (tab === g.key ? " on" : "")}
            title={g.hint}
            onClick={() => setTab(g.key)}
          >
            {g.name}<span className="sp-chip-n">{g.files.length}</span>
          </button>
        ))}
        <button className={"sp-chip" + (tab === "emoji" ? " on" : "")} onClick={() => setTab("emoji")}>Emoji</button>
      </div>
      {group && (
        <div className="sp-grid sp-grid-stk">
          {group.files.map((f, i) => (
            <button
              key={i}
              className="sp-item sp-stk"
              title={group.name}
              onClick={() => onSendSticker({ e: "", label: "", img: `${XIAOBAI_STICKER_BASE}/${f}` })}
            >
              <img src={`${XIAOBAI_STICKER_BASE}/${f}`} alt={group.name} />
            </button>
          ))}
        </div>
      )}
      {tab === "emoji" && (
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
  const [historyWindow, setHistoryWindow] = useStateC(CHAT_HISTORY_INITIAL);
  const [historyCursor, setHistoryCursor] = useStateC(null);
  const [historyHasMore, setHistoryHasMore] = useStateC(false);
  const [historyReady, setHistoryReady] = useStateC(false);
  const [myAvatar, setMyAvatar] = useStateC(DEFAULT_USER_AVATAR);
  const [draft, setDraft] = useStateC("");
  const [typing, setTyping] = useStateC(false);
  const [turnTyping, setTurnTyping] = useStateC(false);
  const playGenRef = useRefC(0);
  const [live2dScene, setLive2dScene] = useStateC("idle");
  const [live2dActive, setLive2dActive] = useStateC(false);
  /* 轻语：聊天时她是"在旁边"，不是"铺在后面"。默认收起立绘，想看她再点"叫她出来"。 */
  const [showFig, setShowFig] = useStateC(() => (
    typeof document === "undefined" ? true : document.documentElement.dataset.skin !== "qingyu"
  ));
  const [big, setBig] = useStateC(false);
  const [stickerOpen, setStickerOpen] = useStateC(false);
  const [searching, setSearching] = useStateC(false);
  const [q, setQ] = useStateC("");
  const [emo, setEmo] = useStateC("01_默认温柔");
  const [calling, setCalling] = useStateC(false);
  const [atts, setAtts] = useStateC([]);
  const [voiceMode, setVoiceMode] = useStateC(false); // 语音/文字切换
  const [voiceSettings, setVoiceSettings] = useStateC(loadVoiceSettings);
  const [moreOpen, setMoreOpen] = useStateC(false); // 更多菜单
  const [inputActionsOpen, setInputActionsOpen] = useStateC(false); // 手机输入栏更多操作
  const [modelOpen, setModelOpen] = useStateC(false);
  // ★ 2026/9/17：思考等级独立开关（不拉模型列表，点开就是四档）
  const [thinkOpen, setThinkOpen] = useStateC(false);
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
  const bigHistoryRef = useRefC(false);
  const sendRef = useRefC(null);
  const failedSendRef = useRefC(failedSend);
  const olderLoadRef = useRefC(null);
  const olderLoadingRef = useRefC(false);
  const skipNextHistoryAutoScrollRef = useRefC(false);
  const historyRequestTokenRef = useRefC(0);
  const historyMessageCount = getChatHistoryMessageCount(msgs);
  failedSendRef.current = failedSend;

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
    const requestToken = ++historyRequestTokenRef.current;
    setHistoryReady(false);
    async function load() {
      olderLoadingRef.current = false;
      olderLoadRef.current = null;
      setHistoryWindow(CHAT_HISTORY_INITIAL);
      setHistoryCursor(null);
      setHistoryHasMore(false);
      const cached = await getCachedMessages(roleId).catch(() => null);
      if (!cancelled && cached?.items?.length) {
        setMsgs(withTimeDividers(mergeImageRows(cached.items).map(toMsg)));
        setHistoryReady(true);
      }
      try {
        let [data, proactive] = await Promise.all([
          getMessages(roleId, CHAT_HISTORY_INITIAL),
          getProactiveEvents({ characterId: roleId, limit: 100 }).catch(() => null),
        ]);
        if (cancelled) return;
        // A hot-reloaded frontend can briefly meet an older local backend. Keep
        // its existing 80-message behavior until that backend is restarted.
        if (!data || Array.isArray(data) || !Object.prototype.hasOwnProperty.call(data, "has_more")) {
          data = await getMessages(roleId, 80);
          if (cancelled) return;
        }
        const items = Array.isArray(data) ? data : (data?.items || []);
        const nextCursor = Number(data?.next_before_id || items[0]?.id || 0);
        const hasMore = Boolean(data?.has_more) && Number.isInteger(nextCursor) && nextCursor > 0;
        if (items.length > 0) {
          const converted = mergeImageRows(items).map(toMsg);
          setMsgs(withTimeDividers(converted));
        } else {
          setMsgs([{ type: "time", text: "今天" }, { who: "her", type: "text", time: "刚刚", text: `你好，我是${agent.name}。` }]);
        }
        setHistoryCursor(hasMore ? nextCursor : null);
        setHistoryHasMore(hasMore);
        setHistoryReady(true);
        const pendingEvents = (proactive?.items || []).filter((item) => item["un" + "read"] && item.id);
        await Promise.all(pendingEvents.map((item) => markProactiveEventRead(item.id).catch(() => null)));
      } catch {
        if (!cancelled) {
          if (!cached?.items?.length) {
            setMsgs([{ type: "time", text: "今天" }, { who: "her", type: "text", time: "刚刚", text: `你好，我是${agent.name}。` }]);
          }
          setHistoryCursor(null);
          setHistoryHasMore(false);
          setHistoryReady(true);
        }
      }
    }
    load();
    return () => {
      cancelled = true;
      if (historyRequestTokenRef.current === requestToken) historyRequestTokenRef.current += 1;
    };
  }, [roleId]);

  const figSrc = hasEmo ? (EMO_SET[emo] || agent.cover) : agent.cover;
  const live2dState = React.useMemo(
    () => ({ scene: live2dActive ? live2dScene : "idle" }),
    [live2dActive, live2dScene],
  );

  useEffectC(() => {
    if (!big) return undefined;

    window.history.pushState({ rbFigure: true }, "");
    bigHistoryRef.current = true;
    const onPop = () => {
      bigHistoryRef.current = false;
      setBig(false);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [big]);

  const closeBig = () => {
    if (bigHistoryRef.current && window.history.state?.rbFigure) {
      window.history.back();
      return;
    }
    setBig(false);
  };

  const scroll = () => requestAnimationFrame(() => { const el = areaRef.current; if (el) el.scrollTop = el.scrollHeight; });
  useEffectC(() => {
    if (skipNextHistoryAutoScrollRef.current) {
      skipNextHistoryAutoScrollRef.current = false;
      return;
    }
    scroll();
  }, [msgs, typing]);

  useLayoutEffectC(() => {
    const previous = olderLoadRef.current;
    if (!previous) return;
    const el = areaRef.current;
    if (el) el.scrollTop = el.scrollHeight - previous.scrollHeight + previous.scrollTop;
    olderLoadRef.current = null;
    olderLoadingRef.current = false;
  }, [historyWindow]);

  const loadOlderMessages = async () => {
    const el = areaRef.current;
    if (!el || q.trim() || el.scrollTop >= 64 || olderLoadingRef.current) return;
    olderLoadingRef.current = true;
    olderLoadRef.current = { scrollHeight: el.scrollHeight, scrollTop: el.scrollTop };
    if (historyWindow < historyMessageCount) {
      setHistoryWindow((current) => Math.min(historyMessageCount, current + CHAT_HISTORY_PAGE));
      return;
    }
    if (!historyHasMore || !historyCursor) {
      olderLoadRef.current = null;
      olderLoadingRef.current = false;
      return;
    }

    const requestToken = historyRequestTokenRef.current;
    let scheduledRender = false;
    try {
      const data = await getMessages(roleId, CHAT_HISTORY_PAGE, { beforeId: historyCursor });
      if (requestToken !== historyRequestTokenRef.current) return;

      const items = Array.isArray(data) ? data : (data?.items || []);
      const knownIds = new Set(msgs.filter((message) => message.type !== "time" && message.id).map((message) => message.id));
      const olderItems = mergeImageRows(items).map(toMsg).filter((message) => !message.id || !knownIds.has(message.id));
      const nextCursor = Number(data?.next_before_id || items[0]?.id || 0);
      const hasMore = Boolean(data?.has_more) && Number.isInteger(nextCursor) && nextCursor > 0;
      setHistoryCursor(hasMore ? nextCursor : null);
      setHistoryHasMore(hasMore);

      if (!olderItems.length) return;

      skipNextHistoryAutoScrollRef.current = true;
      setMsgs((current) => {
        const currentItems = current.filter((message) => message.type !== "time");
        const currentIds = new Set(currentItems.filter((message) => message.id).map((message) => message.id));
        return withTimeDividers([
          ...olderItems.filter((message) => !message.id || !currentIds.has(message.id)),
          ...currentItems,
        ]);
      });
      setHistoryWindow((current) => current + olderItems.length);
      scheduledRender = true;
    } catch (error) {
      if (requestToken === historyRequestTokenRef.current) {
        setChatError(withDiagnosticId("加载更早的聊天记录失败，请稍后再试。", recordDiagnostic({ area: "chat", action: "load-older-history", error })));
      }
    } finally {
      if (!scheduledRender && requestToken === historyRequestTokenRef.current) {
        olderLoadRef.current = null;
        olderLoadingRef.current = false;
      }
    }
  };

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

  /**
   * 她递过来的一张表情包 —— 显示 + 落库，两件事必须**晚一点、单独一条**做。
   *
   * 设计依据（2026/9/15）：消息和表情包不该看着像一起发来的 ——
   * 人的习惯是分两条发，一起冒出来会很怪。
   *
   * 所以：① 延迟一下再出现（像她说完话之后又点了发送）；
   *       ② 单独一条消息、自己的时间戳；
   *       ③ **由前端落库**，而且排在她的文字之后 —— 刷新页面顺序也正确。
   */
  /* 她主动递的那张表情包（2026/9/16 重写保存时机） */
  const pendingStickerRef = useRefC(null);

  /**
   * 只负责"显示"，不负责"保存"。
   *
   * 旧实现是「延迟 550~1300ms 之后再发保存请求」，有两个真实问题：
   *   ① 它和"存她的文字"在**赛跑** —— 定时器先跑完，贴纸的 id 就比文字小，
   *      刷新后贴纸会**跑到文字前面**（用户实际遇到过，当时只能手工调 id 补救）；
   *   ② 用户在这 1.3 秒内刷新/退出/断网，贴纸就**永久丢失**
   *      （实测：她发过的贴纸在数据库里一条都没有，只有用户自己发的那条）。
   *
   * 现在改成：显示照旧晚一点点（像人先打字、再随手递张图），
   * 但**保存统一挪到"她的文字存完之后"执行**（见 flushHerSticker），
   * 这样顺序稳、内容也不会丢。
   */
  const appendHerSticker = React.useCallback((url, group) => {
    if (!url) return;
    pendingStickerRef.current = { url, group: group || "" };
    const delay = 550 + Math.floor(Math.random() * 750);
    setTimeout(() => {
      setMsgs((p) => [...p, {
        who: "her", type: "sticker", img: url, group: group || "", label: "", time: now(),
      }]);
    }, delay);
  }, []);

  /**
   * 把挂起的那张贴纸真正存下来。
   * **必须在"她的文字"存完之后调用** —— 这样贴纸的 id 一定大于文字，
   * 刷新后顺序永远是「先说一句，再递张图」。
   */
  const flushHerSticker = React.useCallback(async () => {
    const pending = pendingStickerRef.current;
    if (!pending?.url) return;
    pendingStickerRef.current = null;
    try {
      const saved = await saveMessage(roleId, {
        role: "assistant",
        content: "",
        message_type: "sticker",
        media_url: pending.url,
      });
      const stickerId = saved?.item?.id;
      if (stickerId) {
        setMsgs((p) => p.map((m) => (
          m.type === "sticker" && m.img === pending.url && !m.id ? { ...m, id: stickerId } : m
        )));
      }
    } catch { /* 保存贴纸失败不挡聊天 */ }
  }, [roleId]);

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
    setLive2dScene(getChatLive2DState([{ who: "me", text: t }], { isResponding: true }).scene);
    setLive2dActive(true);

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

      // 2026/9/19 连发多条：模型仍只请求一次，这里边收边切句，逐条冒出来并逐条落库
      const writer = createBubbleWriter(replyId, reasoningRequested, reasoningLevel);
      await streamAssistantReply(roleId, streamPayload, {
        onToken: (token) => {
          fullReply += token;
          writer.unlockBody();
          for (const ready of writer.splitter.push(token)) writer.finish(ready);
          writer.updateTail(writer.splitter.pending());
        },
        /**
         * ★ 2026/9/17：真思考流式到达（开了思考等级才有）。
         *   它直接写进 think，也就是「她在想什么」里显示的内容。
         */
        onReasoning: (delta) => {
          fullInnerOs += delta;
          paintTurnReasoning(replyId, fullInnerOs, reasoningRequested, { pending: true });
        },
        onInnerOsError: () => {
          paintTurnReasoning(replyId, fullInnerOs, reasoningRequested, { unavailable: true });
        },
        onError: (errMsg) => {
          streamError = String(errMsg || "发送失败，请检查后端和模型配置。");
        },
        /**
         * 2026/9/15：她说完话之后自己递的一张表情包。
         * 后端已经把它存成一条 message_type='sticker' 的真实消息，
         * 这里只要把它显示出来（她主动发，不是装饰）。
         */
        onSticker: (url, group) => appendHerSticker(url, group),
      });
      if (streamError) throw new Error(streamError);

      // 流式结束：把最后没断句的尾巴收成最后一条
      for (const rest of writer.splitter.flush()) writer.finish(rest);
      writer.flushTail();
      writer.unlockBody();
      writer.end();
      paintTurnReasoning(replyId, fullInnerOs, reasoningRequested, {
        streaming: false,
        pending: false,
        unavailable: reasoningRequested && !fullInnerOs.trim(),
      });

      // ★ 2026/9/19：逐条落库。屏幕上一句一条，数据库里也必须一句一条，
      //   否则刷新之后又会变回一整段。思考只挂在第一条上，不重复存。
      const bubblesToSave = writer.emitted.length ? writer.emitted : splitReplyIntoBubbles(fullReply);
      for (let i = 0; i < bubblesToSave.length; i++) {
        try {
          const savedOne = await saveMessage(roleId, {
            role: "assistant",
            content: bubblesToSave[i],
            ...(i === 0 && fullInnerOs.trim() ? { reasoning_summary: fullInnerOs } : {}),
          });
          if (savedOne?.item?.id) {
            const bubbleId = replyId + "_" + i;
            setMsgs((p) => p.map((m) => m._id === bubbleId ? { ...m, id: savedOne.item.id } : m));
          }
        } catch (e) { /* 保存回复失败仍继续 */ }
      }

      // 4) 她递的那张贴纸：等上面"她的文字"存完再存，保证刷新后是「先说、再递图」
      await flushHerSticker();
    } catch (err) {
      const baseText = friendlyChatNetworkError(err);
      setChatError(withDiagnosticId(baseText, recordDiagnostic({ area: "chat", action: "send-message", error: err })));
      setFailedSend({ clientId, text: t, images, userSaved });
      setMsgs((p) => p.map((m) => m._clientId === clientId ? { ...m, failed: true } : m));
      // 发送失败时把你刚打的字还回输入框：不用再复制一次。
      // 只在输入框为空时回填，避免覆盖你在这期间新打的字。
      if (t) setDraft((cur) => (cur && cur.trim() ? cur : t));
    } finally {
      setTyping(false);
      setLive2dActive(false);
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
  const deleteMsg = React.useCallback(async (msgId) => {
    // 合并显示的多图是一组消息，删除时整组一起删（见 mergeImageRows）
    const ids = (Array.isArray(msgId) ? msgId : [msgId]).filter(Boolean);
    if (!ids.length) return;
    try {
      for (const id of ids) await deleteMessage(id);
      setMsgs((p) => p.filter((m) => !ids.includes(m.id) && !(m.ids || []).some((x) => ids.includes(x))));
    } catch (e) { setChatError("删除失败：" + String(e)); }
  }, []);

  sendRef.current = send;
  const retryMessage = React.useCallback((clientId) => {
    const failed = failedSendRef.current;
    if (failed?.clientId === clientId) sendRef.current?.(failed);
  }, []);

  /**
   * 发表情包（贴纸）—— 2026/9/15 改成**真实发送**。
   *
   * 改之前这一版是"本地假动作"：
   *   · 贴纸不落库，刷新就没了；
   *   · "她的回复"是本地写死的随机 emoji（setTimeout 1400ms 假装她回了）；
   *   · 贴纸也不会进她的上下文，她根本不知道你发了什么。
   *
   * 现在：
   *   ① 贴纸按 message_type='sticker' + media_url 存成一条真实消息；
   *   ② 再走正常的流式回复，让她对这张贴纸有真实反应；
   *   ③ 后端会把"这是哪一类情绪的表情"翻译成一句话给她（她看不到图本身）。
   */
  const sendSticker = async (s) => {
    const img = String(s?.img || "").trim();
    setStickerOpen(false);
    setInputActionsOpen(false);

    // 纯 emoji 贴纸（没有图片）：保持轻量，但不假装她回了话
    if (!img) {
      setMsgs((p) => [...p, { who: "me", type: "sticker", sticker: s?.e || "", label: s?.label || "", time: now() }]);
      return;
    }
    if (typing) return;

    setChatError("");
    const clientId = `sticker-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setMsgs((p) => [...p, { who: "me", type: "sticker", img, label: s?.label || "", time: now(), _clientId: clientId }]);
    setTyping(true);
    if (hasEmo) setEmo("02_开心明亮");

    try {
      // ① 贴纸先落库（正文留空，靠 media_url 指到透明 PNG）
      const savedUser = await saveUserMessage(roleId, {
        role: "user",
        content: s?.label || "",
        message_type: "sticker",
        media_url: img,
      });
      const userMsgId = savedUser?.item?.id || savedUser?.user_message?.id;
      if (userMsgId) {
        setMsgs((p) => p.map((m) => m._clientId === clientId ? { ...m, id: userMsgId, _clientId: undefined } : m));
      }

      // ② 她的真实回复（和普通聊天走同一条流式链路）
      const replyId = `sr-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setMsgs((p) => [...p, { who: "her", type: "text", text: "", _id: replyId, streaming: true, time: now() }]);
      let fullReply = "";
      let streamError = "";
      await streamAssistantReply(roleId, {
        content: s?.label || "",
        role: "user",
        message_type: "sticker",
        media_url: img,
        skip_server_persistence: true,
        ...(modelChoice.credentialId && modelChoice.modelId ? { credential_id: modelChoice.credentialId, model_id: modelChoice.modelId } : {}),
        ...(modelChoice.thinkLevel && modelChoice.thinkLevel !== "off" ? { thinking_level: modelChoice.thinkLevel } : {}),
      }, {
        onToken: (token) => {
          fullReply += token;
          setMsgs((p) => p.map((m) => m._id === replyId ? { ...m, text: fullReply } : m));
        },
        onError: (errMsg) => { streamError = String(errMsg || "发送失败，请检查后端和模型配置。"); },
        // 你发了贴纸，她也可以回你一张（同一条链路、同样"单独一条、晚一点"）
        onSticker: (url, group) => appendHerSticker(url, group),
      });
      setMsgs((p) => p.map((m) => m._id === replyId ? { ...m, streaming: false } : m));
      if (streamError) throw new Error(streamError);
      setTyping(false);
      if (!fullReply.trim()) {
        setMsgs((p) => p.filter((m) => m._id !== replyId));
        return;
      }
      try {
        const savedReply = await saveMessage(roleId, { role: "assistant", content: fullReply });
        if (savedReply?.item?.id) {
          setMsgs((p) => p.map((m) => m._id === replyId ? { ...m, id: savedReply.item.id } : m));
        }
      } catch { /* 保存失败不挡聊天，和普通发消息保持一致 */ }
      // 她回敬的那张贴纸：同样等文字存完再存，保证顺序
      await flushHerSticker();
    } catch (e) {
      setTyping(false);
      setChatError(String(e?.message || "贴纸发送失败，稍后再试。"));
      setMsgs((p) => p.map((m) => m._clientId === clientId ? { ...m, failed: true } : m));
    }
  };

  /**
   * 连发多条的共用写入器（2026/9/19）。
   * 主发送和语音发送都用它 —— 之前两处各抄一份，结果语音那处引用了不存在的变量直接报错。
   */
  const createBubbleWriter = (replyId, reasoningRequested, reasoningLevel) => {
    const splitter = createBubbleSplitter();
    const finished = [];
    let tail = "";
    const firstId = firstBubbleId(replyId);
    const gen = ++playGenRef.current;
    let bodyUnlocked = !reasoningRequested;
    let revealed = 0;
    let playing = false;
    let playTimer = 0;
    let ended = false;
    const startedAt = Date.now();
    const upsert = (bubbleId, text, extra = {}) => {
      setMsgs((prev) => {
        const existing = prev.find((m) => m._id === bubbleId);
        const isFirst = bubbleId === firstId;
        if (existing) {
          return prev.map((m) => m._id === bubbleId ? { ...m, text, ...extra } : m);
        }
        return [...prev, {
          who: "her", type: "text", text, time: "", _id: bubbleId, _holdBody: true,
          ...(isFirst && reasoningRequested ? { reasoningRequested: true, reasoningPending: true, reasoningLevel, reasoningStartedAt: startedAt } : {}),
          ...extra,
        }];
      });
    };
    const playNext = () => {
      if (playGenRef.current !== gen) return;
      if (!bodyUnlocked || playing) return;
      if (revealed >= finished.length) {
        setTurnTyping(!ended);
        return;
      }
      playing = true;
      setTurnTyping(true);
      const delay = revealed === 0 ? 560 : 520 + Math.floor(Math.random() * 480);
      playTimer = setTimeout(() => {
        if (playGenRef.current !== gen) return;
        const bubbleId = replyId + "_" + revealed;
        upsert(bubbleId, finished[revealed], { _holdBody: false, _streaming: false, time: now() });
        revealed += 1;
        playing = false;
        if (revealed < finished.length) playNext();
        else setTurnTyping(false);
      }, delay);
    };
    if (reasoningRequested) upsert(firstId, "", { _holdBody: true });
    else setTurnTyping(true);
    return {
      splitter,
      emitted: finished,
      unlockBody() {
        if (bodyUnlocked) return;
        bodyUnlocked = true;
        setMsgs((prev) => prev.map((m) => m._id === firstId ? { ...m, reasoningPending: false } : m));
        playNext();
      },
      finish(text) {
        const bubbleId = replyId + "_" + finished.length;
        finished.push(text);
        tail = "";
        upsert(bubbleId, text, { _holdBody: true });
        playNext();
      },
      updateTail(text) {
        tail = text;
      },
      flushTail() {
        const rest = tail.trim();
        tail = "";
        if (rest) {
          const bubbleId = replyId + "_" + finished.length;
          finished.push(rest);
          upsert(bubbleId, rest, { _holdBody: true });
          playNext();
        }
      },
      end() {
        ended = true;
        playNext();
      },
      stop() {
        clearTimeout(playTimer);
        if (playGenRef.current === gen) setTurnTyping(false);
      },
    };
  };
  const paintTurnReasoning = (replyId, think, requested, extra = {}) => {
    setMsgs((p) => applyTurnReasoning(p, replyId, {
      think,
      requested,
      pending: Boolean(extra.pending),
      unavailable: Boolean(extra.unavailable),
      streaming: extra.streaming,
    }));
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
    setLive2dScene(getChatLive2DState([{ who: "me", text: transcript || "" }], { isResponding: true }).scene);
    setLive2dActive(true);

    /**
     * 无论识别成功与否都发送；无识别时留一条中性记录。
     *
     * ★ 2026/9/21 去毒：原来这里写的是「…这条没有转出文字，你听不到内容」。
     *   它会被存进库、下一轮当成 **user 消息**进上下文，等于用户亲口告诉模型
     *   「你听不到内容」。测试角色消息少，这条一直在最近 20 条窗口里，模型就把
     *   它当成了自己的人格设定 —— 语音明明识别成功、思考里也读到了字，正文却
     *   还在回「你发的语音我看不见内容」（线上库实测）。
     *
     *   现在正文只陈述"这一条当时没转成文字"这个事实；「该怎么办」交给系统提示词，
     *   不让失败记录变成人格暗示。
     */
    const textForAI = transcript || "（他发来一条语音，这次没能转成文字）";

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
      const writer = createBubbleWriter(replyId, reasoningRequested, reasoningLevel);
      await streamAssistantReply(roleId, {
        content: textForAI,
        role: "user",
        // ★ 2026/9/17：带 voice，否则后端把"刚存下的这一轮"摘不干净，同一句会被推两遍
        message_type: "voice",
        skip_server_persistence: true,
        ...(modelChoice.credentialId && modelChoice.modelId ? { credential_id: modelChoice.credentialId, model_id: modelChoice.modelId } : {}),
        ...(modelChoice.thinkLevel && modelChoice.thinkLevel !== "off" ? { thinking_level: modelChoice.thinkLevel } : {}),
      }, {
        onToken: (token) => {
          fullReply += token;
          writer.unlockBody();
          for (const ready of writer.splitter.push(token)) writer.finish(ready);
          writer.updateTail(writer.splitter.pending());
        },
        /**
         * ★ 2026/9/17：真思考流式到达（开了思考等级才有）。
         *   它直接写进 think，也就是「她在想什么」里显示的内容。
         */
        onReasoning: (delta) => {
          fullInnerOs += delta;
          paintTurnReasoning(replyId, fullInnerOs, reasoningRequested, { pending: true });
        },
        onInnerOsError: () => {
          paintTurnReasoning(replyId, fullInnerOs, reasoningRequested, { unavailable: true });
        },
        onError: (err) => { setTyping(false); setChatError(String(err)); },
      });
      setTyping(false);
      for (const rest of writer.splitter.flush()) writer.finish(rest);
      writer.flushTail();
      writer.unlockBody();
      writer.end();
      paintTurnReasoning(replyId, fullInnerOs, reasoningRequested, {
        streaming: false,
        pending: false,
        unavailable: reasoningRequested && !fullInnerOs.trim(),
      });

      if (!fullReply.trim()) return;

      // 先保存文字回复，云端语音需要用真实消息 ID 生成并持久化音频。
      let savedReply = null;
      // 2026/9/19：语音回复也逐条落库，刷新后仍是一条一条；思考只挂第一条。
      const voiceBubbles = writer.emitted.length ? writer.emitted : splitReplyIntoBubbles(fullReply);
      try {
        for (let i = 0; i < voiceBubbles.length; i++) {
          const savedOne = await saveMessage(roleId, {
            role: "assistant",
            content: voiceBubbles[i],
            ...(i === 0 && fullInnerOs.trim() ? { reasoning_summary: fullInnerOs } : {}),
          });
          if (i === 0 && savedOne?.item?.id) savedReply = savedOne;
          if (savedOne?.item?.id) {
            const bubbleId = replyId + "_" + i;
            setMsgs((p) => p.map((m) => m._id === bubbleId ? { ...m, id: savedOne.item.id } : m));
          }
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
    } finally {
      setLive2dActive(false);
    }
  };

  const searched = q.trim() ? msgs.filter((m) => (m.text || "").includes(q.trim())) : null;
  const shown = annotateConsecutiveGroups(q.trim() ? searched : getChatHistoryWindow(msgs, historyWindow));
  const hasMoreHistory = historyWindow < historyMessageCount || historyHasMore;
  const canSend = Boolean(draft.trim() || atts.length > 0);

  return (
    <div className="screen chat-screen anim-screen">
      {/* 常驻立绘 — 当前角色只保留一个舞台，点击后切换为全屏陪伴视图 */}
      {(showFig || big) && <ChatFigure agent={agent} figSrc={figSrc} expanded={big} live2dState={live2dState} live2dReady={historyReady} onOpen={() => setBig(true)} onClose={closeBig} />}

      <header className="chat-top">
        <button className="ct-back" onClick={onBack} aria-label="返回聊天列表" title="返回聊天列表"><Icon name="back" /></button>
        <div className="ct-avatar" role="button" tabIndex={0} aria-label={`查看${agent.name}的立绘`} onClick={() => setBig(true)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setBig(true); }}><img src={agent.avatar} alt="" onError={fallbackToDefaultRoleAvatar} />{agent.online && <span className="cl-online" />}</div>
        <div className="ct-info">
          <div className="ct-name">{agent.name}</div>
          <button className="ct-model" onClick={() => setModelOpen(!modelOpen)} aria-label="切换聊天模型">
            <Icon name="cpu" /> {modelLabel}<Icon name="chevronD" className={"cm-chev" + (modelOpen ? " open" : "")} />
          </button>
        </div>
        {/* ★ 2026/9/17 方案D：页头只多一个脑图标；点它只改思考等级，不拉模型列表。 */}
        <button
          className={"ct-ic ct-think" + (normalizeInnerOsLevel(modelChoice?.thinkLevel) !== "off" ? " on" : "")}
          onClick={() => setThinkOpen(true)}
          aria-label="思考等级"
          title="思考等级（不用等模型列表）"
        ><Icon name="brain" /></button>
        <button className="ct-ic" onClick={() => setMoreOpen(!moreOpen)} style={moreOpen ? { color: "var(--rose)" } : null} aria-label="更多聊天操作" title="更多聊天操作"><Icon name="more" /></button>
      </header>

      {moreOpen && (
        <div className="chat-more-menu" onClick={() => setMoreOpen(false)}>
          <div className="cmm-inner" onClick={(e) => e.stopPropagation()}>
            <button className="cmm-item" onClick={() => { setSearching(!searching); setMoreOpen(false); }}>
              <Icon name="search" /><span>{searching ? "收起搜索" : "搜索聊天记录"}</span>
            </button>
            <button className="cmm-item" onClick={() => { setShowFig(!showFig); setMoreOpen(false); }}>
              <Icon name="spark" /><span>{showFig ? "收起立绘" : "叫她出来"}</span>
            </button>
            <button className="cmm-item danger" onClick={() => { clearChat(); setMoreOpen(false); }}>
              <Icon name="trash" /><span>清空对话</span>
            </button>
          </div>
        </div>
      )}

      {modelOpen && (
        <ModelPanel current={modelChoice} onPick={saveModelChoice} onClose={() => setModelOpen(false)} />
      )}

      {thinkOpen && (
        <ThinkPanel current={modelChoice} onPick={saveModelChoice} onClose={() => setThinkOpen(false)} />
      )}

      {searching && (
        <div className="chat-search">
          <Icon name="search" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索和她的聊天记录…" />
          {q && <button onClick={() => setQ("")} aria-label="清空搜索">×</button>}
        </div>
      )}

      <div className="msg-area" ref={areaRef} onScroll={loadOlderMessages}>
        {q.trim() && <div className="search-note">找到 {searched.filter((m) => m.type !== "time").length} 条包含"{q.trim()}"的记录</div>}
        {!q.trim() && hasMoreHistory && <div className="hist-more" role="status">↑ 上滑加载更早的消息<span className="hist-more-s">已显示最近 {Math.min(historyWindow, historyMessageCount)} 条</span></div>}
        {shown.map((m) => (m.type === "time" && q.trim()) ? null : <MemoBubble key={getChatRenderKey(m)} m={m} agent={agent} tts={voiceSettings.enabled && !q.trim()} voice={voiceSettings} myAvatar={myAvatar} onDelete={deleteMsg} onOpenImage={setPreviewImage} onRetry={retryMessage} />)}
        {typing && !q.trim() && !turnTyping && <Typing agent={agent} />}
        {turnTyping && !q.trim() && (
          <div className="row her continue">
            <div className="row-avatar ghost"><img src={agent.avatar} alt="" onError={fallbackToDefaultRoleAvatar} /></div>
            <div className="her-stack">
              <div className="bubble her-bubble typing"><span /><span /><span /></div>
            </div>
          </div>
        )}
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
                <img src={assetUrl(src)} alt="" />
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
            /* 语音模式：点一下转文字 / 按住发语音（2026/9/19 改） */
            <>
              <VoiceTalkButton
                disabled={typing}
                onTranscript={(text) => {
                  setDraft((d) => (d ? d + " " : "") + text);
                  setVoiceMode(false);
                }}
                onVoice={async ({ blob, durationMs, transcript: readyText }) => {
                  try {
                    // 按住发送也必须转写。Android 优先用按下时已经在听的手机识别；没有字再问服务器。
                    const [audioUrl, transcript] = await Promise.all([
                      uploadVoice(blob),
                      String(readyText || "").trim()
                        ? Promise.resolve(String(readyText).trim())
                        : transcribeOnServer(blob).catch(() => ""),
                    ]);
                    await sendVoice({
                      audioUrl,
                      dur: Math.max(1, Math.round(durationMs / 1000)),
                      transcript: transcript || "",
                      recognitionError: transcript ? "" : "这条语音没转出文字",
                    });
                  } catch {
                    setChatError("语音没发出去，再试一次");
                  }
                }}
                onError={(message) => setChatError(message)}
              />
              <button className="ib-tool ib-voice-sticker" onClick={() => setStickerOpen(!stickerOpen)} style={stickerOpen ? { color: "var(--rose)" } : null} aria-label="打开表情包" title="打开表情包"><Icon name="paw" /></button>
            </>
          ) : (
            /* 文字模式：原有布局 */
            <>
              <button className="ib-tool ib-desktop-tool" onClick={() => setCalling(true)} aria-label="开始实时通话" title="开始实时通话"><Icon name="phone" /></button>
              <button className="ib-tool ib-desktop-tool" onClick={openPicker} disabled={uploading} style={(atts.length || uploading) ? { color: "var(--rose)" } : null} aria-label="选择图片" title="选择图片"><Icon name="image" /></button>
              <button className={"ib-tool ib-desktop-tool" + (guidedImageOpen ? " on" : "")} onClick={openGuidedImage} disabled={typing || uploading || guidedImageBusy} aria-label="引导画图" title="不用写提示词，选几个选项让她画"><Icon name="spark" /></button>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={onPickImage} />
              <button className="ib-tool ib-desktop-tool" onClick={() => setStickerOpen(!stickerOpen)} style={stickerOpen ? { color: "var(--rose)" } : null} aria-label="打开表情包" title="打开表情包"><Icon name="paw" /></button>
              <div className="ib-field">
                <textarea ref={draftRef} value={draft} rows={1} enterKeyHint="send" onFocus={() => { setStickerOpen(false); setInputActionsOpen(false); }}
                  onChange={(e) => { setDraft(e.target.value); resizeDraft(e.currentTarget); }}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                  placeholder={typing ? `${agent.name}正在回复…` : `和${agent.name}说点什么…`} />
              </div>
              <button className={"ib-tool ib-mobile-action" + (stickerOpen ? " on" : "")} onClick={() => { setStickerOpen(!stickerOpen); setInputActionsOpen(false); }} aria-label="打开表情包" title="打开表情包"><Icon name="paw" /></button>
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
            <button className="mobile-input-action" onClick={() => { setStickerOpen(true); setInputActionsOpen(false); }} aria-label="打开表情包"><Icon name="paw" /><span>表情</span></button>
          </div>
        )}
      </footer>

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
          {err && <span style={{ color: "var(--danger)" }}>{err}</span>}
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
