import test from "node:test";
import assert from "node:assert/strict";
import { loadLive2DRuntime } from "./lib/live2d-loader.js";

test("Live2D runtime loader deduplicates imports and exposes the runtime", async () => {
  const globalObject = {};
  let imports = 0;
  const importer = async () => {
    imports += 1;
    return { createLive2DRuntime: () => ({ mount() {} }) };
  };

  const [first, second] = await Promise.all([
    loadLive2DRuntime(globalObject, importer),
    loadLive2DRuntime(globalObject, importer),
  ]);

  assert.equal(first, second);
  assert.equal(imports, 1);
  assert.equal(globalObject.__RUOBAI_LIVE2D_RUNTIME__, first);
});

test("an existing runtime avoids a dynamic import", async () => {
  const runtime = { mount() {} };
  const globalObject = { __RUOBAI_LIVE2D_RUNTIME__: runtime };
  let imported = false;

  const result = await loadLive2DRuntime(globalObject, async () => {
    imported = true;
    return { createLive2DRuntime: () => ({ mount() {} }) };
  });

  assert.equal(result, runtime);
  assert.equal(imported, false);
});
