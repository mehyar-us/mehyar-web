# Turn-004 — 2026-07-09 01:58 UTC — W2-FUNNEL hero CTA move /contact -> /micro-offer#intake

## What shipped
- `client/src/components/hero-section.tsx` line 30: `<Link href="/contact">` → `<Link href="/micro-offer#intake">` on the hero "Book a Tech Audit" primary CTA.
- One-line, two-character semantic change. No other copy, no layout, no styling touched.

## Why
The hero CTA copy "Book a Tech Audit" is a specific audit-intent signal.
It was routing through `/contact`, which is a general "request anything"
form (description: "Request a Tech Audit or Consulting Call"). The
dedicated `/micro-offer` (alias for `/330`) page already has its own
meta title (`$330 Website + Booking Leak Audit | MehyarSoft`),
offer-specific framing, and an intake form pre-tagged for `micro_offer`
+ UTM campaign `330_micro_offer`. The hero was sending the strongest
intent signal through the slowest funnel.

The `#intake` anchor jumps the user directly to the form region
(scrollY=2190 lands it in view), removing the need to scroll past the
audit-page pitch before the form.

## Verified live (post-deploy, bundle `main-DPwQXa_h.js`)
- Bundle contains `/micro-offer#intake` (grep on live JS)
- `curl -sIL https://mehyar.us/micro-offer/` → HTTP 200
- Browser navigated to `https://mehyar.us/micro-offer/#intake`:
  - URL: `https://mehyar.us/micro-offer/#intake`
  - hash: `#intake` preserved
  - `#intake` element exists in DOM
  - `scrollY: 2190` (form in view)
  - console: clean (no JS errors)
  - form fields visible: Name, Email/Phone, Phone, Business, "Where are leads missed?" combobox, "Current tools" combobox, "Estimated missed leads" combobox

## Tests run locally (all green)
- `npm run check` (tsc) — clean
- `npm run build:client` — 34 route shells + 404 fallback emitted
- `npm run test:intake` — 11 tests pass, including `micro-offer fields` and `request_type alias` (confirms the form the hero CTA now lands on is wired)

## Brand voice check
- New path: `/micro-offer#intake` — neutral, no copy change required
- No new strings introduced
- Score: N/A (no copy change). Existing hero copy preserved verbatim.

## Git
- Branch: `improver/hero-cta-micro-offer`
- Feature commit: `79e405f`
- Merge commit: `22dd6f0` ("merge: improver/hero-cta-micro-offer — move hero CTA /contact -> /micro-offer#intake (W2-FUNNEL tick-004)")

## Tickets
- Filed `t_d02d9660` (done) capturing this turn's change.
- W2-FUNNEL hero-CTA piece closed by this turn.
- `t_0634816e` "End-to-end Booking funnel smoke test" remains ready — that's a deeper pass (Booking + MicroOffer submit paths, conversion tracking, CF Functions audit row).

## Lessons
- **Match CTA copy to landing intent, not the inverse.** "Book a Tech Audit" copy on the hero demands an audit-intent landing. `/contact` accepts anything; `/micro-offer` is dedicated. Routing by copy-intent (rather than always-the-general-form) is the highest-leverage micro-fix on a small site.
- **Aliases count.** `/micro-offer` and `/330` both route to the same `MicroOffer` component (`App.tsx` L74-75). The canonical is `/330` (per `staticMeta`), but `/micro-offer` is human-readable and matches the hot list — both work, and CF doesn't 301 between them (the React Router serves the same component for both). Either is a valid hero target; I picked `/micro-offer` because it's the URL referenced in the state-file hot list.
- **`#intake` anchor jumps are zero-cost landing optimization.** Adding `#intake` to the href puts the form in view on first paint without a separate scroll-spy or click handler. The `#intake` element already exists in the page (it's the form region `<section>`). Reuse, don't add.
- **Verify the JS bundle, not just the HTML.** The home shell (`dist/public/index.html`) is the document head only — body content is JS-rendered. Confirming the CTA href change shipped means grepping the live `assets/main-*.js`, not the prerendered shell.

## Next tick (turn-005)
Hot list:
1. `t_0634816e` — end-to-end Booking + MicroOffer funnel smoke (CF Functions audit row, conversion tracking, submit path under retry)
2. W1-SLOP — anti-slop + brand-voice copy pass over public pages
3. LOOP-BOOT (t_b3048d53) — live state audit vs `docs/VISION.md`

Then: revisit the blocked `t_5f79e5ac` (CF API bearer) once per deep tick per state-file rule.