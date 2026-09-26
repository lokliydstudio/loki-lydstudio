package no.lokilyd.crm;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

final class WidgetStore {
    private static final String PREFS = "loki_widget_snapshot";
    private static final String TASKS = "tasks";

    private WidgetStore() {}

    static void save(Context context, List<TaskItem> tasks) {
        JSONArray snapshot = new JSONArray();
        for (TaskItem task : tasks) {
            if (task.completed) continue;
            try { snapshot.put(new JSONObject().put("title", task.title).put("assignee", task.assignee)); }
            catch (JSONException ignored) { /* Invalid task rows are skipped. */ }
        }
        prefs(context).edit().putString(TASKS, snapshot.toString()).apply();
        TasksWidget.updateAll(context);
    }

    static void clear(Context context) {
        prefs(context).edit().remove(TASKS).apply();
        TasksWidget.updateAll(context);
    }

    static boolean hasSnapshot(Context context) { return prefs(context).contains(TASKS); }

    static List<String> visibleTasks(Context context) {
        List<String> result = new ArrayList<>();
        try {
            JSONArray tasks = new JSONArray(prefs(context).getString(TASKS, "[]"));
            for (int i = 0; i < tasks.length() && result.size() < 4; i++) {
                JSONObject item = tasks.optJSONObject(i);
                if (item != null) result.add(item.optString("title"));
            }
        } catch (JSONException ignored) { /* Corrupt snapshots are treated as empty. */ }
        return result;
    }

    static int count(Context context) {
        try { return new JSONArray(prefs(context).getString(TASKS, "[]")).length(); }
        catch (JSONException ignored) { return 0; }
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
