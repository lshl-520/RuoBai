/* 若白 · 微光 2.0 — 共享图标与渠道预设
   （2026/9/17 整理：移除了写死的私人演示数据 —— 角色/聊天/动态/记忆/历史，
     它们会让公开仓库带着私人语境，也会误导部署者以为是真实数据。
     真实数据全部来自后端 API。） */
import { useEffect } from "react";



/* ===== 渠道类型预设(对齐后端 providerType) ===== */
const CHANNEL_TYPES = {
  openai:     { name: "OpenAI 官方",   base: "https://api.openai.com/v1",                         keyHint: "sk-...",  caps: ["chat", "image", "voice"], models: ["gpt-5.5", "gpt-5.4", "gpt-5.3", "gpt-4o", "gpt-4o-mini"] },
  grok:       { name: "Grok 官方",     base: "https://api.x.ai/v1",                               keyHint: "xai-...", caps: ["chat", "image"],          models: ["grok-4", "grok-3", "grok-3-mini"] },
  deepseek:   { name: "DeepSeek 官方", base: "https://api.deepseek.com",                          keyHint: "sk-...",  caps: ["chat"],                   models: ["deepseek-chat", "deepseek-reasoner"] },
  dashscope:  { name: "阿里千问官方",   base: "https://dashscope.aliyuncs.com/compatible-mode/v1", keyHint: "sk-...",  caps: ["chat", "image", "voice"], models: ["qwen-max", "qwen-plus", "qwen-turbo", "qwen-vl-max"] },
  volcengine: { name: "火山方舟",      base: "https://ark.cn-beijing.volces.com/api/v3",          keyHint: "...",     caps: ["chat", "image", "voice"], models: ["doubao-pro-32k", "doubao-lite-32k", "doubao-vision-pro"] },
  "volc-realtime": { name: "豆包语音", base: "wss://openspeech.bytedance.com/api/v3/realtime/dialogue", keyHint: "新版豆包语音 API Key", caps: ["realtime", "voice"], models: ["2.2.0.0", "seed-tts-2.0"] },
  custom:     { name: "自定义 / 中转", base: "https://",                                          keyHint: "sk-...",  caps: ["chat", "image", "voice"], models: [] },
  "openai-compatible": { name: "OpenAI兼容", base: "https://", keyHint: "sk-...", caps: ["chat", "image", "voice"], models: [] }, // 后端兼容用，不在UI显示
};


/* ===== 语音引擎 ===== */
const VOICE_ENGINES = [
  { id: "browser", name: "手机 / 浏览器朗读", sub: "免费 · 无需密钥 · 取决于设备语音服务", free: true },
  { id: "qwen", name: "千问 TTS", sub: "阿里千问 · 自然女声", free: false },
  { id: "volcengine", name: "豆包文字转语音", sub: "需单独的 TTS API Key · 高拟真", free: false },
];


export function useLockBody() {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);
}


/* 时辰问候 */
function greetByHour() {
  const h = new Date().getHours();
  if (h < 6) return "还没睡呀";
  if (h < 11) return "早安";
  if (h < 14) return "午安";
  if (h < 19) return "下午好";
  return "晚上好";
}

