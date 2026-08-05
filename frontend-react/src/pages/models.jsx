import React from "react";
import { Icon, CHANNEL_TYPES, VOICE_ENGINES, useLockBody } from "../store.jsx";
import { getCredentials, createCredential, updateCredential, deleteCredential, refreshCredentialModels, getCapabilities, updateCapability, testCredentialDraft, applyCredential } from "../lib/profile.js";
import { isQwenTtsModel, loadVoiceSettings, saveVoiceSettings, selectCloudTtsOption } from "../lib/voice-settings.js";
import { previewTts } from "../lib/chat.js";
import { speakTextWithSystemVoice } from "../lib/native-tts.js";
import { Toggle, StatusDot, Row } from "./profile.jsx";

const { useState: useStateMo } = React;

const LS_CH = "ruobai_channels_v2";
const TASK_IMAGE_PROVIDER = "image-task-no-key";
const TASK_IMAGE_MODEL = "task-image-default";
const VOLC_REALTIME_PROVIDER = "volc-realtime";
const VOLC_REALTIME_MODEL = "2.2.0.0";
const VOLC_TTS_MODEL = "seed-tts-2.0";
const VOLC_VOICE_MODELS = [VOLC_REALTIME_MODEL, VOLC_TTS_MODEL];
const DEFAULT_VOLC_VOICE = "saturn_zh_female_wenrouwenya_tob";
const loadCH = () => { try { const s = JSON.parse(localStorage.getItem(LS_CH)); if (Array.isArray(s)) return s; } catch (e) {} return []; };

const CAP_INFO = {
  chat: { icon: "chat", name: "文字聊天", tint: "on" },
  vision: { icon: "image", name: "看懂图片", tint: "lav" },
  image: { icon: "image", name: "画图发图", tint: "rose" },
  dynamic: { icon: "image", name: "动态发图", tint: "rose" },
  tts: { icon: "wave", name: "语音(TTS)", tint: "rose" },
  realtime: { icon: "phone", name: "实时通话", tint: "on" },
};

/* ====== 能力选择器 Sheet ====== */
function CapPicker({ cap, options, current, error, saving, onClose, onPick }) {
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
          {cap === "dynamic" && <div className="route-note" style={{ marginBottom: 12 }}>动态只显示能稳定返回单张图片的渠道。免费 Agnes 模型可用于“画图发图”，不用于自动动态。</div>}
          {groups.length === 0 && <div className="route-empty">没有可用的供应商。先在下方「接口渠道」添加一个支持此能力的供应商。</div>}
          {groups.map((g) => (
            <div key={g.credId} className="route-channel">
              <div className="rc-head"><span className="rc-name">{g.name}</span></div>
              {g.models.length <= 10 ? (
                <div className="model-chips">
                  {g.models.map((m) => (
                    <button key={m}
                      className={"model-chip" + (current?.credential_id === g.credId && current?.model_id === m ? " on" : "")}
                      onClick={() => onPick(g.credId, m)} disabled={saving}>{m}</button>
                  ))}
                </div>
              ) : (
                <select className="fld" value={current?.credential_id === g.credId ? (current?.model_id || "") : ""}
                  onChange={(e) => { if (e.target.value) onPick(g.credId, e.target.value); }}>
                  <option value="">选择模型...</option>
                  {g.models.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              )}
            </div>
          ))}
          {error && <div className="voice-tip" style={{ color: "#c4566b", marginTop: 12 }}>{error}</div>}
        </div>
      </div>
    </div>
  );
}

