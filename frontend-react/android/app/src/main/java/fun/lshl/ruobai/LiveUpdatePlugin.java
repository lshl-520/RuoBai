package fun.lshl.ruobai;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * ═══ 流体云 / 灵动岛「常驻胶囊」（2026/9/21）═══
 *
 * 用户问：能不能做成像 ColorOS 流体云那样，一个常驻的小胶囊挂在屏幕顶部？
 *
 * 能做到，而且**不需要厂商白名单**。底层用的是 Android 16（API 36）的
 * 「实时更新通知」（Live Updates / promoted ongoing notification）：
 *   · NotificationCompat.Builder#setRequestPromotedOngoing(true)
 *   · Notification#FLAG_PROMOTED_ONGOING
 *   · NotificationCompat.ProgressStyle
 * ColorOS 的流体云会认这类通知，并把它显示成顶部胶囊。
 *
 * 关键约束（写下来免得以后踩）：
 *   1. 必须有 **常驻**（setOngoing(true)）且带进度的样式，否则系统不升级它；
 *   2. 渠道 importance 创建后**不可修改**，所以单独用 ruobai_live 这个渠道，
 *      不去动推送用的 ruobai_proactive；
 *   3. 系统可能不给（用户关过「实时更新」），所以 isSupported() 要如实上报，
 *      前端据此决定要不要降级成普通通知。
 *
 * 对外方法：
 *   isSupported()            —— 这台机器现在能不能用
 *   start({title,text})      —— 挂上常驻胶囊
 *   update({title,text,progress}) —— 更新内容
 *   stop()                   —— 撤掉
 */
@CapacitorPlugin(
    name = "LiveUpdate",
    permissions = @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = LiveUpdatePlugin.PUSH_PERMISSION)
)
public class LiveUpdatePlugin extends Plugin {

    static final String PUSH_PERMISSION = "notifications";

    private static final String CHANNEL_ID = "ruobai_live";
    // 42001 归 PushPollService 的「后台守候胶囊」用（那是真正不会断的那条路），
    // 这里错开 id，避免手动开关和守候服务互相覆盖同一条通知。
    private static final int NOTIFICATION_ID = 42002;

    @PluginMethod
    public void isSupported(PluginCall call) {
        JSObject result = new JSObject();
        result.put("supported", canPostPromoted());
        result.put("androidVersion", Build.VERSION.SDK_INT);
        result.put("notificationsAllowed", hasNotificationPermission());
        call.resolve(result);
    }

    /** 实时更新是 Android 16 才有的；低版本如实返回 false，让前端降级。 */
    private boolean canPostPromoted() {
        if (Build.VERSION.SDK_INT < 36) return false;
        try {
            NotificationManager manager = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
            return manager != null && manager.canPostPromotedNotifications();
        } catch (Throwable error) {
            return false;
        }
    }

    private boolean hasNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return true;
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS)
            == PackageManager.PERMISSION_GRANTED;
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (!hasNotificationPermission()) {
            requestPermissionForAlias(PUSH_PERMISSION, call, "afterPermission");
            return;
        }
        show(call, true);
    }

    @PluginMethod
    public void update(PluginCall call) {
        if (!hasNotificationPermission()) {
            requestPermissionForAlias(PUSH_PERMISSION, call, "afterPermission");
            return;
        }
        show(call, false);
    }

    @PermissionCallback
    private void afterPermission(PluginCall call) {
        if (!hasNotificationPermission()) {
            call.reject("你没有允许通知权限");
            return;
        }
        show(call, true);
    }

    private void show(PluginCall call, boolean isStart) {
        String title = call.getString("title", "小白");
        String text = call.getString("text", "");
        int progress = call.getInt("progress", -1);

        try {
            NotificationManager manager = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager == null) {
                call.reject("系统通知服务不可用");
                return;
            }

            ensureChannel(manager);

            Intent open = new Intent(getContext(), MainActivity.class);
            open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent contentIntent = PendingIntent.getActivity(
                getContext(),
                0,
                open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );

            NotificationCompat.Builder builder = new NotificationCompat.Builder(getContext(), CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(title)
                .setContentText(text)
                .setContentIntent(contentIntent)
                .setOngoing(true)
                .setSilent(true)
                .setShowWhen(false);

            // 常驻 + 进度样式 + 请求升级，三样齐了系统才会把它当「实时更新」
            if (progress >= 0) {
                builder.setProgress(100, Math.min(100, Math.max(0, progress)), false);
            } else {
                builder.setProgress(0, 0, true);
            }
            builder.setRequestPromotedOngoing(true);

            if (canPostPromoted()) {
                NotificationCompat.ProgressStyle style = new NotificationCompat.ProgressStyle()
                    .setStyledByProgress(false)
                    .setProgressIndeterminate(progress < 0);
                if (progress >= 0) style.setProgress(progress);
                builder.setStyle(style);
            }

            manager.notify(NOTIFICATION_ID, builder.build());

            JSObject result = new JSObject();
            result.put("success", true);
            result.put("promoted", canPostPromoted());
            result.put("first", isStart);
            call.resolve(result);
        } catch (Throwable error) {
            call.reject("显示常驻通知失败：" + error.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        try {
            NotificationManager manager = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) manager.cancel(NOTIFICATION_ID);
            call.resolve();
        } catch (Throwable error) {
            call.reject("撤下常驻通知失败：" + error.getMessage());
        }
    }

    private void ensureChannel(NotificationManager manager) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return;

        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "常驻状态",
            NotificationManager.IMPORTANCE_DEFAULT
        );
        channel.setDescription("在状态栏/流体云显示她当前的状态");
        channel.setShowBadge(false);
        channel.enableVibration(false);
        // 常驻状态不该出声，避免每条更新都叮一下
        channel.setSound(null, null);
        manager.createNotificationChannel(channel);
    }
}
