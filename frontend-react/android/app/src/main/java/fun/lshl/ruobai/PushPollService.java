package fun.lshl.ruobai;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.SystemClock;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

/**
 * ═══ 不依赖谷歌的后台守候（2026/9/21）═══
 *
 * 为什么有这个东西：
 *   FCM 推送必须靠一条通往 Google 的长连接（mtalk.google.com:5228）。
 *   用户网络下这条连接是断的（真机实测 ping 100% 丢包、curl 443 超时），
 *   于是服务器显示推送成功、手机却永远收不到。
 *
 * 这个服务做的事：
 *   1. 常驻（前台服务），所以 ColorOS 不会把若白冻结掉；
 *   2. 每隔几分钟直接问若白服务器「有没有她新说的话」（走 HTTPS，不经谷歌）；
 *   3. 有新的就本地弹通知；
 *   4. 它自己的常驻通知**同时就是**流体云那个小胶囊（promoted ongoing）。
 *
 * 为什么用 AlarmManager 而不是单纯 Handler 循环：
 *   Handler.postDelayed 用的是 uptimeMillis，手机深度睡眠时它不走，
 *   所以纯 Handler 循环在兜里睡着时会被一路推迟。
 *   setAndAllowWhileIdle 不需要额外权限，而且在 Doze 下也能把服务叫醒。
 */
public class PushPollService extends Service {

    static final String PREFS = "ruobai_push_poll";
    static final String KEY_DEVICE = "device_key";
    static final String KEY_BASE = "base_url";
    static final String KEY_INTERVAL = "interval_minutes";
    static final String KEY_CURSOR = "cursor";
    static final String KEY_LAST_POLL = "last_poll_at";
    static final String KEY_LAST_ERROR = "last_error";
    static final String KEY_ENABLED = "enabled";

    static final String ACTION_POLL = "fun.lshl.ruobai.action.POLL";
    static final String ACTION_BOOT = "fun.lshl.ruobai.action.BOOT";

    /** 常驻胶囊 / 前台服务通知共用一个 id，免得出现两个胶囊。 */
    static final int CAPSULE_ID = 42001;
    private static final int MESSAGE_ID_BASE = 61000;
    private static final int DEFAULT_INTERVAL_MINUTES = 5;
    private static final int CONNECT_TIMEOUT_MS = 15000;
    private static final int READ_TIMEOUT_MS = 15000;
    private static final int MAX_ITEMS = 20;

    static final String CHANNEL_CAPSULE = "ruobai_live";
    static final String CHANNEL_MESSAGE = "ruobai_proactive";

    private static final String TAG = "RuobaiPushPoll";

    /** 服务是否在跑：LiveUpdatePlugin 用它决定要不要真的取消胶囊。 */
    static volatile boolean running = false;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        String key = prefs.getString(KEY_DEVICE, "");
        String base = prefs.getString(KEY_BASE, "");
        boolean enabled = prefs.getBoolean(KEY_ENABLED, false);

        if (!enabled || key.isEmpty() || base.isEmpty()) {
            running = false;
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
            stopSelf();
            return START_NOT_STICKY;
        }

        ensureChannels();
        startCapsule();
        running = true;

        // 每次服务起来都确保「第二道保险」在系统侧登记着。
        // 放在这里而不是只在开关那一步排，是因为重装/恢复走的是另一条路，
        // 只在开关处排会导致 job 悄悄丢失（真机上踩过）。
        PushPollJobService.schedule(this);

