import UIKit
import Capacitor

/// Registers the Capacitor plugins that are defined directly in this app target
/// (WebosLan, AppAuth, AppBadge). Capacitor only auto-registers its own built-ins
/// (Http/Console/WebView/Cookies/SystemBars) plus the `packageClassList` that
/// `cap sync` writes into capacitor.config.json for npm/SPM plugins. App-embedded
/// plugins are in neither list, so without this they compile but never register —
/// which is exactly why `Capacitor.Plugins.AppAuth` was undefined and Pierre's
/// native Turnstile bypass failed with "no AppAuth plugin".
///
/// `capacitorDidLoad()` is the documented override point; it runs right after the
/// bridge is created. `registerPluginInstance` works even with autoRegisterPlugins
/// on (unlike `registerPluginType`), and each plugin conforms to CAPBridgedPlugin.
class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(WebosLanPlugin())
        bridge?.registerPluginInstance(AppAuthPlugin())
        bridge?.registerPluginInstance(AppBadgePlugin())
    }
}
