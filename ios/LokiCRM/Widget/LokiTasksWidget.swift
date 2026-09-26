import WidgetKit
import SwiftUI

private struct TasksEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot?
}

private struct TasksProvider: TimelineProvider {
    func placeholder(in context: Context) -> TasksEntry {
        TasksEntry(date: Date(), snapshot: WidgetSnapshot(tasks: [
            WidgetTask(id: "example", title: "Følg opp artist", assignee: "Leon", dueDate: "")
        ], updatedAt: Date()))
    }

    func getSnapshot(in context: Context, completion: @escaping (TasksEntry) -> Void) {
        completion(TasksEntry(date: Date(), snapshot: context.isPreview ? placeholder(in: context).snapshot : WidgetSnapshot.read()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TasksEntry>) -> Void) {
        let now = Date()
        let entry = TasksEntry(date: now, snapshot: WidgetSnapshot.read())
        completion(Timeline(entries: [entry], policy: .after(now.addingTimeInterval(30 * 60))))
    }
}

private struct TasksWidgetView: View {
    let entry: TasksEntry
    @Environment(\.widgetFamily) private var family

    private var maxTasks: Int { family == .systemSmall ? 2 : family == .systemMedium ? 3 : 5 }

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack {
                Text("LOKI").font(.caption.weight(.black)).tracking(2)
                Spacer()
                Text("✓").font(.headline).foregroundStyle(Color(red: 0.67, green: 0.87, blue: 0.13))
            }
            Text("Gjøreliste").font(.headline)
            if let snapshot = entry.snapshot {
                if snapshot.tasks.isEmpty {
                    Text("Ingen åpne oppgaver").font(.subheadline).foregroundStyle(.secondary)
                } else {
                    ForEach(snapshot.tasks.prefix(maxTasks)) { task in
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            Text("○").foregroundStyle(Color(red: 0.67, green: 0.87, blue: 0.13))
                            Text(task.title).lineLimit(1).privacySensitive()
                        }
                        .font(.caption)
                    }
                }
                Spacer(minLength: 0)
                Text("Oppdatert \(snapshot.updatedAt, style: .time)")
                    .font(.caption2).foregroundStyle(.secondary)
            } else {
                Text("Åpne appen og logg inn for å vise oppgavene.")
                    .font(.caption).foregroundStyle(.secondary)
                Spacer(minLength: 0)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(14)
        .containerBackground(Color(red: 0.10, green: 0.10, blue: 0.09), for: .widget)
        .foregroundStyle(.white)
        .widgetURL(URL(string: "lokicrm://tasks"))
    }
}

@main
struct LokiTasksWidget: Widget {
    let kind = "LokiTasksWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: TasksProvider()) { entry in
            TasksWidgetView(entry: entry)
        }
        .configurationDisplayName("Loki Gjøreliste")
        .description("Se de neste oppgavene fra Loki CRM.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}
