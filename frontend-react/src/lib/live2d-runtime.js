import * as PIXI from "pixi.js";
import { getLive2DCoreUrl } from "./live2d.js";
import { buildLive2DModelJson } from "./live2d-model.js";
import { getLive2DExpressionIndex, resolveLive2DExpression } from "./live2d-state.js";

let corePromise = null;
let cubismPromise = null;

function hasCubismCore(globalObject = globalThis) {
  return Boolean(globalObject?.Live2DCubismCore);
}

function loadCoreScript(url) {
  if (typeof document === "undefined") {
    return Promise.reject(new Error("Live2D 播放只能在浏览器中运行"));
  }

  const existing = [...document.querySelectorAll("script[data-ruobai-live2d-core]")]
    .find((script) => script.dataset.ruobaiLive2dCore === url);
  if (existing?.dataset.loaded === "true") return Promise.resolve();
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Cubism Core 加载失败")), { once: true });
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.async = true;
    script.crossOrigin = "anonymous";
    script.src = url;
    script.dataset.ruobaiLive2dCore = url;
    script.addEventListener("load", () => {
      script.dataset.loaded = "true";
      resolve();
    }, { once: true });
    script.addEventListener("error", () => reject(new Error("Cubism Core 加载失败")), { once: true });
    document.head.appendChild(script);
  });
}

async function ensureCubismCore() {
  if (hasCubismCore()) return;
  if (!corePromise) {
    const url = getLive2DCoreUrl();
    if (!url) {
      throw new Error("未配置 Live2D Cubism Core");
    }
    corePromise = loadCoreScript(url)
      .then(() => {
        if (!hasCubismCore()) throw new Error("Cubism Core 加载后没有注册运行时");
      })
      .catch((error) => {
        corePromise = null;
        throw error;
      });
  }
  return corePromise;
}

async function getCubism4Runtime() {
  if (!cubismPromise) {
    cubismPromise = (async () => {
      await ensureCubismCore();
      // The Cubism bundle checks for the Core global while it is evaluated.
      const cubism = await import("pixi-live2d-display/cubism4");
      cubism.startUpCubism4?.();
      await cubism.cubism4Ready?.();
      cubism.Live2DModel.registerTicker(PIXI.Ticker);
      return cubism;
    })().catch((error) => {
      cubismPromise = null;
      throw error;
    });
  }
  return cubismPromise;
}

async function readModelJson(modelUrl) {
  const response = await fetch(modelUrl, { credentials: "same-origin" });
  if (!response.ok) throw new Error(`Live2D 模型入口读取失败（${response.status}）`);
  return response.json();
}

function createPixiApplication(container) {
  const app = new PIXI.Application({
    antialias: true,
    backgroundAlpha: 0,
    autoStart: true,
    resolution: Math.min(globalThis.devicePixelRatio || 1, 2),
    width: Math.max(1, container.clientWidth),
    height: Math.max(1, container.clientHeight),
  });
  app.view.className = "live2d-stage-canvas";
  app.view.setAttribute("aria-hidden", "true");
  container.appendChild(app.view);
  return app;
}

function attachResize(app, container, fitModel) {
  const resize = () => {
    app.renderer.resize(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight));
    fitModel?.();
  };
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(resize) : null;
  observer?.observe(container);
  window.addEventListener("resize", resize);
  resize();
  return () => {
    observer?.disconnect();
    window.removeEventListener("resize", resize);
  };
}

function isTextureReady(texture) {
  const baseTexture = texture?.baseTexture;
  return Boolean(
    texture?.valid
      && baseTexture?.valid
      && baseTexture.width > 0
      && baseTexture.height > 0,
  );
}

