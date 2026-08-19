import express from 'express';

function positiveInteger(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function createAppUpdatesRouter({
  latestVersionCode = process.env.ANDROID_LATEST_VERSION_CODE,
  latestVersionName = process.env.ANDROID_LATEST_VERSION_NAME,
  apkUrl = process.env.ANDROID_APK_URL,
  apkSha256 = process.env.ANDROID_APK_SHA256,
  releaseNotes = process.env.ANDROID_RELEASE_NOTES,
  required = process.env.ANDROID_UPDATE_REQUIRED === 'true'
} = {}) {
  const router = express.Router();

  router.get('/android', (_req, res) => {
    const versionCode = positiveInteger(latestVersionCode);
    const downloadUrl = String(apkUrl || '').trim();
    const available = versionCode > 0 && /^https:\/\//i.test(downloadUrl);

    res.set('Cache-Control', 'no-store');
    return res.json({
      success: true,
      update: available ? {
        versionCode,
        versionName: String(latestVersionName || versionCode).trim(),
        apkUrl: downloadUrl,
        sha256: String(apkSha256 || '').trim().toLowerCase(),
        releaseNotes: String(releaseNotes || '').trim(),
        required: Boolean(required)
      } : null
    });
  });

  return router;
}

export default createAppUpdatesRouter();
