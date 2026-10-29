import { Capacitor } from "@capacitor/core";

/**
 * 打包成 App（Android / iOS）时，App 要连的后端地址。
 *
 * ⚠️ 这里**故意留空**：开源仓库里不放任何人的真实服务器域名。
 * 打 App 包时用 `VITE_API_ORIGIN` 指定，本地放在 `frontend-react/.env.local`
 * （已被 `.gitignore` 忽略，永远不会被提交）。见 `frontend-react/.env.example`。
 *
 * 网页版用不到它 —— `getApiOrigin()` 在非原生环境直接返回空串，走同源。
 */
export const DEFAULT_API_ORIGIN = "";
export const DEFAULT_API_TIMEOUT_MS = 20_000;

let warnedMissingOrigin = false;

export function isNativeApp() {
  return Boolean(Capacitor.isNativePlatform?.());
}

export function getApiOrigin() {
  if (!isNativeApp()) return "";
  const configured = String(import.meta.env.VITE_API_ORIGIN || DEFAULT_API_ORIGIN).trim();
  if (!configured && !warnedMissingOrigin) {
    // 宁可在控制台喊一声，也不要静默地把请求发到 https://localhost/api/... 上去。
    warnedMissingOrigin = true;
    console.error(
      "[api-base] 打 App 包时没有设置 VITE_API_ORIGIN，App 连不上后端。"
      + "请在 frontend-react/.env.local 里配置（参考 frontend-react/.env.example）。"
    );
  }
  return configured.replace(/\/+$/, "");
}

export function apiUrl(path) {
  const raw = String(path || "").trim();
  if (!raw) return getApiOrigin() || "/";
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(raw)) return raw;
  const normalized = raw.startsWith("/") ? raw : `/${raw}`;
  return `${getApiOrigin()}${normalized}`;
}

export function apiFetch(path, options = {}) {
  const { timeoutMs, signal, ...requestOptions } = options;
  const configuredTimeout = timeoutMs === undefined ? DEFAULT_API_TIMEOUT_MS : Number(timeoutMs);
  const shouldUseDefaultTimeout = !signal && Number.isFinite(configuredTimeout) && configuredTimeout > 0;

  if (!shouldUseDefaultTimeout) {
    return fetch(apiUrl(path), {
      ...requestOptions,
      ...(signal ? { signal } : {}),
      credentials: isNativeApp() ? "include" : (options.credentials || "same-origin"),
    });
  }

  const controller = new AbortController();
  let didTimeout = false;
  const timer = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, configuredTimeout);

  return fetch(apiUrl(path), {
    ...requestOptions,
    signal: controller.signal,
    credentials: isNativeApp() ? "include" : (options.credentials || "same-origin"),
  }).catch((error) => {
    if (didTimeout) {
      const timeoutError = new Error("请求超时，请稍后重试。", { cause: error });
      timeoutError.name = "AbortError";
      timeoutError.code = "REQUEST_TIMEOUT";
      throw timeoutError;
    }
    throw error;
  }).finally(() => clearTimeout(timer));
}

export function assetUrl(path) {
  const raw = String(path || "").trim();
  if (!raw || /^[a-z][a-z\d+.-]*:\/\//i.test(raw)) return raw;
  if (isNativeApp() && (/^\/user_assets\//.test(raw) || /^\/api\//.test(raw))) {
    return apiUrl(raw);
  }
  return raw;
}