async function waitForLive2DTextures(model) {
  const textures = Array.isArray(model?.textures) ? model.textures : [];
  await Promise.all(textures.map(async (texture) => {
    if (isTextureReady(texture)) return;

    const resource = texture?.baseTexture?.resource;
    if (typeof resource?.load === "function") {
      await resource.load();
    }

    if (isTextureReady(texture)) return;

    await new Promise((resolve, reject) => {
      const baseTexture = texture?.baseTexture;
      if (!baseTexture?.once) {
        reject(new Error("Live2D 纹理对象无效"));
        return;
      }
      const timeout = setTimeout(() => {
        baseTexture.off?.("loaded", onLoaded);
        baseTexture.off?.("update", onLoaded);
        reject(new Error("Live2D 纹理加载超时"));
      }, 10000);
      const onLoaded = () => {
        clearTimeout(timeout);
        if (isTextureReady(texture)) resolve();
        else reject(new Error("Live2D 纹理尺寸无效"));
      };
      baseTexture.once("loaded", onLoaded);
      baseTexture.once("update", onLoaded);
    });
  }));

  if (textures.some((texture) => !isTextureReady(texture))) {
    throw new Error("Live2D 纹理未进入可绘制状态");
  }
}

function getTextureDebugState(texture) {
  const baseTexture = texture?.baseTexture;
  const resource = baseTexture?.resource;
  const source = resource?.source;
  const sourceWidth = source?.naturalWidth || source?.videoWidth || source?.width || 0;
  const sourceHeight = source?.naturalHeight || source?.videoHeight || source?.height || 0;
  return `${Boolean(texture?.valid)}/${Boolean(baseTexture?.valid)}:${baseTexture?.width || 0}x${baseTexture?.height || 0}:${Boolean(resource?.valid)}:${sourceWidth}x${sourceHeight}`;
}

export function getFraming(framing) {
  const mode = typeof framing === "object" && framing
    ? String(framing.mode || "full")
    : String(framing || "full");
  const presets = {
    // Keep the chat silhouette inside the stage horizontally; knee framing is
    // achieved by the vertical crop, not by enlarging past the stage width.
    knee: { zoom: 1, anchorOffset: 0.14, fit: "width" },
    half: { zoom: 1.3, anchorOffset: 0.08, fit: "width" },
    full: { zoom: 1, anchorOffset: 0, fit: "contain" },
  };
  const preset = presets[mode] || presets.full;
  const source = typeof framing === "object" && framing ? framing : {};
  const zoom = Number(source.zoom);
  const offsetX = Number(source.offsetX);
  const offsetY = Number(source.offsetY);
  return {
    ...preset,
    zoom: preset.zoom * (Number.isFinite(zoom) ? Math.min(2.4, Math.max(0.7, zoom)) : 1),
    offsetX: Number.isFinite(offsetX) ? Math.min(0.35, Math.max(-0.35, offsetX)) : 0,
    offsetY: Number.isFinite(offsetY) ? Math.min(0.35, Math.max(-0.35, offsetY)) : 0,
  };
}