/* ====== 渠道配置 Sheet ====== */
function ChannelSheet({ channel, isNew, onClose, onSave, onDelete, onTest }) {
  useLockBody();
  const [type, setType] = useStateMo(channel?.type || "openai");
  const preset = CHANNEL_TYPES[type] || CHANNEL_TYPES.custom;
  const realtimeMode = type === VOLC_REALTIME_PROVIDER;
  const [taskImageMode, setTaskImageMode] = useStateMo(channel?.providerType === TASK_IMAGE_PROVIDER);
  const noKeyRequired = taskImageMode;
  const [name, setName] = useStateMo(channel?.name || "");
  const [base, setBase] = useStateMo(channel?.base || preset.base);
  const [taskBase, setTaskBase] = useStateMo(channel?.apiAuxBase || "");
  const [apiKey, setApiKey] = useStateMo(channel?.apiKey || "");
  const [enabled, setEnabled] = useStateMo(channel?.enabled ?? true);
  const [showKey, setShowKey] = useStateMo(false);
  const [replacingKey, setReplacingKey] = useStateMo(isNew || !channel?.keyConfigured);
  const [models, setModels] = useStateMo([]);
  const [model, setModel] = useStateMo(channel?.model || "");
  const [fetchState, setFetchState] = useStateMo("idle");
  const [purposes, setPurposes] = useStateMo(channel?.purposes?.length ? channel.purposes : (realtimeMode ? ["realtime", "tts"] : ["chat"]));
  const [fetchMessage, setFetchMessage] = useStateMo(channel?.testMessage || "");
  const [saving, setSaving] = useStateMo(false);
  const [saveError, setSaveError] = useStateMo("");
  const originalType = channel?.type || "openai";
  const originalProviderType = channel?.providerType || originalType;
  const currentProviderType = taskImageMode ? TASK_IMAGE_PROVIDER : type;
  const connectionChanged = !!channel && (
    type !== originalType
    || currentProviderType !== originalProviderType
    || base.trim() !== String(channel?.base || "").trim()
    || taskBase.trim() !== String(channel?.apiAuxBase || "").trim()
    || (replacingKey && !!apiKey.trim())
  );
  const connectionReady = fetchState === "done" || (!isNew && !connectionChanged);
  const canChoosePurpose = !!model.trim() && connectionReady;

  const togglePurpose = (p) => {
    if (taskImageMode || realtimeMode) return;
    setPurposes((prev) => prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]);
  };

  const toggleTaskImageMode = () => {
    const next = !taskImageMode;
    setTaskImageMode(next);
    setFetchState("idle");
    if (next) {
      setPurposes(["image"]);
      setModels([]);
      setModel("");
    } else {
      setModels([]);
      setModel("");
    }
  };

  React.useEffect(() => {
    const body = document.querySelector('.sheet-body');
    if (body) body.scrollTop = 0;
  }, []);

  const pickType = (t) => {
    setType(t);
    const p = CHANNEL_TYPES[t] || CHANNEL_TYPES.custom;
    if (t !== "custom") setTaskImageMode(false);
    if (t === VOLC_REALTIME_PROVIDER) {
      setBase(p.base);
      setModels([]);
      setModel("");
      setPurposes(["realtime", "tts"]);
      setFetchState("idle");
      if (!name.trim()) setName("豆包语音");
      return;
    }
    setFetchState("idle");
    if (!channel) {
      setBase(p.base);
      setModels([]);
      setModel("");
      setPurposes(["chat"]);
    }
  };

  const fetchModels = async () => {
    if (fetchState === "loading") return;
    setFetchState("loading");
    setFetchMessage("正在核对地址、密钥并获取模型...");
    try {
      const result = await onTest(buildDraft());
      if (!result?.success) throw new Error(result?.error || result?.message || "获取模型失败");
      const ids = Array.isArray(result.models) ? result.models.filter(Boolean)
        : taskImageMode ? [TASK_IMAGE_MODEL]
        : realtimeMode ? VOLC_VOICE_MODELS
        : [];
      setModels(ids);
      setModel((current) => ids.includes(current) ? current : (ids[0] || current || ""));
      setFetchState("done");
      setFetchMessage(result.message || `连接正常，已获取 ${ids.length} 个模型`);
    } catch (error) {
      setFetchState("fail");
      setFetchMessage(error?.message || String(error));
      setModels([]);
    }
  };

  const buildDraft = () => ({
    id: channel?.id,
    type,
    providerType: taskImageMode ? TASK_IMAGE_PROVIDER : type,
    name,
    base,
    taskBase,
    apiKey: taskImageMode ? "" : apiKey,
    enabled,
    model: taskImageMode ? TASK_IMAGE_MODEL : realtimeMode ? VOLC_REALTIME_MODEL : model,
    fetched: models,
    purposes: taskImageMode ? ["image"] : realtimeMode ? ["realtime", "tts"] : purposes,
  });


  const save = async () => {
    if (saving) return;
    setSaving(true);
    setSaveError("");
    try {
      await onSave(buildDraft());
    } catch (error) {
      setSaveError(error?.message || String(error));
    } finally {
      setSaving(false);
    }
  };

  const hasUsableKey = noKeyRequired
    || apiKey.trim()
    || (!replacingKey && !!channel?._backendId && channel?.providerType !== TASK_IMAGE_PROVIDER);
  const canSave = (isNew ? name.trim() : true)
    && base.trim()
    && (!taskImageMode || taskBase.trim())
    && (!realtimeMode || taskBase.trim())
    && hasUsableKey
    && connectionReady
    && model.trim();

  const PURPOSE_OPTS = [
    { key: "chat", icon: "chat", label: "聊天" },
    { key: "vision", icon: "image", label: "看图" },
    { key: "image", icon: "image", label: "画图" },
    { key: "dynamic", icon: "image", label: "动态" },
    { key: "tts", icon: "wave", label: "语音" },
    { key: "realtime", icon: "phone", label: "实时通话" },
  ];

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

          {type === "custom" && (
            <div className="switch-row" style={{ marginTop: 14 }}>
              <div>
                <div className="sr-t">无需密钥的任务式生图接口</div>
                <div className="sr-s">适合提交任务后，再到另一个地址查询图片的私人接口</div>
              </div>
              <Toggle on={taskImageMode} onClick={toggleTaskImageMode} />
            </div>
          )}

          <label className="field-label">渠道名称 <span className="lbl-hint">给这个接口起个好认的名</span></label>
          <input className="fld" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如:OpenAI 中转·贵 / 千问·语音" />

          <label className="field-label">{taskImageMode ? "任务提交地址" : realtimeMode ? "实时语音 WebSocket 地址" : "中转地址 / Base URL"}</label>
          <input className="fld" value={base} onChange={(e) => { setBase(e.target.value); setFetchState("idle"); setFetchMessage(""); }} placeholder={taskImageMode ? "https://submit.example.com" : realtimeMode ? "wss://openspeech.bytedance.com/api/v3/realtime/dialogue" : "https://api.example.com/v1"} />

          {taskImageMode && (<>
            <label className="field-label">任务查询 / 图片地址</label>
            <input className="fld" value={taskBase} onChange={(e) => { setTaskBase(e.target.value); setFetchState("idle"); setFetchMessage(""); }} placeholder="https://tasks.example.com" />
          </>)}

          {realtimeMode && (<>
            <label className="field-label">APP ID <span className="lbl-hint">火山控制台“端到端实时语音”的 APP ID</span></label>
            <input className="fld" value={taskBase} onChange={(e) => { setTaskBase(e.target.value.replace(/\s/g, "")); setFetchState("idle"); setFetchMessage(""); }} placeholder="例如：1234567890" inputMode="numeric" />
          </>)}

          <label className="field-label">{realtimeMode ? "Access Token" : "API 密钥"} <span className="lbl-hint">{noKeyRequired ? "这个渠道无需填写" : realtimeMode ? "火山控制台里的 Access Token，不是 API Key" : "只存你本地"}</span></label>
          {noKeyRequired ? (
            <div className="model-empty" style={{ marginTop: 0 }}>无需密钥，点击下方“获取模型列表”检查接口。</div>
          ) : !replacingKey && channel?.keyConfigured ? (
            <div className="saved-key-row">
              <div><span className="saved-key-label">已保存</span><code>{channel.apiKeyMasked || "密钥已保存"}</code></div>
              <button type="button" onClick={() => { setReplacingKey(true); setApiKey(""); setShowKey(false); setFetchState("idle"); setFetchMessage(""); }}>更换密钥</button>
            </div>
          ) : (
            <>
              <div className="key-field">
                <input className="fld" type={showKey ? "text" : "password"} value={apiKey}
                  onChange={(e) => { setApiKey(e.target.value); setFetchState("idle"); setFetchMessage(""); }} placeholder={isNew ? preset.keyHint : "粘贴新的 API Key"} />
                <button className="key-eye" type="button" onClick={() => setShowKey(!showKey)}><Icon name={showKey ? "eyeOff" : "eye"} /></button>
              </div>
              {!isNew && channel?.keyConfigured && <button className="cancel-key-change" type="button" onClick={() => { setReplacingKey(false); setApiKey(""); setShowKey(false); setFetchState("idle"); setFetchMessage(""); }}>取消更换，继续使用 {channel.apiKeyMasked}</button>}
            </>
          )}

          <div className="model-head">
            <label className="field-label" style={{ margin: 0 }}>模型 <span className="lbl-hint">先获取，再选择</span></label>
            <button className={"fetch-btn " + fetchState} onClick={fetchModels}>
              {fetchState === "loading" ? <><span className="test-spin" /> 获取中...</>
                : fetchState === "done" ? <><Icon name="check" /> 已获取 {models.length} 个</>
                : fetchState === "fail" ? <><Icon name="alert" /> 获取失败，点此重试</>
                : <><Icon name="refresh" /> 获取模型列表</>}
            </button>
          </div>
          {fetchMessage && <div className={"channel-feedback " + fetchState}>{fetchMessage}</div>}
          {models.length === 0 && <div className="model-empty">{noKeyRequired ? "这个渠道会自动使用固定生图模型" : realtimeMode ? "豆包实时通话使用 App ID + Access Token；普通文字转语音另需 TTS API Key" : "点「获取模型列表」拉取，或手动输入"}</div>}
          {models.length > 0 && models.length <= 10 && (
            <div className="model-chips" style={{ marginTop: 8 }}>
              {models.map((m) => (
                <button key={m} className={"model-chip" + (model === m ? " on" : "")} onClick={() => setModel(m)}>{m}</button>
              ))}
            </div>
          )}
          {models.length > 10 && (
            <select className="fld" value={model} onChange={(e) => setModel(e.target.value)} style={{ marginTop: 8 }}>
              <option value="">选择模型...</option>
              {models.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          )}
          {taskImageMode ? (
            <div className="model-empty" style={{ marginTop: 8 }}>固定模型：{TASK_IMAGE_MODEL}</div>
          ) : realtimeMode ? (
            <div className="model-empty" style={{ marginTop: 8 }}>固定能力：{VOLC_REALTIME_MODEL}（实时通话）+ {VOLC_TTS_MODEL}（文字转语音）</div>
          ) : (
            <input className="fld" style={{ marginTop: 8 }} value={model} onChange={(e) => setModel(e.target.value)} placeholder="模型名,例如 gpt-5.5" />
          )}



          <label className="field-label">这个模型用来做什么 <span className="lbl-hint">先选模型，再选用途</span></label>
          {!canChoosePurpose && <div className="model-empty" style={{ marginTop: 0 }}>{!connectionReady ? "请先获取模型列表并确认连接。" : "请先选择模型。"}</div>}
          <div className={"type-grid" + (!canChoosePurpose ? " is-disabled" : "")}>
            {(taskImageMode ? PURPOSE_OPTS.filter((p) => p.key === "image") : realtimeMode ? PURPOSE_OPTS.filter((p) => ["tts", "realtime"].includes(p.key)) : PURPOSE_OPTS).map((p) => (
              <button key={p.key} disabled={!canChoosePurpose} className={"type-chip" + (purposes.includes(p.key) ? " on" : "")} onClick={() => togglePurpose(p.key)}>
                {p.label}
              </button>
            ))}
          </div>

          <div className="switch-row">
            <div><div className="sr-t">启用此渠道</div><div className="sr-s">停用后所有用途不会再选到它</div></div>
            <Toggle on={enabled} onClick={() => setEnabled(!enabled)} />
          </div>
        </div>
        <div className="sheet-foot">
          {!isNew && <button className="icon-btn det-del" onClick={() => onDelete(channel.id)}><Icon name="trash" /></button>}
          <div className="grow">
            {saveError && <div className="channel-feedback fail" style={{ marginBottom: 8 }}>{saveError}</div>}
            <button className="pill pill-primary" style={{ width: "100%", opacity: !canSave || saving ? 0.5 : 1 }} disabled={!canSave || saving} onClick={save}>
              {saving ? "保存并应用中..." : isNew ? "添加并应用到所选能力" : "保存并应用到所选能力"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ====== 语音 TTS 配置 Sheet ====== */
function VoiceSheet({ voice, capabilities, onClose, onSave, onPrepareCloud, onRestoreCloud }) {
  useLockBody();
  const [engine, setEngine] = useStateMo(voice?.engine || "browser");
  const [rate, setRate] = useStateMo(voice?.rate ?? 0.9);
  const [qwenVoiceId, setQwenVoiceId] = useStateMo(voice?.voiceId || "longwan");
  const [browserVoiceURI, setBrowserVoiceURI] = useStateMo(voice?.browserVoiceURI || "");
  const [volcVoice, setVolcVoice] = useStateMo(voice?.volcVoice || DEFAULT_VOLC_VOICE);
  const [browserVoices, setBrowserVoices] = useStateMo([]);
  const [testing, setTesting] = useStateMo(false);
  const [saving, setSaving] = useStateMo(false);
  const [error, setError] = useStateMo("");

  const ttsOptions = capabilities?.find((item) => item.capability === "tts")?.options || [];
  const hasVolcTts = ttsOptions.some((item) => item.model_id === VOLC_TTS_MODEL);
  const hasQwenTts = ttsOptions.some((item) => isQwenTtsModel(item.model_id));

  React.useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const load = () => setBrowserVoices(window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("zh")));
    load(); window.speechSynthesis.onvoiceschanged = load;
  }, []);

  const currentConfig = () => ({
    engine,
    rate: Number(rate),
    voiceId: qwenVoiceId.trim() || "longwan",
    browserVoiceURI,
    volcVoice: volcVoice.trim() || DEFAULT_VOLC_VOICE,
  });

  const speakInBrowser = () => speakTextWithSystemVoice("我在呢。今天也会好好陪着你。", {
    language: "zh-CN",
    rate: Number(rate),
    pitch: 1.1,
    browserVoiceURI,
  });

  const test = async () => {
    if (testing) return;
    setTesting(true);
    setError("");
    let preparedCloud = null;
    try {
      if (engine === "browser") {
        await speakInBrowser();
        return;
      }

      const config = currentConfig();
      preparedCloud = await onPrepareCloud(config);
      const result = await previewTts({
        voiceOverride: engine === "volcengine" ? config.volcVoice : config.voiceId,
        rate: config.rate,
      });
      if (!result?.success || !result.audio_url) throw new Error(result?.error || "没有生成试听音频");
      const audio = new Audio(`${result.audio_url}?preview=${Date.now()}`);
      await audio.play();
      await new Promise((resolve, reject) => {
        audio.onended = resolve;
        audio.onerror = () => reject(new Error("试听音频播放失败"));
      });
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      if (preparedCloud) await onRestoreCloud(preparedCloud).catch(() => {});
      setTesting(false);
    }
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      await onSave(currentConfig());
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setSaving(false);
    }
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
            <button key={e.id} className={"engine-row" + (engine === e.id ? " on" : "")} onClick={() => { setEngine(e.id); setError(""); }}>
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
            <div className="voice-tip">免费、即开即用；Android APP 会优先使用手机自带朗读，网页使用浏览器朗读。它只能临时播放，不能保存成角色语音气泡。</div>
          </>)}

          {engine === "qwen" && (<>
            <label className="field-label">千问音色 ID</label>
            <input className="fld" value={qwenVoiceId} onChange={(e) => setQwenVoiceId(e.target.value)} placeholder="longwan 或专属音色 ID" />
            <div className="voice-tip">{hasQwenTts ? "已找到支持文字转语音的千问渠道。" : "还没有发现千问 TTS 模型，请先在接口渠道里配置。"}</div>
          </>)}

          {engine === "volcengine" && (<>
            <label className="field-label">豆包音色 ID</label>
            <input className="fld" value={volcVoice} onChange={(e) => setVolcVoice(e.target.value)} placeholder={DEFAULT_VOLC_VOICE} />
            <div className="voice-tip">{hasVolcTts ? "已找到豆包文字转语音配置。注意：这里需要 TTS API Key，不能直接使用实时通话的 Access Token。" : "普通文字转语音需要单独的豆包 TTS API Key；实时通话的 Access Token 不能直接替代。"}</div>
          </>)}

          <label className="field-label">语速 <span className="lbl-hint">{Number(rate).toFixed(2)}x</span></label>
          <input className="range" type="range" min="0.6" max="1.4" step="0.05" value={rate} onChange={(e) => setRate(e.target.value)} />

          <button className={"test-btn" + (testing ? " loading" : "")} onClick={test} disabled={testing} style={{ marginTop: 16 }}>
            {testing ? <><span className="test-spin" /> 她正在说...</> : <><Icon name="wave" /> 真实试听一句</>}
          </button>
          {error && <div className="voice-tip" style={{ color: "#c4566b", marginTop: 10 }}>{error}</div>}
        </div>
        <div className="sheet-foot">
          <button className="pill pill-primary grow" onClick={save} disabled={saving}>{saving ? "保存中..." : "保存语音"}</button>
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
  const [voiceConfig, setVoiceConfig] = useStateMo(loadVoiceSettings);
  const [channelTests, setChannelTests] = useStateMo({});

  // 能力面板（真实数据）
  const [capabilities, setCaps] = useStateMo([]);
  const [capLoading, setCapLoading] = useStateMo(true);
  const [capPicker, setCapPicker] = useStateMo(null);
  const [capError, setCapError] = useStateMo("");
  const [capSaving, setCapSaving] = useStateMo(false);

  React.useEffect(() => {
    getCapabilities().then((res) => {
      if (res?.success && Array.isArray(res.items)) setCaps(res.items);
    }).catch(() => {}).finally(() => setCapLoading(false));
  }, []);

  const refreshCaps = () => getCapabilities().then((res) => {
    if (res?.success && Array.isArray(res.items)) setCaps(res.items);
    return res;
  }).catch(() => null);

  const toggleCap = async (capKey, currentEnabled) => {
    setCapError("");
    if (!currentEnabled) {
      // 开启时：必须带上已有的 credential_id + model_id，否则后端400
      const cap = capabilities.find((c) => c.capability === capKey);
      if (!cap?.current?.credential_id || !cap?.current?.model_id) {
        // 还没选过模型，直接打开选择器
        setCapPicker(capKey);
        return;
      }
      setCaps((prev) => prev.map((c) => c.capability === capKey ? { ...c, enabled: true } : c));
      try {
        const result = await updateCapability(capKey, {
          enabled: true,
          credential_id: cap.current.credential_id,
          model_id: cap.current.model_id,
        });
        if (!result?.success) throw new Error(result?.error || "启用失败");
      } catch (e) {
        setCapError(e?.message || "启用失败");
        refreshCaps();
      }
    } else {
      // 关闭时不需要带 credential_id/model_id
      setCaps((prev) => prev.map((c) => c.capability === capKey ? { ...c, enabled: false } : c));
      try {
        const result = await updateCapability(capKey, { enabled: false });
        if (!result?.success) throw new Error(result?.error || "关闭失败");
      } catch (e) {
        setCapError(e?.message || "关闭失败");
        refreshCaps();
      }
    }
  };

  const pickCapModel = async (capKey, credentialId, modelId) => {
    setCapError("");
    setCapSaving(true);
    try {
      const result = await updateCapability(capKey, { credential_id: credentialId, model_id: modelId, enabled: true });
      if (!result?.success || !result?.item) throw new Error(result?.error || "模型保存失败");
      setCaps((prev) => prev.map((item) => item.capability === capKey ? result.item : item));
      setCapPicker(null);
      await refreshCaps();
    } catch (e) {
      setCapError(e?.message || "模型保存失败");
    } finally {
      setCapSaving(false);
    }
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
        type: cfg.provider_type === TASK_IMAGE_PROVIDER ? "custom" : (cfg.provider_type || "custom"),
        providerType: cfg.provider_type || "openai-compatible",
        name: cfg.name || "未命名渠道",
        base: cfg.api_base || "",
        apiAuxBase: cfg.api_aux_base || "",
        apiKey: "",
        apiKeyMasked: cfg.api_key_masked || "",
        keyConfigured: cfg.key_configured !== false,
        model: "",
        modelsCount: cfg.models_count || 0,
        enabled: cfg.is_enabled !== false,
        fetched: [],
        _backendId: cfg.id,
      }));
      setChannels(converted);
      const volcCredentialIds = raw
        .filter((cfg) => cfg.provider_type === VOLC_REALTIME_PROVIDER)
        .map((cfg) => cfg.id);
      if (volcCredentialIds.length > 0) {
        Promise.all(volcCredentialIds.map((id) => refreshCredentialModels(id).catch(() => null)))
          .then(() => { if (!cancelled) refreshCaps(); });
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  React.useEffect(() => {
    if (!capabilities.length) return;
    setChannels((prev) => prev.map((channel) => {
      if (!channel._backendId) return channel;
      const assigned = capabilities.filter((item) => Number(item.current?.credential_id) === Number(channel._backendId));
      return {
        ...channel,
        purposes: assigned.map((item) => item.capability),
        model: assigned[0]?.current?.model_id || channel.model || "",
      };
    }));
  }, [capabilities]);

  const refreshChannels = () => getCredentials().then((payload) => {
      const raw = Array.isArray(payload?.items) ? payload.items : [];
      const converted = raw.map((cfg) => ({
        id: String(cfg.id),
        type: cfg.provider_type === TASK_IMAGE_PROVIDER ? "custom" : (cfg.provider_type || "custom"),
        providerType: cfg.provider_type || "openai-compatible",
        name: cfg.name || "未命名渠道",
        base: cfg.api_base || "",
        apiAuxBase: cfg.api_aux_base || "",
        apiKey: "",
        apiKeyMasked: cfg.api_key_masked || "",
        keyConfigured: cfg.key_configured !== false,
        model: "",
        modelsCount: cfg.models_count || 0,
        enabled: cfg.is_enabled !== false,
        fetched: [],
        _backendId: cfg.id,
      }));
      setChannels(converted);
    }).catch(() => {});

  const saveChannel = async (d) => {
    const payload = {
      name: d.name,
      provider_type: d.providerType,
      api_base: d.base,
      api_aux_base: d.taskBase || "",
      is_enabled: d.enabled,
    };
    if (d.providerType === TASK_IMAGE_PROVIDER || d.apiKey) payload.api_key = d.apiKey;

    let backendId = d.id && channels.find((c) => c.id === d.id)?._backendId;
    let result;
    if (backendId) {
      result = await updateCredential(backendId, payload);
    } else {
      result = await createCredential(payload);
      backendId = result?.item?.id;
    }
    if (!result?.success || !backendId) throw new Error(result?.error || "渠道保存失败");

    await refreshCredentialModels(backendId).catch(() => null);
    if (d.enabled && d.purposes?.length) {
      const models = d.providerType === VOLC_REALTIME_PROVIDER
        ? { realtime: VOLC_REALTIME_MODEL, tts: VOLC_TTS_MODEL }
        : {};
      const applied = await applyCredential(backendId, {
        purposes: d.purposes,
        model_id: d.model,
        models,
      });
      if (!applied?.success) throw new Error(applied?.error || "渠道已保存，但应用到能力失败");
    }

    await Promise.all([refreshChannels(), refreshCaps()]);
    setChSheet(undefined);
    return { success: true };
  };

  const testChannel = async (d) => {
    let result;
    const backendId = d.id && channels.find((c) => c.id === d.id)?._backendId;
    result = await testCredentialDraft({
      credential_id: backendId || undefined,
      provider_type: d.providerType,
      api_base: d.base,
      api_aux_base: d.taskBase || "",
      api_key: d.apiKey || "",
    });
    const state = result?.success ? "ok" : "fail";
    if (backendId) {
      setChannelTests((prev) => ({
        ...prev,
        [backendId]: { state, message: result?.message || result?.error || "测试失败", at: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) },
      }));
    }
    if (!result?.success) throw new Error(result?.error || result?.message || "测试失败");
    return result;
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

  const prepareCloudVoice = async (v) => {
    if (v.engine === "browser") return null;
    const ttsCapability = capabilities.find((item) => item.capability === "tts");
    const options = ttsCapability?.options || [];
    const target = selectCloudTtsOption({
      engine: v.engine,
      options,
      current: ttsCapability?.current,
      voiceId: v.voiceId,
    });

    if (!target?.credential_id || !target?.model_id) {
      throw new Error(v.engine === "volcengine"
        ? "还没有可用的豆包语音渠道，请先保存一次“豆包语音”接口渠道"
        : "还没有可用的千问 TTS 模型，请先配置千问语音渠道");
    }

    const voiceId = v.engine === "volcengine" ? (v.volcVoice || DEFAULT_VOLC_VOICE) : (v.voiceId || "longwan");
    const result = await updateCapability("tts", {
      enabled: true,
      credential_id: target.credential_id,
      model_id: target.model_id,
      extras: {
        engine: v.engine,
        voice_id: voiceId,
        resource_id: target.model_id,
        rate: Number(v.rate) || 0.9,
      },
    });
    if (!result?.success) throw new Error(result?.error || "语音渠道保存失败");
    refreshCaps();
    return {
      target,
      previous: ttsCapability?.current ? {
        enabled: ttsCapability.enabled !== false,
        credential_id: ttsCapability.current.credential_id,
        model_id: ttsCapability.current.model_id,
        extras: ttsCapability.current.extras || null,
      } : null,
    };
  };

  const restoreCloudVoice = async (prepared) => {
    const previous = prepared?.previous;
    if (!previous?.credential_id || !previous?.model_id) return;
    await updateCapability("tts", previous);
    await refreshCaps();
  };

  const saveVoice = async (v) => {
    if (v.engine !== "browser") await prepareCloudVoice(v);
    const saved = saveVoiceSettings({ ...voiceConfig, ...v, enabled: true });
    setVoiceConfig(saved);
    setVoiceSheet(false);
  };

  const toggleVoice = async () => {
    const nextEnabled = !voiceConfig.enabled;
    if (nextEnabled && voiceConfig.engine !== "browser") {
      try { await prepareCloudVoice(voiceConfig); } catch { setVoiceSheet(true); return; }
    }
    const saved = saveVoiceSettings({ ...voiceConfig, enabled: nextEnabled });
    setVoiceConfig(saved);
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
                  <span className={"prow-ic " + (voiceConfig.enabled ? info.tint : "")}><Icon name={info.icon} /></span>
                  <span className="prow-main">
                    <span className="prow-t">{info.name}</span>
                    <span className="prow-s">{engineName(voiceConfig.engine)}{voiceConfig.engine === "browser" ? " · 免费" : ""}</span>
                  </span>
                  <Toggle on={voiceConfig.enabled} onClick={(e) => { e.stopPropagation(); toggleVoice(); }} />
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
        {!capLoading && <div className="route-note">“画图发图”是你在聊天里让她画，免费 Agnes 适合先体验；“动态发图”只用于她自动发动态，已排除会返回九宫格的免费模型，建议选 img 生图或猫图片等稳定单图渠道。两项开关、费用和失败状态各自独立。</div>}
        {capError && !capPicker && <div className="route-note" style={{ color: "#c4566b" }}>{capError}</div>}
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
                <span className="prow-s">{c.enabled ? "已启用" : "已停用"} · {c.providerType === TASK_IMAGE_PROVIDER ? "无需密钥" : c.keyConfigured ? "密钥已填写" : "密钥未填写"} · {channelTests[c._backendId]?.state === "ok" ? `连接可用（${channelTests[c._backendId].at}）` : channelTests[c._backendId]?.state === "fail" ? "测试失败" : "尚未测试"}{c.modelsCount > 0 ? ` · ${c.modelsCount} 个模型` : ""}</span>
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
        <ChannelSheet channel={chSheet.channel ? { ...chSheet.channel, testState: channelTests[chSheet.channel._backendId]?.state, testMessage: channelTests[chSheet.channel._backendId]?.message } : null} isNew={chSheet.isNew}
          onClose={() => setChSheet(undefined)} onSave={saveChannel} onDelete={delChannel} onTest={testChannel} />
      )}
      {capPicker && (() => {
        const capData = capabilities.find((c) => c.capability === capPicker);
        return capData ? (
          <CapPicker cap={capPicker} options={capData.options} current={capData.current}
            error={capError} saving={capSaving} onClose={() => { setCapError(""); setCapPicker(null); }} onPick={(credId, modelId) => pickCapModel(capPicker, credId, modelId)} />
        ) : null;
      })()}
      {voiceSheet && (
        <VoiceSheet voice={voiceConfig} capabilities={capabilities} onClose={() => setVoiceSheet(false)} onSave={saveVoice} onPrepareCloud={prepareCloudVoice} onRestoreCloud={restoreCloudVoice} />
      )}
    </>
  );
}

export { ModelsSection };
