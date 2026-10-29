package fun.lshl.ruobai;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

/**
 * ═══ 守候的「第二道保险」（2026/9/21）═══
 *
 * 为什么需要它（真机实测踩到的）：
 *   ColorOS 从最近任务里划掉若白时，会**连前台服务和它的闹钟一起清掉**。
 *   logcat 证据：`unproxyAlarmsByUid ... fun.lshl.ruobai` 紧跟着
 *   `Process fun.lshl.ruobai has died: fg +50 FGS`、`o-kill(40)`。
 *   也就是说 PushPollService.onTaskRemoved() 排的那个闹钟根本没机会生效。
 *
 * JobScheduler 不一样：任务登记在**系统**那边，进程死了系统照样会把它拉回来。
 * 代价是系统只保证 15 分钟以上的周期、且时间不精确 —— 所以它是"兜底"，
 * 不是主通道。主通道仍然是 PushPollService 的 5 分钟闹钟。
 *
 * 另外，国产 ROM 还有一道「自启动白名单」要用户自己开：
 *   设置 → 电池 → 应用自启动管理 → 若白 → 允许
 * 不开的话，划掉 App 之后连 JobScheduler 也可能被拦。
 */
public class PushPollJobService extends JobService {

    /** 15 分钟是 JobScheduler 允许的最短周期。 */
    private static final long INTERVAL_MS = 15 * 60 * 1000L;
    private static final int JOB_ID = 42010;

    @Override
    public boolean onStartJob(JobParameters params) {
        SharedPreferences prefs = getSharedPreferences(PushPollService.PREFS, MODE_PRIVATE);
        boolean enabled = prefs.getBoolean(PushPollService.KEY_ENABLED, false);
        boolean hasKey = !prefs.getString(PushPollService.KEY_DEVICE, "").isEmpty();

        if (!enabled || !hasKey) {
            // 用户关掉了守候：别再唤醒自己
            cancel(this);
            return false;
        }

        // 顺手把前台服务拉回来（它才是 5 分钟那条快路径）
        try {
            startForegroundService(new Intent(this, PushPollService.class)
                .setAction(PushPollService.ACTION_POLL));
        } catch (Throwable ignored) {
            // 后台启动前台服务受限时不强求，下面的 job 结束自己会再排下一次
        }

        // 真正的活交给 PushPollService 去做，这里不占线程
        return false;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        // 返回 true = 被系统中断后希望重排
        return true;
    }

    static void schedule(Context context) {
        JobScheduler scheduler = (JobScheduler) context.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (scheduler == null) return;

        JobInfo job = new JobInfo.Builder(JOB_ID, new ComponentName(context, PushPollJobService.class))
            .setPeriodic(INTERVAL_MS)
            // 不需要联网才能触发 —— 断网时也得能醒过来，请求失败让它自己重试就行
            .setPersisted(true)
            .build();
        try {
            scheduler.schedule(job);
        } catch (Throwable ignored) {
            // 个别 ROM 禁掉了 JobScheduler，不影响主通道
        }
    }

    static void cancel(Context context) {
        JobScheduler scheduler = (JobScheduler) context.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (scheduler != null) scheduler.cancel(JOB_ID);
    }
}
