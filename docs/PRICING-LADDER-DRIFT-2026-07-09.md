# Pricing-Ladder State Drift — 2026-07-09

> Surfaced by the mehyar.us improve-loop on turn-037.
> **Decision needed from founder before any visitor-facing copy change.**

## The drift

Three sources of truth say three different things about the tier-1 entry offer:

| Surface | Says | Evidence |
|---|---|---|
| `docs/VISION.md` "What we sell" leak-ladder | "**$150** — Free Tech Audit (entry, no-pitch)" | docs/VISION.md line 13 |
| `client/src/components/pricing-section.tsx` tier-1 card | "**$150**" for "Free Tech Audit" | pricing-section.tsx:22 |
| `docs/FINAL-ACCEPTANCE-GATE-MEHYARSOFT-V1-2026-05-11.md` row 2 | "$150 / $250 / $1k-$5k / $5k-$25k / $500-$3500 / $150" listed as PASS | gate doc row 2 |
| `client/src/pages/MicroOffer.tsx` (the actual intake) | "**$330** audit/setup path" | 49 occurrences in the live JS bundle main-BKU1Uoxy.js; MicroOffer.tsx lines 51/60/72/87/142/149-153 |
| `docs/mehyarsoft-api-contract.md` | "`form_type: micro_offer` — **$330** rescue offer"; `first_330_target_cents` defaults to 33000 | api-contract.md lines 36, 134 |

**What a visitor sees today on the live home page:**

> Tier 1: **Free Tech Audit** — **$150** — "Best first step" — CTA "Book a Tech Audit" → /micro-offer#intake
>
> Tier 2: **Website Diagnosis Report** — **$250** — "Fast turnaround" — CTA "Request the $250 report" → /micro-offer#intake
>
> *(both CTAs land on the same /micro-offer page, which charges $330)*

This produces two observable contradictions:

1. **Tier-1 ($150) < tier-2 ($250) < actual intake ($330)** — the on-page ladder is internally inconsistent with what the visitor gets asked to pay.
2. **Two different-priced tier CTAs converge on a single $330 intake page** — turn-005's intent (per-tier CTA labels + service-tagged routing) is broken on the audit-intent pair; both tiers 1 and 2 funnel into the same artifact at the same price.

## Why this happened (chronological evidence)

- The $330 micro-offer has been live since launch (api-contract.md `first_330_target_cents: 33000`); the micro-offer page itself is consistent ($330 across 49 bundle mentions).
- VISION.md and pricing-section.tsx both list $150 for tier-1 and $250 for tier-2. These were written before or independently of the micro-offer pricing.
- The QA baseline (recreated at turn-028) correctly notes `/micro-offer: 200, $330` — it knows the micro-offer is $330. But the same QA doc does NOT cross-reference tier-1 of the leak ladder against the micro-offer price, so the contradiction has been invisible to every prior audit.
- turn-005 (per-tier CTA labels) created `ctaLabel: "Request the $250 report"` and wired it to `/micro-offer#intake` — same target as tier-1. The intent was correct (per-tier copy); the assumption that /micro-offer charged $250 was the latent bug.

## Three ways to fix — pick one

### Option A — Match everything to $330 micro-offer reality
- pricing-section.tsx tier-1: `$150` → `$330`
- pricing-section.tsx tier-2: `$250` → keep as-is OR restructure
- VISION.md tier-1 line: `$150` → `$330`
- Final-Acceptance-Gate row 2: update ladder to start at $330
- **Cost:** ~6 small edits, 1 PR, no schema change, no API change.
- **Risk:** publicly changes the tier-1 price. May affect visitors who bookmarked "Free Tech Audit $150" or were quoted $150 in outreach.
- **Reversibility:** 1 commit, easy revert.

