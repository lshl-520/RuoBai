import { getLive2DRuntime } from "./live2d.js";

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
