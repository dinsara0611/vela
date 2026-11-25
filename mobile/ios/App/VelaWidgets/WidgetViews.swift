import WidgetKit
import SwiftUI
import AppIntents

// MARK: - Look (the same colours as the Android widgets)

extension Color {
    init(hex: UInt32, alpha: Double = 1) {
        self.init(.sRGB, red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255, opacity: alpha)
    }
    static let vSoft = Color.white.opacity(0.72)
    static let vFaint = Color.white.opacity(0.45)
    static let vRed = Color(hex: 0xFF5C6C)
    static let vMinus = Color(hex: 0xFFB3BD)
    static let vGreen = Color(hex: 0x1EE88A)
    static let vOrange = Color(hex: 0xFFA24C)
    static let vPink = Color(hex: 0xFF5CA8)
    static let vBlue = Color(hex: 0x4FB3FF)
    static let vGold = Color(hex: 0xF6D98A)
}

enum VelaTheme {
    case card, green, orange, pink, blue, plain
    var gradient: LinearGradient {
        let end = Color(hex: 0x0E0E10)
        let colors: [Color]
        switch self {
        case .card: colors = [Color(hex: 0x8A4DFF), Color(hex: 0x5A2BD6), Color(hex: 0x241252)]
        case .green: colors = [Color(hex: 0x0E2A1E), end]
        case .orange: colors = [Color(hex: 0x2C1A0A), end]
        case .pink: colors = [Color(hex: 0x2C0E20), end]
        case .blue: colors = [Color(hex: 0x0A1E2C), end]
        case .plain: colors = [Color(hex: 0x1A1124), end]
        }
        return LinearGradient(colors: colors, startPoint: .topLeading, endPoint: .bottomTrailing)
    }
}

extension View {
    func velaBackground(_ theme: VelaTheme) -> some View {
        containerBackground(for: .widget) { theme.gradient }
    }
}

let MASK = "••••••"

/// The amount, or dots when the amounts are hidden or Vela has not sent its figures yet.
func shown(_ s: String, _ e: VelaEntry) -> String { e.hidden || e.none || s.isEmpty ? MASK : s }

// MARK: - Pieces

