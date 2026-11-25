import UIKit
import Capacitor

/// Vela's web view screen. It is Capacitor's normal screen plus Vela's own iPhone plugins
/// (the same names the Android app uses, so app.js works the same on both).
class VelaBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        // Home-screen widgets: the app sends them its figures (BalanceWidget, like on Android).
        bridge?.registerPluginInstance(BalanceWidgetPlugin())
        // Hides Vela in the app switcher (iPhone does not let apps block screenshots).
        bridge?.registerPluginInstance(ScreenPrivacyPlugin())
        // Bank messages sent to Vela from the Shortcuts app (iPhone does not let apps read SMS).
        bridge?.registerPluginInstance(BankTextPlugin())
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        // The page scrolls by touch like any app screen: no scrollbar drawn down the side.
        bridge?.webView?.scrollView.showsVerticalScrollIndicator = false
        bridge?.webView?.scrollView.showsHorizontalScrollIndicator = false
    }
}
