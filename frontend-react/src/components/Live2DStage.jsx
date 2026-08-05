import React from "react";
import { detectLive2DMode, getLive2DRuntime } from "../lib/live2d.js";

/*
 * The project does not bundle Cubism/Pixi yet. A runtime adapter can be
 * provided later without changing role identity data. It must expose
 * mount(container, { modelUrl, alt }) and may return a cleanup function.
 */
export function Live2DStage({ modelUrl = "", staticSrc = "", fallbackSrc = "", alt = "角色", runtime = null, className = "" }) {
  const resolvedRuntime = runtime || getLive2DRuntime();
  const mode = detectLive2DMode({ modelUrl, staticSrc, runtime: resolvedRuntime });
  const [runtimeFailed, setRuntimeFailed] = React.useState(false);
  const [source, setSource] = React.useState(mode === "static" ? staticSrc : fallbackSrc || staticSrc);
  const stageRef = React.useRef(null);

  React.useEffect(() => {
    setRuntimeFailed(false);
    setSource(mode === "static" ? staticSrc : fallbackSrc || staticSrc);
  }, [mode, staticSrc, fallbackSrc]);

  React.useEffect(() => {
    if (mode !== "live2d" || runtimeFailed || !resolvedRuntime || !stageRef.current) return undefined;
    try {
      const cleanup = resolvedRuntime.mount(stageRef.current, { modelUrl, alt });
      return typeof cleanup === "function" ? cleanup : undefined;
    } catch {
      setRuntimeFailed(true);
      return undefined;
    }
  }, [mode, modelUrl, alt, resolvedRuntime, runtimeFailed]);

  if (mode === "live2d" && !runtimeFailed) {
    return <div ref={stageRef} className={`live2d-stage live2d-stage-live ${className}`} data-live2d-mode="live2d" data-model-url={modelUrl} aria-label={alt} />;
  }

  const fallbackMode = staticSrc ? "static" : "pseudo";

  return (
    <div className={`live2d-stage live2d-stage-${fallbackMode} ${className}`} data-live2d-mode={fallbackMode} data-live2d-fallback={runtimeFailed ? "runtime-error" : undefined}>
      {source && <img src={source} alt={alt} onError={() => setSource(fallbackSrc || "")} />}
    </div>
  );
}
