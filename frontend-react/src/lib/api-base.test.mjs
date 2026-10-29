import assert from "node:assert/strict";
import test from "node:test";

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("apiFetch turns an ordinary stalled request into a readable timeout", async () => {
  globalThis.fetch = (_url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
  });

  const { apiFetch } = await import("./api-base.js?timeout-test");
  await assert.rejects(
    apiFetch("/api/slow", { timeoutMs: 5 }),
    (error) => error?.name === "AbortError"
      && error?.code === "REQUEST_TIMEOUT"
      && /超时/.test(error.message),
  );
});

test("apiFetch preserves a caller-provided signal", async () => {
  const controller = new AbortController();
  let receivedSignal;
  globalThis.fetch = async (_url, options) => {
    receivedSignal = options.signal;
    return new Response("ok", { status: 200 });
  };

  const { apiFetch } = await import("./api-base.js?signal-test");
  await apiFetch("/api/fast", { signal: controller.signal });
  assert.equal(receivedSignal, controller.signal);
});
