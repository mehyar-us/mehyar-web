# turn-038 — add Pricing-consistency check (Section G) to LOOP-BOOT rubric

> Tick: 38
> When: 2026-07-09T23:1x:00Z (UTC)
> Live site on: c33755d (main-BKU1Uoxy.js bundle, unchanged from turn-036)
> Local source on: c33755d (HEAD at tick start)
> Rubric: docs/QA-MEHYARSOFT-B2B-BASELINE-2026-05-11.md (now 8 sections A-H)
> Prior audit: turn-034 (sha c33755d, full 13-route LOOP-BOOT)
> Verdict: PASS — docs-only rubric extension; live site unchanged

## Why this tick

State.md hot-list (turn-037 output) explicitly listed 3 candidate moves:

1. **BLOCKER** — founder decision on docs/PRICING-LADDER-DRIFT-2026-07-09.md (options A/B/C).
   Loop will NOT ship pricing changes autonomously.
2. **(small)** — add pricing-consistency check to LOOP-BOOT rubric (Section B or
   new Section G). Loop CAN ship this autonomously.
3. W5-PERSUADE — long-stale, needs user direction.

Item #2 was the right autonomous move this tick: small, reversible, docs-only,
addresses a known gap (the drift surfaced at turn-037 was invisible to 4 prior
audit ticks — 005 / 028 / 031 / 034). Fixing the rubric means the next audit
catches it automatically.

## What shipped

- Added **Section G "Pricing-consistency"** to
  `docs/QA-MEHYARSOFT-B2B-BASELINE-2026-05-11.md` (was 7 sections A-G, now 8 A-H)
- Demoted the old "G. Open registry" prose to new Section H
- Bumped the rubric "Last update" header to reflect turn-038

Section G contains:

- **The invariant**: every tier card price must equal the intake-page charge
  for the page that tier's CTA routes to
- **A runnable 3-grep probe** (`.hermes/probe-section-G.sh`) that captures
  tier-1 price from `pricing-section.tsx`, most-frequent $ string from
  `MicroOffer.tsx`, and FAILs if they disagree
- **Today's expected output**: `G FAIL: tier-1=$150 intake=$330` — explicit,
  intentional, tracked. The FAIL is the rubric working.
- **Pass criteria** for after the founder decision lands
- **Failure-mode catalog** (4-row table) covering 4 future drift patterns:
  pricing-section ≠ intake, VISION ≠ pricing-section, multiple tiers → same
  intake, MicroOffer ≠ api-contract

The probe is verified end-to-end this tick:

```
$ bash .hermes/probe-section-G.sh
=== G Pricing-consistency probe (turn-038 new check) ===
tier-1 price (pricing-section.tsx): $150
intake price (MicroOffer.tsx most-frequent): $330
G FAIL: tier-1=$150 intake=$330
exit=1
```

The exit-1 is correct and intentional — it confirms the probe is wired correctly
and would have caught the turn-037 drift on any prior LOOP-BOOT tick that ran it.

## What was NOT shipped

- No pricing change in `pricing-section.tsx`, `MicroOffer.tsx`,
  `docs/VISION.md`, or `docs/mehyarsoft-api-contract.md` — these are all
  BLOCKED on the founder decision per `docs/PRICING-LADDER-DRIFT-2026-07-09.md`.
- No `client/src/` or `scripts/` change — pure docs-only tick.
- No CF Pages deploy — `docs/` is excluded from the CF Pages deploy
  workflow paths filter (lesson from turn-028).

## Sections A-F spot-check (post-patch)

No copy or structure changed in Sections A-F. The patch only:

1. Added new Section G content (replacing the old 3-line G paragraph)
2. Moved the old G paragraph to new Section H
3. Bumped the "Last update" header from "turn-028" to "turn-038"

Sections A-F (Surface reachability, Audit-intent funnel, Structured data,
Voice, Build gates, Anti-slop) are byte-identical to the turn-034 audit
baseline. Live site is unchanged (no src/ or scripts/ change).

## Tie-back to state.md hot-list

This tick closed item #2 of the 3-item hot-list from turn-037's last_learned
output. The remaining items:

- **Item #1 (BLOCKER)** — founder decision still pending on
  `docs/PRICING-LADDER-DRIFT-2026-07-09.md`. Loop will continue to hold.
  The new Section G probe is the loop's automated "is the decision still
  pending?" signal — until it goes green, the drift is open.
- **Item #3 (W5-PERSUADE)** — long-stale, still awaiting user direction.
  Out of scope for an autonomous tick.

## Class budget

This is a docs-only rubric-extension tick — no Phase-6 4-screen smoke is
needed (no live change to verify). The probe-section-G.sh is the
verification artifact.

## Lessons

1. The drift was invisible to 4 prior audit ticks because the rubric didn't
   have a section that cross-checked "marketing ladder price" against
   "intake charge". Adding the check is cheaper than fixing the drift
   (founder decision required) AND catches the NEXT drift before it ships.
2. The 3-grep probe pattern is reusable: capture a string from the
   "stated" surface (pricing-section.tsx) and the "actual" surface
   (MicroOffer.tsx), FAIL if they disagree. Same shape can catch
   tier-2 vs tier-3 mismatches, offer-name drift, or any future
   "stated vs charged" mismatch.
3. Doc-only ticks are the right home for rubric evolution — no CF Pages
   deploy, no live risk, the rubric gets stronger without moving any
   visitor-facing string.
4. Probe scripts that exit non-zero on FAIL are CI-ready — wire the
   `probe-section-G.sh` exit code into a future LOOP-BOOT run and the
   audit tick becomes self-checking.