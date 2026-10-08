import UIKit
import UserNotifications

/// App delegate: APNs registration + notification handling.
/// Permission is requested on first value moment (via the JS bridge), never at launch.
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(_ application: UIApplication,
                     didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02.2hhx", $0) }.joined()
        UserDefaults.standard.set(token, forKey: "mayor.apns.token")
        // Hand it to the PWA so the worker can register it server-side.
        NotificationCenter.default.post(name: .mayorPushToken,
                                        object: nil, userInfo: ["token": token])
    }

    func application(_ application: UIApplication,
                     didFailToRegisterForRemoteNotificationsWithError error: Error) {
        // Simulator / no APNs environment — the PWA bridge reports null token.
        UserDefaults.standard.removeObject(forKey: "mayor.apns.token")
    }
}

// MARK: - UNUserNotificationCenterDelegate

extension AppDelegate: UNUserNotificationCenterDelegate {
    /// Foreground push: show the banner anyway (proactive alerts must be seen).
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound, .badge])
    }

    /// Tap on a push: deep-link. Payload contract (see PUSH_SERVER_NOTES.md):
    ///   aps: { alert: {title, body}, badge, sound }
    ///   url: "https://mayor.mehyar.us/feed#briefing"   ← deep link inside the PWA
    ///   business_id: "<tenant>"                        ← lets the PWA switch context
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        let info = response.notification.request.content.userInfo
        if let url = info["url"] as? String {
            NotificationCenter.default.post(name: .mayorDeepLink,
                                            object: nil,
                                            userInfo: ["url": url,
                                                       "business_id": info["business_id"] as? String ?? ""])
        }
        completionHandler()
    }
}

// MARK: - PushManager (bridge-facing)

enum PushManager {
    /// Asks for authorization and registers with APNs. Called from the JS bridge
    /// at the first value moment — never at app launch.
    static func requestPermission(completion: @escaping (Bool) -> Void) {
        let center = UNUserNotificationCenter.current()
        center.getNotificationSettings { settings in
            switch settings.authorizationStatus {
            case .authorized, .provisional, .ephemeral:
                DispatchQueue.main.async {
                    UIApplication.shared.registerForRemoteNotifications()
                    completion(true)
                }
            case .denied:
                completion(false)
            case .notDetermined:
                center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
                    if granted {
                        DispatchQueue.main.async {
                            UIApplication.shared.registerForRemoteNotifications()
                        }
                    }
                    completion(granted)
                }
            @unknown default:
                completion(false)
            }
        }
    }
}
