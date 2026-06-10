import React from "react";
import { Icon, PROVIDERS, CHANNEL_TYPES, CAP_LABELS, CHANNELS, ROUTING, VOICE_ENGINES } from "../store.jsx";
import { Toggle, StatusDot, Row } from "./profile.jsx";
/* 模型接入 2.0 — 接口渠道 + 用途路由 + 模型获取/切换 + 语音TTS
   概念: 渠道(一个 base/key) 与 用途(聊天/图片/语音) 解耦,各用途各自选渠道+模型,随时切换。 */
const { useState: useStateMo } = React;

const LS_CH = "ruobai_channels_v2";
const LS_RT = "ruobai_routing_v2";
const loadCH = () => { try { const s = JSON.parse(localStorage.getItem(LS_CH)); if (Array.isArray(s)) return s; } catch (e) {} return CHANNELS; };
const loadRT = () => { try { const s = JSON.parse(localStorage.getItem(LS_RT)); if (s && s.chat) return s; } catch (e) {} return ROUTING; };

function CapDots({ caps }) {
  return (
    <span className="cap-dots">
      {["chat", "image", "voice", "realtime"].map((c) => (
        <span key={c} className={"cap-dot" + (caps.includes(c) ? " on" : "")}>{CAP_LABELS[c]}</span>
      ))}
    </span>
  );
}

