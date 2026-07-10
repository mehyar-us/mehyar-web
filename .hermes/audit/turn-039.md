# turn-039 — mehyar.us improve-loop audit

> Tick: 2026-07-10 00:48 UTC
> Active board: mehyar-us
> Live bundle: main-BKU1Uoxy.js (unchanged from turn-036)
> Deployed sha: c33755d (turn-036, still live)

## What shipped

**docs-only commit sha `d9d96b9` on github main. No CF Pages deploy. Live site stays on turn-036 c33755d.**

- **`docs/QA-MEHYARSOFT-B2B-BASELINE-2026-05-11.md`**: grew from 8 sections (A-H) to 9 sections (A-I). Added new **Section H — Accessibility/SEO smoke** (live-bundle proxy for Lighthouse a11y+SEO audits). Renamed old Section H "Open registry" to new **Section I "Open registry"** to make room. Doc self-link back to git history now matches.
- **`.hermes/probe-section-H.sh`**: new probe. Runs 9 grep-based checks against the live bundle (`main-BKU1Uoxy.js`, 574085 bytes) and the home shell:
  - skip-to-content link presence + literal
  - semantic landmark tags (≥6 — main, nav, header, footer, article, section)
  - `aria-hidden` count ≥10 (decorative icon hiding for AT)
  - `aria-label` count ≥1 (icon-only button naming)
  - `sr-only` count ≥1 (visually-hidden text for AT)
  - `<html lang>` on home shell
  - viewport meta on home shell
  - canonical link on home shell
  - ≥2 JSON-LD blocks on home shell (cheap re-check of Section C)
- All 9 sub-checks PASS this tick. Bundle byte size 574085 (expect ~574069, ±1% drift = OK).
- Failure-mode catalog (6 rows) added so future drift is categorized: skip-link removed (P1), `<html lang>` changed (P0), new SVG w/o `aria-hidden` (P2), new icon-button w/o `aria-label` (P1), viewport removed (P0), canonical removed (P1).

## Why this lives in the rubric and not as a one-off

Lighthouse audits are heavyweight (chromium + headless, ~30s+ per run) and expensive to wire into every LOOP-BOOT tick. The probe is the **cheap proxy** — grep-able bundle literals that map to Lighthouse categories (SEO, accessibility, best-practices) without needing a browser. When the probe goes red, that's the "real Lighthouse will complain" signal. The probe runs against the live bundle (`main-BKU1Uoxy.js`), so it measures what visitors get, not what developers wrote.

## Naming-consistency bugs caught + fixed in this turn

The in-progress turn-039 work hit the working tree uncommitted with three naming bugs:
- Doc text in Section H referenced probe-section-I.sh in 3 places, but the actual file on disk is probe-section-H.sh
- Probe script's internal banner said "Section I Accessibility/SEO smoke" (mismatch with filename)
- Probe echo lines all used "I OK" / "I FAIL" / "I INDETERMINATE" / "I PASS" prefixes

All three fixed this tick:
- Doc references → probe-section-H.sh (3 occurrences)
- Probe script banner → "Section H"
- Probe echo lines → all "H OK" / "H FAIL" / "H INDETERMINATE" / "H PASS"
- Probe re-run: still PASS, now consistent end-to-end.

The bug is the pattern the rubric itself predicts: a section rename is a 2-place minimum job (Section H in doc + Section H filename in script + Section H echo prefixes = 4 places). Caught by the change itself, not by a probe — but the lesson is "before committing a section rename, grep all 4 places (filename, doc heading, doc body references, echo prefixes)".

## Test matrix (this tick)

| Check | Result |
| --- | --- |
| `bash .hermes/probe-section-H.sh` | PASS (9/9 sub-checks green, exit 0) |
| `bash .hermes/probe-section-G.sh` (Section G regression-check) | FAIL exit 1 — `G FAIL: tier-1=$150 intake=$330` (expected — pricing drift still open, awaiting founder decision) |
| `npm run check` (tsc) | green |
| `npm run test:intake` | 11/11 PASS |
| 4-screen smoke (home / booking / micro-offer / 404) | 200 / 200 / 200 / 404 |

## Live site state

- Live bundle hash: `main-BKU1Uoxy.js` (unchanged from turn-036)
- Live deployed sha: `c33755d` (turn-036)
- This turn's commit `d9d96b9` is docs-only; `docs/` excluded from CF Pages deploy workflow paths filter → no live deploy needed. Loop stays on turn-036's live state.
- Section G probe regression check on the live bundle → FAIL — confirms pricing drift is still open and the Section G rubric-extension from turn-038 is working as designed.

## Open state after this tick

- **Pricing drift still open** (`docs/PRICING-LADDER-DRIFT-2026-07-09.md`) — awaiting founder decision (chat 6829435996 or doc reply). Blocked. Loop will NOT ship pricing changes autonomously.
- **W5-PERSUADE** (`t_45ea76a8`, ready) — long-stale; needs founder direction before any persuasion work ships. Persuasion shape still locked: passive only.
- **BOARD-HANDOFF** (`t_90f2136f`, ready) — bootstrap record, no work needed.
- **New rubric (turn-039)**: 9 sections A-I, both probes wired + verified PASS on live bundle.

## Lessons (will append to learned.md)

1. **Section rename is a 4-place job, not a 2-place job.** Renaming a rubric section requires updating: (a) the doc heading, (b) the doc body references to the probe script, (c) the probe script's internal banner, (d) the probe script's echo prefixes. The Section G turn-038 lesson ("2-place minimum") was incomplete — Section H caught us because the probe script also has self-identifying text in 3 places.
2. **The Section H probe is the cheapest catch for Lighthouse regressions on a budget.** All 9 checks total <2s wall time on this Windows host, no chromium needed. Future LOOP-BOOT audits can include this probe as a 5th screen (after the 4 smoke screens) for ≤30s extra wall time.
3. **The Section G probe keeps doing its job** — this turn's regression run (`G FAIL: tier-1=$150 intake=$330`, exit 1) is the second tick in a row where the probe caught the open drift. Good signal that turn-038's rubric-extension fix is genuinely persistent.
4. **Docs-only commits don't need a CF Pages deploy.** `docs/` is in the workflow path filter exclusion list (confirmed in turn-028). Today's rubric extension doesn't touch src/ or scripts/, so CF Pages skipped the build → no 5min build lag → live site stays on turn-036.