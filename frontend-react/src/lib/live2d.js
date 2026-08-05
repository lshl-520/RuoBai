export function getLive2DRuntime(globalObject = globalThis) {
  const runtime = globalObject?.__RUOBAI_LIVE2D_RUNTIME__;
  return runtime && typeof runtime.mount === "function" ? runtime : null;
}

export function detectLive2DMode({ modelUrl, staticSrc, runtime } = {}) {
  if (modelUrl && runtime && typeof runtime.mount === "function") return "live2d";
  if (staticSrc) return "static";
  return "pseudo";
}
