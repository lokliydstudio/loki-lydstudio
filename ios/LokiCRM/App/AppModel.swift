import Foundation
import SwiftUI
import UIKit
import WebKit
import WidgetKit
import UserNotifications

struct CrmTask: Codable, Identifiable {
    let id: String
    let title: String
    let details: String
    let dueDate: String
    let priority: String
    let assignee: String
    let completed: Bool
}

private struct AuthReply: Decodable {
    struct User: Decodable { let email: String }
    let authenticated: Bool
    let user: User
}
private struct WorkspaceReply: Decodable { let tasks: [CrmTask] }
private struct TaskReply: Decodable { let item: CrmTask }
private struct NativePushReply: Decodable { let configured: Bool? }

private struct APIError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

@MainActor
final class AppModel: NSObject, ObservableObject, WKNavigationDelegate, WKUIDelegate {
    static let origin = URL(string: "https://www.lokilyd.no")!
    static weak var current: AppModel?
    let webView: WKWebView
    @Published private(set) var tasks: [CrmTask] = []
    @Published private(set) var currentEmail = ""
    @Published private(set) var errorMessage = ""
    @Published private(set) var loading = false
    @Published private(set) var pushConfigured = false
    @Published private(set) var notificationsEnabled = UserDefaults.standard.bool(forKey: "loki-native-push-enabled")
    private var deviceToken = ""

    override init() {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()
        Self.current = self
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.load(URLRequest(url: Self.origin.appending(path: "/crmplatform/")))
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard webView.url?.host == Self.origin.host else { return }
        Task {
            await refreshTasks()
            await refreshPushStatus()
            if notificationsEnabled && !deviceToken.isEmpty { await registerDeviceToken(deviceToken) }
        }
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url { webView.load(URLRequest(url: url)) }
        return nil
    }

    func openCRM(path: String) {
        let safePath = path.hasPrefix("/crmplatform/") ? path : "/crmplatform/"
        guard let url = URL(string: safePath, relativeTo: Self.origin)?.absoluteURL else { return }
        webView.load(URLRequest(url: url))
    }

    private func crmCookie() async -> HTTPCookie? {
        await withCheckedContinuation { continuation in
            webView.configuration.websiteDataStore.httpCookieStore.getAllCookies { cookies in
                continuation.resume(returning: cookies.first { $0.name == "loki_crm_session" && $0.domain.contains("lokilyd.no") })
            }
        }
    }

    private func syncCookies(from response: HTTPURLResponse, url: URL) async {
        let headers = response.allHeaderFields.reduce(into: [String: String]()) { result, entry in
            if let key = entry.key as? String, let value = entry.value as? String { result[key] = value }
        }
        for cookie in HTTPCookie.cookies(withResponseHeaderFields: headers, for: url) {
            await withCheckedContinuation { continuation in
                webView.configuration.websiteDataStore.httpCookieStore.setCookie(cookie) { continuation.resume() }
            }
        }
    }

