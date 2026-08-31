export function getLive2DRuntime(globalObject = globalThis) {
  const runtime = globalObject?.__RUOBAI_LIVE2D_RUNTIME__;
  return runtime && typeof runtime.mount === "function" ? runtime : null;
}

// A broken or very large model must not leave the chat room in a permanent
// loading state. If the adapter resolves after the timeout, dispose its late
// controller so the fallback can take over cleanly.
export function runWithTimeout(task, timeoutMs, timeoutMessage = "Live2D 模型加载超时") {
  let timedOut = false;
  let timer = null;
  const work = Promise.resolve()
    .then(task)
    .then((result) => {
      if (timedOut) {
        if (typeof result === "function") result();
        return undefined;
      }
      return result;
    });
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(new Error(timeoutMessage));
    }, Math.max(1, Number(timeoutMs) || 1));
  });

  return Promise.race([work, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export function getLive2DCoreUrl(globalObject = globalThis) {
  const configured = globalObject?.__RUOBAI_LIVE2D_CORE_URL__;
  if (typeof configured === "string" && configured.trim()) return configured.trim();

  // Keep the direct `import.meta.env` access so Vite replaces local env values.
  const envUrl = import.meta.env?.VITE_RUOBAI_LIVE2D_CORE_URL;
  return typeof envUrl === "string" ? envUrl.trim() : "";
}

export function detectLive2DMode({ modelUrl, staticSrc, runtime } = {}) {
  if (modelUrl && runtime && typeof runtime.mount === "function") return "live2d";
  if (staticSrc) return "static";
  return "pseudo";
}
