import { Capacitor, registerPlugin } from "@capacitor/core";

const AppUpdater = registerPlugin("AppUpdater");
const SNOOZE_KEY = "ruobai_update_snoozed_until";
const SNOOZE_MS = 24 * 60 * 60 * 1000;

export function isAndroidApp() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

export async function checkForAndroidUpdate() {
  if (!isAndroidApp()) return null;
  const [{ versionCode }, response] = await Promise.all([
    AppUpdater.getVersionInfo(),
    fetch("/api/app-updates/android", { credentials: "same-origin", cache: "no-store" })
  ]);
  if (!response.ok) throw new Error("暂时无法检查更新");
  const payload = await response.json();
  const update = payload?.update;
  if (!update || Number(update.versionCode) <= Number(versionCode || 0)) return null;

  const snoozedUntil = Number(localStorage.getItem(SNOOZE_KEY) || 0);
  if (!update.required && snoozedUntil > Date.now()) return null;
  return update;
}

export function snoozeAndroidUpdate() {
  try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS)); } catch {}
}

export async function downloadAndroidUpdate(update) {
  const versionName = String(update?.versionName || update?.versionCode || "latest").replace(/[^A-Za-z0-9._-]/g, "-");
  return AppUpdater.downloadAndInstall({
    url: update.apkUrl,
    filename: `ruobai-${versionName}.apk`,
  });
}