/* ===================== 共享图标 ===================== */
function Icon({ name, ...p }) {
  const paths = {
    agents: <><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/><circle cx="17.5" cy="7" r="2.4"/><path d="M16 13.4c2.8 0 4.5 1.8 4.5 4.6"/></>,
    chat: <><path d="M20 11.5a7.5 7.5 0 0 1-10.4 6.9L4 19.5l1.2-4.1A7.5 7.5 0 1 1 20 11.5z"/></>,
    moments: <><circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8"/></>,
    me: <><circle cx="12" cy="8" r="3.6"/><path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6"/></>,
    back: <polyline points="15 18 9 12 15 6"/>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></>,
    heart: <path d="M12 20s-7-4.4-9.3-8.2C1 8.6 2.6 5.5 5.7 5.5c1.9 0 3.1 1.1 3.8 2.2.7-1.1 1.9-2.2 3.8-2.2 3.1 0 4.7 3.1 3 6.3C19 15.6 12 20 12 20z"/>,
    heartFill: <path d="M12 20s-7-4.4-9.3-8.2C1 8.6 2.6 5.5 5.7 5.5c1.9 0 3.1 1.1 3.8 2.2.7-1.1 1.9-2.2 3.8-2.2 3.1 0 4.7 3.1 3 6.3C19 15.6 12 20 12 20z"/>,
    send: <path d="M5 12l14-7-5.5 7L19 19z"/>,
    share: <><circle cx="18" cy="5" r="2.2"/><circle cx="6" cy="12" r="2.2"/><circle cx="18" cy="19" r="2.2"/><path d="M8 11l7.8-4.5M8 13l7.8 4.5"/></>,
    more: <><circle cx="5" cy="12" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="19" cy="12" r="1.9"/></>,
    x: <><path d="M6 6l12 12M18 6L6 18"/></>,
    card: <><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M7 9h5M7 13h8"/></>,
    comment: <path d="M20 11.5a7.5 7.5 0 0 1-10.4 6.9L4 19.5l1.2-4.1A7.5 7.5 0 1 1 20 11.5z"/>,
    thinking: <><path d="M12 3a6 6 0 0 0-3.5 10.9c.4.3.6.7.6 1.2v.9h5.8v-.9c0-.5.2-.9.6-1.2A6 6 0 0 0 12 3z"/><path d="M9.5 19.5h5M10.5 22h3"/></>,
    brain: <><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 0 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 0 1 12 18Z"/><path d="M12 5v13M8 8.5c0 1.5 1 2 2 2M16 8.5c0 1.5-1 2-2 2M8 15c1 0 2-.5 2-1.5M16 15c-1 0-2-.5-2-1.5"/></>,
    chevron: <polyline points="9 6 15 12 9 18"/>,
    chevronD: <polyline points="6 9 12 15 18 9"/>,
    image: <><rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="M21 16l-5-5L5 20"/></>,
    mic: <><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 11a6 6 0 0 0 12 0M12 17v3"/></>,
    keyboard: <><rect x="2" y="6" width="20" height="13" rx="2.5"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h12M8 14v-1M16 14v-1"/></>,
    edit: <><path d="M14 5l5 5M4 20l1-4L16.5 4.5a2 2 0 0 1 3 3L8 19l-4 1z"/></>,
    trash: <><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></>,
    cpu: <><rect x="6" y="6" width="12" height="12" rx="2.5"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/></>,
    book: <><path d="M5 4h11a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2z"/><path d="M5 16h13"/></>,
    wave: <><path d="M4 12h2M9 6v12M14 3v18M19 9v6"/></>,
    spark: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>,
    globe: <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18"/></>,
    bell: <><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6"/><path d="M10 20a2 2 0 0 0 4 0"/></>,
    shield: <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></>,
    flame: <path d="M12 3c1 3 4 4 4 8a4 4 0 0 1-8 0c0-1.5.8-2.4.8-2.4C9.6 9.5 11 8 12 3z"/>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    sparkSm: <path d="M12 4l1.4 4L17 9.4 13.4 11 12 15l-1.4-4L7 9.4 10.6 8z"/>,
    add: <><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></>,
    logout: <><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M9 16l-4-4 4-4M5 12h11"/></>,
    flower: <><circle cx="12" cy="12" r="2.6"/><path d="M12 9.4C12 6 13.8 4 12 4s0 3.4 0 5.4M12 14.6C12 18 10.2 20 12 20s0-3.4 0-5.4M9.4 12C6 12 4 10.2 4 12s3.4 0 5.4 0M14.6 12C18 12 20 13.8 20 12s-3.4 0-5.4 0"/></>,
    star: <path d="M12 3.5l2.5 5.3 5.8.7-4.3 4 1.1 5.7L12 21.6 6.9 18.7 8 13l-4.3-4 5.8-.7z"/>,
    play: <path d="M7 4.5l12 7.5-12 7.5z"/>,
    pause: <><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></>,
    phone: <path d="M5 4h3.5l1.5 4-2 1.5a12 12 0 0 0 5 5l1.5-2 4 1.5V19a2 2 0 0 1-2 2A16 16 0 0 1 4 6a2 2 0 0 1 1-2z"/>,
    palette: <><path d="M12 3a9 9 0 1 0 0 18c1.4 0 2-1 2-2 0-1.4-1-1.6-1-2.6 0-.8.7-1.4 1.6-1.4H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8z"/><circle cx="7.5" cy="11.5" r="1" fill="currentColor"/><circle cx="12" cy="8" r="1" fill="currentColor"/><circle cx="16" cy="10" r="1" fill="currentColor"/></>,
    key: <><circle cx="8" cy="15" r="4"/><path d="M10.8 12.2L20 3M17 6l2 2M14 9l2 2"/></>,
    user: <><circle cx="12" cy="8" r="3.6"/><path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6"/></>,
    eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></>,
    eyeOff: <><path d="M3 3l18 18M10.6 10.6a3 3 0 0 0 4.2 4.2M9.4 5.2A9.5 9.5 0 0 1 12 5c6.5 0 10 7 10 7a16 16 0 0 1-3.4 4.3M6.4 6.4A16 16 0 0 0 2 12s3.5 7 10 7a9.5 9.5 0 0 0 3.2-.5"/></>,
    check: <polyline points="4 12 10 18 20 6"/>,
    refresh: <><path d="M3.5 12a8.5 8.5 0 0 1 14.5-6M20.5 12A8.5 8.5 0 0 1 6 18"/><polyline points="17 2 18 6 14 6.5"/><polyline points="7 22 6 18 10 17.5"/></>,
    swap: <><path d="M7 4v13M4 14l3 3 3-3M17 20V7M14 10l3-3 3 3"/></>,
    coin: <><ellipse cx="12" cy="6.5" rx="7" ry="3"/><path d="M5 6.5v11c0 1.7 3.1 3 7 3s7-1.3 7-3v-11M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/></>,
    sliders: <><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2.2"/><circle cx="8" cy="17" r="2.2"/></>,
    alert: <><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.5"/></>,
    download: <><path d="M12 3v12M7 10l5 5 5-5M5 20h14"/></>,
    stop: <rect x="6" y="6" width="12" height="12" rx="2"/>,
    lock: <><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></>,
    /* 2026/9/15：表情入口图标。原来的 star（空心星）辨识度差，
       换成小白的爪印——一眼就知道是"用她的表情"。 */
    paw: <><ellipse cx="12" cy="15.6" rx="4.5" ry="3.8"/><ellipse cx="6.4" cy="10.6" rx="2" ry="2.5"/><ellipse cx="10" cy="7.4" rx="1.9" ry="2.4"/><ellipse cx="14" cy="7.4" rx="1.9" ry="2.4"/><ellipse cx="17.6" cy="10.6" rx="2" ry="2.5"/></>,
  };
  return (
    <svg viewBox="0 0 24 24" fill={["heartFill","spark","sparkSm","flame","play","pause","paw"].includes(name) ? "currentColor" : "none"}
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
      {paths[name]}
    </svg>
  );
}

function Bars() {
  return (
    <svg width="46" height="14" viewBox="0 0 46 14" fill="currentColor">
      <rect x="0" y="3" width="4" height="8" rx="1"/><rect x="6" y="1.5" width="4" height="9.5" rx="1"/>
      <rect x="12" y="0" width="4" height="11" rx="1" opacity="0.4"/>
      <rect x="22" y="1" width="16" height="10" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.5"/>
      <rect x="23.5" y="2.5" width="11" height="7" rx="1.2"/><rect x="39" y="4" width="2" height="4" rx="1" opacity="0.5"/>
    </svg>
  );
}

export { CHANNEL_TYPES, VOICE_ENGINES, Icon, Bars, greetByHour };
