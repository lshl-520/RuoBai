import React from "react";
import { Icon, CHANNEL_TYPES, VOICE_ENGINES, useLockBody } from "../store.jsx";
import { getCredentials, createCredential, updateCredential, deleteCredential, refreshCredentialModels, discoverModelConfigs, getCapabilities, updateCapability } from "../lib/profile.js";
import { Toggle, StatusDot, Row } from "./profile.jsx";

const { useState: useStateMo } = React;

const LS_CH = "ruobai_channels_v2";
const loadCH = () => { try { const s = JSON.parse(localStorage.getItem(LS_CH)); if (Array.isArray(s)) return s; } catch (e) {} return []; };

const CAP_INFO = {
  chat: { icon: "chat", name: "文字聊天", tint: "on" },
  vision: { icon: "image", name: "看懂图片", tint: "lav" },
  image: { icon: "image", name: "画图发图", tint: "rose" },
  tts: { icon: "wave", name: "语音(TTS)", tint: "rose" },
  realtime: { icon: "phone", name: "实时通话", tint: "on" },
};

/* ====== 能力选择器 Sheet ====== */
function CapPicker({ cap, options, current, onClose, onPick }) {
  useLockBody();
  const grouped = {};
  (options || []).forEach((o) => {
    const key = o.credential_name || `供应商#${o.credential_id}`;
    if (!grouped[key]) grouped[key] = { credId: o.credential_id, name: key, models: [] };
    grouped[key].models.push(o.model_id);
  });
  const groups = Object.values(grouped);
  const info = CAP_INFO[cap] || { name: cap };

  return (
    <div className="sheet-mask" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "78%" }}>
        <div className="sheet-grip" />
        <div className="sheet-head">
          <h2 className="serif">{info.name} · 选模型</h2>
          <button className="icon-btn" onClick={onClose} style={{ width: 34, height: 34 }}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>
        <div className="sheet-body">
          {groups.length === 0 && <div className="route-empty">没有可用的供应商。先在下方「接口渠道」添加一个支持此能力的供应商。</div>}
          {groups.map((g) => (
            <div key={g.credId} className="route-channel">
              <div className="rc-head"><span className="rc-name">{g.name}</span></div>
              <div className="model-chips">
                {g.models.map((m) => (
                  <button key={m}
                    className={"model-chip" + (current?.credential_id === g.credId && current?.model_id === m ? " on" : "")}
                    onClick={() => onPick(g.credId, m)}>{m}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ====== 渠道配置 Sheet ====== */
function ChannelSheet({ channel, isNew, onClose, onSave, onDelete }) {
  useLockBody();
  const [type, setType] = useStateMo(channel?.type || "openai");
  const preset = CHANNEL_TYPES[type] || CHANNEL_TYPES.custom;
  const [name, setName] = useStateMo(channel?.name || "");
  const [base, setBase] = useStateMo(channel?.base || preset.base);
  const [apiKey, setApiKey] = useStateMo(channel?.apiKey || "");
  const [enabled, setEnabled] = useStateMo(channel?.enabled ?? true);
  const [showKey, setShowKey] = useStateMo(false);
  const [models, setModels] = useStateMo(channel?.fetched?.length ? channel.fetched : preset.models);
  const [model, setModel] = useStateMo(channel?.model || preset.models[0] || "");
  const [fetchState, setFetchState] = useStateMo("idle");

  React.useEffect(() => {
    const body = document.querySelector('.sheet-body');
    if (body) body.scrollTop = 0;
  }, []);

  const pickType = (t) => {
    setType(t);
    const p = CHANNEL_TYPES[t] || CHANNEL_TYPES.custom;
    if (!channel) { setBase(p.base); setModels(p.models); setModel(p.models[0] || ""); }
  };

  const fetchModels = async () => {
    setFetchState("loading");
    try {
      if (channel?._backendId) {
        const result = await refreshCredentialModels(channel._backendId);
        if (result.success && result.items?.length) {
          const ids = result.items.map((m) => m.model_id);
          setModels(ids);
          setFetchState("done");
          if (!model && ids[0]) setModel(ids[0]);
        } else {
          setFetchState("done");
          setModels([]);
        }
      } else {
        if (!apiKey.trim() && type !== "custom") { setFetchState("fail"); return; }
        const result = await discoverModelConfigs({ api_base: base, api_key: apiKey });
        if (result.success && result.items?.length) {
          setModels(result.items);
          setFetchState("done");
          if (!model && result.suggested_model) setModel(result.suggested_model);
          else if (!model && result.items[0]) setModel(result.items[0]);
        } else {
          setFetchState("fail");
          setModels(CHANNEL_TYPES[type]?.models?.length ? CHANNEL_TYPES[type].models : []);
        }
      }
    } catch (err) {
      setFetchState("fail");
      setModels(CHANNEL_TYPES[type]?.models?.length ? CHANNEL_TYPES[type].models : []);
    }
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
            {Object.entries(CHANNEL_TYPES).filter(([k]) => k !== "openai-compatible").map(([k, v]) => (
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

          <div className="model-head">
            <label className="field-label" style={{ margin: 0 }}>模型</label>
            <button className={"fetch-btn " + fetchState} onClick={fetchModels}>
              {fetchState === "loading" ? <><span className="test-spin" /> 获取中...</>
                : fetchState === "done" ? <><Icon name="check" /> 已更新 {models.length} 个</>
                : fetchState === "fail" ? <><Icon name="alert" /> 需先填密钥</>
                : <><Icon name="refresh" /> 获取模型列表</>}
            </button>
          </div>
          {models.length === 0 && <div className="model-empty">点「获取模型列表」拉取，或手动输入</div>}
          {models.length > 0 && (
            <select className="fld" value={model} onChange={(e) => setModel(e.target.value)} style={{ marginTop: 8 }}>
              <option value="">选择模型...</option>
              {models.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          )}
          <input className="fld" style={{ marginTop: 8 }} value={model} onChange={(e) => setModel(e.target.value)} placeholder="模型名,例如 gpt-5.5" />

          <div className="switch-row">
            <div><div className="sr-t">启用此渠道</div><div className="sr-s">停用后所有用途不会再选到它</div></div>
            <Toggle on={enabled} onClick={() => setEnabled(!enabled)} />
          </div>
        </div>
        <div className="sheet-foot">
          {!isNew && <button className="icon-btn det-del" onClick={() => onDelete(channel.id)}><Icon name="trash" /></button>}
          <button className="pill pill-primary grow" disabled={!canSave} style={!canSave ? { opacity: 0.5 } : null}
            onClick={() => onSave({ id: channel?.id, type, name, base, apiKey, enabled, model, fetched: models })}>
            {isNew ? "添加渠道" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ====== 语音 TTS 配置 Sheet ====== */
function VoiceSheet({ voice, onClose, onSave }) {
  useLockBody();
  const [engine, setEngine] = useStateMo(voice?.engine || "browser");
  const [rate, setRate] = useStateMo(voice?.rate ?? 0.9);
  const [qwenVoiceId, setQwenVoiceId] = useStateMo(voice?.voiceId || "");
  const [browserVoiceURI, setBrowserVoiceURI] = useStateMo(voice?.browserVoiceURI || "");
  const [volcVoice, setVolcVoice] = useStateMo(voice?.volcVoice || "zh_female_wennuan");
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
            <div className="voice-tip">走「阿里千问」渠道的密钥,请求 /audio/speech。</div>
          </>)}

          {engine === "volcengine" && (<>
            <label className="field-label">火山音色</label>
            <input className="fld" value={volcVoice} onChange={(e) => setVolcVoice(e.target.value)} placeholder="zh_female_wennuan" />
            <div className="voice-tip">火山语音需要 appId / token / cluster。<b>后端还没接,先占个位。</b></div>
          </>)}

          <label className="field-label">语速 <span className="lbl-hint">{Number(rate).toFixed(2)}x</span></label>
          <input className="range" type="range" min="0.6" max="1.4" step="0.05" value={rate} onChange={(e) => setRate(e.target.value)} />

          <button className={"test-btn" + (testing ? " loading" : "")} onClick={test} style={{ marginTop: 16 }}>
            {testing ? <><span className="test-spin" /> 她正在说...</> : <><Icon name="wave" /> 试听一句</>}
          </button>
        </div>
        <div className="sheet-foot">
          <button className="pill pill-primary grow" onClick={() => onSave({ engine, rate: Number(rate), voiceId: qwenVoiceId, browserVoiceURI, volcVoice })}>保存语音</button>
        </div>
      </div>
    </div>
  );
}

/* ====== 模型接入整段(她的能力 + 渠道列表) ====== */
function ModelsSection() {
  const [channels, setChannels] = useStateMo(loadCH);
  const [chSheet, setChSheet] = useStateMo(undefined);
  const [voiceSheet, setVoiceSheet] = useStateMo(false);
  const [voiceConfig, setVoiceConfig] = useStateMo(() => {
    try { const s = JSON.parse(localStorage.getItem("ruobai_voice_v2")); if (s) return s; } catch (e) {}
    return { engine: "browser", rate: 0.9, voiceId: "", browserVoiceURI: "", volcVoice: "zh_female_wennuan" };
  });

  // 能力面板（真实数据）
  const [capabilities, setCaps] = useStateMo([]);
  const [capLoading, setCapLoading] = useStateMo(true);
  const [capPicker, setCapPicker] = useStateMo(null);

  React.useEffect(() => {
    getCapabilities().then((res) => {
      if (res?.success && Array.isArray(res.items)) setCaps(res.items);
    }).catch(() => {}).finally(() => setCapLoading(false));
  }, []);

  const refreshCaps = () => {
    getCapabilities().then((res) => {
      if (res?.success && Array.isArray(res.items)) setCaps(res.items);
    }).catch(() => {});
  };

  const toggleCap = async (capKey, currentEnabled) => {
    setCaps((prev) => prev.map((c) => c.capability === capKey ? { ...c, enabled: !currentEnabled } : c));
    try { await updateCapability(capKey, { enabled: !currentEnabled }); } catch (e) { refreshCaps(); }
  };

  const pickCapModel = async (capKey, credentialId, modelId) => {
    try {
      await updateCapability(capKey, { credential_id: credentialId, model_id: modelId, enabled: true });
      refreshCaps();
    } catch (e) {}
    setCapPicker(null);
  };

  /* 从后端拉真实 credentials 作为渠道列表 */
  React.useEffect(() => {
    let cancelled = false;
    getCredentials().then((payload) => {
      if (cancelled) return;
      const raw = Array.isArray(payload?.items) ? payload.items : [];
      if (raw.length === 0) return;
      const converted = raw.map((cfg) => ({
        id: String(cfg.id),
        type: cfg.provider_type || "custom",
        name: cfg.name || "未命名渠道",
        base: cfg.api_base || "",
        apiKey: "",
        apiKeyMasked: cfg.api_key_masked || "",
        model: "",
        modelsCount: cfg.models_count || 0,
        enabled: true,
        fetched: [],
        _backendId: cfg.id,
      }));
      setChannels(converted);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const refreshChannels = () => {
    getCredentials().then((payload) => {
      const raw = Array.isArray(payload?.items) ? payload.items : [];
      const converted = raw.map((cfg) => ({
        id: String(cfg.id),
        type: cfg.provider_type || "custom",
        name: cfg.name || "未命名渠道",
        base: cfg.api_base || "",
        apiKey: "",
        apiKeyMasked: cfg.api_key_masked || "",
        model: "",
        modelsCount: cfg.models_count || 0,
        enabled: true,
        fetched: [],
        _backendId: cfg.id,
      }));
      setChannels(converted);
    }).catch(() => {});
  };

  const saveChannel = async (d) => {
    const payload = { name: d.name, provider_type: d.type, api_base: d.base, api_key: d.apiKey };
    try {
      if (d.id && channels.find((c) => c.id === d.id)?._backendId) {
        const backendId = channels.find((c) => c.id === d.id)._backendId;
        await updateCredential(backendId, payload);
        await refreshCredentialModels(backendId).catch(() => {});
      } else {
        const res = await createCredential(payload);
        if (res?.success && res.item?.id) {
          await refreshCredentialModels(res.item.id).catch(() => {});
        }
      }
    } catch (e) {}
    refreshChannels();
    refreshCaps();
    setChSheet(undefined);
  };

  const delChannel = async (id) => {
    const ch = channels.find((c) => c.id === id);
    if (ch?._backendId) {
      await deleteCredential(ch._backendId).catch(() => {});
    }
    refreshChannels();
    refreshCaps();
    setChSheet(undefined);
  };

  const saveVoice = (v) => {
    setVoiceConfig(v);
    try { localStorage.setItem("ruobai_voice_v2", JSON.stringify(v)); } catch (e) {}
    setVoiceSheet(false);
  };

  const engineName = (id) => VOICE_ENGINES.find((e) => e.id === id)?.name || id;

  return (
    <>
      {/* 她的能力 */}
      <div className="section-label pad" style={{ marginTop: 20 }}><span>她的能力</span><span className="sl-line" /></div>
      <div className="pad">
        <div className="cap-card">
          {capLoading && <div className="prow last"><span className="prow-main"><span className="prow-s">加载中...</span></span></div>}
          {!capLoading && capabilities.map((cap, i) => {
            const info = CAP_INFO[cap.capability] || { icon: "cpu", name: cap.capability, tint: "" };
            const isLast = i === capabilities.length - 1 && cap.capability !== "tts";
            const isTts = cap.capability === "tts";

            if (isTts) {
              return (
                <button key={cap.capability} className="prow" onClick={() => setVoiceSheet(true)}>
                  <span className={"prow-ic " + info.tint}><Icon name={info.icon} /></span>
                  <span className="prow-main">
                    <span className="prow-t">{info.name}</span>
                    <span className="prow-s">{engineName(voiceConfig.engine)}{voiceConfig.engine === "browser" ? " · 免费" : ""}</span>
                  </span>
                  <Toggle on={cap.enabled} onClick={(e) => { e.stopPropagation(); toggleCap(cap.capability, cap.enabled); }} />
                </button>
              );
            }

            return (
              <button key={cap.capability} className={"prow" + (isLast ? " last" : "")} onClick={() => setCapPicker(cap.capability)}>
                <span className={"prow-ic " + (cap.enabled ? info.tint : "")}><Icon name={info.icon} /></span>
                <span className="prow-main">
                  <span className="prow-t">{info.name}</span>
                  <span className="prow-s">{cap.current ? `${cap.current.credential_name} · ${cap.current.model_id}` : "未选择"}</span>
                </span>
                <Toggle on={cap.enabled} onClick={(e) => { e.stopPropagation(); toggleCap(cap.capability, cap.enabled); }} />
              </button>
            );
          })}
        </div>
        {!capLoading && <div className="route-note">点能力行选模型，右边开关控制启用。有钱用贵的，想省就切便宜的。</div>}
      </div>

      {/* 接口渠道 */}
      <div className="section-label pad" style={{ marginTop: 18 }}><span>接口渠道 · 自带密钥</span><span className="sl-line" /></div>
      <div className="pad">
        <div className="cap-card">
          {channels.map((c) => (
            <button key={c.id} className="prow" onClick={() => setChSheet({ channel: c, isNew: false })}>
              <span className={"prow-ic on"}><Icon name="cpu" /></span>
              <span className="prow-main">
                <span className="prow-t">{c.name}</span>
                <span className="prow-s">{c.base}{c.modelsCount > 0 ? ` · 已发现 ${c.modelsCount} 个模型` : ""}</span>
              </span>
              <Icon name="chevron" className="row-chev" />
            </button>
          ))}
          <button className="prow last" onClick={() => setChSheet({ channel: null, isNew: true })}>
            <span className="prow-ic rose"><Icon name="add" /></span>
            <span className="prow-main"><span className="prow-t">添加接口渠道</span><span className="prow-s">DeepSeek / 千问 / 火山 / Grok / OpenAI / 自定义中转</span></span>
            <Icon name="chevron" className="row-chev" />
          </button>
        </div>
      </div>

      {chSheet !== undefined && (
        <ChannelSheet channel={chSheet.channel} isNew={chSheet.isNew}
          onClose={() => setChSheet(undefined)} onSave={saveChannel} onDelete={delChannel} />
      )}
      {capPicker && (() => {
        const capData = capabilities.find((c) => c.capability === capPicker);
        return capData ? (
          <CapPicker cap={capPicker} options={capData.options} current={capData.current}
            onClose={() => setCapPicker(null)} onPick={(credId, modelId) => pickCapModel(capPicker, credId, modelId)} />
        ) : null;
      })()}
      {voiceSheet && (
        <VoiceSheet voice={voiceConfig} onClose={() => setVoiceSheet(false)} onSave={saveVoice} />
      )}
    </>
  );
}

export { ModelsSection };
