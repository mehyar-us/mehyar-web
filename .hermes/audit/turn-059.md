# turn-059 — home FAQPage $330 audit-plus-setup drift fix (sha 881df83)

## What shipped
One-line copy rewrite in `client/index.html` (the build-time home shell template that carries the inlined FAQPage JSON-LD). The home-page FAQPage question "What does a first engagement cost?" previously answered with BOTH "$150 Tech Audit" AND a "$330 audit-plus-setup plan" on the same sentence. The "$330 audit-plus-setup" is not a named product anywhere on the site — it's the MicroOffer intake charge, not a tier on the 6-tier leak-ladder. The sentence:

1. Contradicted the on-page leak-ladder cards directly above (tier-1 $150 + tier-2 $250, no $330 anywhere on the ladder).
2. Invented a product name ("audit-plus-setup plan") that doesn't exist on any visitor surface.
3. Was silently dropped from the visitor's mental model of the leak-ladder (tier-2 $250 went unmentioned).

## Before / after

**Before (visible to Google + every visitor to /):**
```
"What does a first engagement cost?": "A focused Tech Audit starts at $150 and a $330 audit-plus-setup plan is the common first step. Larger custom builds run $1k-$25k, retainers run $500-$3,500 per month, and hourly advisory is $150 per hour. The first call identifies the smallest useful engagement for the leak."
```

**After (live as of 2026-07-10T17:00Z):**
```
"What does a first engagement cost?": "A focused Tech Audit starts at $150 and a written Website Diagnosis Report is $250. Custom builds run $1k-$25k, retainers run $500-$3,500 per month, and hourly advisory is $150 per hour. The first call identifies the smallest useful engagement for the leak."
```

The rewrite matches the on-page leak-ladder verbatim (matches `docs/VISION.md` lines 13-14: tier-1 = `$150 Free Tech Audit`, tier-2 = `$250 Website Diagnosis Report`, tier-3-6 ranges unchanged). The MicroOffer's $330 charge stays on `/micro-offer` where it belongs. No tier prices touched. No VISION.md change.

## Why this matters more than turn-058

- Turn-058 (2026-07-10, sha b76f59e) closed the same drift class on the **home leak-ladder subtitle** (visitor-facing copy). That was copy that a visitor would read while scrolling the page.
- Turn-059 (this turn) closes the same drift class on the **home FAQPage JSON-LD** — which is what Google's "rich results" and answer boxes index. Every "what does MehyarSoft cost" search impression feeds the fabricated "audit-plus-setup" phrase.

Together turn-058 + turn-059 close the home-page $330 contradiction class on both visitor-facing copy AND crawler-indexed structured data. Section G pricing-consistency probe (turn-038) still FAIL exit 1 — that is the founder-blocked tier-1 vs MicroOffer-charge drift per `docs/PRICING-LADDER-DRIFT-2026-07-09.md`, NOT caused by this change.

## Verified

- `tsc --noEmit` green
- `vite build` green (dist shell rewritten, JS bundle rolled by CF Pages — turn-058's local hash main-CbIxzlhT.js differs from CF Pages build's main-BUtub95-.js because vite hashes are build-host-dependent; content equivalent, both contain turn-058's pricing-section.tsx rewrite)
- `npm run test:intake` 11/11 green
- `dist/public/index.html`:
  - old `audit-plus-setup` substring: `grep -c` returns 0
  - new `Website Diagnosis Report is $250` substring: `grep -c` returns 1
- Live home FAQPage (`curl https://mehyar.us/`):
  - new text live (verified at 2026-07-10T17:00Z)
  - old text absent (verified at 2026-07-10T17:00Z)
- 4-screen smoke: `/` 200 / `/booking` 308 / `/micro-offer` 308 / `/nope-zzz` 404 (unchanged from turn-050 baseline)
- 8/9 probe sections PASS: H/J/K/L/M/N/O green; Section G FAIL exit 1 (founder-blocked pricing drift, NOT caused by this change — same G FAIL was present in turn-058's baseline)
- Section O: live bundle auto-discovered at 575244 bytes, canonical across 4 routes (unchanged from turn-058)
- Voice 5/5: short sentences, named numbers, matches leak-ladder, no marketing fluff; anti-slop 0 hits (`grep -ciE "in today's fast-paced|empowering businesses|your trusted partner|leverage"` = 0)

## Lesson

The `$330 drift` class shows up on **two distinct surfaces** in the same visitor's session — the leak-ladder subtitle (turn-058) AND the FAQPage answer (turn-059). Turn-058's commit message assumed the leak-ladder copy was the only home-page surface carrying the drift; it wasn't. The fix order for any "drift class across multiple surfaces" problem:

1. Find the surface (bundle-grep for the literal across all inlined HTML + JSON-LD)
2. Fix the highest-leverage surface first (FAQPage JSON-LD > visible copy > sub-page copy)
3. Re-grep after each fix to catch the next instance

Turn-058 missed step 1 — it eyeball-audited the home page and caught the subtitle but skipped the FAQPage (which is in `client/index.html` as static inlined JSON-LD, not in any `.tsx` component, so it's invisible to component-level audits). The cheap pre-fix check added to the running list: `grep -rnE '<drift-literal>' client/index.html client/src/` should be the **first** check on any home-page drift class, not the last.

Companion references: see `docs/PRICING-LADDER-DRIFT-2026-07-09.md` for the founder-blocked Section G drift (separate concern, NOT addressed here); see `.hermes/audit/turn-058.md` for the leak-ladder subtitle half of the same class.