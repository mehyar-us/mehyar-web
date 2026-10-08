import Foundation
import WebKit
import UIKit
import LocalAuthentication

/// JS ↔ native bridge. The PWA calls `window.MayorNative.*`; each returns a Promise.
/// Bridge surface is intentionally small — the PWA remains the source of truth for UI.
///
///   MayorNative.requestPushPermission() -> { granted: Bool }
///   MayorNative.getPushToken()          -> { token: String|null }
///   MayorNative.haptic(type)            -> { ok: true }   // light|medium|heavy|success|warning|error
///   MayorNative.share(text, url)        -> { shared: Bool }
///   MayorNative.biometricAuth(reason)   -> { ok: Bool }
final class MayorBridge: NSObject, WKScriptMessageHandler {
    /// Resolves the presenting view controller for sheets (set by WebView).
    var viewControllerProvider: (() -> UIViewController?)?

    static let injectedJS = """
    (function(){
      if (window.MayorNative) return;
      window.__mayorCallbacks = {};
      function call(method, params){
        return new Promise(function(resolve){
          var id = 'cb' + Math.random().toString(36).slice(2);
          window.__mayorCallbacks[id] = resolve;
          window.webkit.messageHandlers.mayorBridge.postMessage({id:id, method:method, params:params||{}});
        });
      }
      window.__mayorResolve = function(id, value){
        var cb = window.__mayorCallbacks[id];
        if (cb) { delete window.__mayorCallbacks[id]; cb(value); }
      };
      window.MayorNative = {
        isNative: true,
        requestPushPermission: function(){ return call('requestPushPermission'); },
        getPushToken:          function(){ return call('getPushToken'); },
        haptic:  function(t){ return call('haptic', {type: t||'light'}); },
        share:   function(text, url){ return call('share', {text: text||'', url: url||''}); },
        biometricAuth: function(reason){ return call('biometricAuth', {reason: reason||'Confirm it’s you'}); }
      };
    })();
    """

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let id = body["id"] as? String,
              let method = body["method"] as? String else { return }
        let params = body["params"] as? [String: Any] ?? [:]
        let webView = message.webView

        func resolve(_ value: [String: Any]) {
            guard let data = try? JSONSerialization.data(withJSONObject: value),
                  let json = String(data: data, encoding: .utf8) else { return }
            DispatchQueue.main.async {
                webView?.evaluateJavaScript("window.__mayorResolve('\(id)', \(json));")
            }
        }

        switch method {
        case "requestPushPermission":
            PushManager.requestPermission { granted in
                resolve(["granted": granted])
            }
        case "getPushToken":
            let token: Any = UserDefaults.standard.string(forKey: "mayor.apns.token") ?? NSNull()
            resolve(["token": token])
        case "haptic":
            MayorBridge.haptic(type: params["type"] as? String)
            resolve(["ok": true])
        case "share":
            presentShare(text: params["text"] as? String ?? "",
                         urlString: params["url"] as? String ?? "") { shared in
                resolve(["shared": shared])
            }
        case "biometricAuth":
            biometric(reason: params["reason"] as? String ?? "Confirm it’s you") { ok in
                resolve(["ok": ok])
            }
        default:
            resolve(["error": "unknown method"])
        }
    }

    // MARK: - Native implementations

    static func haptic(type: String?) {
        switch type {
        case "heavy":
            UIImpactFeedbackGenerator(style: .heavy).impactOccurred()
        case "medium":
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        case "success":
            UINotificationFeedbackGenerator().notificationOccurred(.success)
        case "warning":
            UINotificationFeedbackGenerator().notificationOccurred(.warning)
        case "error":
            UINotificationFeedbackGenerator().notificationOccurred(.error)
        default:
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
        }
    }

    private func presentShare(text: String, urlString: String,
                              completion: @escaping (Bool) -> Void) {
        var items: [Any] = []
        if !text.isEmpty { items.append(text) }
        if let url = URL(string: urlString), !urlString.isEmpty { items.append(url) }
        guard !items.isEmpty, let presenter = viewControllerProvider?() else {
            completion(false)
            return
        }
        let sheet = UIActivityViewController(activityItems: items, applicationActivities: nil)
        sheet.completionWithItemsHandler = { _, completed, _, _ in completion(completed) }
        if let pop = sheet.popoverPresentationController {
            pop.sourceView = presenter.view
            pop.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.midY,
                                    width: 0, height: 0)
            pop.permittedArrowDirections = []
        }
        presenter.present(sheet, animated: true)
    }

    private func biometric(reason: String, completion: @escaping (Bool) -> Void) {
        let ctx = LAContext()
        var err: NSError?
        guard ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &err) else {
            // Fall back to device passcode when biometrics aren't enrolled.
            ctx.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { ok, _ in
                completion(ok)
            }
            return
        }
        ctx.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics,
                           localizedReason: reason) { ok, _ in completion(ok) }
    }
}
