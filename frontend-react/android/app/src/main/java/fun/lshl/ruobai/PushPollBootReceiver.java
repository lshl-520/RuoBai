package fun.lshl.ruobai;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * 开机自启：手机重启之后把守候服务拉回来。
 * 用户关了这个开关时 PREFS 里 enabled=false，服务自己会立刻退掉，
 * 所以这里不需要额外判断。
 */
public class PushPollBootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent == null ? null : intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action)
            && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            return;
        }
        if (!context.getSharedPreferences(PushPollService.PREFS, Context.MODE_PRIVATE)
            .getBoolean(PushPollService.KEY_ENABLED, false)) {
            return;
        }
        Intent service = new Intent(context, PushPollService.class)
            .setAction(PushPollService.ACTION_BOOT);
        try {
            context.startForegroundService(service);
        } catch (Throwable error) {
            // 个别 ROM 在开机阶段不让起前台服务，退一步排个闹钟
            PushPollService.scheduleAlarm(context, 1);
        }
    }
}