async function mountLive2D(container, { modelUrl, manifest = null, framing = "default", state = null } = {}) {
  if (!modelUrl) throw new Error("没有 Live2D 模型入口");
  const cubism = await getCubism4Runtime();
  const source = await readModelJson(modelUrl);
  const settings = buildLive2DModelJson(source, { modelUrl, manifest });
  const app = createPixiApplication(container);
  let model = null;
  let detachResize = () => {};
  let expressionTimer = null;
  let expressionRequest = 0;
  let activeExpression = "";
  let disposed = false;
  const destroyApp = () => app.destroy(true, { children: true, texture: false, baseTexture: false });

  const clearExpression = () => {
    if (expressionTimer) clearTimeout(expressionTimer);
    expressionTimer = null;
    activeExpression = "";
    model?.resetExpression?.();
    container.dataset.live2dExpression = "";
  };

  const applyState = async (nextState) => {
    const scene = typeof nextState === "string" ? nextState : nextState?.scene;
    const requestedExpression = resolveLive2DExpression(nextState, manifest);
    const expressionIndex = getLive2DExpressionIndex(requestedExpression, manifest);
    const request = ++expressionRequest;
    container.dataset.live2dScene = scene || "idle";
    container.dataset.live2dExpressionRequested = requestedExpression;
    if (!requestedExpression) {
      clearExpression();
      container.dataset.live2dExpressionResult = "idle";
      return false;
    }
    if (activeExpression === requestedExpression) return true;

    if (expressionTimer) clearTimeout(expressionTimer);
    expressionTimer = null;
    const invokeExpression = (target) => {
      try {
        return Promise.resolve(model?.expression?.(target)).catch(() => false);
      } catch {
        return Promise.resolve(false);
      }
    };
    let applied = await invokeExpression(requestedExpression);
    // Some Cubism expression managers resolve only numeric indices. The
    // manifest order is the same order injected into FileReferences.Expressions.
    if (!applied && expressionIndex >= 0) {
      applied = await invokeExpression(expressionIndex);
    }
    if (!applied) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      applied = await invokeExpression(requestedExpression);
      if (!applied && expressionIndex >= 0) applied = await invokeExpression(expressionIndex);
    }
    if (disposed || request !== expressionRequest || !applied) {
      if (!disposed && request === expressionRequest) container.dataset.live2dExpressionResult = "failed";
      return false;
    }

    activeExpression = requestedExpression;
    container.dataset.live2dExpression = requestedExpression;
    container.dataset.live2dExpressionResult = "applied";
    expressionTimer = setTimeout(() => {
      if (disposed || activeExpression !== requestedExpression) return;
      clearExpression();
    }, 3500);
    return true;
  };

  try {
    model = await cubism.Live2DModel.from(settings, {
      autoInteract: false,
      autoUpdate: true,
      crossOrigin: "anonymous",
    });
    await waitForLive2DTextures(model);
    container.dataset.live2dTextureCount = String(model.textures?.length || 0);
    container.dataset.live2dTextureState = (model.textures || [])
      .map(getTextureDebugState)
      .join(",");
    container.dataset.live2dModelSize = `${Math.round(model.width)}x${Math.round(model.height)}`;
    container.dataset.live2dDrawableCount = String(model.internalModel?.getDrawableIDs?.().length || 0);
    const expressionManager = model.internalModel?.expressionManager || model.internalModel?.motionManager?.expressionManager;
    container.dataset.live2dExpressionCount = String(expressionManager?.definitions?.length || 0);
    expressionManager?.on?.("expressionLoadError", (_index, error) => {
      container.dataset.live2dExpressionError = String(error?.message || error || "expression-load-error").slice(0, 240);
    });
    model.anchor.set(0.5, 1);
    app.stage.addChild(model);

    const baseWidth = Math.max(1, model.width);
    const baseHeight = Math.max(1, model.height);
    const frame = getFraming(framing);
    // Keep the intentional lower crop tied to stage width, not viewport height.
    const fitModel = () => {
      const width = Math.max(1, app.renderer.width / app.renderer.resolution);
      const height = Math.max(1, app.renderer.height / app.renderer.resolution);
      const fitScale = frame.fit === "width"
        ? (width / baseWidth)
        : Math.min(width / baseWidth, height / baseHeight) * 0.96;
      const scale = fitScale * frame.zoom;
      model.scale.set(scale);
      model.x = width / 2 + (width * frame.offsetX);
      model.y = height + (width * frame.anchorOffset) + (height * frame.offsetY);
    };
    detachResize = attachResize(app, container, fitModel);
    fitModel();

    if (Array.isArray(manifest?.motionPaths) && manifest.motionPaths.length) {
      const started = await model.motion("Idle", 0, 1).catch(() => false);
      container.dataset.live2dMotionStarted = String(Boolean(started));
    }
    await applyState(state);
  } catch (error) {
    clearExpression();
    detachResize();
    destroyApp();
    throw error;
  }

  const cleanup = () => {
    disposed = true;
    clearExpression();
    detachResize();
    destroyApp();
  };
  cleanup.setState = applyState;
  return cleanup;
}

export function createLive2DRuntime() {
  return {
    mount: mountLive2D,
  };
}
