package no.lokilyd.crm;

import android.webkit.CookieManager;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

final class CrmApi {
    static final String ORIGIN = "https://www.lokilyd.no";
    static final String CRM_URL = ORIGIN + "/crmplatform/";
    private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");
    private static final OkHttpClient CLIENT = new OkHttpClient.Builder()
            .followRedirects(false)
            .followSslRedirects(false)
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(15, TimeUnit.SECONDS)
            .build();

    static final class AuthRequired extends IOException {
        AuthRequired() { super("Logg inn i CRM-fanen først."); }
    }

    static final class TaskList {
        final String email;
        final List<TaskItem> tasks;

        TaskList(String email, List<TaskItem> tasks) {
            this.email = email;
            this.tasks = tasks;
        }
    }

    private CrmApi() {}

    static TaskList loadTasks() throws IOException, JSONException {
        JSONObject auth = request("GET", "/api/crm/auth-status", null);
        if (!auth.optBoolean("authenticated")) throw new AuthRequired();
        String email = auth.optJSONObject("user") == null ? "" : auth.optJSONObject("user").optString("email");
        JSONObject workspace = request("GET", "/api/studio?action=workspace", null);
        JSONArray array = workspace.optJSONArray("tasks");
        List<TaskItem> tasks = new ArrayList<>();
        if (array != null) for (int i = 0; i < array.length(); i++) {
            JSONObject item = array.optJSONObject(i);
            if (item != null) tasks.add(new TaskItem(item));
        }
        return new TaskList(email, tasks);
    }

    static TaskItem createTask(String title, String assignee) throws IOException, JSONException {
        JSONObject item = new JSONObject().put("title", title).put("assignee", assignee).put("priority", "Normal");
        JSONObject body = new JSONObject().put("kind", "task").put("item", item);
        return new TaskItem(request("POST", "/api/studio?action=workspace", body).getJSONObject("item"));
    }

    static TaskItem setCompleted(TaskItem task, boolean completed) throws IOException, JSONException {
        JSONObject body = new JSONObject().put("id", task.id).put("changes", new JSONObject().put("completed", completed));
        return new TaskItem(request("PATCH", "/api/studio?action=workspace", body).getJSONObject("item"));
    }

    private static JSONObject request(String method, String path, JSONObject body) throws IOException, JSONException {
        if (!path.startsWith("/api/") || path.startsWith("//")) throw new IOException("Ugyldig API-adresse.");
        CookieManager cookies = CookieManager.getInstance();
        String cookie = cookies.getCookie(ORIGIN);
        if (cookie == null || !cookie.contains("loki_crm_session=")) throw new AuthRequired();
        RequestBody payload = body == null ? null : RequestBody.create(body.toString(), JSON);
        Request request = new Request.Builder()
                .url(ORIGIN + path)
                .method(method, payload)
                .header("Cookie", cookie)
                .header("Accept", "application/json")
                .build();
        try (Response response = CLIENT.newCall(request).execute()) {
            for (String value : response.headers("Set-Cookie")) cookies.setCookie(ORIGIN, value);
            cookies.flush();
            if (response.code() == 401) throw new AuthRequired();
            if (!response.isSuccessful()) throw new IOException("CRM svarte med feil " + response.code() + ".");
            if (response.body() == null) throw new IOException("CRM svarte uten data.");
            return new JSONObject(response.body().string());
        }
    }
}
