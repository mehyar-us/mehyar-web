import SwiftUI
import Network
import LocalAuthentication

/// Root view: the PWA webview, an offline banner, and the biometric gate.
/// The Mayor canvas is the home screen — there is no separate "chat tab".
struct ContentView: View {
    @State private var isOnline = true
    @State private var isUnlocked = false
    @State private var biometricAvailable = false
    @State private var showBiometricPrompt = false

    private let monitor = NWPathMonitor()
    private let monitorQueue = DispatchQueue(label: "us.mehyar.mayor.netmon")

    var body: some View {
        ZStack {
            WebView()
                .ignoresSafeArea(.all, edges: .bottom)

            // Offline notice — the PWA keeps its last state; we just say what's wrong.
            if !isOnline {
                VStack {
                    HStack(spacing: 8) {
                        Image(systemName: "wifi.slash")
                        Text("You're offline — reconnect to reach The Mayor.")
                            .font(.subheadline)
                    }
                    .padding(10)
                    .frame(maxWidth: .infinity)
                    .background(Color(.systemYellow).opacity(0.95))
                    .foregroundColor(.black)
                    .transition(.move(edge: .top))
                    Spacer()
                }
            }

            // Biometric gate overlay (only when the user opted in).
            if biometricAvailable && !isUnlocked {
                BiometricLockView(isUnlocked: $isUnlocked)
            }
        }
        .onAppear {
            monitor.pathUpdateHandler = { path in
                DispatchQueue.main.async {
                    let wasOffline = !isOnline
                    isOnline = path.status == .satisfied
                    // On reconnect the webview resumes on its own; nothing to restart.
                    if wasOffline && isOnline {
                        NotificationCenter.default.post(name: .mayorNetworkBack, object: nil)
                    }
                }
            }
            monitor.start(queue: monitorQueue)

            // Biometric: only gate when the user opted in on the first-run prompt.
            let ctx = LAContext()
            var err: NSError?
            biometricAvailable = ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &err)
                && UserDefaults.standard.bool(forKey: "mayor.biometric.enabled")
            if ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &err)
                && !UserDefaults.standard.bool(forKey: "mayor.biometric.asked") {
                showBiometricPrompt = true
            }
        }
        .alert("Unlock with Face ID?", isPresented: $showBiometricPrompt) {
            Button("Use Face ID") {
                UserDefaults.standard.set(true, forKey: "mayor.biometric.enabled")
                UserDefaults.standard.set(true, forKey: "mayor.biometric.asked")
                biometricAvailable = true
                authenticate()
            }
            Button("Not now", role: .cancel) {
                UserDefaults.standard.set(true, forKey: "mayor.biometric.asked")
            }
        } message: {
            Text("The Mayor holds your business data. Face ID keeps it yours.")
        }
    }

    private func authenticate() {
        let ctx = LAContext()
        ctx.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics,
                           localizedReason: "Unlock The Mayor") { ok, _ in
            DispatchQueue.main.async { isUnlocked = ok }
        }
    }
}

/// Full-screen lock shown when biometric gate is on.
private struct BiometricLockView: View {
    @Binding var isUnlocked: Bool

    var body: some View {
        ZStack {
            Color(red: 0.063, green: 0.169, blue: 0.278) // #102b47 brand navy
                .ignoresSafeArea()
            VStack(spacing: 16) {
                Text("M")
                    .font(.system(size: 72, weight: .bold))
                    .foregroundColor(.white)
                Text("The Mayor")
                    .font(.title2).foregroundColor(.white.opacity(0.9))
                Button {
                    let ctx = LAContext()
                    ctx.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics,
                                       localizedReason: "Unlock The Mayor") { ok, _ in
                        DispatchQueue.main.async { isUnlocked = ok }
                    }
                } label: {
                    Label("Unlock with Face ID", systemImage: "faceid")
                        .padding(.horizontal, 24).padding(.vertical, 12)
                        .background(Color.white.opacity(0.15))
                        .cornerRadius(12)
                        .foregroundColor(.white)
                }
            }
        }
    }
}

extension Notification.Name {
    static let mayorNetworkBack = Notification.Name("us.mehyar.mayor.networkBack")
    /// Posted by PushNotifications when a push arrives carrying a deep-link URL.
    static let mayorDeepLink = Notification.Name("us.mehyar.mayor.deepLink")
}
