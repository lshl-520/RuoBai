export function getLive2DRuntime(globalObject = globalThis) {
  const runtime = globalObject?.__RUOBAI_LIVE2D_RUNTIME__;
  return runtime && typeof runtime.mount === "function" ? runtime : null;
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