/* ====== 渠道配置 Sheet ====== */
function ChannelSheet({ channel, isNew, onClose, onSave, onDelete }) {
  const [type, setType] = useStateMo(channel?.type || "openai");
  const preset = CHANNEL_TYPES[type];
  const [name, setName] = useStateMo(channel?.name || "");
  const [base, setBase] = useStateMo(channel?.base || preset.base);
  const [apiKey, setApiKey] = useStateMo(channel?.apiKey || "");
  const [caps, setCaps] = useStateMo(channel?.caps || preset.caps.slice(0, 1));
  const [enabled, setEnabled] = useStateMo(channel?.enabled ?? true);
  const [showKey, setShowKey] = useStateMo(false);
  const [models, setModels] = useStateMo(channel?.fetched?.length ? channel.fetched : preset.models);
  const [model, setModel] = useStateMo(channel?.model || preset.models[0] || "");
  const [fetchState, setFetchState] = useStateMo("idle"); // idle|loading|done|fail

  const pickType = (t) => {
    setType(t);
    const p = CHANNEL_TYPES[t];
    if (!channel) { setBase(p.base); setCaps(p.caps.slice(0, 1)); setModels(p.models); setModel(p.models[0] || ""); }
  };
  const toggleCap = (c) => setCaps((p) => p.includes(c) ? p.filter((x) => x !== c) : [...p, c]);

  const fetchModels = () => {
    if (!apiKey.trim() && type !== "custom") { setFetchState("fail"); return; }
    setFetchState("loading");
    setTimeout(() => {
      const list = CHANNEL_TYPES[type].models.length ? CHANNEL_TYPES[type].models : ["model-large", "model-medium", "model-small"];
      setModels(list); setFetchState("done");
      if (!model && list[0]) setModel(list[0]);
    }, 1400);
  };

  const canSave = (isNew ? name.trim() : true) && (apiKey.trim() || type === "custom");

  return (
    <div className="sheet-mask" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="sheet-head">
          <h2 className="serif">{isNew ? "添加接口渠道" : `配置 · ${channel.name}`}</h2>
          <button className="icon-btn" onClick={onClose} style={{ width: 34, height: 34 }}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>
        <div className="sheet-body">
          <label className="field-label">服务商类型</label>
          <div className="type-grid">
            {Object.entries(CHANNEL_TYPES).map(([k, v]) => (
              <button key={k} className={"type-chip" + (type === k ? " on" : "")} onClick={() => pickType(k)}>{v.name}</button>
            ))}
          </div>

          <label className="field-label">渠道名称 <span className="lbl-hint">给这个接口起个好认的名</span></label>
          <input className="fld" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如:OpenAI 中转·贵 / 千问·语音" />

          <label className="field-label">中转地址 / Base URL</label>
          <input className="fld" value={base} onChange={(e) => setBase(e.target.value)} placeholder="https://api.example.com/v1" />

          <label className="field-label">API 密钥 <span className="lbl-hint">只存你本地</span></label>
          <div className="key-field">
            <input className="fld" type={showKey ? "text" : "password"} value={apiKey}
              onChange={(e) => { setApiKey(e.target.value); setFetchState("idle"); }} placeholder={preset.keyHint} />
            <button className="key-eye" onClick={() => setShowKey(!showKey)}><Icon name={showKey ? "eyeOff" : "eye"} /></button>
          </div>

          <label className="field-label">这个渠道用来做什么 <span className="lbl-hint">可多选</span></label>
          <div className="cap-pick">
            {["chat", "image", "voice", "realtime"].map((c) => (
              <button key={c} className={"cap-btn" + (caps.includes(c) ? " on" : "")} onClick={() => toggleCap(c)}>
                <Icon name={c === "chat" ? "chat" : c === "image" ? "image" : c === "voice" ? "wave" : "phone"} /> {CAP_LABELS[c]}
              </button>
            ))}
          </div>

          {caps.includes("chat") || caps.includes("image") ? (<>
            <div className="model-head">
              <label className="field-label" style={{ margin: 0 }}>模型</label>
              <button className={"fetch-btn " + fetchState} onClick={fetchModels}>
                {fetchState === "loading" ? <><span className="test-spin" /> 获取中…</>
                  : fetchState === "done" ? <><Icon name="check" /> 已更新 {models.length} 个</>
                  : fetchState === "fail" ? <><Icon name="alert" /> 需先填密钥</>
                  : <><Icon name="refresh" /> 获取模型列表</>}
              </button>
            </div>
            <div className="model-chips">
              {models.map((m) => <button key={m} className={"model-chip" + (model === m ? " on" : "")} onClick={() => setModel(m)}>{m}</button>)}
              {models.length === 0 && <span className="model-empty">点「获取模型列表」拉取,或手动输入 ↓</span>}
            </div>
            <input className="fld" style={{ marginTop: 8 }} value={model} onChange={(e) => setModel(e.target.value)} placeholder="模型名,例如 gpt-5.5" />
          </>) : null}

          <div className="switch-row">
            <div><div className="sr-t">启用此渠道</div><div className="sr-s">停用后所有用途不会再选到它</div></div>
            <Toggle on={enabled} onClick={() => setEnabled(!enabled)} />
          </div>
        </div>
        <div className="sheet-foot">
          {!isNew && <button className="icon-btn det-del" onClick={() => onDelete(channel.id)}><Icon name="trash" /></button>}
          <button className="pill pill-primary grow" disabled={!canSave} style={!canSave ? { opacity: 0.5 } : null}
            onClick={() => onSave({ id: channel?.id, type, name, base, apiKey, caps, enabled, model, fetched: models })}>
            {isNew ? "添加渠道" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ====== 用途路由 选择器(聊天/图片 选 渠道+模型) ====== */
function RoutePicker({ cap, channels, current, onClose, onPick }) {
  const list = channels.filter((c) => c.enabled && c.caps.includes(cap));
  return (
    <div className="sheet-mask" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "78%" }}>
        <div className="sheet-grip" />
        <div className="sheet-head">
          <h2 className="serif">{CAP_LABELS[cap]}用哪个</h2>
          <button className="icon-btn" onClick={onClose} style={{ width: 34, height: 34 }}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>
        <div className="sheet-body">
          {list.length === 0 && <div className="route-empty">还没有支持「{CAP_LABELS[cap]}」的渠道。去下面添加一个,并勾选这个用途。</div>}
          {list.map((c) => (
            <div key={c.id} className="route-channel">
              <div className="rc-head"><span className="rc-name">{c.name}</span><span className="micro-tag">{CHANNEL_TYPES[c.type]?.name}</span></div>
              <div className="model-chips">
                {(c.fetched?.length ? c.fetched : CHANNEL_TYPES[c.type]?.models || [c.model]).map((m) => (
                  <button key={m}
                    className={"model-chip" + (current.channelId === c.id && current.model === m ? " on" : "")}
                    onClick={() => onPick({ channelId: c.id, model: m })}>{m}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ====== 语音 TTS 配置 Sheet ====== */
function VoiceSheet({ voice, channels, onClose, onSave }) {
  const [engine, setEngine] = useStateMo(voice.engine || "browser");
  const [rate, setRate] = useStateMo(voice.rate ?? 0.9);
  const [qwenVoiceId, setQwenVoiceId] = useStateMo(voice.voiceId || "");
  const [browserVoiceURI, setBrowserVoiceURI] = useStateMo(voice.browserVoiceURI || "");
  const [volcVoice, setVolcVoice] = useStateMo(voice.volcVoice || "zh_female_wennuan");
  const [browserVoices, setBrowserVoices] = useStateMo([]);
  const [testing, setTesting] = useStateMo(false);

  React.useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const load = () => setBrowserVoices(window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("zh")));
    load(); window.speechSynthesis.onvoiceschanged = load;
  }, []);

  const test = () => {
    setTesting(true);
    if (engine === "browser" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance("我在呢。今天也会好好陪着你。");
      u.lang = "zh-CN"; u.rate = Number(rate); u.pitch = 1.1;
      const sel = browserVoices.find((v) => v.voiceURI === browserVoiceURI);
      if (sel) u.voice = sel;
      u.onend = () => setTesting(false);
      window.speechSynthesis.speak(u);
    } else { setTimeout(() => setTesting(false), 1600); }
  };

  return (
    <div className="sheet-mask" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="sheet-head">
          <h2 className="serif">语音 · 让她开口</h2>
          <button className="icon-btn" onClick={onClose} style={{ width: 34, height: 34 }}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>
        <div className="sheet-body">
          <label className="field-label">语音引擎</label>
          {VOICE_ENGINES.map((e) => (
            <button key={e.id} className={"engine-row" + (engine === e.id ? " on" : "")} onClick={() => setEngine(e.id)}>
              <span className="er-radio" />
              <span className="er-main"><span className="er-name">{e.name}{e.free && <span className="er-free">免费</span>}</span><span className="er-sub">{e.sub}</span></span>
            </button>
          ))}

          {engine === "browser" && (<>
            <label className="field-label">浏览器音色 <span className="lbl-hint">{browserVoices.length} 个中文音色</span></label>
            <select className="fld" value={browserVoiceURI} onChange={(e) => setBrowserVoiceURI(e.target.value)}>
              <option value="">系统默认</option>
              {browserVoices.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>)}
            </select>
            <div className="voice-tip">浏览器自带,免费、即开即用、断网也能用。音色取决于你的系统。</div>
          </>)}

          {engine === "qwen" && (<>
            <label className="field-label">千问音色 ID</label>
            <input className="fld" value={qwenVoiceId} onChange={(e) => setQwenVoiceId(e.target.value)} placeholder="qwen-tts-vd-bailian-voice-..." />
            <div className="voice-tip">走「阿里千问」渠道的密钥,请求 /audio/speech。在上面把千问渠道勾上「语音」用途。</div>
          </>)}

          {engine === "volcengine" && (<>
            <label className="field-label">火山音色</label>
            <input className="fld" value={volcVoice} onChange={(e) => setVolcVoice(e.target.value)} placeholder="zh_female_wennuan" />
            <div className="voice-tip">火山语音需要 appId / token / cluster,在火山渠道里填好,这里只选音色。<b>后端还没接,先占个位。</b></div>
          </>)}

          <label className="field-label">语速 <span className="lbl-hint">{Number(rate).toFixed(2)}×</span></label>
          <input className="range" type="range" min="0.6" max="1.4" step="0.05" value={rate} onChange={(e) => setRate(e.target.value)} />

          <button className={"test-btn" + (testing ? " loading" : "")} onClick={test} style={{ marginTop: 16 }}>
            {testing ? <><span className="test-spin" /> 她正在说…</> : <><Icon name="wave" /> 试听一句</>}
          </button>
        </div>
        <div className="sheet-foot">
          <button className="pill pill-primary grow" onClick={() => onSave({ engine, rate: Number(rate), voiceId: qwenVoiceId, browserVoiceURI, volcVoice })}>保存语音</button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { ChannelSheet, RoutePicker, VoiceSheet, CapDots, loadCH, loadRT, LS_CH, LS_RT });

/* ====== 模型接入整段(用途路由 + 渠道列表) ====== */
function ModelsSection() {
  const [channels, setChannels] = useStateMo(loadCH);
  const [routing, setRouting] = useStateMo(loadRT);
  const [chSheet, setChSheet] = useStateMo(undefined); // {channel, isNew}
  const [route, setRoute] = useStateMo(null);          // cap being routed
  const [voiceSheet, setVoiceSheet] = useStateMo(false);

  const persistCh = (n) => { setChannels(n); try { localStorage.setItem(LS_CH, JSON.stringify(n)); } catch (e) {} };
  const persistRt = (n) => { setRouting(n); try { localStorage.setItem(LS_RT, JSON.stringify(n)); } catch (e) {} };

  const saveChannel = (d) => {
    let n;
    if (d.id) n = channels.map((c) => c.id === d.id ? { ...c, ...d } : c);
    else n = [...channels, { ...d, id: "c_" + Date.now() }];
    persistCh(n); setChSheet(undefined);
  };
  const delChannel = (id) => { persistCh(channels.filter((c) => c.id !== id)); setChSheet(undefined); };

  const chName = (id) => channels.find((c) => c.id === id)?.name || "未选择";
  const engineName = (id) => VOICE_ENGINES.find((e) => e.id === id)?.name || id;

  return (
    <>
      {/* 用途路由 */}
      <div className="section-label pad" style={{ marginTop: 20 }}><span>用途路由 · 各管各的</span><span className="sl-line" /></div>
      <div className="pad">
        <div className="cap-card">
          <button className="prow" onClick={() => setRoute("chat")}>
            <span className="prow-ic on"><Icon name="chat" /></span>
            <span className="prow-main"><span className="prow-t">聊天</span><span className="prow-s">{chName(routing.chat.channelId)}</span></span>
            <span className="route-val">{routing.chat.model}<Icon name="swap" className="route-swap" /></span>
          </button>
          <button className="prow" onClick={() => setRoute("image")}>
            <span className="prow-ic lav"><Icon name="image" /></span>
            <span className="prow-main"><span className="prow-t">图片理解 / 生成</span><span className="prow-s">{chName(routing.image.channelId)}</span></span>
            <span className="route-val">{routing.image.model}<Icon name="swap" className="route-swap" /></span>
          </button>
          <button className="prow" onClick={() => setRoute("realtime")}>
            <span className="prow-ic on"><Icon name="phone" /></span>
            <span className="prow-main"><span className="prow-t">实时语音通话</span><span className="prow-s">{chName((routing.realtime || {}).channelId)} · 打电话时用</span></span>
            <span className="route-val">{(routing.realtime || {}).model || "未选择"}<Icon name="swap" className="route-swap" /></span>
          </button>
          <button className="prow last" onClick={() => setVoiceSheet(true)}>
            <span className="prow-ic rose"><Icon name="wave" /></span>
            <span className="prow-main"><span className="prow-t">语音 (TTS)</span><span className="prow-s">{engineName(routing.voice.engine)}{routing.voice.engine === "browser" ? " · 免费" : ""}</span></span>
            <Icon name="chevron" className="row-chev" />
          </button>
        </div>
        <div className="route-note">同一个用途随时切渠道、切模型 —— 有钱用贵的(gpt-5.5),想省就切便宜的(deepseek)。聊天页顶部也能一键切。<br/>「实时语音通话」是打电话那个页用的模型(边听边说,如 gpt-4o-realtime),跟上面「语音(TTS)」只负责把文字读出来不一样。</div>
      </div>

      {/* 接口渠道 */}
      <div className="section-label pad" style={{ marginTop: 18 }}><span>接口渠道 · 自带密钥</span><span className="sl-line" /></div>
      <div className="pad">
        <div className="cap-card">
          {channels.map((c) => (
            <button key={c.id} className="prow" onClick={() => setChSheet({ channel: c, isNew: false })}>
              <span className={"prow-ic " + (c.enabled ? "on" : "")}><Icon name="cpu" /></span>
              <span className="prow-main">
                <span className="prow-t">{c.name}</span>
                <CapDots caps={c.caps} />
              </span>
              <StatusDot status={c.enabled ? "on" : "off"} detail={c.enabled ? "已启用" : "已停用"} />
            </button>
          ))}
          <button className="prow last" onClick={() => setChSheet({ channel: null, isNew: true })}>
            <span className="prow-ic rose"><Icon name="add" /></span>
            <span className="prow-main"><span className="prow-t">添加接口渠道</span><span className="prow-s">OpenAI / Claude / Grok / DeepSeek / 千问 / 火山 / 自定义中转</span></span>
            <Icon name="chevron" className="row-chev" />
          </button>
        </div>
      </div>

      {chSheet !== undefined && (
        <ChannelSheet channel={chSheet.channel} isNew={chSheet.isNew}
          onClose={() => setChSheet(undefined)} onSave={saveChannel} onDelete={delChannel} />
      )}
      {route && (
        <RoutePicker cap={route} channels={channels} current={routing[route] || {}}
          onClose={() => setRoute(null)}
          onPick={(sel) => { persistRt({ ...routing, [route]: sel }); setRoute(null); }} />
      )}
      {voiceSheet && (
        <VoiceSheet voice={routing.voice} channels={channels}
          onClose={() => setVoiceSheet(false)}
          onSave={(v) => { persistRt({ ...routing, voice: { ...routing.voice, ...v } }); setVoiceSheet(false); }} />
      )}
    </>
  );
}

export { ModelsSection };
