import { getLive2DRuntime } from "./live2d.js";
import { apiFetch } from "./api-base.js";

const runtimePromises = new WeakMap();
const importRuntime = () => import("./live2d-runtime.js");

// Keep the Pixi/Cubism bundle out of the initial app module. It is only needed
// after a role with a real Live2D model has reached a visible stage.
export function loadLive2DRuntime(globalObject = globalThis, importer = importRuntime) {
  const existing = getLive2DRuntime(globalObject);
  if (existing) return Promise.resolve(existing);

  const pending = runtimePromises.get(globalObject);
  if (pending) return pending;

  const promise = Promise.resolve()
    .then(() => importer())
    .then(({ createLive2DRuntime }) => {
      const current = getLive2DRuntime(globalObject);
      if (current) return current;

      const runtime = createLive2DRuntime();
      globalObject.__RUOBAI_LIVE2D_RUNTIME__ = runtime;
      return runtime;
    });

  runtimePromises.set(globalObject, promise);
  promise.catch(() => {
    if (runtimePromises.get(globalObject) === promise) runtimePromises.delete(globalObject);
  });
  return promise;
}

/**
 * 2026/10/14：提前预热 Live2D，减少「点进聊天室还要等很久」的体感。
 * 只加载必要的两样：运行库 chunk（本地）+ Cubism 核心库（自托管）；
 * 传入 modelUrl 时顺手把模型入口文件拉进 HTTP 缓存（贴图仍然按需加载）。
 * 任何一步失败都不影响正常流程 —— 只是没预热成功而已。
 */
export async function preloadLive2DRuntime({ modelUrl = "" } = {}) {
  const runtime = await loadLive2DRuntime();
  try {
    await runtime?.preload?.();
  } catch {
    /* 预热失败不影响进入聊天室时的正常加载 */
  }
  if (modelUrl) {
    try {
      await apiFetch(modelUrl, { timeoutMs: 8000 });
    } catch {
      /* 模型入口文件拉不到也不影响后续按需加载 */
    }
  }
  return runtime;
}
