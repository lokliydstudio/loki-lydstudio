package no.lokilyd.crm;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.ArrayAdapter;
import android.widget.TextView;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    static final String EXTRA_TAB = "loki_tab";
    static final String TAB_TASKS = "tasks";
    private static final int FILE_PICKER = 201;
    private static final int NOTIFICATION_PERMISSION = 202;
    private static final String TAB_CRM = "crm";
    private static final String TAB_SETTINGS = "settings";

    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final List<TaskItem> tasks = new ArrayList<>();
    private FrameLayout content;
    private WebView webView;
    private LinearLayout nav;
    private ValueCallback<Uri[]> fileCallback;
    private String currentTab = TAB_CRM;
    private String currentEmail = "";
    private String status = "";
    private boolean loading;
    private boolean showCompleted;
    private OnBackInvokedCallback backCallback;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(0xFF20211F);
        getWindow().setNavigationBarColor(0xFF20211F);
        buildShell();
        createWebView();
        if (Build.VERSION.SDK_INT >= 33) {
            backCallback = this::handleBack;
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, backCallback);
        }
        showTab(TAB_TASKS.equals(getIntent().getStringExtra(EXTRA_TAB)) ? TAB_TASKS : TAB_CRM);
        webView.loadUrl(CrmApi.CRM_URL);
    }

    private void buildShell() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(0xFF20211F);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            int top;
            int bottom;
            if (Build.VERSION.SDK_INT >= 30) {
                top = insets.getInsets(WindowInsets.Type.statusBars()).top;
                bottom = insets.getInsets(WindowInsets.Type.navigationBars()).bottom;
            } else {
                top = insets.getSystemWindowInsetTop();
                bottom = insets.getSystemWindowInsetBottom();
            }
            view.setPadding(0, top, 0, bottom);
            return insets;
        });
        setContentView(root);

        LinearLayout masthead = new LinearLayout(this);
        masthead.setGravity(Gravity.CENTER_VERTICAL);
        masthead.setPadding(dp(16), dp(8), dp(16), dp(8));
        masthead.setBackgroundColor(0xFF20211F);
        TextView mark = new TextView(this);
        mark.setText(R.string.brand_header);
        mark.setTextColor(0xFFDFFF55);
        mark.setTextSize(15);
        mark.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        masthead.addView(mark, new LinearLayout.LayoutParams(0, dp(42), 1));
        root.addView(masthead);

        content = new FrameLayout(this);
        content.setBackgroundColor(getColor(R.color.loki_bg));
        root.addView(content, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));

        nav = new LinearLayout(this);
        nav.setGravity(Gravity.CENTER);
        nav.setBackgroundColor(0xFF20211F);
        nav.setPadding(dp(5), dp(5), dp(5), dp(5));
        root.addView(nav, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(60)));
    }

    private void createWebView() {
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        webView = new WebView(this);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        if (Build.VERSION.SDK_INT >= 27) settings.setSafeBrowsingEnabled(true);
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String host = uri.getHost();
                if ("https".equals(uri.getScheme()) && ("www.lokilyd.no".equals(host) || "lokilyd.no".equals(host))) return false;
                if ("https".equals(uri.getScheme()) || "mailto".equals(uri.getScheme()) || "tel".equals(uri.getScheme())) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
                    catch (Exception error) { Toast.makeText(MainActivity.this, "Kunne ikke åpne lenken.", Toast.LENGTH_SHORT).show(); }
                }
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (url.startsWith(CrmApi.ORIGIN + "/")) refreshTasks();
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try {
                    Intent picker = params.createIntent();
                    startActivityForResult(picker, FILE_PICKER);
                    return true;
                } catch (Exception error) {
                    fileCallback = null;
                    Toast.makeText(MainActivity.this, "Filvelgeren kunne ikke åpnes.", Toast.LENGTH_SHORT).show();
                    return false;
                }
            }
        });
        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            Uri uri = Uri.parse(url);
            if (!"https".equals(uri.getScheme()) || !"www.lokilyd.no".equals(uri.getHost())) {
                Toast.makeText(this, "Denne filen må åpnes i nettleseren.", Toast.LENGTH_SHORT).show();
                return;
            }
            try {
                String filename = URLUtil.guessFileName(url, contentDisposition, mimeType);
                DownloadManager.Request download = new DownloadManager.Request(uri);
                download.setMimeType(mimeType);
                download.addRequestHeader("Cookie", CookieManager.getInstance().getCookie(CrmApi.ORIGIN));
                download.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                download.setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, filename);
                DownloadManager manager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                manager.enqueue(download);
                Toast.makeText(this, "Laster ned " + filename, Toast.LENGTH_SHORT).show();
            } catch (Exception error) {
                Toast.makeText(this, "Kunne ikke laste ned filen.", Toast.LENGTH_SHORT).show();
            }
        });
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == FILE_PICKER && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
            fileCallback = null;
        }
    }

    private void showTab(String tab) {
        currentTab = tab;
        content.removeAllViews();
        if (TAB_CRM.equals(tab)) {
            if (webView != null) content.addView(webView);
        } else if (TAB_TASKS.equals(tab)) {
            renderTasks();
            refreshTasks();
        } else {
            renderSettings();
        }
        renderNavigation();
    }

    private void renderNavigation() {
        nav.removeAllViews();
        navButton("CRM", TAB_CRM);
        navButton("Oppgaver", TAB_TASKS);
        navButton("Innstillinger", TAB_SETTINGS);
    }

    private void navButton(String title, String tab) {
        TextView button = new TextView(this);
        button.setText(title);
        button.setTextSize(14);
        button.setGravity(Gravity.CENTER);
        button.setTypeface(Typeface.DEFAULT, tab.equals(currentTab) ? Typeface.BOLD : Typeface.NORMAL);
        button.setTextColor(tab.equals(currentTab) ? 0xFF20211F : 0xFFE7E7DF);
        if (tab.equals(currentTab)) button.setBackground(rounded(0xFFDFFF55, 13));
        button.setOnClickListener(view -> showTab(tab));
        nav.addView(button, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1));
    }

    private void refreshTasks() {
        if (loading) return;
        loading = true;
        io.execute(() -> {
            try {
                CrmApi.TaskList result = CrmApi.loadTasks();
                WidgetStore.save(this, result.tasks);
                runOnUiThread(() -> {
                    tasks.clear();
                    tasks.addAll(result.tasks);
                    currentEmail = result.email;
                    status = "";
                    loading = false;
                    redrawCurrentTab();
                });
            } catch (CrmApi.AuthRequired error) {
                WidgetStore.clear(this);
                runOnUiThread(() -> {
                    tasks.clear();
                    currentEmail = "";
                    status = error.getMessage();
                    loading = false;
                    redrawCurrentTab();
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    status = "Kunne ikke hente oppgaver. Prøv igjen.";
                    loading = false;
                    redrawCurrentTab();
                });
            }
        });
    }

    private void redrawCurrentTab() {
        if (TAB_TASKS.equals(currentTab)) renderTasks();
        if (TAB_SETTINGS.equals(currentTab)) renderSettings();
    }

    private void renderTasks() {
        if (content == null) return;
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        LinearLayout stack = vertical();
        stack.setPadding(dp(18), dp(24), dp(18), dp(24));
        scroll.addView(stack);
        content.removeAllViews();
        content.addView(scroll);

        addLabel(stack, "GJØRELISTE", 12, true, getColor(R.color.loki_muted));
        addLabel(stack, "Oppgaver", 31, true, getColor(R.color.loki_text));
        addLabel(stack, tasks.stream().filter(task -> !task.completed).count() + " åpne oppgaver · Leon og Charles", 14, false, getColor(R.color.loki_muted));

        if (currentEmail.isEmpty()) {
            LinearLayout card = card(stack);
            addLabel(card, "Logg inn i CRM-fanen først", 18, true, getColor(R.color.loki_text));
            addLabel(card, "Deretter vises oppgavene her og i Android-widgeten.", 14, false, getColor(R.color.loki_muted));
            actionButton(card, "Åpne CRM", () -> showTab(TAB_CRM));
        } else {
            LinearLayout form = card(stack);
            addLabel(form, "Ny oppgave", 18, true, getColor(R.color.loki_text));
            EditText title = new EditText(this);
            title.setSingleLine(true);
            title.setHint("Hva skal gjøres?");
            form.addView(title, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52)));
            Spinner assignee = new Spinner(this);
            String[] owners = {"Begge", "Leon", "Charles"};
            ArrayAdapter<String> adapter = new ArrayAdapter<>(this, android.R.layout.simple_spinner_item, owners);
            adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
            assignee.setAdapter(adapter);
            form.addView(assignee);
            actionButton(form, "Legg til oppgave", () -> {
                String value = title.getText().toString().trim();
                if (value.isEmpty()) { title.setError("Skriv en oppgave først."); return; }
                io.execute(() -> {
                    try {
                        CrmApi.createTask(value, owners[assignee.getSelectedItemPosition()]);
                        runOnUiThread(this::refreshTasks);
                    } catch (Exception error) { runOnUiThread(() -> Toast.makeText(this, "Kunne ikke lagre oppgaven.", Toast.LENGTH_SHORT).show()); }
                });
            });

            CheckBox completed = new CheckBox(this);
            completed.setText(R.string.show_completed);
            completed.setChecked(showCompleted);
            completed.setOnCheckedChangeListener((button, checked) -> { showCompleted = checked; renderTasks(); });
            stack.addView(completed);

            List<TaskItem> visible = new ArrayList<>();
            for (TaskItem task : tasks) if (showCompleted || !task.completed) visible.add(task);
            visible.sort(Comparator.comparing((TaskItem task) -> task.completed)
                    .thenComparing(task -> task.dueDate.isEmpty() ? "9999" : task.dueDate));
            if (visible.isEmpty()) addLabel(stack, "Ingen oppgaver akkurat nå.", 16, false, getColor(R.color.loki_muted));
            for (TaskItem task : visible) {
                LinearLayout item = card(stack);
                CheckBox check = new CheckBox(this);
                check.setText(task.title);
                check.setTextSize(16);
                check.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
                check.setChecked(task.completed);
                check.setOnCheckedChangeListener((button, checked) -> {
                    check.setEnabled(false);
                    io.execute(() -> {
                        try {
                            CrmApi.setCompleted(task, checked);
                            runOnUiThread(this::refreshTasks);
                        } catch (Exception error) {
                            runOnUiThread(() -> {
                                check.setChecked(task.completed);
                                check.setEnabled(true);
                                Toast.makeText(this, "Kunne ikke oppdatere oppgaven.", Toast.LENGTH_SHORT).show();
                            });
                        }
                    });
                });
                item.addView(check);
                if (!task.details.isEmpty()) addLabel(item, task.details, 14, false, getColor(R.color.loki_text));
                String meta = task.assignee + (task.dueDate.isEmpty() ? "" : " · Frist " + task.dueDate)
                        + ("Høy".equals(task.priority) ? " · Høy prioritet" : "");
                addLabel(item, meta, 12, false, getColor(R.color.loki_muted));
            }
        }
        if (!status.isEmpty()) addLabel(stack, status, 13, false, getColor(R.color.loki_muted));
        actionButton(stack, loading ? "Oppdaterer…" : "Oppdater oppgaver", this::refreshTasks);
    }

    private void renderSettings() {
        ScrollView scroll = new ScrollView(this);
        LinearLayout stack = vertical();
        stack.setPadding(dp(18), dp(24), dp(18), dp(24));
        scroll.addView(stack);
        content.removeAllViews();
        content.addView(scroll);
        addLabel(stack, "LOKI STUDIO", 12, true, getColor(R.color.loki_muted));
        addLabel(stack, "Innstillinger", 31, true, getColor(R.color.loki_text));

        LinearLayout account = card(stack);
        addLabel(account, "Konto", 18, true, getColor(R.color.loki_text));
        addLabel(account, currentEmail.isEmpty() ? "Ikke innlogget" : currentEmail, 15, false, getColor(R.color.loki_muted));
        addLabel(account, "Appen bruker samme private CRM-konto som nettsiden. Innloggingen blir lagret i Androids private webvisning.", 13, false, getColor(R.color.loki_muted));

        LinearLayout notices = card(stack);
        addLabel(notices, "Oppgavevarsler", 18, true, getColor(R.color.loki_text));
        addLabel(notices, TaskPollService.isEnabled(this) ? "På" : "Av", 14, true, getColor(R.color.loki_text));
        addLabel(notices, "Android sjekker endringer i oppgaver omtrent hvert 15. minutt når systemet tillater det. Dette er ikke sanntids-push.", 13, false, getColor(R.color.loki_muted));
        actionButton(notices, TaskPollService.isEnabled(this) ? "Slå av varsler" : "Aktiver varsler", () -> {
            if (TaskPollService.isEnabled(this)) {
                TaskPollService.disable(this);
                renderSettings();
            } else if (currentEmail.isEmpty()) {
                Toast.makeText(this, "Logg inn først.", Toast.LENGTH_SHORT).show();
                showTab(TAB_CRM);
            } else if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_PERMISSION);
            } else enableNotifications();
        });

        LinearLayout widget = card(stack);
        addLabel(widget, "Widget", 18, true, getColor(R.color.loki_text));
        addLabel(widget, "Legg til «Loki CRM» fra Androids widgetoversikt. Den viser åpne oppgaver uten å lagre innloggingsnøkkelen.", 13, false, getColor(R.color.loki_muted));
        if (!status.isEmpty()) addLabel(stack, status, 13, false, getColor(R.color.loki_muted));
    }

    private void enableNotifications() {
        TaskPollService.enable(this, tasks);
        renderSettings();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == NOTIFICATION_PERMISSION && results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) enableNotifications();
        else if (requestCode == NOTIFICATION_PERMISSION) Toast.makeText(this, "Tillat varsler i Android-innstillingene.", Toast.LENGTH_LONG).show();
    }

    private LinearLayout vertical() {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        return layout;
    }

    private LinearLayout card(LinearLayout parent) {
        LinearLayout card = vertical();
        card.setPadding(dp(16), dp(14), dp(16), dp(14));
        card.setBackground(rounded(getColor(R.color.loki_card), 18));
        LinearLayout.LayoutParams layout = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        layout.topMargin = dp(14);
        parent.addView(card, layout);
        return card;
    }

    private TextView addLabel(LinearLayout parent, String value, int size, boolean bold, int color) {
        TextView label = new TextView(this);
        label.setText(value);
        label.setTextSize(size);
        label.setTextColor(color);
        if (bold) label.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        LinearLayout.LayoutParams layout = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        layout.bottomMargin = dp(7);
        parent.addView(label, layout);
        return label;
    }

    private void actionButton(LinearLayout parent, String title, Runnable action) {
        Button button = new Button(this);
        button.setText(title);
        button.setAllCaps(false);
        button.setTextColor(0xFF20211F);
        button.setBackground(rounded(0xFFDFFF55, 13));
        LinearLayout.LayoutParams layout = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48));
        layout.topMargin = dp(10);
        parent.addView(button, layout);
        button.setOnClickListener(view -> action.run());
    }

    private GradientDrawable rounded(int color, int radius) {
        GradientDrawable background = new GradientDrawable();
        background.setColor(color);
        background.setCornerRadius(dp(radius));
        return background;
    }

    private int dp(float value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (TAB_TASKS.equals(intent.getStringExtra(EXTRA_TAB))) showTab(TAB_TASKS);
    }

    @SuppressLint("GestureBackNavigation")
    @Override
    public void onBackPressed() {
        handleBack();
    }

    private void handleBack() {
        if (TAB_CRM.equals(currentTab) && webView.canGoBack()) webView.goBack();
        else if (!TAB_CRM.equals(currentTab)) showTab(TAB_CRM);
        else finish();
    }

    @Override
    protected void onDestroy() {
        if (Build.VERSION.SDK_INT >= 33 && backCallback != null) getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(backCallback);
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        CookieManager.getInstance().flush();
        io.shutdown();
        super.onDestroy();
    }
}
