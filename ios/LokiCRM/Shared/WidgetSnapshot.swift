import Foundation

struct WidgetTask: Codable, Identifiable {
    let id: String
    let title: String
    let assignee: String
    let dueDate: String
}

struct WidgetSnapshot: Codable {
    let tasks: [WidgetTask]
    let updatedAt: Date

    static let key = "loki-widget-tasks-v1"
    static let group = "group.no.lokilyd.crm"

    static func read() -> WidgetSnapshot? {
        guard let data = UserDefaults(suiteName: group)?.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(WidgetSnapshot.self, from: data)
    }

    func save() {
        guard let data = try? JSONEncoder().encode(self) else { return }
        UserDefaults(suiteName: Self.group)?.set(data, forKey: Self.key)
    }

    static func clear() {
        UserDefaults(suiteName: group)?.removeObject(forKey: key)
    }
}
