package fun.lshl.ruobai;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * ═══ 后台守候开关（2026/9/21）═══
 *
 * 前端只负责把「设备密钥 + 服务器地址」交给这里，剩下的交给 PushPollService。
 * 密钥由前端调 /api/push/poll-key 拿到（需要登录），存在 Java 侧的
 * SharedPreferences 里 —— 前台服务在 WebView 之外，读不到 localStorage。
 */
@CapacitorPlugin(name = "PushPoll")
public class PushPollPlugin extends Plugin {

    /**
     * 通知被点开时，MainActivity 把「该进哪个角色的聊天」放在这里，
     * 前端启动后调 consumePendingOpen() 取一次。取完就清掉，避免重复跳转。
     */
    private static volatile int pendingCharacterId = 0;
    private static volatile long pendingMessageId = 0L;

    static void setPendingOpen(int characterId, long messageId) {
        pendingCharacterId = characterId;
        pendingMessageId = messageId;
    }

    @PluginMethod
    public void consumePendingOpen(PluginCall call) {
        JSObject result = new JSObject();
        int characterId = pendingCharacterId;
        long messageId = pendingMessageId;
        pendingCharacterId = 0;
        pendingMessageId = 0L;
        result.put("characterId", characterId);
        result.put("messageId", messageId);
        result.put("hasTarget", characterId > 0);
        call.resolve(result);
    }

    /** 用已经存好的密钥把守候重新拉起来（App 重启后走这条，不换钥匙）。 */
    @PluginMethod
    public void resume(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(PushPollService.PREFS, Context.MODE_PRIVATE);
        if (!prefs.getBoolean(PushPollService.KEY_ENABLED, false)
            || prefs.getString(PushPollService.KEY_DEVICE, "").isEmpty()) {
            JSObject result = new JSObject();
            result.put("success", false);
            result.put("reason", "not-enabled");
            call.resolve(result);
            return;
        }
        try {
            getContext().startForegroundService(
                new Intent(getContext(), PushPollService.class).setAction(PushPollService.ACTION_POLL));
        } catch (Throwable error) {
            call.reject("恢复后台守候失败：" + error.getMessage());
            return;
        }
        JSObject result = new JSObject();
        result.put("success", true);
        call.resolve(result);
    }

    @PluginMethod
    public void isSupported(PluginCall call) {
        JSObject result = new JSObject();
        result.put("supported", true);
        result.put("androidVersion", Build.VERSION.SDK_INT);
        call.resolve(result);
    }

    @PluginMethod
    public void start(PluginCall call) {
        String key = call.getString("deviceKey", "");
        String baseUrl = call.getString("baseUrl", "");
        int interval = call.getInt("intervalMinutes", 5);

        if (key == null || key.length() < 32) {
            call.reject("设备密钥无效");
            return;
        }
        if (baseUrl == null || !(baseUrl.startsWith("https://") || baseUrl.startsWith("http://"))) {
            call.reject("服务器地址无效");
            return;
        }

        SharedPreferences prefs = getContext().getSharedPreferences(PushPollService.PREFS, Context.MODE_PRIVATE);
        prefs.edit()
            .putString(PushPollService.KEY_DEVICE, key)
            .putString(PushPollService.KEY_BASE, trimTrailingSlash(baseUrl))
            .putInt(PushPollService.KEY_INTERVAL, Math.max(1, Math.min(interval, 120)))
            .putBoolean(PushPollService.KEY_ENABLED, true)
            // 换钥匙就重置进度，否则会拿旧 cursor 去比新用户的库
            .putLong(PushPollService.KEY_CURSOR, -1L)
            .apply();

        // 第二道保险：JobScheduler 登记在系统侧，划掉 App 后也能把服务拉回来。
        // 原因见 PushPollJobService 顶部说明（ColorOS 会连闹钟一起清）。
        PushPollJobService.schedule(getContext());

        Intent service = new Intent(getContext(), PushPollService.class)
            .setAction(PushPollService.ACTION_POLL);
        try {
            getContext().startForegroundService(service);
        } catch (Throwable error) {
            call.reject("启动后台守候失败：" + error.getMessage());
            return;
        }

        JSObject result = new JSObject();
        result.put("success", true);
        result.put("running", true);
        call.resolve(result);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(PushPollService.PREFS, Context.MODE_PRIVATE);
        prefs.edit().putBoolean(PushPollService.KEY_ENABLED, false).apply();
        PushPollJobService.cancel(getContext());
        getContext().stopService(new Intent(getContext(), PushPollService.class));
        call.resolve();
    }

    @PluginMethod
    public void status(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(PushPollService.PREFS, Context.MODE_PRIVATE);
        JSObject result = new JSObject();
        result.put("enabled", prefs.getBoolean(PushPollService.KEY_ENABLED, false));
        result.put("running", PushPollService.running);
        result.put("hasKey", !prefs.getString(PushPollService.KEY_DEVICE, "").isEmpty());
        result.put("intervalMinutes", prefs.getInt(PushPollService.KEY_INTERVAL, 5));
        long lastPoll = prefs.getLong(PushPollService.KEY_LAST_POLL, 0L);
        result.put("lastPollAt", lastPoll);
        result.put("lastError", prefs.getString(PushPollService.KEY_LAST_ERROR, ""));
        call.resolve(result);
    }

    private String trimTrailingSlash(String value) {
        String trimmed = value.trim();
        while (trimmed.endsWith("/")) trimmed = trimmed.substring(0, trimmed.length() - 1);
        return trimmed;
    }
}