        final String action = intent == null ? null : intent.getAction();
        if (ACTION_POLL.equals(action) || ACTION_BOOT.equals(action) || action == null) {
            // 网络请求不能占着主线程，单开一条线程。
            new Thread(this::pollOnce, "ruobai-poll").start();
        }
        scheduleNext();
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        super.onDestroy();
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // 从最近任务里划掉时，ColorOS 默认会把服务一起收走。重新排一次闹钟把它拉回来。
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        if (prefs.getBoolean(KEY_ENABLED, false)) {
            scheduleAlarm(this, prefs.getInt(KEY_INTERVAL, DEFAULT_INTERVAL_MINUTES));
        }
        super.onTaskRemoved(rootIntent);
    }

    // ────────────────────────── 轮询 ──────────────────────────

    private void pollOnce() {
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        String key = prefs.getString(KEY_DEVICE, "");
        String base = prefs.getString(KEY_BASE, "");
        if (key.isEmpty() || base.isEmpty()) return;

        long cursor = prefs.getLong(KEY_CURSOR, -1L);
        HttpURLConnection connection = null;
        try {
            StringBuilder url = new StringBuilder(base)
                .append("/api/push/poll/pending");
            if (cursor >= 0) {
                url.append("?since=").append(URLEncoder.encode(String.valueOf(cursor), "UTF-8"));
            }

            connection = (HttpURLConnection) new URL(url.toString()).openConnection();
            connection.setRequestMethod("GET");
            connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
            connection.setReadTimeout(READ_TIMEOUT_MS);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("x-device-key", key);

            int code = connection.getResponseCode();
            if (code != 200) {
                recordError("HTTP " + code);
                return;
            }

            StringBuilder body = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) body.append(line);
            }

            JSONObject payload = new JSONObject(body.toString());
            long nextCursor = payload.optLong("cursor", Math.max(cursor, 0));
            JSONArray items = payload.optJSONArray("items");

            int shown = 0;
            if (items != null) {
                for (int i = 0; i < items.length() && shown < MAX_ITEMS; i++) {
                    JSONObject item = items.optJSONObject(i);
                    if (item == null) continue;
                    showMessage(item);
                    shown += 1;
                }
            }

            SharedPreferences.Editor editor = prefs.edit()
                .putLong(KEY_CURSOR, nextCursor)
                .putLong(KEY_LAST_POLL, System.currentTimeMillis())
                .putString(KEY_LAST_ERROR, "");
            editor.apply();

            if (shown > 0) updateCapsule("她给你留了句话");
        } catch (Exception error) {
            recordError(String.valueOf(error.getMessage()));
            Log.w(TAG, "poll failed: " + error.getMessage());
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private void recordError(String message) {
        getSharedPreferences(PREFS, MODE_PRIVATE)
            .edit()
            .putLong(KEY_LAST_POLL, System.currentTimeMillis())
            .putString(KEY_LAST_ERROR, message == null ? "未知错误" : message)
            .apply();
    }

    private void showMessage(JSONObject item) {
        long itemId = item.optLong("id", 0L);
        String title = item.optString("character_name", "小白");
        String body = item.optString("body", "");
        int characterId = item.optInt("character_id", 0);
        if (body.isEmpty()) return;

        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;

        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        open.putExtra("ruobai_character_id", characterId);
        open.putExtra("ruobai_message_id", itemId);
        PendingIntent contentIntent = PendingIntent.getActivity(
            this,
            (int) (itemId % 100000),
            open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Notification notification = new NotificationCompat.Builder(this, CHANNEL_MESSAGE)
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(0xFFC16579)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setContentIntent(contentIntent)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .build();

        manager.notify(MESSAGE_ID_BASE + (int) (itemId % 10000), notification);
    }

    // ────────────────────────── 常驻胶囊 ──────────────────────────

    private void startCapsule() {
        updateCapsule(null);
    }

    /**
     * 常驻通知 = 前台服务通知 = 流体云胶囊。
     * 「常驻 + 进度样式 + setRequestPromotedOngoing(true)」三样齐了，
     * Android 16 才会把它升级成顶部胶囊（详见 LiveUpdatePlugin 顶部说明）。
     */
    private void updateCapsule(String text) {
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;

        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
            this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_CAPSULE)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("小白")
            .setContentText(text == null ? "在后台守着你" : text)
            .setContentIntent(contentIntent)
            .setOngoing(true)
            .setSilent(true)
            .setShowWhen(false)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            // 常驻 + 进度样式 + 请求升级，系统才会考虑把它当「实时更新」
            .setProgress(0, 0, true)
            .setRequestPromotedOngoing(true);

        try {
            NotificationCompat.ProgressStyle style = new NotificationCompat.ProgressStyle()
                .setStyledByProgress(false)
                .setProgressIndeterminate(true);
            builder.setStyle(style);
        } catch (Throwable ignored) {
            // 低版本没有 ProgressStyle，退化成普通常驻通知即可
        }

        Notification notification = builder.build();
        int type = Build.VERSION.SDK_INT >= 34
            ? ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING
            : 0;
        if (type != 0) {
            ServiceCompat.startForeground(this, CAPSULE_ID, notification, type);
        } else {
            startForeground(CAPSULE_ID, notification);
        }

        if (text != null) manager.notify(CAPSULE_ID, notification);
    }

    private void ensureChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;

        if (manager.getNotificationChannel(CHANNEL_CAPSULE) == null) {
            NotificationChannel capsule = new NotificationChannel(
                CHANNEL_CAPSULE, "常驻状态", NotificationManager.IMPORTANCE_LOW);
            capsule.setDescription("在状态栏/流体云显示她当前的状态");
            capsule.setShowBadge(false);
            capsule.enableVibration(false);
            capsule.setSound(null, null);
            manager.createNotificationChannel(capsule);
        }

        if (manager.getNotificationChannel(CHANNEL_MESSAGE) == null) {
            NotificationChannel message = new NotificationChannel(
                CHANNEL_MESSAGE, "小白的消息", NotificationManager.IMPORTANCE_HIGH);
            message.setDescription("她主动发来的消息");
            message.enableVibration(true);
            message.setShowBadge(true);
            manager.createNotificationChannel(message);
        }
    }

    // ────────────────────────── 定时 ──────────────────────────

    private void scheduleNext() {
        int minutes = getSharedPreferences(PREFS, MODE_PRIVATE)
            .getInt(KEY_INTERVAL, DEFAULT_INTERVAL_MINUTES);
        scheduleAlarm(this, minutes);
    }

    static void scheduleAlarm(Context context, int minutes) {
        int safeMinutes = Math.max(1, Math.min(minutes, 120));
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (manager == null) return;

        Intent intent = new Intent(context, PushPollService.class).setAction(ACTION_POLL);
        PendingIntent pending = PendingIntent.getService(
            context,
            1001,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        long triggerAt = SystemClock.elapsedRealtime() + safeMinutes * 60_000L;
        try {
            // setAndAllowWhileIdle 不需要额外权限，而且在 Doze 下也能把服务叫醒
            manager.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pending);
        } catch (Throwable error) {
            manager.set(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pending);
        }
    }
}
