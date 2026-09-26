package no.lokilyd.crm;

import android.Manifest;
import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class TaskPollService extends JobService {
    private static final int JOB_ID = 260926;
    private static final String PREFS = "loki_task_notifications";
    private static final String ENABLED = "enabled";
    private static final String LAST_STATE = "last_state";
    private static final String CHANNEL = "loki_task_updates";
    private static final ExecutorService WORKER = Executors.newSingleThreadExecutor();

    static boolean isEnabled(Context context) { return prefs(context).getBoolean(ENABLED, false); }

    static void enable(Context context, List<TaskItem> baseline) {
        prefs(context).edit().putBoolean(ENABLED, true).putString(LAST_STATE, state(baseline).toString()).apply();
        JobScheduler scheduler = context.getSystemService(JobScheduler.class);
        if (scheduler == null) return;
        JobInfo job = new JobInfo.Builder(JOB_ID, new ComponentName(context, TaskPollService.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPeriodic(15 * 60 * 1000L)
                .setPersisted(true)
                .build();
        scheduler.schedule(job);
    }

    static void disable(Context context) {
        prefs(context).edit().putBoolean(ENABLED, false).remove(LAST_STATE).apply();
        JobScheduler scheduler = context.getSystemService(JobScheduler.class);
        if (scheduler != null) scheduler.cancel(JOB_ID);
    }

    static void recordOwnChange(Context context, List<TaskItem> tasks) {
        if (isEnabled(context)) prefs(context).edit().putString(LAST_STATE, state(tasks).toString()).apply();
    }

    @Override
    public boolean onStartJob(JobParameters params) {
        Context context = getApplicationContext();
        WORKER.execute(() -> {
            try {
                if (isEnabled(context)) {
                    CrmApi.TaskList result = CrmApi.loadTasks();
                    WidgetStore.save(context, result.tasks);
                    compareAndNotify(context, result.tasks);
                }
            } catch (CrmApi.AuthRequired error) {
                WidgetStore.clear(context);
            } catch (Exception ignored) {
                // Network failures retain the previous state and are retried on the next run.
            } finally {
                jobFinished(params, false);
            }
        });
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) { return true; }

    private static void compareAndNotify(Context context, List<TaskItem> tasks) {
        SharedPreferences settings = prefs(context);
        String previousText = settings.getString(LAST_STATE, "");
        JSONObject next = state(tasks);
        settings.edit().putString(LAST_STATE, next.toString()).apply();
        if (previousText.isEmpty()) return;
        JSONObject previous;
        try { previous = new JSONObject(previousText); }
        catch (Exception ignored) { return; }
        List<String> changes = new ArrayList<>();
        for (TaskItem task : tasks) {
            if (!previous.has(task.id)) {
                if (!task.completed) changes.add("Ny oppgave: " + task.title);
            } else if (previous.optBoolean(task.id) != task.completed) {
                changes.add(task.actorName() + (task.completed ? " fullførte «" : " åpnet «") + task.title + "»");
            }
        }
        if (changes.isEmpty() || !isEnabled(context)) return;
        if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;

        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL, "CRM-oppgaver", NotificationManager.IMPORTANCE_DEFAULT);
        channel.setDescription("Endringer i gjøreliste for Loki Lydstudio");
        manager.createNotificationChannel(channel);
        Intent open = new Intent(context, MainActivity.class).putExtra(MainActivity.EXTRA_TAB, MainActivity.TAB_TASKS);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent action = PendingIntent.getActivity(context, 2, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        String text = changes.size() == 1 ? changes.get(0) : changes.size() + " endringer. " + changes.get(0);
        Notification notification = new Notification.Builder(context, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setColor(Color.rgb(223, 255, 85))
                .setContentTitle("Loki CRM · Gjøreliste")
                .setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text))
                .setVisibility(Notification.VISIBILITY_PRIVATE)
                .setAutoCancel(true)
                .setContentIntent(action)
                .build();
        manager.notify(1001, notification);
    }

    private static JSONObject state(List<TaskItem> tasks) {
        JSONObject state = new JSONObject();
        try { for (TaskItem task : tasks) state.put(task.id, task.completed); }
        catch (Exception ignored) { /* Task IDs are already validated by the CRM. */ }
        return state;
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