    private func request<T: Decodable>(_ path: String, method: String = "GET", body: Data? = nil) async throws -> T {
        guard let cookie = await crmCookie() else { throw APIError(message: "Logg inn i CRM-fanen først.") }
        guard let url = URL(string: path, relativeTo: Self.origin)?.absoluteURL else { throw APIError(message: "Ugyldig adresse.") }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpBody = body
        request.setValue("\(cookie.name)=\(cookie.value)", forHTTPHeaderField: "Cookie")
        if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        request.cachePolicy = .reloadIgnoringLocalCacheData
        let (data, rawResponse) = try await URLSession.shared.data(for: request)
        guard let response = rawResponse as? HTTPURLResponse else { throw APIError(message: "Ugyldig serversvar.") }
        await syncCookies(from: response, url: url)
        if response.statusCode == 401 { throw APIError(message: "Økten er utløpt. Logg inn i CRM-fanen.") }
        guard (200..<300).contains(response.statusCode) else {
            throw APIError(message: "CRM svarte med feil \(response.statusCode).")
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    func refreshTasks() async {
        loading = true
        defer { loading = false }
        do {
            let auth: AuthReply = try await request("/api/crm/auth-status")
            currentEmail = auth.user.email
            let result: WorkspaceReply = try await request("/api/studio?action=workspace")
            tasks = result.tasks
            errorMessage = ""
            saveWidgetSnapshot()
        } catch {
            if error.localizedDescription.contains("Logg inn") || error.localizedDescription.contains("utløpt") {
                currentEmail = ""
                tasks = []
                WidgetSnapshot.clear()
                WidgetCenter.shared.reloadTimelines(ofKind: "LokiTasksWidget")
            }
            errorMessage = error.localizedDescription
        }
    }

    func createTask(title: String, assignee: String) async -> Bool {
        do {
            let payload = ["kind": "task", "item": ["title": title, "assignee": assignee, "priority": "Normal"]] as [String: Any]
            let data = try JSONSerialization.data(withJSONObject: payload)
            let reply: TaskReply = try await request("/api/studio?action=workspace", method: "POST", body: data)
            tasks.insert(reply.item, at: 0)
            saveWidgetSnapshot()
            errorMessage = ""
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }

    func setTaskCompleted(_ task: CrmTask, completed: Bool) async {
        do {
            let payload: [String: Any] = ["id": task.id, "changes": ["completed": completed]]
            let data = try JSONSerialization.data(withJSONObject: payload)
            let reply: TaskReply = try await request("/api/studio?action=workspace", method: "PATCH", body: data)
            tasks = tasks.map { $0.id == task.id ? reply.item : $0 }
            saveWidgetSnapshot()
            errorMessage = ""
        } catch { errorMessage = error.localizedDescription }
    }

    private func saveWidgetSnapshot() {
        let visible = tasks.filter { !$0.completed }.sorted { ($0.dueDate.isEmpty ? "9999" : $0.dueDate) < ($1.dueDate.isEmpty ? "9999" : $1.dueDate) }
        WidgetSnapshot(tasks: visible.prefix(6).map { WidgetTask(id: $0.id, title: $0.title, assignee: $0.assignee, dueDate: $0.dueDate) }, updatedAt: Date()).save()
        WidgetCenter.shared.reloadTimelines(ofKind: "LokiTasksWidget")
    }

    func refreshPushStatus() async {
        do {
            let reply: NativePushReply = try await request("/api/studio?action=native-push")
            pushConfigured = reply.configured ?? false
        } catch { pushConfigured = false }
    }

    func enableNotifications() async {
        do {
            let granted = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound])
            guard granted else { throw APIError(message: "Tillat varsler for Loki CRM i iPhone-innstillingene.") }
            notificationsEnabled = true
            UserDefaults.standard.set(true, forKey: "loki-native-push-enabled")
            UIApplication.shared.registerForRemoteNotifications()
            errorMessage = ""
        } catch { errorMessage = error.localizedDescription }
    }

    func disableNotifications() async {
        notificationsEnabled = false
        UserDefaults.standard.set(false, forKey: "loki-native-push-enabled")
        guard !deviceToken.isEmpty else { return }
        do {
            let body = try JSONSerialization.data(withJSONObject: ["token": deviceToken])
            let _: NativePushReply = try await request("/api/studio?action=native-push", method: "DELETE", body: body)
        } catch { errorMessage = error.localizedDescription }
    }

    func registerDeviceToken(_ token: String) async {
        deviceToken = token
        guard notificationsEnabled else { return }
        #if DEBUG
        let environment = "sandbox"
        #else
        let environment = "production"
        #endif
        do {
            let body = try JSONSerialization.data(withJSONObject: ["token": token, "environment": environment, "device": "iPhone · Loki CRM"])
            let reply: NativePushReply = try await request("/api/studio?action=native-push", method: "POST", body: body)
            pushConfigured = reply.configured ?? false
            errorMessage = ""
        } catch { errorMessage = error.localizedDescription }
    }
}
