import test from "node:test";
import assert from "node:assert/strict";
import { getMessages } from "./lib/chat.js";

test("chat history requests include an optional before_id cursor", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    return new Response(JSON.stringify({ success: true, items: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    await getMessages(48, 40, { beforeId: 1234 });
    await getMessages(48, 40);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(requests[0].url, "/api/chat?character_id=48&limit=40&before_id=1234");
  assert.equal(requests[1].url, "/api/chat?character_id=48&limit=40");
});