struct EyeButton: View {
    let kind: String
    let hidden: Bool
    var body: some View {
        Button(intent: ToggleAmountsIntent(kind: kind)) {
            Image(systemName: hidden ? "eye.slash" : "eye")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(.white.opacity(0.9))
                .frame(width: 28, height: 28)
                .background(Circle().fill(.white.opacity(0.14)))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(hidden ? "Show amounts" : "Hide amounts")
    }
}

struct Head: View {
    let title: String
    let e: VelaEntry
    var eye = true
    var body: some View {
        HStack(spacing: 6) {
            Text(title)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(.white.opacity(0.85))
                .lineLimit(1)
            Spacer(minLength: 4)
            if eye { EyeButton(kind: e.kind, hidden: e.hidden) }
        }
    }
}

struct Big: View {
    let text: String
    var size: CGFloat = 24
    var color: Color = .white
    var body: some View {
        Text(text)
            .font(.system(size: size, weight: .bold, design: .rounded))
            .foregroundStyle(color)
            .lineLimit(1)
            .minimumScaleFactor(0.45)
    }
}

struct Small: View {
    let text: String
    var color: Color = .vSoft
    var size: CGFloat = 11
    var body: some View {
        Text(text).font(.system(size: size, weight: .medium)).foregroundStyle(color).lineLimit(1).minimumScaleFactor(0.7)
    }
}

struct Row: View {
    let name: String
    let amount: String
    var color: Color = .white
    var body: some View {
        HStack(spacing: 6) {
            Text(name).font(.system(size: 12, weight: .medium)).foregroundStyle(Color.vSoft).lineLimit(1)
            Spacer(minLength: 4)
            Text(amount).font(.system(size: 12, weight: .semibold, design: .rounded)).foregroundStyle(color).lineLimit(1)
        }
    }
}

struct Ring: View {
    let pct: Int        // -1: no figure (no budget set)
    let color: Color
    var size: CGFloat = 56
    var line: CGFloat = 7
    var label: String? = nil
    var body: some View {
        let over = pct >= 100 && color == .vGreen
        ZStack {
            Circle().stroke(Color.white.opacity(0.12), lineWidth: line)
            Circle()
                .trim(from: 0, to: CGFloat(max(0, min(pct, 100))) / 100)
                .stroke(over ? Color.vRed : color, style: StrokeStyle(lineWidth: line, lineCap: .round))
                .rotationEffect(.degrees(-90))
            Text(label ?? (pct < 0 ? "–" : "\(pct)%"))
                .font(.system(size: size * 0.24, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
                .minimumScaleFactor(0.5)
                .lineLimit(1)
                .padding(line)
        }
        .frame(width: size, height: size)
    }
}

/// Lock screen: a title, the main figure and one line (amounts follow the home-screen eye button).
struct LockLine: View {
    let title: String
    let big: String
    let sub: String
    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(title).font(.system(size: 12, weight: .semibold)).widgetAccentable().lineLimit(1)
            Text(big).font(.system(size: 17, weight: .bold, design: .rounded)).lineLimit(1).minimumScaleFactor(0.6)
            Text(sub).font(.system(size: 11)).lineLimit(1).opacity(0.8)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Balances: a bank card with the total; bigger sizes list each account with a bar for its share

struct BalancesView: View {
    let e: VelaEntry
    @Environment(\.widgetFamily) var family

    var body: some View {
        let d = e.d
        let title = d.s("title", "All accounts")
        let big = shown(d.s("big"), e)
        let color: Color = !e.hidden && d.b("minus") ? .vMinus : .white
        let count = e.none ? "Open Vela to load" : d.s("count")
        switch family {
        case .accessoryRectangular:
            LockLine(title: title, big: big, sub: count)
        case .systemSmall:
            VStack(alignment: .leading, spacing: 0) {
                Head(title: title, e: e)
                Spacer(minLength: 4)
                chip
                Spacer(minLength: 6)
                Big(text: big, size: 22, color: color)
                Small(text: count)
            }
            .padding(14)
        default:
            let rows = d.list("rows").prefix(family == .systemLarge ? 4 : 2)
            VStack(alignment: .leading, spacing: 8) {
                Head(title: title, e: e)
                HStack(alignment: .center, spacing: 10) {
                    chip
                    VStack(alignment: .leading, spacing: 1) {
                        Big(text: big, size: family == .systemLarge ? 30 : 24, color: color)
                        Small(text: count)
                    }
                }
                if family == .systemLarge { Spacer(minLength: 4) }
                ForEach(Array(rows.enumerated()), id: \.offset) { _, r in
                    VStack(spacing: 3) {
                        Row(name: r.s("name"), amount: shown(r.s("amount"), e), color: !e.hidden && r.b("minus") ? .vMinus : .white)
                        ShareBar(share: r.i("share"))
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(14)
        }
    }

    var chip: some View {
        RoundedRectangle(cornerRadius: 4)
            .fill(LinearGradient(colors: [.vGold, Color(hex: 0xC9A24C)], startPoint: .topLeading, endPoint: .bottomTrailing))
            .frame(width: 26, height: 19)
    }
}

struct ShareBar: View {
    let share: Int
    var body: some View {
        GeometryReader { g in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.white.opacity(0.16))
                Capsule().fill(Color.white.opacity(0.85)).frame(width: max(3, g.size.width * CGFloat(max(0, min(share, 100))) / 100))
            }
        }
        .frame(height: 4)
    }
}

// MARK: - Budget: a ring with how much of the month's budget is used

struct BudgetView: View {
    let e: VelaEntry
    @Environment(\.widgetFamily) var family

    var body: some View {
        let d = e.d
        let pct = e.none ? -1 : d.i("pct", -1)
        let big = shown(d.s("big"), e)
        let color: Color = !e.hidden && d.b("minus") ? .vMinus : .white
        let sub = e.none ? "Open Vela to load" : (e.hidden ? d.s("subHidden", d.s("sub")) : d.s("sub"))
        let title = d.s("title", "Budget")
        switch family {
        case .accessoryRectangular:
            LockLine(title: title, big: big, sub: sub)
        case .systemSmall:
            VStack(alignment: .leading, spacing: 0) {
                Head(title: "Budget", e: e)
                Spacer(minLength: 4)
                Ring(pct: pct, color: .vGreen, size: 52, line: 6)
                Spacer(minLength: 6)
                Big(text: big, size: 20, color: color)
                Small(text: sub)
            }
            .padding(14)
        default:
            let large = family == .systemLarge
            VStack(alignment: .leading, spacing: 10) {
                Head(title: title, e: e)
                HStack(alignment: .center, spacing: 14) {
                    Ring(pct: pct, color: .vGreen, size: large ? 104 : 84, line: large ? 11 : 9)
                    VStack(alignment: .leading, spacing: 4) {
                        Big(text: big, size: large ? 28 : 22, color: color)
                        Small(text: sub)
                        if !d.s("perDay").isEmpty { Row(name: "Per day", amount: shown(d.s("perDay"), e)) }
                        Row(name: "Days left", amount: d.s("daysLeft", "–"))
                    }
                }
                if large {
                    ForEach(Array(d.list("rows").prefix(5).enumerated()), id: \.offset) { _, r in
                        Row(name: r.s("name"), amount: shown(r.s("amount"), e))
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(14)
        }
    }
}

// MARK: - Bills: small is the next bill as a calendar page; bigger sizes show the month as a calendar

struct CalendarPage: View {
    let mon: String
    let day: String
    var body: some View {
        VStack(spacing: 0) {
            Text(mon).font(.system(size: 9, weight: .heavy)).foregroundStyle(.black.opacity(0.8))
                .frame(maxWidth: .infinity).padding(.vertical, 2).background(Color.vOrange)
            Text(day).font(.system(size: 22, weight: .bold, design: .rounded)).foregroundStyle(.white)
                .frame(maxWidth: .infinity).padding(.vertical, 3)
        }
        .frame(width: 48)
        .background(Color.white.opacity(0.1))
        .clipShape(RoundedRectangle(cornerRadius: 9))
    }
}

/// This month, Monday first. Bill days orange, late ones red, today ringed.
struct MonthGrid: View {
    let marks: [Int: Bool]   // day -> late
    var cell: CGFloat = 18
    var font: CGFloat = 10

    var body: some View {
        let cal = Calendar(identifier: .gregorian)
        let now = Date()
        let today = cal.component(.day, from: now)
        let dim = cal.range(of: .day, in: .month, for: now)?.count ?? 30
        let first = cal.date(from: cal.dateComponents([.year, .month], from: now)) ?? now
        let offset = (cal.component(.weekday, from: first) + 5) % 7
        let weeks = (offset + dim + 6) / 7
        VStack(spacing: 2) {
            HStack(spacing: 2) {
                ForEach(Array(["M", "T", "W", "T", "F", "S", "S"].enumerated()), id: \.offset) { _, l in
                    Text(l).font(.system(size: font - 1, weight: .bold)).foregroundStyle(Color.vFaint).frame(width: cell, height: cell * 0.8)
                }
            }
            ForEach(0..<weeks, id: \.self) { w in
                HStack(spacing: 2) {
                    ForEach(0..<7, id: \.self) { k in
                        let day = w * 7 + k - offset + 1
                        dayCell(day: day, inMonth: day >= 1 && day <= dim, today: today)
                    }
                }
            }
        }
    }

    @ViewBuilder
    func dayCell(day: Int, inMonth: Bool, today: Int) -> some View {
        let late = inMonth ? marks[day] : nil
        ZStack {
            if let late { Circle().fill(late ? Color.vRed : Color.vOrange) }
            else if inMonth && day == today { Circle().stroke(Color.vOrange, lineWidth: 1.5) }
            Text(inMonth ? "\(day)" : "")
                .font(.system(size: font, weight: late != nil || day == today ? .bold : .medium, design: .rounded))
                .foregroundStyle(late != nil ? Color.white : day == today ? Color.vOrange : day < today ? Color.white.opacity(0.4) : Color.white.opacity(0.9))
                .minimumScaleFactor(0.6)
        }
        .frame(width: cell, height: cell)
    }
}

struct BillsView: View {
    let e: VelaEntry
    @Environment(\.widgetFamily) var family

    var body: some View {
        let d = e.d
        let items = d.list("items")
        let first = items.first
        var marks: [Int: Bool] = [:]
        for m in d.list("days") { marks[m.i("d")] = m.b("late") }
        let now = Date()
        let mon = first?.s("mon") ?? now.formatted(.dateTime.month(.abbreviated)).uppercased()
        let day = first?.s("day") ?? now.formatted(.dateTime.day())
        let whenColor: Color = first?.b("late") == true ? .vRed : (first == nil && !e.none ? .vGreen : .vOrange)
        let when = e.none ? "Open Vela to load" : (first?.s("when") ?? "All paid this month")
        return Group {
            switch family {
            case .accessoryRectangular:
                LockLine(title: first?.s("name") ?? "Bills coming", big: first.map { shown($0.s("amount"), e) } ?? (e.none ? MASK : "Nothing to pay"), sub: when)
            case .systemSmall:
                VStack(alignment: .leading, spacing: 0) {
                    Head(title: "Bills", e: e)
                    Spacer(minLength: 4)
                    CalendarPage(mon: mon, day: day)
                    Spacer(minLength: 6)
                    Text(first?.s("name") ?? "No bills to pay").font(.system(size: 13, weight: .semibold)).foregroundStyle(.white).lineLimit(1)
                    Small(text: when, color: whenColor)
                    if let first { Small(text: shown(first.s("amount"), e), color: .white, size: 12) }
                }
                .padding(14)
            case .systemMedium:
                HStack(alignment: .top, spacing: 12) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(d.s("month", now.formatted(.dateTime.month(.wide)))).font(.system(size: 12, weight: .bold)).foregroundStyle(Color.vOrange)
                        MonthGrid(marks: marks, cell: 17, font: 9)
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        Head(title: "Bills coming", e: e)
                        Big(text: shown(d.s("big"), e), size: 20)
                        Small(text: e.none ? "Open Vela to load" : d.s("count"))
                        Spacer(minLength: 2)
                        if let first {
                            Small(text: "NEXT", color: .vFaint, size: 9)
                            Text(first.s("name")).font(.system(size: 12, weight: .semibold)).foregroundStyle(.white).lineLimit(1)
                            Small(text: first.s("when"), color: whenColor)
                            Small(text: shown(first.s("amount"), e), color: .white, size: 12)
                        } else if !e.none {
                            Small(text: "Nothing to pay", color: .vGreen)
                        }
                    }
                }
                .padding(14)
            default:
                VStack(alignment: .leading, spacing: 8) {
                    Head(title: "Bills · \(d.s("month", now.formatted(.dateTime.month(.wide))))", e: e)
                    HStack {
                        Spacer(minLength: 0)
                        MonthGrid(marks: marks, cell: 30, font: 13)
                        Spacer(minLength: 0)
                    }
                    HStack(alignment: .firstTextBaseline) {
                        Big(text: shown(d.s("big"), e), size: 20)
                        Spacer()
                        Small(text: e.none ? "Open Vela to load" : d.s("count"))
                    }
                    ForEach(Array(items.prefix(3).enumerated()), id: \.offset) { _, x in
                        HStack(spacing: 6) {
                            Text(x.s("name")).font(.system(size: 12, weight: .medium)).foregroundStyle(Color.vSoft).lineLimit(1)
                            Text(x.s("when")).font(.system(size: 11, weight: .semibold)).foregroundStyle(x.b("late") ? Color.vRed : Color.vOrange).lineLimit(1)
                            Spacer(minLength: 4)
                            Text(shown(x.s("amount"), e)).font(.system(size: 12, weight: .semibold, design: .rounded)).foregroundStyle(.white).lineLimit(1)
                        }
                    }
                    Spacer(minLength: 0)
                }
                .padding(14)
            }
        }
    }
}

// MARK: - Goals: rings for each goal

struct GoalsView: View {
    let e: VelaEntry
    @Environment(\.widgetFamily) var family

    var body: some View {
        let d = e.d
        let items = d.list("items")
        let sub = e.none ? "Open Vela to load" : (e.hidden ? d.s("subHidden", d.s("sub")) : d.s("sub"))
        switch family {
        case .systemSmall:
            VStack(alignment: .leading, spacing: 0) {
                Head(title: "Goals", e: e)
                Spacer(minLength: 4)
                Ring(pct: e.none ? -1 : d.i("pct"), color: .vPink, size: 52, line: 6)
                Spacer(minLength: 6)
                Big(text: shown(d.s("big"), e), size: 20)
                Small(text: sub)
            }
            .padding(14)
        default:
            let large = family == .systemLarge
            VStack(alignment: .leading, spacing: 10) {
                Head(title: "Goals", e: e)
                if large {
                    Big(text: shown(d.s("big"), e), size: 26)
                    Small(text: sub)
                }
                if items.isEmpty {
                    Spacer(minLength: 0)
                    Small(text: e.none ? "Open Vela to load" : "No goals yet · open Vela to add one")
                } else {
                    HStack(alignment: .top, spacing: 8) {
                        ForEach(Array(items.prefix(3).enumerated()), id: \.offset) { _, g in
                            VStack(spacing: 4) {
                                Ring(pct: g.i("pct"), color: .vPink, size: large ? 78 : 56, line: large ? 8 : 6)
                                Text(g.s("name")).font(.system(size: 11, weight: .semibold)).foregroundStyle(.white).lineLimit(1)
                                Small(text: shown(g.s("amount"), e), size: 10)
                            }
                            .frame(maxWidth: .infinity)
                        }
                    }
                }
                if large {
                    ForEach(Array(d.list("rows").enumerated()), id: \.offset) { _, r in
                        Row(name: r.s("name"), amount: shown(r.s("amount"), e))
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(14)
        }
    }
}

// MARK: - Recent: spending of the last 7 days as bars, and the latest entries

struct WeekBars: View {
    let week: [J]
    var height: CGFloat = 36
    var body: some View {
        HStack(alignment: .bottom, spacing: 5) {
            ForEach(Array(week.enumerated()), id: \.offset) { k, x in
                VStack(spacing: 3) {
                    RoundedRectangle(cornerRadius: 3)
                        .fill(k == week.count - 1 ? Color.vBlue : Color.vBlue.opacity(0.55))
                        .frame(height: max(3, height * CGFloat(max(0, min(x.i("h"), 100))) / 100))
                    Text(x.s("d")).font(.system(size: 9, weight: .semibold)).foregroundStyle(Color.vFaint)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
            }
        }
        .frame(height: height + 14)
    }
}

struct RecentView: View {
    let e: VelaEntry
    @Environment(\.widgetFamily) var family

    var body: some View {
        let d = e.d
        let sub = e.none ? "Open Vela to load" : (e.hidden ? d.s("subHidden", d.s("sub")) : d.s("sub"))
        let week = d.list("week")
        switch family {
        case .systemSmall:
            VStack(alignment: .leading, spacing: 2) {
                Head(title: "Today", e: e)
                Spacer(minLength: 2)
                Big(text: shown(d.s("big"), e), size: 20)
                Small(text: sub)
                WeekBars(week: week, height: 28)
            }
            .padding(14)
        case .systemMedium:
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Head(title: "Recent", e: e)
                    Big(text: shown(d.s("big"), e), size: 20)
                    Small(text: sub)
                    Spacer(minLength: 2)
                    WeekBars(week: week, height: 30)
                }
                VStack(alignment: .leading, spacing: 6) {
                    Small(text: e.none ? "" : d.s("count"), color: .vFaint, size: 10)
                    ForEach(Array(d.list("items").prefix(3).enumerated()), id: \.offset) { _, t in
                        EntryRow(t: t, e: e)
                    }
                    Spacer(minLength: 0)
                }
            }
            .padding(14)
        default:
            VStack(alignment: .leading, spacing: 8) {
                Head(title: "Recent", e: e)
                Big(text: shown(d.s("big"), e), size: 26)
                Small(text: sub)
                WeekBars(week: week, height: 80)
                ForEach(Array(d.list("items").prefix(3).enumerated()), id: \.offset) { _, t in
                    EntryRow(t: t, e: e)
                }
                Spacer(minLength: 0)
            }
            .padding(14)
        }
    }
}

struct EntryRow: View {
    let t: J
    let e: VelaEntry
    var body: some View {
        let kind = t.s("kind")
        HStack(spacing: 6) {
            Circle().fill(kind == "in" ? Color.vGreen : kind == "move" ? Color.white.opacity(0.5) : Color.vRed).frame(width: 6, height: 6)
            VStack(alignment: .leading, spacing: 0) {
                Text(t.s("name")).font(.system(size: 12, weight: .semibold)).foregroundStyle(.white).lineLimit(1)
                Text(t.s("when")).font(.system(size: 10)).foregroundStyle(Color.vFaint).lineLimit(1)
            }
            Spacer(minLength: 4)
            Text(shown(t.s("amount"), e)).font(.system(size: 12, weight: .semibold, design: .rounded))
                .foregroundStyle(kind == "in" && !e.hidden ? Color.vGreen : .white).lineLimit(1)
        }
    }
}

// MARK: - Quick add: buttons that open Vela at a new expense, income or transfer (no amounts)

struct QuickAddView: View {
    let e: VelaEntry
    @Environment(\.widgetFamily) var family

    var body: some View {
        if family == .systemSmall {
            // A small widget is one tap target on iPhone: it opens a new expense.
            VStack(alignment: .leading, spacing: 0) {
                Head(title: "Quick add", e: e, eye: false)
                Spacer(minLength: 4)
                Image(systemName: "minus")
                    .font(.system(size: 22, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 52, height: 52)
                    .background(Circle().fill(Color.vRed.opacity(0.85)))
                Spacer(minLength: 6)
                Text("Add expense").font(.system(size: 14, weight: .semibold)).foregroundStyle(.white)
            }
            .padding(14)
            .widgetURL(VelaShared.open("add-expense"))
        } else {
            VStack(alignment: .leading, spacing: 10) {
                Link(destination: VelaShared.open("home")) { Head(title: "Quick add", e: e, eye: false) }
                HStack(spacing: 8) {
                    button("add-expense", "minus", "Expense", Color.vRed.opacity(0.85))
                    button("add-income", "plus", "Income", Color.vGreen.opacity(0.8))
                    button("add-transfer", "arrow.left.arrow.right", "Transfer", Color.white.opacity(0.18))
                }
            }
            .padding(14)
        }
    }

    func button(_ what: String, _ icon: String, _ label: String, _ color: Color) -> some View {
        Link(destination: VelaShared.open(what)) {
            VStack(spacing: 6) {
                Image(systemName: icon).font(.system(size: 18, weight: .bold)).foregroundStyle(.white)
                Text(label).font(.system(size: 12, weight: .semibold)).foregroundStyle(.white)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(RoundedRectangle(cornerRadius: 14).fill(color))
        }
    }
}
