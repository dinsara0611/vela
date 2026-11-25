import AppIntents
import UserNotifications

/// A Shortcuts action: "Check a bank SMS in Vela". The person chooses to send a bank message to Vela, for example
/// with a Shortcuts automation "When I get a message from ComBank" or from the share sheet. Vela reads the amount
/// and asks before adding anything, the same as a pasted SMS. This is Apple's own Shortcuts feature, set up by the
/// person; Vela itself never reads SMS on iPhone.
@available(iOS 16.0, *)
struct CheckBankSmsIntent: AppIntent {
    static var title: LocalizedStringResource = "Check a bank SMS in Vela"
    static var description = IntentDescription("Sends a bank message to Vela. Vela reads the amount and asks you before adding anything.")
    static var openAppWhenRun: Bool = false

    @Parameter(title: "Message text")
    var text: String

    init() {}

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return .result(dialog: "There was no message text to send.") }
        PendingBankTexts.add(t)
        await CheckBankSmsIntent.remind()
        return .result(dialog: "Sent to Vela. Open Vela to check it.")
    }

    /// A notification so the person knows to open Vela (only if they allowed Vela's notifications).
    private static func remind() async {
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else { return }
        let content = UNMutableNotificationContent()
        content.title = "Bank message for Vela"
        content.body = "Open Vela to check it. Nothing is added until you say so."
        let request = UNNotificationRequest(identifier: "vela-bank-text", content: content, trigger: nil)
        try? await center.add(request)
    }
}

@available(iOS 16.0, *)
struct VelaShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: CheckBankSmsIntent(), phrases: ["Check a bank SMS in \(.applicationName)"])
    }
}
