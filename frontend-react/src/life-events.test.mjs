import test from "node:test";
import assert from "node:assert/strict";
import { getLifeEventSource, getLifeEventStatusLabel, getLifeEventStatusHint, LIFE_EVENT_STATUS_OPTIONS } from "./lib/life-events.js";

test("life event status labels stay in plain language", () => {
  assert.equal(getLifeEventStatusLabel("completed"), "已经完成");
  assert.equal(getLifeEventStatusLabel("expired"), "已经过期");
  assert.equal(getLifeEventStatusLabel("unknown"), "还没完成");
  assert.equal(getLifeEventStatusHint("postponed"), "这件事还没做，改到以后。");
  assert.deepEqual(LIFE_EVENT_STATUS_OPTIONS.map(([value]) => value), [
    "active", "completed", "postponed", "cancelled", "expired",
  ]);
});

test("source lookup rejects malformed references before making a request", async () => {
  await assert.rejects(() => getLifeEventSource(4, "role:9"), /来源编号非法/);
  await assert.rejects(() => getLifeEventSource(4, "chat:nope"), /来源编号非法/);
});
