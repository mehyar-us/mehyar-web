# turn-037 — pricing-ladder state drift surfaced for founder decision (docs-only)

> Tick: 37
> When: 2026-07-09T22:55:00Z (UTC, approximate)
> Live site on: c33755d (turn-036 hero CTA + About 'Practicality' voice fix — unchanged)
> Local source on: 17c70a3 (HEAD on main after push; docs-only commit)
> Prior tick: 36 (turn-036 About Practicality card copy — drop 'leverage', sha c33755d, bundle main-BKU1Uoxy.js live)
> Verdict: ship (docs-only, no live change)

## Why this tick

State.md hot-list after turn-035 (W2-FUNNEL fully closed) was: W5-PERSUADE needs user direction; next-tick small move = LOOP-BOOT cadence anchor OR a 1-PR shipping win. The loop scanned for visitor-facing drift and surfaced a real, repeatable finding: **the publicly stated tier-1 price in VISION.md + pricing-section.tsx is $150, but the actual intake page that the tier-1 CTA points at charges $330.** This is a structural contradiction on the live home page:

| Visible to visitor | Live value | Source |
|---|---|---|
| Tier-1 leak ladder card | "Free Tech Audit" — $150 | pricing-section.tsx:22 |
| Tier-1 leak ladder doc | "Free Tech Audit — $150 (entry, no-pitch)" | VISION.md line 13 |
| Tier-2 leak ladder card | "Website Diagnosis Report" — $250 | pricing-section.tsx:33 |
| Tier-1 CTA target | /micro-offer#intake | pricing-section.tsx:25 |
| Tier-2 CTA target | /micro-offer#intake (same) | pricing-section.tsx:36 |
| Actual intake page charge | $330 audit/setup path | MicroOffer.tsx 51/60/72/87/142; 49 bundle mentions |
| API contract truth | `form_type: micro_offer` — $330 rescue offer; `first_330_target_cents: 33000` | mehyarsoft-api-contract.md lines 36, 134 |
| QA baseline rubric | "/micro-offer: 200, $330" | QA-MEHYARSOFT Section A row 8 |

**Two observable contradictions on the live home page:**
1. Tier-1 ($150) < tier-2 ($250) < actual intake ($330) — the on-page ladder is internally inconsistent with what the visitor gets asked to pay.
2. Two different-priced tier CTAs converge on a single $330 intake page — turn-005's per-tier CTA intent is broken on the audit-intent pair.

This drift has been visible since launch. It was missed by:
- turn-005 (per-tier CTA labels) — created the tier-1 + tier-2 both → /micro-offer#intake pattern under the assumption that /micro-offer charged $250.
- turn-028 (rubric recreation) — the QA baseline notes /micro-offer is $330 but does not cross-reference tier-1's $150.
- turn-031 + turn-034 (full LOOP-BOOT audits) — neither rubric section checks pricing consistency between pricing-section.tsx tier prices and intake-page charges.

## What shipped this tick

**docs-only commit:** `docs/PRICING-LADDER-DRIFT-2026-07-09.md` (102 insertions) on main at sha 17c70a3.

The doc:
- Documents the drift with file:line evidence.
- Presents three decision options (A: align to $330 / B: drop micro-offer price / C: treat as two separate products) with cost + risk + reversibility for each.
- Explicitly states the loop did NOT ship any of them — too consequential for autonomous.
- Recommends adding a "pricing consistency" check to the LOOP-BOOT rubric (Section B or new Section G) so this drift catches itself on future audits.
- Lists every file the loop did NOT touch (so the founder can verify no autonomous edits landed).

Push result: `c33755d..17c70a3 main -> main` (clean, no force-push, no secret leak).

## What was NOT shipped

No visitor-facing copy changed. No pricing changed. No API contract changed. No CF Functions changed. No tests changed. **The drift will continue to surface on every LOOP-BOOT audit tick until a founder decision lands.**

## Verification

- `npm run check` (tsc) — green (no src changes, just-in-case verification)
- `npm run build:client` — green, dist/public/assets/main-Ba-gh8Bm.js unchanged from turn-036
- `npm run test:intake` — 11/11 (unchanged)
- `grep -oE '\$150|\$330' dist/public/assets/main-Ba-gh8Bm.js | sort | uniq -c` — 4 $150 / 49 $330 (matches live bundle main-BKU1Uoxy.js exactly)
- `curl https://mehyar.us/` → 200, bundle hash main-BKU1Uoxy.js (live unchanged from turn-036)

## Voice bar

No copy changed. No anti-slop risk. Voice 5/5 preserved.

## Audit-intent funnel counts (unchanged)

| Counter | Local bundle | Live bundle | turn-035 baseline |
|---|---|---|---|
| `micro-offer#intake` | 20 | 20 | 20 ✓ |
| `/#pricing` | 1 | 1 | 1 ✓ |
| `/contact` (visible hrefs) | unchanged | 20 | 20 ✓ |

## Founder decision required

The loop surfaces; the founder decides. Three options in the drift doc:

- **A: align everything to $330 reality** — 6 small edits, 1 PR, easy revert. Changes publicly stated tier-1 price.
- **B: drop micro-offer charge to $150 or $250** — revenue direction, high risk, NOT recommended without careful funnel review.
- **C: position $150 Free Tech Audit as separate product from $330 micro-offer audit+setup sprint** — 4-6 edits, 1 PR, moderate restructure. Most likely matches the founder's intent (two distinct artifacts).

**Fastest path:** 5-minute founder reply via Telegram (chat 6829435996) or on the doc with one of "ship option A/B/C [with this tweak: …]". Loop will run the edit in a single turn-038 tick: build + test:intake + 4-screen smoke + push + state update + Telegram card. Expected ~15 minutes from decision to live.

## Detection method going forward (recommendation)

Add to LOOP-BOOT rubric (Section B or new Section G "Pricing consistency"):

> Every priced tier in `pricing-section.tsx` must point at an intake page whose `priceRange` / charge matches the tier's `price` field. If a tier's CTA target is `/micro-offer`, the micro-offer charge MUST equal the tier's `price` field. Tier-1 → micro-offer charge. Tier-2 → /contact?service=website-diagnosis or micro-offer charge. Drift = FAIL.

This check costs ~3 grep commands per LOOP-BOOT audit and would have flagged this drift on turn-031 (the first full audit after rubric recreation at turn-028).

## Kanban ticket

`hermes kanban --board mehyar-us create` → t_7f1c39e4 → completed with full context. Status: done. Assignee: improver.

## Lesson

The founder's stated pricing ladder (VISION.md) and the revenue reality (micro-offer charge) had drifted apart silently. Three rubric sections (Surface reachability, Audit-intent funnel, Voice bar) were passing because none of them checks the relationship between a tier's display price and the intake page that the tier's CTA points at. **The cheapest catch is a 3-line check: for each priced tier card, verify the target intake page charges the same amount.** That check belongs in the LOOP-BOOT rubric and should fire on every audit tick — the same way Section B verifies audit-intent funnel counts.

A docs-only tick that surfaces drift without changing copy is the right shape when the fix is too consequential for autonomous. The cost of NOT surfacing it is bigger than the cost of waiting for a founder decision: visitors seeing contradictory pricing lose trust faster than they lose patience waiting for the founder to ship the fix.