import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";

const TOKEN_KEY = "ruobai_fcm_token";
let listenersReady = false;
let heartbeatTimer = null;

async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error || `请求失败：${response.status}`);
  }
  return data;
}

export function isNativePushAvailable() {
  return Capacitor.isNativePlatform();
}

export function getStoredPushToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

function storePushToken(token) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {}
}

function resolveNotificationPath(data = {}) {
  const path = data.path || "/chat";
  const params = new URLSearchParams();
  if (data.character_id) params.set("character_id", data.character_id);
  if (data.message_id) params.set("message_id", data.message_id);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

function openNotificationTarget(data) {
  const target = resolveNotificationPath(data);
  window.history.pushState({}, "", target);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export async function registerPushDevice(token) {
  return request("/api/push/devices", {
    method: "POST",
    body: JSON.stringify({
      token,
      platform: Capacitor.getPlatform(),
      app_version: "1.0.0",
    }),
  });
}

export async function heartbeatPushDevice(token = getStoredPushToken()) {
  if (!token) return null;
  return request("/api/push/heartbeat", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

export async function getPushPreferences() {
  return request("/api/push/preferences", { method: "GET" });
}

export async function updatePushPreferences(payload) {
  return request("/api/push/preferences", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function disableCurrentPushDevice(token = getStoredPushToken()) {
  if (!token) return null;
  return request("/api/push/devices/current", {
    method: "DELETE",
    body: JSON.stringify({ token }),
  });
}

export function startPushHeartbeat() {
  const token = getStoredPushToken();
  if (!token || heartbeatTimer) return;
  heartbeatPushDevice(token).catch(() => {});
  heartbeatTimer = window.setInterval(() => {
    heartbeatPushDevice(token).catch(() => {});
  }, 5 * 60 * 1000);
}

async function ensurePushListeners() {
  if (listenersReady) return;

  await Promise.all([
    PushNotifications.addListener("registration", async (token) => {
      const value = token?.value || "";
      if (!value) return;
      storePushToken(value);
      await registerPushDevice(value);
      startPushHeartbeat();
    }),
    PushNotifications.addListener("registrationError", (error) => {
      console.error("[push] registration error", error);
    }),
    PushNotifications.addListener("pushNotificationActionPerformed", (event) => {
      openNotificationTarget(event?.notification?.data || {});
    }),
  ]);

  listenersReady = true;
}

export async function enableNativePush() {
  if (!isNativePushAvailable()) {
    throw new Error("原生推送只在 APP 里可用");
  }

  await ensurePushListeners();

  const permission = await PushNotifications.requestPermissions();
  if (permission.receive !== "granted") {
    throw new Error("你没有允许通知权限");
  }

  await PushNotifications.register();
  return { success: true };
}

export function bootNativePushIfPossible() {
  if (!isNativePushAvailable()) return;
  ensurePushListeners().catch((error) => {
    console.warn("[push] listener boot failed", error);
  });
  startPushHeartbeat();
}
