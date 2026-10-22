# The Mayor — Phase 1 Full QA Test Report

**Date:** 2026-10-12 · **Branch:** `mayor/vision-transform` (from `origin/main` 1ae4c17)
**Order:** "Develop mayors vision and change pricing after test all things and redo the ui better."
**Method:** 4 parallel QA streams (read-only) + coordinator compliance audit. No live Stripe charges, no deploys, no emails.

Stream reports: `QA-REPORT-MARKETING.md` · `QA-REPORT-APP.md` · `QA-REPORT-BACKEND.md` · `VISION-GAP-MATRIX.md`
Compliance: `~/workspace/product-compliance/audits/mayor-2026-10-12.md`

---

## 1. Marketing site (mayor.mehyar.us) — /sales FAILS, rest passes

| Page | Verdict |
|---|---|
| `/` landing | PASS — Free $0 / Pro $14/mo shown, no-refunds copy, legal footers, consent-gated GA4 (G-6RCJMF73VJ) |
| `/sales` | **FAIL** — CRITICAL: zero dollar figures beside "No hidden fees" promise |
| `/pricing` | PASS (minor: missing OG tags) — $0/$14/$4/$8/$12 all shown |
| `/get-started` | PASS (note: contentless SPA fallback, no CTA points to it) |
| 7 vertical pages | PASS — all 200, OG/canonical, compliant footers |

**/sales defects (fix in Phase 2/3):**
1. CRITICAL: "No hidden fees" with ZERO prices on the page; no link to /pricing (compliance items 9/10 FAIL)
2. SEVERE: tier names Start/Grow/Top-up vs app's Free/Pro — buyer can't map sales copy to checkout
3. SEVERE: no Twilio/Telnyx provider-billing disclosure ("instant text-back" implies it's included)
4. SEVERE: 7 trade cards have zero links — vertical pages orphaned
5. MINOR: /sales/plumbing + /sales/auto 404 (canonical slugs work)

**Debunked:** "five vs seven trades" (seven everywhere); "pet-grooming/med-spa exceed runtime" (7 runtime profiles exist).

## 2. PWA app — working, tested; experience layer is the gap

- **Tests: 983/983 pass** (88 files, 40.5s). Billing catalog/runtime/Stripe, proactive, voice, onboarding all green.
- **IMPLEMENTED:** proactive engine (5 detectors, 3/day cap, 21:00–08:00 quiet, 5-min cron), OAuth connections (calendar/phone), tap-to-talk + telephony with AI disclosure verified in code, billing UI ($14, packs, no-refunds), tenant isolation.
- **PARTIAL:** Chief of Staff onboarding (conversational Q&A + Places lookup exist; no 5-phase agent, no "Set the rules"), authority tiers (draft-for-approval everywhere; no owner-settable per-action tiers), glanceable cards (no weekly money card), GBP (reads not wired).
- **MISSING:** conversation canvas (app is 6 tabs: Today/Feed/Connectors/Plan&usage/Settings + chat), speak-and-show visuals.
- **Bugs B1–B6** (low/medium): misleading `proactive-stub.ts` name, no authority-tier settings, no-refunds line missing from upgrade dialog, GBP card over-promises, quiet hours not configurable.

## 3. Backend + billing — solid, $39 path mapped

- **Billing: 8/8 tests pass**, zero live Stripe contact. Constants confirmed: Pro $14/mo (1400¢), packs $4/$8/$12. Checkout disclosure verified ("Pro is $14 per month… Phone-provider charges are separate.").
- **No refund code paths exist** — webhooks only revoke entitlements on external refunds/disputes. Standing order holds.
- **4 Stripe Price ID env vars:** `MAYOR_STRIPE_PRICE_ID`, `MAYOR_STRIPE_CREDIT_PRICE_SMALL/MEDIUM/LARGE`. **$39 change = new Stripe Prices + `PRO_PRICE_CENTS` 1400→3900 + `PRO_PRICE_VERSION` bump + checkout copy.** ⛔ Blocked: Price IDs must come from Mayor.
- **Runtime verticals = 7** (salon, restaurant, plumbing_hvac, dental, auto_repair, pet_grooming, med_spa) — corrects old "5" reports. 34 docs are content-only.
- **Tenant isolation PASS.** Metering atomic (no overshoot path).
- **AI Gateway + GOOGLE_PLACES_API_KEY both absent in prod** — degrade gracefully (direct Workers AI fallback; manual onboarding flow). Standing blockers, not faked.

## 4. Vision gap matrix — 23 items mapped

**Implemented:** memory, acting tools, proactive suggestions, tenant isolation, OAuth vault, AI disclosure, no-refunds, nudge caps, connection cards (calendar/phone).
**Biggest contradiction:** 6-tab dashboard vs vision's "one conversation canvas."
**Council:** verified gone (zero matches).

### Phase-2 backlog (value × feasibility)
| Pri | Workstream | Size |
|---|---|---|
| P1 | Authority tiers — per-action-type selector, persisted + enforced | M |
| P2 | Conversation canvas — collapse 6 tabs into one surface (Phase 4 UI redo) | L |
| P3 | Speak-and-show — visual events during voice turns (Phase 4) | M→L |
| P4 | Chief of Staff 5-phase conductor over existing primitives | M |
| P5 | Glanceable money card (weekly) | M |
| P6 | Reviews + payments one-click connections | S/M |
| P7 | Proactive day-one gaps (GBP-hours check, post-missed-call connect nudge) | S |
| P8 | Verticals scope — Option A: 5 deep + honest mapping (copy alignment) | S |
| P9 | Verification (DO confirmation, gateway wiring, animation budgets) | S |

## 5. Go / no-go for Phase 3 (pricing)

**Tests pass** (983 app + 8 billing, all green). Known issues are documented and scheduled — none block the pricing change itself.
**⛔ BLOCKER: 4 Stripe Price IDs for $39/mo + $10/$20/$30 packs must come from Mayor** (Stripe dashboard). Will not invent. Price IDs needed:
1. Pro $39/mo recurring → `MAYOR_STRIPE_PRICE_ID`
2. Small $10 pack → `MAYOR_STRIPE_CREDIT_PRICE_SMALL`
3. Medium $20 pack → `MAYOR_STRIPE_CREDIT_PRICE_MEDIUM`
4. Large $30 pack → `MAYOR_STRIPE_CREDIT_PRICE_LARGE`

Code changes staged in `~/workspace/mayor-pilot/pricing-39.diff` (plans.ts + service.ts) + /sales + /pricing + app UI price surfaces.

## 6. Recommended Phase-2 execution order

1. **/sales truth fixes** (prices, tier names, provider disclosure, vertical links) — unblocks Phase 3 compliance
2. **P1 authority tiers** — highest trust lever, machinery exists
3. **P4 Chief of Staff conductor** — fulfills the public-site promise
4. **P7/P5/P6** — proactive day-one, money card, reviews+payments
5. **Phase 4:** P2 canvas + P3 speak-and-show (the UI redo)
