import { getModelSettings } from './store.js';

export async function sendMessage(messages, systemPrompt) {
  const settings = getModelSettings();
  if (!settings.apiBase || !settings.apiKey || !settings.model) {
    throw new Error('请先在“我的 - 设置中心”配置 Provider、API Key 和模型名称。');
  }

  return fetch(`${settings.apiBase.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify({
      model: settings.model,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      temperature: settings.temperature,
      max_tokens: settings.maxTokens,
      stream: true
    })
  });
}

export async function streamChat(messages, systemPrompt, onChunk, onDone, onError) {
  try {
    const res = await sendMessage(messages, systemPrompt);
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(detail || `请求失败：${res.status}`);
    }
    if (!res.body) throw new Error('当前浏览器不支持流式响应。');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith('data:')) continue;

        const data = line.slice(5).trim();
        if (!data) continue;
        if (data === '[DONE]') {
          onDone?.();
          return;
        }

        try {
          const json = JSON.parse(data);
          const content = json.choices?.[0]?.delta?.content ?? json.choices?.[0]?.message?.content;
          if (content) onChunk?.(content);
        } catch {
          // Ignore provider keepalive or malformed partial chunks.
        }
      }
    }
    onDone?.();
  } catch (error) {
    onError?.(error);
  }
}
