const CAPABILITY_META = {
  chat: {
    icon: '💬',
    label: '文字聊天',
    note: '重要对话切贵的，日常闲聊切省的。'
  },
  vision: {
    icon: '👁',
    label: '看懂图片',
    note: '以后你发照片给她，她要靠这里才能真正看懂。'
  },
  image: {
    icon: '🎨',
    label: '画图发图',
    note: '她以后发动态图片、给你画图，就靠这一行。'
  },
  tts: {
    icon: '🔊',
    label: '听她说话',
    note: '以后你点消息朗读、或者想听她说话，就是这一行在管。'
  },
  realtime: {
    icon: '📞',
    label: '实时通话',
    note: '这一项最贵，所以保留按需开的感觉，不强推。'
  }
};

function groupOptions(options = []) {
  const map = new Map();
  for (const option of options) {
    const key = `${option.credential_id}`;
    if (!map.has(key)) {
      map.set(key, {
        credentialId: option.credential_id,
        credentialName: option.credential_name,
        models: []
      });
    }
    map.get(key).models.push({
      credentialId: option.credential_id,
      credentialName: option.credential_name,
      modelId: option.model_id
    });
  }
  return [...map.values()];
}

export function buildQuickChatChoices(current, options = []) {
  if (!current?.credential_id) {
    return [];
  }

  return options
    .filter(option => option.credential_id === current.credential_id && option.model_id !== current.model_id)
    .slice(0, 3)
    .map(option => ({
      credentialId: option.credential_id,
      credentialName: option.credential_name,
      modelId: option.model_id,
      active: false
    }));
}

export function buildCapabilityViewModel(item) {
  const meta = CAPABILITY_META[item.capability] || {
    icon: '✨',
    label: item.capability,
    note: ''
  };
  const options = Array.isArray(item.options) ? item.options : [];
  const optionGroups = groupOptions(options);
  const suggestedModels = options.slice(0, 2).map(option => option.model_id);
  const firstAvailable = options.length
    ? {
        credentialId: options[0].credential_id,
        credentialName: options[0].credential_name,
        modelId: options[0].model_id
      }
    : null;

  return {
    capability: item.capability,
    icon: meta.icon,
    label: meta.label,
    note: meta.note,
    enabled: Boolean(item.enabled),
    stateText: item.enabled ? '开启' : '关闭',
    current: item.current || null,
    currentLabel: item.current
      ? `${item.current.credential_name} / ${item.current.model_id}`
      : '',
    optionGroups,
    suggestedModels,
    firstAvailable,
    canEnableQuickly: Boolean(firstAvailable),
    emptyHint: firstAvailable ? '想开启？检测到' : '你的凭证里还没有能干这件事的模型',
    quickChatChoices: item.capability === 'chat'
      ? buildQuickChatChoices(item.current, options)
      : []
  };
}
