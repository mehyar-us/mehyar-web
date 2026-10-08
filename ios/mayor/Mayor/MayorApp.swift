import SwiftUI

/// The Mayor — native iOS shell (SwiftUI lifecycle) around the PWA at mayor.mehyar.us.
/// The PWA remains the source of truth for UI; this target adds the native
/// integrations App Review requires: push, mic, biometric unlock, haptics, share.
@main
struct MayorApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
