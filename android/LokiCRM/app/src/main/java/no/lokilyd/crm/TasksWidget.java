package no.lokilyd.crm;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class TasksWidget extends AppWidgetProvider {
    private static final ExecutorService WORKER = Executors.newSingleThreadExecutor();

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        updateAll(context);
        PendingResult pending = goAsync();
        Context appContext = context.getApplicationContext();
        WORKER.execute(() -> {
            try {
                CrmApi.TaskList result = CrmApi.loadTasks();
                WidgetStore.save(appContext, result.tasks);
            } catch (CrmApi.AuthRequired error) {
                WidgetStore.clear(appContext);
            } catch (Exception ignored) {
                // Keep the last known snapshot when offline.
            } finally {
                pending.finish();
            }
        });
    }

    static void updateAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        ComponentName provider = new ComponentName(context, TasksWidget.class);
        int[] ids = manager.getAppWidgetIds(provider);
        for (int id : ids) updateOne(context, manager, id);
    }

    private static void updateOne(Context context, AppWidgetManager manager, int id) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.tasks_widget);
        if (!WidgetStore.hasSnapshot(context)) {
            views.setTextViewText(R.id.widget_count, "Logg inn for oppgaver");
            views.setTextViewText(R.id.widget_tasks, "Åpne Loki CRM og logg inn.");
        } else {
            int count = WidgetStore.count(context);
            List<String> titles = WidgetStore.visibleTasks(context);
            views.setTextViewText(R.id.widget_count, count + (count == 1 ? " åpen oppgave" : " åpne oppgaver"));
            if (titles.isEmpty()) views.setTextViewText(R.id.widget_tasks, "Alt er gjort ✓");
            else {
                StringBuilder summary = new StringBuilder();
                for (String title : titles) {
                    if (summary.length() > 0) summary.append('\n');
                    summary.append("• ").append(title);
                }
                views.setTextViewText(R.id.widget_tasks, summary.toString());
            }
        }
        Intent open = new Intent(context, MainActivity.class).putExtra(MainActivity.EXTRA_TAB, MainActivity.TAB_TASKS);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent action = PendingIntent.getActivity(context, 1, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.widget_root, action);
        manager.updateAppWidget(id, views);
    }
}
