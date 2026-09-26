import SwiftUI
import WebKit

struct CRMWebView: UIViewRepresentable {
    let webView: WKWebView
    func makeUIView(context: Context) -> WKWebView { webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

struct TasksView: View {
    @ObservedObject var model: AppModel
    let openCRM: () -> Void
    @State private var title = ""
    @State private var assignee = "Begge"
    @State private var showingCompleted = false
    @State private var submitting = false

    private var displayedTasks: [CrmTask] {
        model.tasks.filter { showingCompleted || !$0.completed }
            .sorted { left, right in
                if left.completed != right.completed { return !left.completed }
                return (left.dueDate.isEmpty ? "9999" : left.dueDate) < (right.dueDate.isEmpty ? "9999" : right.dueDate)
            }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    VStack(alignment: .leading, spacing: 5) {
                        Text("LOKI STUDIO").font(.caption.weight(.black)).tracking(3).foregroundStyle(.secondary)
                        Text("Gjøreliste").font(.largeTitle.weight(.semibold))
                        Text("\(model.tasks.filter { !$0.completed }.count) åpne oppgaver · delt mellom Leon og Charles")
                            .font(.subheadline).foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    if model.currentEmail.isEmpty {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Logg inn i CRM-fanen først").font(.headline)
                            Text("Deretter vises oppgavene dine her og i widgeten.").font(.subheadline).foregroundStyle(.secondary)
                            Button("Åpne CRM", action: openCRM).buttonStyle(.borderedProminent)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding()
                        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
                    } else {
                        VStack(alignment: .leading, spacing: 12) {
                            TextField("Ny oppgave", text: $title)
                                .textInputAutocapitalization(.sentences)
                                .submitLabel(.done)
                            Picker("Ansvarlig", selection: $assignee) {
                                Text("Begge").tag("Begge")
                                Text("Leon").tag("Leon")
                                Text("Charles").tag("Charles")
                            }
                            .pickerStyle(.segmented)
                            Button {
                                let cleanTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
                                guard !cleanTitle.isEmpty else { return }
                                submitting = true
                                Task {
                                    if await model.createTask(title: cleanTitle, assignee: assignee) { title = "" }
                                    submitting = false
                                }
                            } label: {
                                Label("Legg til oppgave", systemImage: "plus")
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(Color(red: 0.34, green: 0.30, blue: 0.22))
                            .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || submitting)
                        }
                        .padding()
                        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))

                        Toggle("Vis fullførte", isOn: $showingCompleted).font(.subheadline)
                        if displayedTasks.isEmpty {
                            ContentUnavailableView("Ingen oppgaver", systemImage: "checkmark.circle", description: Text("Gjøreliste og widget oppdateres når en oppgave legges til."))
                        }
                        ForEach(displayedTasks) { task in
                            HStack(alignment: .top, spacing: 13) {
                                Button {
                                    Task { await model.setTaskCompleted(task, completed: !task.completed) }
                                } label: {
                                    Image(systemName: task.completed ? "checkmark.circle.fill" : "circle")
                                        .font(.title2)
                                        .foregroundStyle(task.completed ? .green : .primary)
                                }
                                .accessibilityLabel(task.completed ? "Åpne \(task.title) igjen" : "Fullfør \(task.title)")
                                VStack(alignment: .leading, spacing: 5) {
                                    Text(task.title).font(.headline).strikethrough(task.completed)
                                    if !task.details.isEmpty { Text(task.details).font(.subheadline).foregroundStyle(.secondary) }
                                    Text([task.assignee, task.dueDate.isEmpty ? nil : "Frist \(task.dueDate)", task.priority == "Høy" ? "Høy prioritet" : nil].compactMap { $0 }.joined(separator: " · "))
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer(minLength: 0)
                            }
                            .padding()
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14))
                        }
                    }
                    if !model.errorMessage.isEmpty && !model.currentEmail.isEmpty { Text(model.errorMessage).font(.caption).foregroundStyle(.red) }
                }
                .padding()
            }
            .background(Color(uiColor: .systemGroupedBackground))
            .navigationTitle("Oppgaver")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { Button { Task { await model.refreshTasks() } } label: { Image(systemName: "arrow.clockwise") }.disabled(model.loading) }
            .refreshable { await model.refreshTasks() }
        }
    }
}

struct SettingsView: View {
    @ObservedObject var model: AppModel

    var body: some View {
        NavigationStack {
            Form {
                Section("Konto") {
                    LabeledContent("Innlogget som", value: model.currentEmail.isEmpty ? "Ikke innlogget" : model.currentEmail)
                    Text("Appen bruker den samme godkjente CRM-kontoen som nettsiden. Økten lagres i appens private webvisning.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Section("Varsler") {
                    LabeledContent("På denne iPhonen", value: model.notificationsEnabled ? "På" : "Av")
                    LabeledContent("Serverkobling", value: model.pushConfigured ? "Klar" : "Venter på APNs-oppsett")
                    if model.notificationsEnabled {
                        Button("Slå av varsler") { Task { await model.disableNotifications() } }
                    } else {
                        Button("Aktiver varsler") { Task { await model.enableNotifications() } }
                    }
                    Text("Native push krever at Loki CRM-appen er signert med Push Notifications og at APNs-nøkkelen er konfigurert på serveren.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Section("Widget") {
                    Text("Legg til «Loki Gjøreliste» fra iPhone sin widget-oversikt. Den viser oppgaver fra siste synkronisering i appen.")
                    Text("Åpne appen for å hente oppdatert liste.").font(.caption).foregroundStyle(.secondary)
                }
                if !model.errorMessage.isEmpty { Text(model.errorMessage).foregroundStyle(.red) }
            }
            .navigationTitle("Innstillinger")
        }
    }
}
