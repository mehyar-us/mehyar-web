# The Mayor — iOS App Deploy Checklist (Xcode Cloud)

Native iOS shell (`ios/mayor/`) around the PWA at https://mayor.mehyar.us.
Bundle ID: `us.mehyar.mayor` · Branch: `ios/mayor-app` · Scheme: `Mayor` (shared)
iOS 17+, Swift 5.9, zero third-party deps. Builds on **Xcode Cloud** — no GitHub Actions.

## Owner actions (cannot be automated — do these in order)

- [ ] **1. Apple Developer Program enrollment** — https://developer.apple.com/programs/enroll — $99/yr.
      Nothing below works without it.
- [ ] **2. Register the bundle ID** — Certificates, Identifiers & Profiles → Identifiers →
      `us.mehyar.mayor` (App ID, explicit). Enable **Push Notifications** capability.
- [ ] **3. Create the APNs key (.p8)** — Keys → create key, enable Apple Push Notifications
      service (APNs). Download the `.p8` **once** (Apple never shows it again). Note the Key ID.
      → Server side needs this for the worker push provider (see PUSH_SERVER_NOTES.md).
- [ ] **4. Create the app record** — App Store Connect → My Apps → + → iOS → name "The Mayor",
      bundle `us.mehyar.mayor`, SKU `mayor-ios-1`.
- [ ] **5. Connect the repo to Xcode Cloud** — App Store Connect → the app → Xcode Cloud →
      Get Started → connect the **mehyar-us/mehyar-web** GitHub repo (or Xcode →
      Report navigator → Cloud tab → Connect). Grant access to the repo.
- [ ] **6. Create the Xcode Cloud workflow** — Xcode Cloud → Create Workflow → use these
      exact settings (also listed at the bottom of this file):
      - Workflow name: `Mayor — TestFlight`
      - Branch: `ios/mayor-app`
      - Scheme: `Mayor` (shared scheme ships in the repo)
      - Xcode: 16.x (latest) · macOS: latest
      - Clean: ✅ on
      - Actions: Build + Test (optional) + Archive; **TestFlight (Internal)** upload on
      - Environment → Signing: select your Apple Developer team. The project uses
        automatic signing (`CODE_SIGN_STYLE = Automatic`); Xcode Cloud manages
        certificates/profiles from the connected App Store Connect org.
      - If signing fails: open `ios/mayor/Mayor.xcodeproj` in Xcode once, set the Team
        under Signing & Capabilities (writes `DEVELOPMENT_TEAM` into the pbxproj),
        commit, push.
- [ ] **7. Start the first build** — Xcode Cloud → Workflows → `Mayor — TestFlight` →
      Start Build. Watch it go green. The build appears in TestFlight → iOS Builds.
- [ ] **8. Internal testers** — TestFlight → Internal Testing → create group "Mayor crew",
      add testers. Builds are available in minutes.

## TestFlight → App Store

- [ ] Verify on device: launch <3s, push arrives + deep-links, mic works, offline banner,
      Face ID gate, share sheet. (Skill verification list.)
- [ ] Screenshots: 6.7" + 6.5" from Simulator (`xcrun simctl`).
- [ ] Privacy: `PrivacyInfo.xcprivacy` ships in the bundle (device token for push, linked).
- [ ] Review notes: "AI front-desk for local businesses; sign-in required — demo account:
      <email> / <password>." (Owner supplies a demo login.)
- [ ] External beta review (~24h), then App Store submission.
- [ ] **Red-team gate: never submit a build the red-team hasn't passed on device.**

## Xcode Cloud workflow settings (copy-paste reference)

| Setting | Value |
|---|---|
| Workflow name | `Mayor — TestFlight` |
| Repository | `mehyar-us/mehyar-web` |
| Branch | `ios/mayor-app` |
| Scheme | `Mayor` (shared, in `xcshareddata`) |
| Xcode version | 16.x (latest) |
| macOS | latest |
| Clean build | Yes |
| Archive action | Release |
| Post-actions | TestFlight → Internal |
| Signing | Automatic — Apple Developer team selected in Environment |
| Custom script | `ios/mayor/ci_scripts/ci_post_clone.sh` (env sanity check; runs automatically) |
| Environment variables | None required |

## Notes

- First push: the PWA must call `MayorNative.requestPushPermission()` at the first
  value moment (e.g., after onboarding) — never at launch.
- The worker needs the push provider + token storage before pushes do anything
  useful — see PUSH_SERVER_NOTES.md.
- `ITSAppUsesNonExemptEncryption = false` is set (no custom crypto).
- No repo secrets needed: Xcode Cloud handles signing and TestFlight upload
  through the connected App Store Connect organization.
