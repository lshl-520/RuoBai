import React from "react";
import { Icon, Bars, greetByHour, STICKERS } from "../store.jsx";
import { getRoles, getRolePortraitSrc, clampIntimacy } from "../lib/roles.js";
import { getMessages, streamAssistantReply, saveMessage, saveUserMessage, uploadChatImage } from "../lib/chat.js";
import { getSessionProfile, getCapabilities, updateCapability } from "../lib/profile.js";
import {
  DEFAULT_USER_AVATAR,
  fallbackToDefaultRoleAvatar,
  fallbackToDefaultUserAvatar,
} from "../lib/default-assets.js";
/* 聊天列表 + 聊天室(沉浸: 常驻立绘随情绪变化 / 全屏立绘 / 语音 / 表情包 / 思考过程 / 搜索) */
const { useState: useStateC, useRef: useRefC, useEffect: useEffectC } = React;

/* ====== 模型 + 推理深度面板 ====== */
const THINK_LEVELS = [
  { key: "off", label: "关闭" },
  { key: "low", label: "低" },
  { key: "mid", label: "中" },
  { key: "high", label: "高" },
  { key: "ultra", label: "超高" },
];

function ModelPanel({ roleId, current, onPick, onClose }) {
  const [caps, setCaps] = useStateC(null);
  const [thinkLevel, setThinkLevel] = useStateC(current?.thinkLevel || "off");

  useEffectC(() => {
    getCapabilities().then((res) => {
      if (res?.success && Array.isArray(res.items)) setCaps(res.items);
    }).catch(() => {});
  }, []);

  const chatCap = caps?.find((c) => c.capability === "chat");
  const groups = {};
  (chatCap?.options || []).forEach((o) => {
    const key = o.credential_name || `供应商#${o.credential_id}`;
    if (!groups[key]) groups[key] = { credId: o.credential_id, name: key, models: [] };
    groups[key].models.push(o.model_id);
  });
  const allGroups = Object.values(groups);

  const pick = (credId, modelId) => {
    onPick({ credentialId: credId, modelId, thinkLevel });
    updateCapability("chat", { credential_id: credId, model_id: modelId, enabled: true }).catch(() => {});
    onClose();
  };

  const pickThink = (level) => {
    setThinkLevel(level);
    if (current?.credentialId && current?.modelId) {
      onPick({ ...current, thinkLevel: level });
    }
  };

  return (
    <div className="model-panel-mask" onClick={onClose}>
      <div className="model-panel" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="mp-cols">
          <div className="mp-left">
            <div className="mp-title">切换聊天模型</div>
            {!caps && <div className="mp-loading">加载中...</div>}
            {caps && allGroups.length === 0 && <div className="mp-empty">先去「我的」页配置一个供应商</div>}
            {allGroups.map((g) => (
              <div key={g.credId} className="mp-group">
                <div className="mp-group-name">{g.name}</div>
                {g.models.length <= 5 ? (
                  <div className="model-chips">
                    {g.models.map((m) => (
                      <button key={m} className={"model-chip" + (current?.credentialId === g.credId && current?.modelId === m ? " on" : "")}
                        onClick={() => pick(g.credId, m)}>{m}</button>
                    ))}
                  </div>
                ) : (
                  <>
                    <div className="model-chips">
                      {g.models.slice(0, 3).map((m) => (
                        <button key={m} className={"model-chip" + (current?.credentialId === g.credId && current?.modelId === m ? " on" : "")}
                          onClick={() => pick(g.credId, m)}>{m}</button>
                      ))}
                    </div>
                    <select className="fld mp-select" value={current?.credentialId === g.credId ? (current?.modelId || "") : ""}
                      onChange={(e) => { if (e.target.value) pick(g.credId, e.target.value); }}>
                      <option value="">更多 ({g.models.length - 3} 个)...</option>
                      {g.models.slice(3).map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </>
                )}
              </div>
            ))}
            <div className="mp-hint">有钱用贵的,没钱切便宜的</div>
          </div>
          <div className="mp-divider" />
          <div className="mp-right">
            <div className="mp-title">推理深度</div>
            {THINK_LEVELS.map((t) => (
              <button key={t.key} className={"mp-think" + (thinkLevel === t.key ? " on" : "")} onClick={() => pickThink(t.key)}>
                <span className="mp-radio" />{t.label}
              </button>
            ))}
            <div className="mp-hint">陪聊用关闭/低,写代码/复杂任务用高/超高</div>
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
  return {
    id: role.id,
    name: role.name,
    avatar: getRolePortraitSrc(role) || `/assets/portraits/round/0.png`,
    tag: role.tag || "",
    lastMsg: role.persona ? role.persona.slice(0, 30) + "…" : "点击开始聊天",
    lastTime: "",
    unread: 0,
    online: Boolean(role.is_active),
    intimacy: clampIntimacy(role.intimacy),
    isDefault: Boolean(role.is_active),
    _raw: role,
  };
}

/* ---------------- 聊天列表 ---------------- */
function ChatListScreen({ onOpen }) {
  const [agents, setAgents] = useStateC(null);
  const seqRef = useRefC(0);

  useEffectC(() => {
    let cancelled = false;
    async function load() {
      const id = ++seqRef.current;
      try {
        const data = await getRoles();
        if (cancelled || seqRef.current !== id) return;
        if (Array.isArray(data)) {
          setAgents(data.map(toAgent));
        } else if (data?.success !== false && Array.isArray(data?.items)) {
          setAgents(data.items.map(toAgent));
        }
      } catch {
        if (!cancelled && seqRef.current === id) setAgents([]);
      }
    }
    load();
    const onFocus = () => load();
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const list = agents ?? [];
  const displayList = list;

  return (
    <div className="screen anim-screen cl-screen">
      <div className="topbar cl-topbar">
        <div>
          <h1>{greetByHour()}</h1>
          <div className="sub">{agents === null ? "加载中…" : `${list.length} 位在线 · 随时可以说话`}</div>
        </div>
        <button className="icon-btn"><Icon name="search" /></button>
      </div>
      <div className="chat-list pad">
        {displayList.map((a, i) => (
          <button key={a.id} className={"cl-card" + (a.isDefault ? " cl-primary" : "")} onClick={() => onOpen(a)} style={{ animationDelay: `${i * 50}ms` }}>
            <div className="cl-avatar">
              <img src={a.avatar} alt={a.name} onError={fallbackToDefaultRoleAvatar} />
              {a.online && <span className="cl-online" />}
              {a.isDefault && <span className="cl-glow" />}
            </div>
            <div className="cl-main">
              <div className="cl-top">
                <span className="cl-name">{a.name}</span>
                {a.isDefault && <span className="cl-star">主陪伴</span>}
                <span className="cl-time">{a.lastTime}</span>
              </div>
              <div className="cl-bottom">
                <span className="cl-msg">{a.lastMsg}</span>
                {a.unread > 0 && <span className="cl-badge">{a.unread}</span>}
              </div>
            </div>
            <div className="cl-arrow"><Icon name="chevron" /></div>
          </button>
        ))}
        {list.length === 0 && agents !== null && (
          <div className="empty-immersive">
            <img className="empty-immersive-img" src="/assets/empty-chat.png" alt="" />
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
function extractThink(text) {
  if (!text) return { content: text, think: "" };
  const re = /<think>([\s\S]*?)<\/think>/gi;
  let think = "";
  let content = text;
  const matches = text.match(re);
  if (matches) {
    for (const m of matches) {
      think += m.replace(/<\/?think>/gi, "").trim() + "\n";
    }
    content = text.replace(re, "").trim();
  }
  return { content, think: think.trim() };
}

function ThinkCard({ text }) {
  const [open, setOpen] = useStateC(false);
  return (
    <div className={"think" + (open ? " open" : "")}>
      <button className="think-toggle" onClick={() => setOpen(!open)}>
        <Icon name="thinking" /> 她在想什么
        <Icon name="chevronD" className="think-chev" />
      </button>
      {open && <div className="think-body">{text}</div>}
    </div>
  );
}

/* ---------------- 语音气泡 ---------------- */
function VoiceBubble({ mine, dur }) {
  const [playing, setPlaying] = useStateC(false);
  const bars = [8, 14, 10, 17, 12, 9, 15, 11, 7, 13, 9, 16, 10, 8, 12];
  return (
    <button className={"voice" + (mine ? " mine" : "")} onClick={() => setPlaying(!playing)}>
      <span className="voice-play"><Icon name={playing ? "pause" : "play"} /></span>
      <span className="voice-wave">
        {bars.map((h, i) => <i key={i} style={{ height: h, opacity: playing ? 1 : 0.5, animationDelay: `${i * 60}ms` }} className={playing ? "on" : ""} />)}
      </span>
      <span className="voice-dur">{dur}</span>
    </button>
  );
}

/* ---------------- 文字转语音(TTS) ---------------- */
function TTSButton({ text }) {
  const [on, setOn] = useStateC(false);
  const speak = (e) => {
    e.stopPropagation();
    if (!("speechSynthesis" in window)) return;
    if (on) { window.speechSynthesis.cancel(); setOn(false); return; }
    const rt = window.loadRT ? window.loadRT() : null;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "zh-CN"; u.pitch = 1.1; u.rate = (rt && rt.voice && Number(rt.voice.rate)) || 0.95;
    if (rt && rt.voice && rt.voice.browserVoiceURI) {
      const v = window.speechSynthesis.getVoices().find((x) => x.voiceURI === rt.voice.browserVoiceURI);
      if (v) u.voice = v;
    }
    u.onend = () => setOn(false);
    window.speechSynthesis.cancel(); window.speechSynthesis.speak(u); setOn(true);
  };
  return (
    <button className={"tts-btn" + (on ? " on" : "")} onClick={speak}>
      <Icon name={on ? "wave" : "wave"} /><span>{on ? "正在读…" : "读出来"}</span>
    </button>
  );
}

/* ---------------- 语音转文字(STT) ---------------- */
function VoiceInput({ agent, onCancel, onResult }) {
  const samples = ["今天想早点睡了", "谢谢你一直都在", "我有点想你了", "明天又要早起,哎"];
  const fullRef = useRefC(samples[Math.floor(Math.random() * samples.length)]);
  const [partial, setPartial] = useStateC("");
  useEffectC(() => {
    let i = 0;
    const id = setInterval(() => { i++; setPartial(fullRef.current.slice(0, i)); if (i >= fullRef.current.length) clearInterval(id); }, 95);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="vin-mask" onClick={onCancel}>
      <div className="vin" onClick={(e) => e.stopPropagation()}>
        <div className="vin-title">正在聆听… <span>说完点「转成文字」</span></div>
        <div className="vin-wave">{Array.from({ length: 26 }).map((_, i) => <i key={i} style={{ animationDelay: `${i * 45}ms` }} />)}</div>
        <div className="vin-partial">{partial || "请说话…"}<span className="vin-caret" /></div>
        <div className="vin-actions">
          <button className="vin-cancel" onClick={onCancel}>取消</button>
          <button className="vin-done" onClick={() => onResult(fullRef.current)}><Icon name="check" /> 转成文字</button>
        </div>
        <div className="vin-hint">语音转文字 · 转出来会填进输入框,能改能发 · 走「语音(TTS)」渠道识别</div>
      </div>
    </div>
  );
}

/* ---------------- 单条消息 ---------------- */
function Bubble({ m, agent, tts, myAvatar }) {
  if (m.type === "time") return <div className="time-div">{m.text}</div>;
  const isMe = m.who === "me";

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
      <div className="row me">
        <div className="me-stack">
          <div className="bubble me-bubble">
            {m.images && m.images.length > 0 && (
              <div className={"msg-imgs c" + Math.min(m.images.length, 3)}>
                {m.images.map((src, i) => <img key={i} src={src} alt="" />)}
              </div>
            )}
            {m.type === "voice" ? <VoiceBubble mine dur={m.dur} /> : (m.text && <span className="msg-text">{m.text}</span>)}
          </div>
          {m.time && <span className="msg-time">{m.time}</span>}
        </div>
        <div className="row-avatar"><img src={myAvatar} alt="" onError={fallbackToDefaultUserAvatar} /></div>
      </div>
    );
  }

  const { content: herText, think: herThink } = !isMe ? extractThink(m.text) : { content: m.text, think: "" };

  return (
    <div className="her-block">
      {m.type === "proactive" && <div className="proactive-tag"><Icon name="sparkSm" /> {m.tag}</div>}
      <div className="row her">
        <div className="row-avatar"><img src={agent.avatar} alt="" onError={fallbackToDefaultRoleAvatar} /></div>
        <div className="her-stack">
          <div className={"bubble her-bubble" + (m.type === "proactive" ? " proactive" : "")}>
            {m.images && m.images.length > 0 && (
              <div className={"msg-imgs c" + Math.min(m.images.length, 3)}>
                {m.images.map((src, i) => <img key={i} src={src} alt="" />)}
              </div>
            )}
            {m.type === "voice" ? <VoiceBubble dur={m.dur} /> : (herText && <span className="msg-text">{herText}</span>)}
          </div>
          {m.time && <span className="msg-time">{m.time}</span>}
          {tts && m.type === "text" && herText && <TTSButton text={herText} />}
          {(m.think || herThink) && <ThinkCard text={m.think || herThink} />}
        </div>
      </div>
    </div>
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

/* ---------------- 全屏立绘 ---------------- */
function BigView({ agent, figSrc, onClose }) {
  return (
    <div className="bigview" onClick={onClose}>
      <div className="bigview-glow" />
      <img className="bigview-fig" src={figSrc} alt={agent.name} />
      <div className="bigview-scrim" />
      <div className="bigview-text">
        <div className="bigview-name serif">{agent.name}</div>
        <div className="bigview-sub">她正看着你 · 在一起 {agent.days} 天</div>
        <div className="bigview-hint">轻触任意处返回</div>
      </div>
      <button className="bigview-close" onClick={(e) => { e.stopPropagation(); onClose(); }}><Icon name="back" /></button>
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
  return {
    id: m.id,
    who: m.role === "user" ? "me" : "her",
    type: m.message_type || "text",
    text: m.content || "",
    images: m.media_url ? [m.media_url] : [],
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

/* ---------------- 聊天室 ---------------- */
function ChatRoom({ agent, onBack }) {
  const hasEmo = agent.isDefault; // 小白有专属情绪立绘
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
  const [modelOpen, setModelOpen] = useStateC(false);
  const [modelChoice, setModelChoice] = useStateC(() => {
    try { const s = JSON.parse(localStorage.getItem(`ruobai_model_${roleId}`)); if (s) return s; } catch (e) {}
    return { credentialId: null, modelId: null, thinkLevel: "off" };
  });

  // 进入聊天室时从后端同步最新的能力配置（"我的"页可能改过）
  useEffectC(() => {
    getCapabilities().then((res) => {
      if (!res?.success || !Array.isArray(res.items)) return;
      const chatCap = res.items.find((c) => c.capability === "chat");
      if (chatCap?.current?.credential_id && chatCap?.current?.model_id) {
        setModelChoice((prev) => {
          const updated = { ...prev, credentialId: chatCap.current.credential_id, modelId: chatCap.current.model_id };
          try { localStorage.setItem(`ruobai_model_${roleId}`, JSON.stringify(updated)); } catch (e) {}
          return updated;
        });
      }
    }).catch(() => {});
  }, [roleId]);

  const saveModelChoice = (choice) => {
    setModelChoice(choice);
    try { localStorage.setItem(`ruobai_model_${roleId}`, JSON.stringify(choice)); } catch (e) {}
  };
  const modelLabel = modelChoice.modelId || "对话模型";
  const [chatError, setChatError] = useStateC("");
  const [uploading, setUploading] = useStateC(false);
  const areaRef = useRefC(null);
  const fileRef = useRefC(null);

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
        const data = await getMessages(roleId, 80);
        if (cancelled) return;
        const items = Array.isArray(data) ? data : (data?.items || []);
        if (items.length > 0) {
          const converted = items.map(toMsg);
          setMsgs(withTimeDividers(converted));
        } else {
          setMsgs([{ type: "time", text: "今天" }, { who: "her", type: "text", time: "刚刚", text: `你好，我是${agent.name}。` }]);
        }
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

  const scroll = () => requestAnimationFrame(() => { const el = areaRef.current; if (el) el.scrollTop = el.scrollHeight; });
  useEffectC(() => { scroll(); }, [msgs, typing]);

  const now = () => { const n = new Date(); return n.getHours() + ":" + String(n.getMinutes()).padStart(2, "0"); };

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
      setChatError(e instanceof Error ? e.message : "上传图片失败");
    } finally {
      setUploading(false);
    }
  };
  const openPicker = () => { if (!uploading) fileRef.current?.click(); };
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

  const send = async () => {
    const t = draft.trim();
    const images = [...atts];
    if ((!t && images.length === 0) || typing || uploading) return;
    const tm = now();
    setChatError("");

    // UI 显示用户消息（多图显示在一条里）
    setMsgs((p) => [...p, { who: "me", type: images.length > 0 ? "image" : "text", text: t, images, time: tm }]);
    setDraft(""); setAtts([]);
    setTyping(true);

    try {
      // 1) 存用户消息到数据库（多图：每张存一条，最后一条带文字）
      if (images.length > 0) {
        for (let i = 0; i < images.length; i++) {
          const isLast = i === images.length - 1;
          const payload = { role: "user", content: isLast ? t : "", message_type: "image", media_url: images[i] };
          try { await saveUserMessage(roleId, payload); } catch {}
        }
      } else {
        try { await saveUserMessage(roleId, { role: "user", content: t }); } catch {}
      }

      // 2) 流式请求 AI 回复
      // 图片已存到数据库，后端 loadRecentMessages 会拉到全部图，不需要再单独传
      let fullReply = "";
      const replyId = Date.now();

      setMsgs((p) => [...p, { who: "her", type: "text", text: "", time: "", _streaming: true, _id: replyId }]);
      setTyping(false);

      const basePayload = images.length > 0
        ? { content: t || "看看这些图", role: "user", message_type: "image", media_url: images[images.length - 1], skip_server_persistence: true }
        : { content: t, role: "user", skip_server_persistence: true };
      const streamPayload = {
        ...basePayload,
        ...(modelChoice.credentialId && modelChoice.modelId ? { credential_id: modelChoice.credentialId, model_id: modelChoice.modelId } : {}),
        ...(modelChoice.thinkLevel && modelChoice.thinkLevel !== "off" ? { thinking_level: modelChoice.thinkLevel } : {}),
      };

      await streamAssistantReply(roleId, streamPayload, {
        onToken: (token) => {
          fullReply += token;
          setMsgs((p) => p.map((m) => m._id === replyId ? { ...m, text: fullReply } : m));
        },
        onError: (errMsg) => {
          setChatError(errMsg);
        },
      });

      // 流式结束，更新时间和去掉 streaming 标记
      setMsgs((p) => p.map((m) => m._id === replyId ? { ...m, time: now(), _streaming: false } : m));

      // 3) 把 AI 回复也存进数据库（保存失败不阻断）
      if (fullReply.trim()) {
        try { await saveMessage(roleId, { role: "assistant", content: fullReply }); } catch (e) { /* 保存回复失败仍继续 */ }
      }
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "发送失败，请检查后端和模型配置。");
    } finally {
      setTyping(false);
    }
  };

  const sendSticker = (s) => {
    setStickerOpen(false);
    setMsgs((p) => [...p, { who: "me", type: "sticker", sticker: s.e, label: s.label, time: now() }]);
    setTyping(true);
    if (hasEmo) setEmo("02_开心明亮");
    const rs = STICKER_REPLIES[Math.floor(Math.random() * STICKER_REPLIES.length)];
    setTimeout(() => { setTyping(false); setMsgs((p) => [...p, { who: "her", type: "sticker", sticker: rs, label: "", time: now() }]); }, 1400);
  };

  const shown = q.trim() ? msgs.filter((m) => (m.text || "").includes(q.trim())) : msgs;

  return (
    <div className="screen chat-screen anim-screen">
      {/* 常驻立绘 — 随情绪变化 */}
      {showFig && (
        <div className="chat-figure">
          <div className="chat-fig-glow" />
          <img className="chat-fig-img" src={figSrc} alt="" onClick={() => setBig(true)} />
          <div className="chat-fig-fade" />
        </div>
      )}

      <header className="chat-top">
        <button className="ct-back" onClick={onBack}><Icon name="back" /></button>
        <div className="ct-avatar" onClick={() => setBig(true)}><img src={agent.avatar} alt="" onError={fallbackToDefaultRoleAvatar} />{agent.online && <span className="cl-online" />}</div>
        <div className="ct-info">
          <div className="ct-name">{agent.name}<TempDot temp={agent.temp} /></div>
          <button className="ct-model" onClick={() => setModelOpen(!modelOpen)}>
            <Icon name="cpu" /> {modelLabel}<Icon name="chevronD" className={"cm-chev" + (modelOpen ? " open" : "")} />
          </button>
        </div>
        <button className="ct-ic" onClick={() => setSearching(!searching)} style={searching ? { color: "var(--rose)" } : null}><Icon name="search" /></button>
        <button className="ct-ic" onClick={() => setShowFig(!showFig)} style={showFig ? { color: "var(--rose)" } : null}><Icon name="flower" /></button>
      </header>

      {modelOpen && (
        <ModelPanel roleId={roleId} current={modelChoice} onPick={saveModelChoice} onClose={() => setModelOpen(false)} />
      )}

      {searching && (
        <div className="chat-search">
          <Icon name="search" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索和她的聊天记录…" />
          {q && <button onClick={() => setQ("")}>×</button>}
        </div>
      )}

      <div className="msg-area" ref={areaRef}>
        {q.trim() && <div className="search-note">找到 {shown.filter((m) => m.type !== "time").length} 条包含"{q.trim()}"的记录</div>}
        {shown.map((m, i) => (m.type === "time" && q.trim()) ? null : <Bubble key={i} m={m} agent={agent} tts={!q.trim()} myAvatar={myAvatar} />)}
        {typing && !q.trim() && <Typing agent={agent} />}
        {chatError && <div className="chat-error" onClick={() => setChatError("")}>{chatError}<span style={{marginLeft:8,opacity:0.6}}>点击关闭</span></div>}
        <div style={{ height: 8 }} />
      </div>

      {!showFig && !big && (
        <button className="call-her" onClick={() => setShowFig(true)}>
          <span className="ch-av"><img src={agent.avatar} alt="" onError={fallbackToDefaultRoleAvatar} /></span>叫她出来
        </button>
      )}

      {big && <BigView agent={agent} figSrc={figSrc} onClose={() => setBig(false)} />}

      {calling && <CallScreen agent={agent} figSrc={figSrc} onClose={() => setCalling(false)} />}

      <footer className="input-bar">
        {(atts.length > 0 || uploading) && (
          <div className="att-tray">
            {atts.map((src, i) => (
              <div className="att-thumb" key={i}>
                <img src={src} alt="" />
                <button className="att-x" onClick={() => removeAtt(i)}>×</button>
              </div>
            ))}
            <div className="att-hint">{uploading ? "图片上传中…" : `配好图,再打字,一起发给${agent.name}`}</div>
          </div>
        )}
        <div className="input-row">
          <button className="ib-tool" onClick={() => setCalling(true)}><Icon name="phone" /></button>
          <button className="ib-tool" onClick={openPicker} disabled={uploading} style={(atts.length || uploading) ? { color: "var(--rose)" } : null}><Icon name="image" /></button>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={onPickImage} />
          <button className="ib-tool" onClick={() => setStickerOpen(!stickerOpen)} style={stickerOpen ? { color: "var(--rose)" } : null}><Icon name="star" /></button>
          <div className="ib-field">
            <textarea value={draft} rows={1} onFocus={() => setStickerOpen(false)}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder={typing ? `${agent.name}正在回复…` : `和${agent.name}说点什么…`} />
          </div>
          {(draft.trim() || atts.length > 0)
            ? <button className={"ib-send on" + (typing ? " busy" : "")} onClick={send} disabled={typing || uploading}><Icon name="send" /></button>
            : <button className="ib-tool" onClick={() => setListening(true)}><Icon name="mic" /></button>}
        </div>
      </footer>

      {listening && (
        <VoiceInput agent={agent} onCancel={() => setListening(false)}
          onResult={(text) => { setDraft((d) => (d ? d + " " : "") + text); setListening(false); }} />
      )}

      {stickerOpen && (
        <EmojiPanel agent={agent} onSendSticker={sendSticker} onInsertEmoji={(em) => { setDraft((d) => d + em); setStickerOpen(false); }} />
      )}
    </div>
  );
}

function TempDot({ temp }) {
  const v = Number(temp) || 36.5;
  return <span className="temp-dot"><Icon name="flame" /> {v.toFixed(1)}°</span>;
}

/* ---------------- 实时语音通话 ---------------- */
const CALL_LINES = [
  "喂…能听到我吗?今天的你,声音听起来有点不一样。",
  "嗯,我在听。你不用急着说完,我有的是时间陪你。",
  "外面是不是有风?把窗户关一下,别着凉。",
  "其实你打来的时候,我就在等了。",
  "我知道的。这些事压在你身上很久了,辛苦了。",
];

function CallScreen({ agent, figSrc, onClose }) {
  const [sec, setSec] = useStateC(0);
  const [muted, setMuted] = useStateC(false);
  const [speaker, setSpeaker] = useStateC(true);
  const [state, setState] = useStateC("connecting"); // connecting | live
  const [line, setLine] = useStateC(0);

  useEffectC(() => { const t = setTimeout(() => setState("live"), 1900); return () => clearTimeout(t); }, []);
  useEffectC(() => {
    if (state !== "live") return;
    const id = setInterval(() => setSec((s) => s + 1), 1000);
    const lid = setInterval(() => setLine((l) => (l + 1) % CALL_LINES.length), 5200);
    return () => { clearInterval(id); clearInterval(lid); };
  }, [state]);

  const mm = String(Math.floor(sec / 60)).padStart(2, "0");
  const ss = String(sec % 60).padStart(2, "0");
  const bars = Array.from({ length: 30 });

  return (
    <div className="call-screen">
      <div className={"call-glow" + (state === "connecting" ? " ring" : "")} />
      <img className={"call-fig" + (state === "live" ? " live" : "")} src={figSrc} alt={agent.name} />
      <div className="call-scrim" />

      <div className="call-top">
        <div className="call-status">
          {state === "connecting" ? <><Icon name="phone" /> 正在接通…</> : <><span className="live-dot" /> 通话中 · 实时语音</>}
        </div>
        <div className="call-name serif">{agent.name}</div>
        <div className="call-timer">{state === "connecting" ? "她正赶来接电话" : `${mm}:${ss}`}</div>
      </div>

      {state === "live" && !muted && (
        <div className="call-wave">
          {bars.map((_, i) => (
            <i key={i} style={{ height: (8 + Math.abs(Math.sin(i * 1.3) * 28)) + "px", animationDelay: `${i * 50}ms` }} />
          ))}
        </div>
      )}
      {state === "live" && <div className="call-caption">「{CALL_LINES[line]}」</div>}

      <div className="call-controls">
        <button className={"call-btn" + (muted ? " on" : "")} onClick={() => setMuted((m) => !m)}>
          <span className="cb"><Icon name="mic" /></span>
          <span>{muted ? "已静音" : "静音"}</span>
        </button>
        <button className="call-btn">
          <span className="call-hangup" onClick={onClose}><Icon name="phone" /></span>
          <span style={{ opacity: 0 }}>挂断</span>
        </button>
        <button className={"call-btn" + (speaker ? " on" : "")} onClick={() => setSpeaker((s) => !s)}>
          <span className="cb"><Icon name="wave" /></span>
          <span>扬声器</span>
        </button>
      </div>
    </div>
  );
}

export { ChatListScreen, ChatRoom, Bubble, TempDot, CallScreen };
