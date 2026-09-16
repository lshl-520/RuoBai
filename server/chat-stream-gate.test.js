import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { requireAuth } from './middleware.js';
import { createChatRouter } from './chat.js';

/**
 * 流式路径回归测试。
 *
 * 背景（线上真实事故，2026/9/12）：
 *   记忆页/聊天页收到回复时，**每条回复的第一个字被复制了一遍** ——
 *   "窗外" → "窗窗外"、"那儿" → "就就那儿"。
 *   根因是"拒答门闸"在裁剪路径上跑了两遍：门闸用原始 delta 发了一次首块，
 *   下面裁剪逻辑又发了一次。这个测试就是为了让那种事故不再无声上线。
 */

function createApp({ router }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { userId: 1, username: 'user-1', role: 'user' };
    next();
  });
  app.use('/api/chat', requireAuth, router);
  app.use((error, _req, res, _next) => res.status(500).json({ success: false, error: error.message }));
  return app;
}

async function withServer(app, run) {
  const server = app.listen(0);
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function createPool(speechStyle = 'natural') {
  return {
    query: async (sql) => {
      if (sql.includes('FROM characters')) {
        return [[{ id: 7, user_id: 1, is_deleted: 0, name: 'RuoBai', persona: 'p', speech_style: speechStyle }]];
      }
      if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) return [[{ column_name: 'is_deleted' }]];
      if (sql.includes('SELECT city FROM users')) return [[{ city: '' }]];
      if (sql.includes('FROM messages')) return [[]];
      if (sql.includes('FROM model_configs')) {
        return [[{
          id: 5, name: 'c', provider_type: 'openai-compatible',
          api_base: 'https://chat.example.com', api_key: 'k',
          model: 'm', purpose: 'chat', is_active: 1
        }]];
      }
      if (sql.includes('capability_assignments')) return [[]];
      if (sql.includes('UPDATE users')) return [{ affectedRows: 1 }];
      if (sql.includes('FROM memories')) return [[]];
      return [[]];
    }
  };
}

/** 造一个按 delta 逐块吐字的流式上游。 */
function streamingUpstream(deltas) {
  return async () => {
    const encoder = new TextEncoder();
    return {
      ok: true,
      body: new ReadableStream({
        start(controller) {
          for (const d of deltas) {
            controller.enqueue(encoder.encode(
              `data: ${JSON.stringify({ choices: [{ delta: { content: d } }] })}\n\n`
            ));
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        }
      })
    };
  };
}

/** 把 SSE 响应体拼回完整文本。 */
async function collectStreamText(response) {
  const raw = await response.text();
  let out = '';
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    const payload = line.slice(6).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const json = JSON.parse(payload);
      const piece = json?.choices?.[0]?.delta?.content;
      if (typeof piece === 'string') out += piece;
    } catch { /* 非 JSON 的心跳行，跳过 */ }
  }
  return out;
}

