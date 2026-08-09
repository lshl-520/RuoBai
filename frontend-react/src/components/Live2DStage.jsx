import React from "react";
import { detectLive2DMode, getLive2DRuntime } from "../lib/live2d.js";

/*
 * The project does not bundle Cubism/Pixi yet. A runtime adapter can be
 * provided by the browser bootstrap without changing role identity data. It
 * exposes mount(container, options), which may resolve to a cleanup function.
 */
export function Live2DStage({ modelUrl = "", staticSrc = "", fallbackSrc = "", manifest = null, framing = "default", state = null, alt = "角色", runtime = null, className = "" }) {
  const resolvedRuntime = runtime || getLive2DRuntime();
  const mode = detectLive2DMode({ modelUrl, staticSrc, runtime: resolvedRuntime });
  const framingKey = typeof framing === "string" ? framing : JSON.stringify(framing || {});
  const [runtimeFailed, setRuntimeFailed] = React.useState(false);
  const [runtimeReady, setRuntimeReady] = React.useState(false);
  const [source, setSource] = React.useState(mode === "static" ? staticSrc : fallbackSrc || staticSrc);
  const stageRef = React.useRef(null);
  const controllerRef = React.useRef(null);
  const stateKey = JSON.stringify(state || {});

  React.useEffect(() => {
    setRuntimeFailed(false);
    setRuntimeReady(false);
    setSource(mode === "static" ? staticSrc : fallbackSrc || staticSrc);
  }, [mode, modelUrl, staticSrc, fallbackSrc]);

  React.useEffect(() => {
    if (mode !== "live2d" || runtimeFailed || !resolvedRuntime || !stageRef.current) return undefined;
    let active = true;
    let cleanup = null;
    Promise.resolve()
      .then(() => resolvedRuntime.mount(stageRef.current, { modelUrl, manifest, framing, state, alt }))
      .then((result) => {
        if (!active) {
          if (typeof result === "function") result();
          return;
        }
        cleanup = typeof result === "function" ? result : null;
        controllerRef.current = cleanup;
        setRuntimeReady(true);
      })
      .catch(() => {
        if (active) setRuntimeFailed(true);
      });

    return () => {
      active = false;
      cleanup?.();
      if (controllerRef.current === cleanup) controllerRef.current = null;
    };
  }, [mode, modelUrl, manifest, framingKey, alt, resolvedRuntime, runtimeFailed]);

  React.useEffect(() => {
    if (mode === "live2d" && runtimeReady) controllerRef.current?.setState?.(state);
  }, [mode, runtimeReady, stateKey]);

  if (mode === "live2d" && !runtimeFailed) {
    return (
      <div ref={stageRef} className={`live2d-stage live2d-stage-live ${className}`} data-live2d-mode="live2d" data-live2d-status={runtimeReady ? "ready" : "loading"} data-model-url={modelUrl} aria-label={alt} />
    );
  }

  const fallbackMode = staticSrc ? "static" : "pseudo";

  return (
    <div className={`live2d-stage live2d-stage-${fallbackMode} ${className}`} data-live2d-mode={fallbackMode} data-live2d-fallback={runtimeFailed ? "runtime-error" : undefined}>
      {source && <img src={source} alt={alt} onError={() => setSource(fallbackSrc || "")} />}
    </div>
  );
}
