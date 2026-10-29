package fun.lshl.ruobai;

import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.content.pm.PackageInfo;
import android.content.pm.ResolveInfo;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.net.URI;

@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {
    private static final String TAG = "RuoBaiAppUpdater";
    private static final long POLL_INTERVAL_MS = 1000L;
    private static final int DOWNLOAD_POLL_MAX = 900;
    private static final int APK_WAIT_MAX = 300;

    private long activeDownloadId = -1;
    private File activeTarget;
    private boolean installerLaunched = false;
    private BroadcastReceiver downloadReceiver;

    @PluginMethod
    public void getVersionInfo(PluginCall call) {
        try {
            PackageInfo info = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            JSObject result = new JSObject();
            result.put("versionCode", Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? info.getLongVersionCode() : info.versionCode);
            result.put("versionName", info.versionName == null ? "" : info.versionName);
            call.resolve(result);
        } catch (PackageManager.NameNotFoundException error) {
            call.reject("无法读取当前版本", error);
        }
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String url = call.getString("url", "");
        String filename = call.getString("filename", "ruobai-update.apk");
        if (!isTrustedUrl(url)) {
            call.reject("更新地址不安全");
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getContext().getPackageManager().canRequestPackageInstalls()) {
            Intent permissionIntent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
            permissionIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(permissionIntent);
            call.reject("请先允许若白安装更新，然后返回应用再次点击更新", "INSTALL_PERMISSION_REQUIRED");
            return;
        }

        File target = new File(getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), filename.replaceAll("[^A-Za-z0-9._-]", "_"));
        if (target.exists()) target.delete();
        DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url))
            .setTitle("若白更新")
            .setDescription("正在下载新版本")
            .setMimeType("application/vnd.android.package-archive")
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setDestinationInExternalFilesDir(getContext(), Environment.DIRECTORY_DOWNLOADS, target.getName());
        DownloadManager manager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
        activeDownloadId = manager.enqueue(request);
        activeTarget = target;
        installerLaunched = false;
        registerDownloadReceiver();
        // ColorOS 上 DownloadManager 的完成广播不一定能送到应用内动态接收器（实测收不到），
        // 所以主路径改成主动轮询下载状态，广播只当作快路径。
        pollDownload(activeDownloadId, target, 0);

        JSObject result = new JSObject();
        result.put("downloadId", activeDownloadId);
        result.put("state", "downloading");
        call.resolve(result);
    }

    private boolean isTrustedUrl(String value) {
        try {
            URI uri = URI.create(value);
            // 只允许从打包时写入的本项目更新域名下载，避免下载被替换的 APK。
            final String allowedHost = BuildConfig.APP_UPDATE_HOST;
            if (allowedHost.isEmpty()) return false;
            return "https".equalsIgnoreCase(uri.getScheme()) && allowedHost.equalsIgnoreCase(uri.getHost());
        } catch (RuntimeException error) {
            return false;
        }
    }

    private void pollDownload(long downloadId, File target, int attempt) {
        if (installerLaunched || downloadId != activeDownloadId) return;
        if (attempt >= DOWNLOAD_POLL_MAX) {
            Log.e(TAG, "download polling gave up, id=" + downloadId);
            return;
        }

        int status = -1;
        DownloadManager manager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
        if (manager != null) {
            Cursor cursor = null;
            try {
                cursor = manager.query(new DownloadManager.Query().setFilterById(downloadId));
                if (cursor != null && cursor.moveToFirst()) {
                    status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                }
            } catch (RuntimeException error) {
                Log.w(TAG, "query download status failed: " + error);
            } finally {
                if (cursor != null) cursor.close();
            }
        }

        if (status == DownloadManager.STATUS_SUCCESSFUL) {
            Log.i(TAG, "download finished, waiting for apk file " + target.getName());
            waitForApk(downloadId, target, 0);
            return;
        }
        if (status == DownloadManager.STATUS_FAILED) {
            Log.e(TAG, "download failed, id=" + downloadId);
            return;
        }
        new Handler(Looper.getMainLooper()).postDelayed(
            () -> pollDownload(downloadId, target, attempt + 1),
            POLL_INTERVAL_MS
        );
    }

    private void waitForApk(long downloadId, File target, int attempt) {
        if (installerLaunched || downloadId != activeDownloadId) return;
        if (attempt >= APK_WAIT_MAX) {
            Log.e(TAG, "apk file never appeared: " + target.getAbsolutePath());
            return;
        }
        // ColorOS 等系统下载完成后会先叫 *.oplusdownload，随后才改成正式 APK 名。
        // 正式文件一旦出现，优先用 FileProvider；这是各家系统安装器兼容性最好的一条路。
        if (target.exists() && target.length() > 0) {
            launchInstaller(downloadId, target);
            return;
        }
        if (attempt % 10 == 0) {
            Log.i(TAG, "waiting for apk file, attempt=" + attempt + ", exists=" + target.exists());
        }
        new Handler(Looper.getMainLooper()).postDelayed(
            () -> waitForApk(downloadId, target, attempt + 1),
            POLL_INTERVAL_MS
        );
    }

    private void launchInstaller(long downloadId, File target) {
        if (installerLaunched) return;
        installerLaunched = true;

        Uri apkUri = null;
        try {
            if (target.exists()) {
                apkUri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", target);
            } else {
                DownloadManager manager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
                if (manager != null) apkUri = manager.getUriForDownloadedFile(downloadId);
            }
        } catch (RuntimeException error) {
            Log.e(TAG, "resolve apk uri failed: " + error);
        }

        if (apkUri == null) {
            installerLaunched = false;
            Log.e(TAG, "apk uri is null, will retry");
            new Handler(Looper.getMainLooper()).postDelayed(
                () -> waitForApk(downloadId, target, 0),
                POLL_INTERVAL_MS
            );
            return;
        }

        Intent installIntent = new Intent(Intent.ACTION_VIEW)
            .setDataAndType(apkUri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        ResolveInfo resolveInfo = getContext().getPackageManager().resolveActivity(installIntent, 0);
        if (resolveInfo != null && resolveInfo.activityInfo != null) {
            try {
                getContext().grantUriPermission(resolveInfo.activityInfo.packageName, apkUri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } catch (RuntimeException ignored) {}
        }
        try {
            getContext().startActivity(installIntent);
            Log.i(TAG, "installer intent sent: " + apkUri);
        } catch (RuntimeException error) {
            installerLaunched = false;
            Log.e(TAG, "startActivity failed: " + error);
            new Handler(Looper.getMainLooper()).postDelayed(
                () -> waitForApk(downloadId, target, 0),
                POLL_INTERVAL_MS
            );
        }
    }

    private void registerDownloadReceiver() {
        if (downloadReceiver != null) {
            try { getContext().unregisterReceiver(downloadReceiver); } catch (IllegalArgumentException ignored) {}
        }
        downloadReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                long completedId = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                if (completedId != activeDownloadId) return;
                Log.i(TAG, "download complete broadcast received, id=" + completedId);
                File target = activeTarget;
                if (target == null) return;
                waitForApk(completedId, target, 0);
            }
        };
        IntentFilter filter = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            // 必须用 EXPORTED：DownloadManager 的完成广播由系统下载提供者（另一个 UID）发出，
            // 用 NOT_EXPORTED 注册时会被系统拦掉，接收器永远收不到。
            getContext().registerReceiver(downloadReceiver, filter, Context.RECEIVER_EXPORTED);
        } else {
            getContext().registerReceiver(downloadReceiver, filter);
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (downloadReceiver != null) {
            try { getContext().unregisterReceiver(downloadReceiver); } catch (IllegalArgumentException ignored) {}
            downloadReceiver = null;
        }
        super.handleOnDestroy();
    }
}