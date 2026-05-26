const CAPABILITY_META = [
  { capability: 'chat', label: '文字聊天' },
  { capability: 'vision', label: '看懂图片' },
  { capability: 'image', label: '画图发图' },
  { capability: 'tts', label: '听她说话' },
  { capability: 'realtime', label: '实时通话' }
];

const SUPPLIER_PRESETS = [
  {
    id: 'deepseek',
    label: 'DeepSeek 官方',
    apiBase: 'https://api.deepseek.com',
    icon: '🧠',
    note: '便宜，活人感一般',
    isCustom: false
  },
  {
    id: 'dashscope',
    label: '阿里千问官方',
    apiBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    icon: '🎙',
    note: '国产，TTS 强',
    isCustom: false
  },
  {
    id: 'volcengine',
    label: '火山豆包',
    apiBase: 'https://ark.cn-beijing.volces.com/api/v3',
    icon: '🌋',
    note: '国产，活人感 +++',
    isCustom: false
  },
  {
    id: 'grok',
    label: 'Grok 官方',
    apiBase: 'https://api.x.ai/v1',
    icon: '⚡',
    note: '体验好，要美区 key',
    isCustom: false
  },
  {
    id: 'openai',
    label: 'OpenAI 官方',
    apiBase: 'https://api.openai.com/v1',
    icon: '✨',
    note: '贵，被墙',
    isCustom: false
  },
  {
    id: 'custom',
    label: '自定义 / 中转',
    apiBase: '',
    icon: '🛠',
    note: 'gpt5x 中转、Grok2API 等',
    isCustom: true
  }
];

const PREFERRED_MODEL_KEYWORDS = {
  chat: ['gpt-5.5', 'gpt-5', 'claude', 'qwen-max', 'deepseek-chat'],
  vision: ['vl-max', 'vl-plus', 'vision', '4o', 'omni'],
  image: ['gpt-image', 'wanx', 'seed-image', 'flux', 'sdxl'],
  tts: ['tts', 'speech', 'voice'],
  realtime: ['realtime', 'omni', 'live']
};

export function listSupplierPresets() {
  return SUPPLIER_PRESETS.map(item => ({ ...item }));
}

export function buildSupplierPresetDraft(providerId = 'custom') {
  const preset = SUPPLIER_PRESETS.find(item => item.id === providerId) || SUPPLIER_PRESETS[SUPPLIER_PRESETS.length - 1];

  return {
    providerId: preset.id,
    providerLabel: preset.label,
    name: '',
    apiBase: preset.apiBase,
    isCustom: Boolean(preset.isCustom),
    showApiBaseField: Boolean(preset.isCustom),
    apiBaseReadonly: !preset.isCustom
  };
}

export function pickRecommendedModel(capability, models = []) {
  const list = Array.isArray(models) ? models.filter(Boolean) : [];
  if (!list.length) {
    return '';
  }

  const keywords = PREFERRED_MODEL_KEYWORDS[capability] || [];
  for (const keyword of keywords) {
    const hit = list.find(model => String(model).toLowerCase().includes(keyword));
    if (hit) {
      return hit;
    }
  }

  return list[0];
}

export function buildSupplierCapabilitySummary(payload = {}) {
  const summary = payload.summary || {};

  return CAPABILITY_META.map(item => {
    const models = Array.isArray(summary[item.capability]) ? summary[item.capability] : [];
    return {
      capability: item.capability,
      label: item.label,
      count: models.length,
      available: models.length > 0,
      recommendedModel: pickRecommendedModel(item.capability, models),
      models
    };
  });
}
