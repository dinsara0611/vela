import WidgetKit
import SwiftUI
import AppIntents

// Vela's home-screen widgets for iPhone: the same six as the Android app (balances, budget, bills, goals,
// recent spending and quick add). The app writes its figures, already formatted, into the shared App Group
// (app.js widgetData() -> BalanceWidget plugin); the widgets never read Vela's own data.
// Amounts are hidden until the eye button is tapped (anyone can see a home screen), like on Android.

enum VelaShared {
    static let group = "group.io.github.dinsara0611.vela"
    static var defaults: UserDefaults { UserDefaults(suiteName: group) ?? .standard }

    static func data() -> J? {
        guard let s = defaults.string(forKey: "data"), let raw = s.data(using: .utf8),
              let o = try? JSONSerialization.jsonObject(with: raw) as? [String: Any] else { return nil }
        return J(o)
    }

    static func hidden(_ kind: String) -> Bool { defaults.object(forKey: "hidden_" + kind) as? Bool ?? true }
    static func setHidden(_ kind: String, _ value: Bool) { defaults.set(value, forKey: "hidden_" + kind) }

    /// A tap opens Vela at the right place (handled by app.js handleWidgetUrl).
    static func open(_ what: String) -> URL { URL(string: "io.github.dinsara0611.vela://widget/" + what)! }
}

/// A forgiving reader for the JSON the app sends (missing fields just read as empty).
struct J {
    let o: [String: Any]
    init(_ any: Any?) { o = any as? [String: Any] ?? [:] }
    func s(_ k: String, _ def: String = "") -> String {
        if let v = o[k] as? String { return v }
        if let n = o[k] as? NSNumber { return n.stringValue }
        return def
    }
    func b(_ k: String) -> Bool { (o[k] as? NSNumber)?.boolValue ?? false }
    func i(_ k: String, _ def: Int = 0) -> Int { (o[k] as? NSNumber)?.intValue ?? def }
    func list(_ k: String) -> [J] { (o[k] as? [Any] ?? []).map { J($0) } }
    func obj(_ k: String) -> J { J(o[k]) }
    var isEmpty: Bool { o.isEmpty }
}

struct VelaEntry: TimelineEntry {
    let date: Date
    let kind: String
    let d: J        // this widget's part of the figures
    let hidden: Bool
    let none: Bool  // Vela has not sent any figures yet
}

struct VelaProvider: TimelineProvider {
    let kind: String

    func entry() -> VelaEntry {
        let all = VelaShared.data()
        return VelaEntry(date: Date(), kind: kind, d: all?.obj(kind) ?? J(nil), hidden: VelaShared.hidden(kind), none: all == nil)
    }

    func placeholder(in context: Context) -> VelaEntry {
        VelaEntry(date: Date(), kind: kind, d: J(nil), hidden: true, none: true)
    }

    func getSnapshot(in context: Context, completion: @escaping (VelaEntry) -> Void) {
        completion(context.isPreview ? VelaEntry(date: Date(), kind: kind, d: J(nil), hidden: true, none: true) : entry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<VelaEntry>) -> Void) {
        // The app asks for a redraw whenever its figures change; redraw at midnight too, for the calendar's "today".
        let midnight = Calendar.current.startOfDay(for: Date().addingTimeInterval(86400))
        completion(Timeline(entries: [entry()], policy: .after(midnight)))
    }
}

/// The eye button: shows or hides this widget's amounts without opening Vela.
struct ToggleAmountsIntent: AppIntent {
    static var title: LocalizedStringResource = "Show or hide amounts"
    static var isDiscoverable: Bool = false

    @Parameter(title: "Widget")
    var kind: String

    init() { kind = "balances" }
    init(kind: String) { self.kind = kind }

    func perform() async throws -> some IntentResult {
        VelaShared.setHidden(kind, !VelaShared.hidden(kind))
        return .result()
    }
}

// MARK: - The six widgets

struct BalancesWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "VelaBalances", provider: VelaProvider(kind: "balances")) { e in
            BalancesView(e: e).velaBackground(.card).widgetURL(VelaShared.open("home"))
        }
        .configurationDisplayName("Balances")
        .description("Your money in all accounts. Tap the eye to show the amounts.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryRectangular])
        .contentMarginsDisabled()
    }
}

struct BudgetWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "VelaBudget", provider: VelaProvider(kind: "budget")) { e in
            BudgetView(e: e).velaBackground(.green).widgetURL(VelaShared.open("budget"))
        }
        .configurationDisplayName("Budget")
        .description("What is left to spend this month, as a ring.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryRectangular])
        .contentMarginsDisabled()
    }
}

struct BillsWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "VelaBills", provider: VelaProvider(kind: "bills")) { e in
            BillsView(e: e).velaBackground(.orange).widgetURL(VelaShared.open("bills"))
        }
        .configurationDisplayName("Bills")
        .description("Bills still to pay, on this month's calendar.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryRectangular])
        .contentMarginsDisabled()
    }
}

struct GoalsWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "VelaGoals", provider: VelaProvider(kind: "goals")) { e in
            GoalsView(e: e).velaBackground(.pink).widgetURL(VelaShared.open("goals"))
        }
        .configurationDisplayName("Goals")
        .description("How far your savings goals are, as rings.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
        .contentMarginsDisabled()
    }
}

struct RecentWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "VelaRecent", provider: VelaProvider(kind: "recent")) { e in
            RecentView(e: e).velaBackground(.blue).widgetURL(VelaShared.open("activity"))
        }
        .configurationDisplayName("Recent spending")
        .description("Spending of the last 7 days and your latest entries.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
        .contentMarginsDisabled()
    }
}

struct QuickAddWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "VelaQuickAdd", provider: VelaProvider(kind: "quick")) { e in
            QuickAddView(e: e).velaBackground(.plain)
        }
        .configurationDisplayName("Quick add")
        .description("Add an expense, income or a transfer in one tap. No amounts are shown.")
        .supportedFamilies([.systemSmall, .systemMedium])
        .contentMarginsDisabled()
    }
}

@main
struct VelaWidgetsBundle: WidgetBundle {
    var body: some Widget {
        BalancesWidget()
        BudgetWidget()
        BillsWidget()
        GoalsWidget()
        RecentWidget()
        QuickAddWidget()
    }
}
