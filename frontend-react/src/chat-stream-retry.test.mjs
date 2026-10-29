import test from "node:test";
import assert from "node:assert/strict";
import { streamAssistantReply } from "./lib/chat.js";

// 用 SSE 流构造一个会成功的回复
function sseResponse(text) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

test("网络半断的第一次失败会自动重试并成功", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) throw new TypeError("Failed to fetch");
    return sseResponse("我在呢");
  };

  const tokens = [];
  try {
    await streamAssistantReply(48, { content: "在吗" }, {
      onToken: (t) => tokens.push(t),
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls, 2);
  assert.deepEqual(tokens, ["我在呢"]);
});

test("502 中转抖动会自动重试一次", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return new Response("{}", { status: 502 });
    return sseResponse("接上了");
  };

  const tokens = [];
  try {
    await streamAssistantReply(48, { content: "在吗" }, {
      onToken: (t) => tokens.push(t),
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls, 2);
  assert.deepEqual(tokens, ["接上了"]);
});

test("业务错误（4xx）不会自动重试", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: "模型配置错误" }), { status: 400 });
  };

  let caught = null;
  try {
    await streamAssistantReply(48, { content: "在吗" }, {});
  } catch (e) {
    caught = e;
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls, 1);
  assert.ok(caught instanceof Error);
});

test("已经开始吐内容后中断，不再自动重试", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "前面" } }] })}\n\n`));
        setTimeout(() => controller.error(new TypeError("Failed to fetch")), 20);
      },
    });
    return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  };

  const tokens = [];
  let caught = null;
  try {
    await streamAssistantReply(48, { content: "在吗" }, {
      onToken: (t) => tokens.push(t),
    });
  } catch (e) {
    caught = e;
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls, 1);
  assert.deepEqual(tokens, ["前面"]);
  assert.ok(caught instanceof Error);
});