### Option B — Keep the $150 / $250 ladder, restructure the $330 micro-offer
- micro-offer.tsx and api-contract: $330 → $150 (tier-1) OR $250 (tier-2)
- **Cost:** affects revenue (drops from $330 to $150/$250 per intake), changes billing artifacts, requires Cloudflare Function / D1 migration if any rows already exist.
- **Risk:** HIGH. Pricing change in the revenue direction is the most consequential product change possible. Requires testing the intake / notification / billing flow.
- **Reversibility:** hard. Once a price changes, visitors who paid $330 will notice.

### Option C — Treat them as two separate products (most likely the truth)
- The leak-ladder "$150 Free Tech Audit" is a **scoped written deliverable** (a leak map, plain-language prioritized fixes) — the founder's tier-1 entry, no-pitch, low-friction.
- The "/micro-offer $330 audit/setup path" is a **2-week audit + first-fix sprint** — a separate, larger artifact that turn-019+20 funneled into.
- Tier-2 ($250 "Website Diagnosis Report") is the **middle tier** — a written report on website/booking/follow-up leaks.
- **Fix:** explicitly position the three as separate products in pricing-section.tsx and VISION.md. Tier-1 "Free Tech Audit" stays at $150 with its own /contact?service=tech-audit-150 path. The /micro-offer becomes a standalone "$330 audit + first-fix sprint" card (or moves to a 7th position above tier-3).
- **Cost:** ~4-6 edits, 1 PR, 1 CF Function adjustment if /contact?service=tech-audit-150 needs a new intake mode.
- **Risk:** moderate. Restructures the visitor-facing ladder. Founder needs to confirm the product split is what they intended.
- **Reversibility:** 1 commit, easy revert.

## What the loop is NOT doing

Not shipping any of these unilaterally. This is a founder decision that affects revenue, intake flow, and the publicly stated offer ladder. The loop surfaces; the founder decides.

Until a decision lands:

- **Do not** edit `pricing-section.tsx` tier-1 or tier-2 prices.
- **Do not** edit VISION.md leak-ladder prices.
- **Do not** edit MicroOffer.tsx charge.
- **Do not** edit api-contract.md `first_330_target_cents`.

The drift will continue to surface on every LOOP-BOOT audit tick until a decision lands.

## How to decide

The fastest path is a 5-minute founder reply to this doc (or to the Telegram card on chat 6829435996) with one of:

- "ship option A"
- "ship option B"
- "ship option C with this tweak: …"

Once a decision lands, the loop will run the edit in a single turn-038 tick: build + test:intake + 4-screen smoke + push + state.md update + Telegram card. Expected: ~15 minutes from decision to live.

## Detection method (so this doesn't recur)

This drift was visible since launch and only caught by manually comparing VISION.md against `client/src/pages/MicroOffer.tsx`. The loop never ran a price-consistency check across the four sources of truth before. **Recommended addition to the LOOP-BOOT rubric (Section B or new Section G "Pricing consistency"):**

> Every priced tier in pricing-section.tsx must point at an intake page whose `priceRange` / charge matches the tier's `price` field. Tier-1 → /micro-offer micro-offer-page charge. Tier-2 → /contact?service=website-diagnosis or /micro-offer (depending on routing). If a tier's CTA target is /micro-offer, the micro-offer charge MUST equal the tier's `price` field.

This check costs ~3 grep commands per LOOP-BOOT audit and would have flagged this drift on turn-031 (the first full audit after rubric recreation).

## Files referenced (no edits made by this doc)

- `docs/VISION.md` lines 12-18 (leak ladder)
- `docs/FINAL-ACCEPTANCE-GATE-MEHYARSOFT-V1-2026-05-11.md` row 2 (gate PASS list)
- `client/src/components/pricing-section.tsx` lines 19-30 (tier-1 + tier-2 cards)
- `client/src/pages/MicroOffer.tsx` lines 51-153 (actual intake charge)
- `docs/mehyarsoft-api-contract.md` lines 36, 134 (api-truth references)
- `docs/QA-MEHYARSOFT-B2B-BASELINE-2026-05-11.md` Section A row 8 (micro-offer rubric)