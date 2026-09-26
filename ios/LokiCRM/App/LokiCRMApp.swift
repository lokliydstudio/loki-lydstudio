import SwiftUI
import UserNotifications

@main
struct LokiCRMApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var model = AppModel()
    @State private var selectedTab = 0

    var body: some Scene {
        WindowGroup {
            TabView(selection: $selectedTab) {
                CRMWebView(webView: model.webView)
                    .tabItem { Label("CRM", systemImage: "square.grid.2x2") }
                    .tag(0)
                TasksView(model: model, openCRM: { selectedTab = 0 })
                    .tabItem { Label("Oppgaver", systemImage: "checklist") }
                    .tag(1)
                SettingsView(model: model)
                    .tabItem { Label("Innstillinger", systemImage: "gearshape") }
                    .tag(2)
            }
            .tint(Color(red: 0.38, green: 0.25, blue: 0.78))
            .onOpenURL { url in
                guard url.scheme == "lokicrm" else { return }
                if url.host == "tasks" {
                    selectedTab = 1
                    Task { await model.refreshTasks() }
                } else {
                    selectedTab = 0
                    model.openCRM(path: "/crmplatform/")
                }
            }
            .onReceive(NotificationCenter.default.publisher(for: .lokiDeviceToken)) { notification in
                guard let token = notification.object as? String else { return }
                Task { await model.registerDeviceToken(token) }
            }
            .onReceive(NotificationCenter.default.publisher(for: .lokiPushTapped)) { notification in
                selectedTab = 0
                model.openCRM(path: notification.object as? String ?? "/crmplatform/")
                Task { await model.refreshTasks() }
            }
            .onReceive(NotificationCenter.default.publisher(for: .lokiPushArrived)) { _ in
                Task { await model.refreshTasks() }
            }
            .task {
                await model.refreshTasks()
                await model.refreshPushStatus()
                if UserDefaults.standard.bool(forKey: "loki-native-push-enabled") {
                    UIApplication.shared.registerForRemoteNotifications()
                }
            }
        }
    }
}

extension Notification.Name {
    static let lokiDeviceToken = Notification.Name("loki-device-token")
    static let lokiPushTapped = Notification.Name("loki-push-tapped")
    static let lokiPushArrived = Notification.Name("loki-push-arrived")
}

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        NotificationCenter.default.post(name: .lokiDeviceToken, object: token)
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        NotificationCenter.default.post(name: .lokiPushArrived, object: nil)
        completionHandler([.banner, .sound, .badge])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        let path = response.notification.request.content.userInfo["url"] as? String ?? "/crmplatform/"
        NotificationCenter.default.post(name: .lokiPushTapped, object: path)
        completionHandler()
    }

    func application(_ application: UIApplication, didReceiveRemoteNotification userInfo: [AnyHashable: Any], fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
        Task { @MainActor in
            guard let model = AppModel.current else { completionHandler(.noData); return }
            await model.refreshTasks()
            completionHandler(.newData)
        }
    }
}