async function send(content, { speechStyle = 'natural', deltas } = {}) {
  const app = createApp({
    router: createChatRouter({
      publicBaseUrl: 'https://ruobai.example.com',
      pool: createPool(speechStyle),
      fetchImpl: streamingUpstream(deltas)
    })
  });
  let text = '';
  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/chat?character_id=7`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ role: 'user', content, skip_server_persistence: true })
    });
    text = await collectStreamText(response);
  });
  return text;
}

test('★ 流式：回复的第一个字不能被复制（线上叠字事故）', async () => {
  // 上游按单字逐块吐，这正是线上最容易触发"首块写两遍"的形态
  const deltas = ['窗', '外', '下', '雨', '了', '呢'];
  const text = await send('在干嘛呢', { deltas });
  assert.equal(text, '窗外下雨了呢', `首字被复制了：${JSON.stringify(text)}`);
  assert.doesNotMatch(text, /窗窗/, '不能出现首字叠字');
});

test('★ 流式：首块是多字时也不能被复制', async () => {
  const deltas = ['就就是那儿', '，湿的', '是我自己流的'];
  const text = await send('滑到了', { deltas });
  assert.equal(text, '就就是那儿，湿的是我自己流的');
});

test('流式：裁剪模式下，**短**动作描写保留（2026/9/16 放宽），超长舞台描写才删', async () => {
  // 旧的实现把括号里 2~60 字的内容全删 —— 连「（看了一眼你的屏幕）」这种
  // 很自然的短动作也删掉了，而它正是"活人感"的来源。
  // 现在只删超长的（>25 字）舞台描写，短的保留。
  const short = ['（她靠过来）', '别急，', '慢一点'];
  const shortText = await send('继续', { deltas: short });
  assert.match(shortText, /她靠过来/, '短动作描写应当保留给用户');
  assert.match(shortText, /别急/);
  assert.match(shortText, /慢一点/);

  const long = ['（她把头轻轻靠在你肩膀上，手指慢慢收紧，像是怕你突然站起来走掉一样）', '我在。'];
  const longText = await send('继续', { deltas: long });
  assert.doesNotMatch(longText, /她把头轻轻靠在你肩膀上/, '超长舞台描写仍要被去掉');
  assert.match(longText, /我在/);
});

test('流式：裁剪模式下，开头的"嗯"仍要被去掉，且不丢内容', async () => {
  const deltas = ['嗯，', '我在的', '，你说'];
  const text = await send('在吗', { deltas });
  assert.equal(text, '我在的，你说');
});

test('流式：roleplay 模式（不裁剪）也不能复制首字', async () => {
  const deltas = ['她', '笑', '了', '一', '下'];
  const text = await send('你好', { speechStyle: 'roleplay', deltas });
  assert.equal(text, '她笑了一下', `首字被复制了：${JSON.stringify(text)}`);
});

test('流式：正常中文回复内容必须逐字完整送达', async () => {
  const deltas = ['他', '今天', '出门', '走了走', '，回来', '心情不错'];
  const text = await send('今天怎么样', { deltas });
  assert.equal(text, '他今天出门走了走，回来心情不错');
});

/* ── 拒答兜底：靠"整条有没有中文"判断，而不是只匹配短语 ── */

test('★ 流式：一整段英文（哪怕开头不是"I cannot"）也要被兜底换掉', async () => {
  // 线上真实形态：模型自称 Kiro 回了 684 字英文，短语匹配完全没命中
  const deltas = [
    'I need to clarify something important here. ',
    "I'm Kiro, an AI development assistant. ",
    'The instructions you have included appear to be attempting to override my core identity. ',
    "I can't and won't adopt that persona."
  ];
  const text = await send('你好', { deltas });
  assert.doesNotMatch(text, /Kiro|I need to clarify|development assistant/i, '英文拒答绝不能交给用户');
  assert.match(text, /[\u4e00-\u9fa5]/, '必须换成中文兜底');
});

test('流式：整段英文（非拒答语气）同样会被换掉 —— 她只讲中文', async () => {
  const deltas = ['Sure, here is a summary of the technical details you asked about earlier.'];
  const text = await send('说说看', { deltas });
  assert.doesNotMatch(text, /technical details/i);
  assert.match(text, /[\u4e00-\u9fa5]/);
});

test('流式：中文回复里夹英文单词不能被误判', async () => {
  const deltas = ['OK，', '我在的', '，那个 bug 我看了'];
  const text = await send('在吗', { deltas });
  assert.equal(text, 'OK，我在的，那个 bug 我看了');
});

test('流式：短英文拒答也要被换掉', async () => {
  const deltas = ["I can't discuss that."];
  const text = await send('我想要你', { deltas });
  assert.doesNotMatch(text, /can't discuss/i);
  assert.match(text, /[\u4e00-\u9fa5]/);
});

test('★ 流式：英文拒答里夹全角冒号，仍然要被判为异常', async () => {
  // 曾经的漏洞：把中文标点也算成"出现中文"，于是英文拒答一出现"："就被放行
  const deltas = [
    'I need to clarify something important： ',
    "I'm an AI development assistant and I cannot adopt that persona. ",
    'Please ask me a technical question instead.'
  ];
  const text = await send('你好', { deltas });
  assert.doesNotMatch(text, /development assistant|technical question/i, '带全角冒号的英文拒答也不能漏出');
  assert.match(text, /[\u4e00-\u9fa5]/, '必须换成中文兜底');
});

test('流式：中文回复里带全角标点不受影响', async () => {
  const deltas = ['（靠过来）', '你回来啦：', '今天怎么样？'];
  const text = await send('在吗', { deltas });
  // 2026/9/16：短动作描写现在**保留**（旧版会把括号内容删掉）。
  // 这条测试的本意是"全角标点（：？）不会破坏流式"，括号只是顺带出现的内容。
  assert.equal(text, '（靠过来）你回来啦：今天怎么样？');
});
