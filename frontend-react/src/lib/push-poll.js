import { Capacitor, registerPlugin } from "@capacitor/core";
import { apiFetch, getApiOrigin } from "./api-base.js";

/**
 * ═══ 不依赖谷歌的后台守候（2026/9/21）═══
 *
 * 为什么需要它（已实测确认）：
 *   FCM 推送必须靠一条通往 Google 的长连接（mtalk.google.com:5228）。
 *   用户网络下这条路是断的 —— 真机上 ping 100% 丢包、curl 443 超时，
 *   而自己的后端正常。于是服务器显示「推送成功」，手机永远收不到。
 *
 * 这条通道完全绕开谷歌：
 *   App 里跑一个前台服务 → 定时问若白服务器「有没有她新说的话」→ 本地弹通知。
 *   它的常驻通知同时就是流体云那个小胶囊。
 *
 * 密钥从哪来：
 *   登录状态下调 POST /api/push/poll-key 换一把 64 位随机密钥，
 *   然后连「服务器地址」一起交给原生侧存起来（前台服务读不到 localStorage）。
 */

const PushPoll = registerPlugin("PushPoll");

export const POLL_DEVICE_KEY_STORAGE = "ruobai_poll_device_key";

export function isPushPollAvailable() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

async function readError(response) {
  const data = await response.json().catch(() => null);
  return data?.error || `请求失败（HTTP ${response.status}）`;
}

/** 换一把新设备密钥。旧密钥会立即失效，所以只有开启/重置时才调。 */
export async function issuePollDeviceKey() {
  const response = await apiFetch("/api/push/poll-key", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ platform: Capacitor.getPlatform() || "android" }),
  });
  if (!response.ok) throw new Error(await readError(response));
  const data = await response.json().catch(() => null);
  const key = String(data?.key || "");
  if (!key) throw new Error("服务器没有下发设备密钥");
  try {
    localStorage.setItem(POLL_DEVICE_KEY_STORAGE, key);
  } catch {}
  return key;
}

/** 把密钥和服务器地址交给原生侧，后台守候就转起来了。 */
export async function startBackgroundWatch({ baseUrl, intervalMinutes = 5 } = {}) {
  if (!isPushPollAvailable()) {
    return { success: false, reason: "not-native" };
  }
  const key = await issuePollDeviceKey();
  const origin = baseUrl || getApiOrigin() || window.location.origin;
  const result = await PushPoll.start({
    deviceKey: key,
    baseUrl: origin,
    intervalMinutes: Number(intervalMinutes) || 5,
  });
  return { success: Boolean(result?.success), key };
}

export async function stopBackgroundWatch() {
  if (!isPushPollAvailable()) return;
  try {
    await PushPoll.stop();
  } catch {
    // 关不掉不值得打扰用户
  }
  try {
    localStorage.removeItem(POLL_DEVICE_KEY_STORAGE);
  } catch {}
}

export async function getBackgroundWatchStatus() {
  if (!isPushPollAvailable()) {
    return { enabled: false, running: false, hasKey: false };
  }
  try {
    const result = await PushPoll.status();
    return {
      enabled: Boolean(result?.enabled),
      running: Boolean(result?.running),
      hasKey: Boolean(result?.hasKey),
      intervalMinutes: Number(result?.intervalMinutes) || 5,
      lastPollAt: Number(result?.lastPollAt) || 0,
      lastError: String(result?.lastError || ""),
    };
  } catch {
    return { enabled: false, running: false, hasKey: false };
  }
}

/**
 * 通知被点开后，App 启动时要跳到对应的聊天。
 * 原生侧只在内存里存一次，取完即清，所以不会重复跳。
 */
export async function consumePendingOpen() {
  if (!isPushPollAvailable()) return { hasTarget: false };
  try {
    const result = await PushPoll.consumePendingOpen();
    return {
      hasTarget: Boolean(result?.hasTarget),
      characterId: Number(result?.characterId) || 0,
      messageId: Number(result?.messageId) || 0,
    };
  } catch {
    return { hasTarget: false };
  }
}

/**
 * App 启动时自动把守候接回来。
 *
 * 只在「以前开过」时才恢复 —— 没开过的用户不该被偷偷启动一个常驻通知，
 * 那会让人莫名其妙。原生侧记住 enabled=true 就会自己跑，这里不用重复下发密钥。
 */
export async function resumeBackgroundWatchIfEnabled() {
  if (!isPushPollAvailable()) return;
  try {
    const status = await getBackgroundWatchStatus();
    if (!status.enabled || !status.hasKey) return;
    // 走 resume 而不是 start：start 会换一把新钥匙，没必要也不该每次开机都换。
    await PushPoll.resume();
  } catch {
    // 恢复失败不影响前台使用
  }
}
