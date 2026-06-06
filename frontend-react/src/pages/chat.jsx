import React from "react";
import { Icon, Bars, greetByHour } from "../store.jsx";
import { getRoles, getRolePortraitSrc, clampIntimacy } from "../lib/roles.js";
/* 聊天列表 + 聊天室(沉浸: 常驻立绘随情绪变化 / 全屏立绘 / 语音 / 表情包 / 思考过程 / 搜索) */
const { useState: useStateC, useRef: useRefC, useEffect: useEffectC } = React;

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
function ChatListScreen({ agents: fallbackAgents, onOpen }) {
  const [agents, setAgents] = useStateC(null); // null = 加载中
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
        // 后端没开或未登录，保持 null 走兜底
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

  const list = agents ?? fallbackAgents;

  return (
    <div className="screen anim-screen">
      <div className="topbar">
        <div>
          <h1>{greetByHour()}</h1>
          <div className="sub">{agents === null ? "加载中…" : "她们都在,随时可以说话"}</div>
        </div>
        <button className="icon-btn"><Icon name="search" /></button>
      </div>
      <div className={list.length === 0 && agents !== null ? "chat-list" : "chat-list pad"}>
        {list.map((a) => (
          <button key={a.id} className="cl-item" onClick={() => onOpen(a)}>
            <div className="cl-avatar">
              <img src={a.avatar} alt={a.name} />
              {a.online && <span className="cl-online" />}
            </div>
            <div className="cl-main">
              <div className="cl-top">
                <span className="cl-name">{a.name}</span>
                <span className="cl-time">{a.lastTime}</span>
              </div>
              <div className="cl-bottom">
                <span className="cl-msg">{a.lastMsg}</span>
                {a.unread > 0 && <span className="cl-badge">{a.unread}</span>}
              </div>
            </div>
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
function Bubble({ m, agent, tts }) {
  if (m.type === "time") return <div className="time-div">{m.text}</div>;
  const isMe = m.who === "me";

  if (m.type === "sticker") {
    return (
      <div className={"row " + (isMe ? "me" : "her")}>
        {!isMe && <div className="row-avatar"><img src={agent.avatar} alt="" /></div>}
        <div className="sticker-wrap">
          <div className="sticker"><span className="st-emo">{m.sticker}</span>{m.label && <span className="st-label">{m.label}</span>}</div>
          {m.time && <span className="msg-time">{m.time}</span>}
        </div>
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
      </div>
    );
  }

  return (
    <div className="her-block">
      {m.type === "proactive" && <div className="proactive-tag"><Icon name="sparkSm" /> {m.tag}</div>}
      <div className="row her">
        <div className="row-avatar"><img src={agent.avatar} alt="" /></div>
        <div className="her-stack">
          <div className={"bubble her-bubble" + (m.type === "proactive" ? " proactive" : "")}>
            {m.images && m.images.length > 0 && (
              <div className={"msg-imgs c" + Math.min(m.images.length, 3)}>
                {m.images.map((src, i) => <img key={i} src={src} alt="" />)}
              </div>
            )}
            {m.type === "voice" ? <VoiceBubble dur={m.dur} /> : (m.text && <span className="msg-text">{m.text}</span>)}
          </div>
          {m.time && <span className="msg-time">{m.time}</span>}
          {tts && m.type === "text" && m.text && <TTSButton text={m.text} />}
          {m.think && <ThinkCard text={m.think} />}
        </div>
      </div>
    </div>
  );
}

function Typing({ agent }) {
  return (
    <div className="row her">
      <div className="row-avatar"><img src={agent.avatar} alt="" /></div>
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

const REPLIES = [
  { text: "嗯,我在。你慢慢说,我不打断。", emo: "01_默认温柔", think: "他主动开口了,这很珍贵。我要做的不是回应得多漂亮,是让他觉得说出来是安全的。" },
  { text: "听到了。这件事搁在你心里多久了?", emo: "05_关心担忧", think: "顺着他的情绪往下,而不是急着给建议。先把『多久』问出来,他自己也许会松动。" },
  { text: "没关系的。你不用现在就想明白,我陪你一起拖一会儿也行。", emo: "11_撒娇期待", think: "他要的是允许,不是答案。给他一个能喘气的缝隙。" },
];
const STICKER_REPLIES = ["🥰", "🥺", "😘", "🌙", "😋", "🌸"];

/* ---------------- 聊天室 ---------------- */
function ChatRoom({ agent, onBack }) {
  const hasEmo = agent.isDefault; // 小白有专属情绪立绘
  const base = (window.HISTORY && window.HISTORY[agent.id]) || (agent.id === 48 ? CHAT_48 : [
    { type: "time", text: "今天" },
    { who: "her", type: "text", time: "刚刚", text: `我是${agent.name}。${agent.tagline}`, think: "第一句话要像她的人——不是客服开场白,是她会说的话。" },
  ]);
  const [msgs, setMsgs] = useStateC(base);
  const [draft, setDraft] = useStateC("");
  const [typing, setTyping] = useStateC(false);
  const [showFig, setShowFig] = useStateC(true);
  const [big, setBig] = useStateC(false);
  const [stickerOpen, setStickerOpen] = useStateC(false);
  const [searching, setSearching] = useStateC(false);
  const [q, setQ] = useStateC("");
  const [emo, setEmo] = useStateC("01_默认温柔");
  const [calling, setCalling] = useStateC(false);
  const [atts, setAtts] = useStateC([]); // 待发送的图片附件
  const [listening, setListening] = useStateC(false); // 语音输入(STT)
  const [modelOpen, setModelOpen] = useStateC(false);
  const [routing, setRouting] = useStateC(() => (window.loadRT ? window.loadRT() : { chat: { channelId: "", model: "对话模型" } }));
  const areaRef = useRefC(null);

  const channels = window.loadCH ? window.loadCH() : [];
  const chatChannel = channels.find((c) => c.id === routing.chat.channelId);
  const chatModels = chatChannel ? (chatChannel.fetched?.length ? chatChannel.fetched : (window.CHANNEL_TYPES?.[chatChannel.type]?.models || [routing.chat.model])) : [routing.chat.model];
  const switchModel = (model) => {
    const next = { ...routing, chat: { ...routing.chat, model } };
    setRouting(next); setModelOpen(false);
    try { localStorage.setItem(window.LS_RT, JSON.stringify(next)); } catch (e) {}
  };

  const figSrc = hasEmo ? (EMO_SET[emo] || agent.cover) : agent.cover;

  const scroll = () => requestAnimationFrame(() => { const el = areaRef.current; if (el) el.scrollTop = el.scrollHeight; });
  useEffectC(() => { scroll(); }, [msgs, typing]);

  const now = () => { const n = new Date(); return n.getHours() + ":" + String(n.getMinutes()).padStart(2, "0"); };

  const SCENE_IMGS = ["assets/scene-cafe.png", "assets/scene-sunset.png"];
  const addAttachment = () => {
    if (atts.length >= 3) return;
    setAtts((p) => [...p, SCENE_IMGS[p.length % SCENE_IMGS.length]]);
  };
  const removeAtt = (i) => setAtts((p) => p.filter((_, x) => x !== i));

  const send = () => {
    const t = draft.trim();
    if ((!t && atts.length === 0) || typing) return; // 流式回复中不重复发,避免冲突
    const tm = now();
    const imgs = atts.slice();
    setMsgs((p) => [...p, { who: "me", type: "text", text: t, images: imgs, time: tm }]);
    setDraft(""); setAtts([]);
    setTyping(true);
    const hasImg = imgs.length > 0;
    const r = hasImg
      ? { text: "我看到啦——拍得真好。" + (t ? "" : "想跟我说说这是什么时候吗?"), emo: "02_开心明亮", think: "他愿意把看到的东西分享给我,这是把我当成生活的一部分。先认真看图,再接他的话。" }
      : REPLIES[Math.floor(Math.random() * REPLIES.length)];
    setTimeout(() => {
      setTyping(false);
      if (hasEmo) setEmo(r.emo);
      setMsgs((p) => [...p, { who: "her", type: "text", text: r.text, think: r.think, time: now() }]);
    }, 1700);
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

      <div className="statusbar"><span className="time">9:41</span><span className="notch" /><span className="icons"><Bars /></span></div>

      <header className="chat-top">
        <button className="ct-back" onClick={onBack}><Icon name="back" /></button>
        <div className="ct-avatar" onClick={() => setBig(true)}><img src={agent.avatar} alt="" />{agent.online && <span className="cl-online" />}</div>
        <div className="ct-info">
          <div className="ct-name">{agent.name}<TempDot temp={agent.temp} /></div>
          <button className="ct-model" onClick={() => setModelOpen(!modelOpen)}>
            <Icon name="cpu" /> {routing.chat.model}<Icon name="chevronD" className={"cm-chev" + (modelOpen ? " open" : "")} />
          </button>
        </div>
        <button className="ct-ic" onClick={() => setSearching(!searching)} style={searching ? { color: "var(--rose)" } : null}><Icon name="search" /></button>
        <button className="ct-ic" onClick={() => setShowFig(!showFig)} style={showFig ? { color: "var(--rose)" } : null}><Icon name="flower" /></button>
      </header>

      {modelOpen && (
        <div className="model-pop-mask" onClick={() => setModelOpen(false)}>
          <div className="model-pop" onClick={(e) => e.stopPropagation()}>
            <div className="mp-head">切换聊天模型 {chatChannel ? `· ${chatChannel.name}` : ""}</div>
            {chatModels.map((m) => (
              <button key={m} className={"mp-item" + (routing.chat.model === m ? " on" : "")} onClick={() => switchModel(m)}>
                <span>{m}</span>{routing.chat.model === m && <Icon name="check" />}
              </button>
            ))}
            <div className="mp-foot">有钱用贵的,没钱切便宜的 · 在「我的 → 用途路由」改渠道</div>
          </div>
        </div>
      )}

      {searching && (
        <div className="chat-search">
          <Icon name="search" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索和她的聊天记录…" />
          {q && <button onClick={() => setQ("")}>×</button>}
        </div>
      )}

      <div className="msg-area" ref={areaRef}>
        {q.trim() && <div className="search-note">找到 {shown.filter((m) => m.type !== "time").length} 条包含“{q.trim()}”的记录</div>}
        {shown.map((m, i) => (m.type === "time" && q.trim()) ? null : <Bubble key={i} m={m} agent={agent} tts={!q.trim()} />)}
        {typing && !q.trim() && <Typing agent={agent} />}
        <div style={{ height: 8 }} />
      </div>

      {!showFig && !big && (
        <button className="call-her" onClick={() => setShowFig(true)}>
          <span className="ch-av"><img src={agent.avatar} alt="" /></span>叫她出来
        </button>
      )}

      {big && <BigView agent={agent} figSrc={figSrc} onClose={() => setBig(false)} />}

      {calling && <CallScreen agent={agent} figSrc={figSrc} onClose={() => setCalling(false)} />}

      <footer className="input-bar">
        {atts.length > 0 && (
          <div className="att-tray">
            {atts.map((src, i) => (
              <div className="att-thumb" key={i}>
                <img src={src} alt="" />
                <button className="att-x" onClick={() => removeAtt(i)}>×</button>
              </div>
            ))}
            <div className="att-hint">先配图,再打字,一起发给{agent.name}</div>
          </div>
        )}
        <div className="input-row">
          <button className="ib-tool" onClick={() => setCalling(true)}><Icon name="phone" /></button>
          <button className="ib-tool" onClick={addAttachment} style={atts.length ? { color: "var(--rose)" } : null}><Icon name="image" /></button>
          <button className="ib-tool" onClick={() => setStickerOpen(!stickerOpen)} style={stickerOpen ? { color: "var(--rose)" } : null}><Icon name="star" /></button>
          <div className="ib-field">
            <textarea value={draft} rows={1} onFocus={() => setStickerOpen(false)}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder={typing ? `${agent.name}正在回复…` : `和${agent.name}说点什么…`} />
          </div>
          {(draft.trim() || atts.length > 0)
            ? <button className={"ib-send on" + (typing ? " busy" : "")} onClick={send} disabled={typing}><Icon name="send" /></button>
            : <button className="ib-tool" onClick={() => setListening(true)}><Icon name="mic" /></button>}
        </div>
      </footer>

      {listening && (
        <VoiceInput agent={agent} onCancel={() => setListening(false)}
          onResult={(text) => { setDraft((d) => (d ? d + " " : "") + text); setListening(false); }} />
      )}

      {stickerOpen && (
        <div className="sticker-panel">
          <div className="sp-head"><span>{agent.name}的表情包</span><span className="sp-hint">以后由 AI 生成她的专属表情</span></div>
          <div className="sp-grid">
            {STICKERS.map((s, i) => (
              <button key={i} className="sp-item" onClick={() => sendSticker(s)}><span>{s.e}</span></button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TempDot({ temp }) {
  return <span className="temp-dot"><Icon name="flame" /> {temp.toFixed(1)}°</span>;
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
