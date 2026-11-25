import UIKit
import Capacitor
import WidgetKit
import UserNotifications

/// The App Group that Vela and its widgets share. The widgets read the figures the app writes here.
/// The owner must turn on this App Group for both app IDs in their Apple Developer account (see ios/README.md).
enum VelaGroup {
    static let id = "group.io.github.dinsara0611.vela"
    static var defaults: UserDefaults { UserDefaults(suiteName: id) ?? .standard }
    static let dataKey = "data"

    static func reloadWidgets() {
        if #available(iOS 14.0, *) { WidgetCenter.shared.reloadAllTimelines() }
    }
}

/// The app hands the home-screen widgets their figures (already formatted) and asks them to redraw.
/// Same name and methods as the Android BalanceWidgetPlugin.
@objc(BalanceWidgetPlugin)
public class BalanceWidgetPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BalanceWidgetPlugin"
    public let jsName = "BalanceWidget"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise)
    ]

    @objc func update(_ call: CAPPluginCall) {
        guard let data = call.getString("data"), data.count <= 20000 else { call.reject("no data"); return }
        VelaGroup.defaults.set(data, forKey: VelaGroup.dataKey)
        VelaGroup.reloadWidgets()
        call.resolve()
    }

    /// Signed out or data cleared: the widgets forget the figures.
    @objc func clear(_ call: CAPPluginCall) {
        VelaGroup.defaults.removeObject(forKey: VelaGroup.dataKey)
        VelaGroup.reloadWidgets()
        call.resolve()
    }

    @objc func status(_ call: CAPPluginCall) {
        let hidden = VelaGroup.defaults.object(forKey: "hidden_balances") as? Bool ?? true
        call.resolve(["hidden": hidden])
    }
}

/// Screen privacy on iPhone: when Vela goes to the background or the app switcher, a black cover hides the money.
/// iPhone does not let apps block screenshots or screen recording, so this only covers the app switcher.
@objc(ScreenPrivacyPlugin)
public class ScreenPrivacyPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ScreenPrivacyPlugin"
    public let jsName = "ScreenPrivacy"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise)
    ]
    private static let key = "vela_secure_screen"
    private var cover: UIView?

    static var isOn: Bool { UserDefaults.standard.object(forKey: key) as? Bool ?? true }

    override public func load() {
        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(coverScreen), name: UIApplication.willResignActiveNotification, object: nil)
        center.addObserver(self, selector: #selector(uncoverScreen), name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    @objc private func coverScreen() {
        DispatchQueue.main.async {
            guard ScreenPrivacyPlugin.isOn, self.cover == nil, let window = self.bridge?.viewController?.view.window else { return }
            let v = UIView(frame: window.bounds)
            v.backgroundColor = .black
            v.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            window.addSubview(v)
            self.cover = v
        }
    }

    @objc private func uncoverScreen() {
        DispatchQueue.main.async {
            self.cover?.removeFromSuperview()
            self.cover = nil
        }
    }

    @objc func get(_ call: CAPPluginCall) {
        call.resolve(["on": ScreenPrivacyPlugin.isOn])
    }

    @objc func set(_ call: CAPPluginCall) {
        let on = call.getBool("on") ?? true
        UserDefaults.standard.set(on, forKey: ScreenPrivacyPlugin.key)
        call.resolve(["on": on])
    }
}

/// Bank messages handed to Vela by the user (the Shortcuts action "Check a bank SMS in Vela").
/// Vela never reads SMS by itself on iPhone: Apple does not allow it.
enum PendingBankTexts {
    private static let key = "vela_pending_bank_texts"
    static let arrived = Notification.Name("VelaBankTextArrived")

    static func add(_ text: String) {
        let d = UserDefaults.standard
        var list = d.stringArray(forKey: key) ?? []
        list.append(String(text.prefix(2000)))
        d.set(Array(list.suffix(50)), forKey: key)
        NotificationCenter.default.post(name: arrived, object: nil)
    }

    static func take() -> [String] {
        let d = UserDefaults.standard
        let list = d.stringArray(forKey: key) ?? []
        d.removeObject(forKey: key)
        return list
    }
}

/// app.js takes the waiting bank messages when it opens, and hears about new ones while it is open.
@objc(BankTextPlugin)
public class BankTextPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BankTextPlugin"
    public let jsName = "BankText"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "take", returnType: CAPPluginReturnPromise)
    ]

    override public func load() {
        NotificationCenter.default.addObserver(self, selector: #selector(arrived), name: PendingBankTexts.arrived, object: nil)
    }

    @objc private func arrived() {
        notifyListeners("bankText", data: [:])
    }

    @objc func take(_ call: CAPPluginCall) {
        call.resolve(["texts": PendingBankTexts.take()])
    }
}
