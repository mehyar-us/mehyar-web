import SwiftUI
import WebKit
import SafariServices

/// Single WKWebView loading the PWA. Cookies/localStorage persist via the default
/// data store. External links open in SFSafariViewController, never in the webview.
struct WebView: UIViewRepresentable {
    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default() // persistent cookies + storage
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []

        // The MayorNative JS bridge (see Bridge.swift).
        let bridge = MayorBridge()
        config.userContentController.add(bridge, name: "mayorBridge")
        config.userContentController.addUserScript(WKUserScript(
            source: MayorBridge.injectedJS,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))
        context.coordinator.bridge = bridge

        let web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = context.coordinator
        web.uiDelegate = context.coordinator
        web.allowsBackForwardNavigationGestures = true

        // Pull-to-refresh on the web content.
        let refresh = UIRefreshControl()
        refresh.addTarget(context.coordinator, action: #selector(Coordinator.didPullToRefresh(_:)), for: .valueChanged)
        web.scrollView.refreshControl = refresh
        context.coordinator.refreshControl = refresh

        bridge.viewControllerProvider = { [weak web] in
            var r: UIResponder? = web
            while let next = r?.next {
                if let vc = next as? UIViewController { return vc }
                r = next
            }
            return nil
        }

        if let url = URL(string: "https://mayor.mehyar.us/") {
            web.load(URLRequest(url: url))
        }

        NotificationCenter.default.addObserver(
            context.coordinator,
            selector: #selector(Coordinator.handleDeepLink(_:)),
            name: .mayorDeepLink, object: nil)
        NotificationCenter.default.addObserver(
            context.coordinator,
            selector: #selector(Coordinator.handlePushToken(_:)),
            name: .mayorPushToken, object: nil)

        context.coordinator.webView = web
        return web
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        weak var webView: WKWebView?
        var bridge: MayorBridge?
        weak var refreshControl: UIRefreshControl?

        // MARK: - Navigation policy

        func webView(_ webView: WKWebView,
                     decidePolicyFor navigationAction: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = navigationAction.request.url else {
                decisionHandler(.cancel); return
            }

            // Links that want a new window, and anything leaving mayor.mehyar.us,
            // open in the in-app Safari sheet — never hijack the PWA canvas.
            let isMainFrame = navigationAction.targetFrame?.isMainFrame ?? true
            let external = url.host?.lowercased() != "mayor.mehyar.us"
            if navigationAction.navigationType == .linkActivated && (!isMainFrame || external) {
                presentSafari(url: url)
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }

        /// New-window requests (target=_blank) → Safari sheet as well.
        func webView(_ webView: WKWebView,
                     createWebViewWith configuration: WKWebViewConfiguration,
                     for navigationAction: WKNavigationAction,
                     windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = navigationAction.request.url {
                presentSafari(url: url)
            }
            return nil
        }

        private func presentSafari(url: URL) {
            let safari = SFSafariViewController(url: url)
            topViewController()?.present(safari, animated: true)
        }

        private func topViewController() -> UIViewController? {
            guard let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
                  var vc = scene.windows.first(where: { $0.isKeyWindow })?.rootViewController else {
                return nil
            }
            while let next = vc.presentedViewController { vc = next }
            return vc
        }

        // MARK: - Pull to refresh

        @objc func didPullToRefresh(_ sender: UIRefreshControl) {
            webView?.reload()
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            refreshControl?.endRefreshing()
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            refreshControl?.endRefreshing()
        }

        // MARK: - Native → web events

        /// Push arrived with a deep-link URL: load it in the PWA.
        @objc func handleDeepLink(_ note: Notification) {
            guard let urlString = note.userInfo?["url"] as? String,
                  let url = URL(string: urlString) else { return }
            // Only deep-link inside our own origin; anything else goes to Safari.
            if url.host?.lowercased() == "mayor.mehyar.us" {
                webView?.load(URLRequest(url: url))
            } else {
                presentSafari(url: url)
            }
        }

        /// APNs token registered: hand it to the PWA so it can register server-side.
        @objc func handlePushToken(_ note: Notification) {
            guard let token = note.userInfo?["token"] as? String else { return }
            let js = "window.dispatchEvent(new CustomEvent('mayorPushToken',{detail:'\(token)'}));"
            webView?.evaluateJavaScript(js)
        }
    }
}

extension Notification.Name {
    /// Posted by PushNotifications when APNs registration yields a device token.
    static let mayorPushToken = Notification.Name("us.mehyar.mayor.pushToken")
}
