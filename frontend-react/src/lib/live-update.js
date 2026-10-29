import { Capacitor, registerPlugin } from "@capacitor/core";

/**
 * ═══ 流体云 / 灵动岛「常驻胶囊」（2026/9/21）═══
 *
 * 对应安卓侧的 LiveUpdatePlugin：用 Android 16 的「实时更新通知」
 * （promoted ongoing notification）请求系统把通知升级成顶部胶囊。
 * ColorOS 的流体云会认这类通知；其他 ROM 如果不认，就退化成普通常驻通知，
 * 不会报错、也不会丢消息。
 *
 * 为什么不做成"每次都弹"：
 *   常驻胶囊的价值是"她一直在那儿"，不是多一条打扰。所以这里只更新同一条通知，
 *   并且静音、不震动 —— 想收她主动消息靠的是推送那条通道。
 */

const LiveUpdate = registerPlugin("LiveUpdate");

export function isLiveUpdateAvailable() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

export async function isLiveUpdateSupported() {
  if (!isLiveUpdateAvailable()) return { supported: false, notificationsAllowed: false, reason: "not-native" };
  try {
    const result = await LiveUpdate.isSupported();
    return {
      supported: Boolean(result?.supported),
      notificationsAllowed: Boolean(result?.notificationsAllowed),
      androidVersion: Number(result?.androidVersion) || 0,
    };
  } catch {
    return { supported: false, notificationsAllowed: false, reason: "unavailable" };
  }
}

export async function startLiveUpdate({ title = "小白", text = "", progress = -1 } = {}) {
  if (!isLiveUpdateAvailable()) return { success: false, reason: "not-native" };
  return LiveUpdate.start({ title, text, progress: Number(progress) });
}

export async function updateLiveUpdate({ title = "小白", text = "", progress = -1 } = {}) {
  if (!isLiveUpdateAvailable()) return { success: false, reason: "not-native" };
  return LiveUpdate.update({ title, text, progress: Number(progress) });
}

export async function stopLiveUpdate() {
  if (!isLiveUpdateAvailable()) return;
  try {
    await LiveUpdate.stop();
  } catch {
    // 撤不下来不值得打扰用户
  }
}
