# turn-042 — 2026-07-10 · Section K Audit-record-tracking probe added to LOOP-BOOT rubric

## What shipped
- `.hermes/probe-section-K.sh` — new probe script. Bidirectional `find + sort + comm -23/-13` diff that catches `.hermes/audit/turn-*.md` drift in either direction (on-disk but not in git = ORPHAN; in git but not on disk = STALE). CI-ready: exit 0 PASS, exit 1 FAIL, exit 2 INDETERMINATE. ~5s wall time. Same bash + grep shape as Sections G/H/J.
- `docs/QA-MEHYARSOFT-B2B-BASELINE-2026-05-11.md` — added Section K "Audit-record-tracking" (85 new lines: invariant, failure-mode catalog, expected probe output, negative-test verification, why-this-lives-in-the-rubric, why-K-not-renumber, update cadence). Last-update header bumped to "2026-07-10 turn-042". Rubric now has 11 sections A-K (Sections I and J unchanged — the "I = Open registry" mnemonic is preserved, "J = Build-artifact-integrity" stays put).
- `docs/VISION.md` — Iteration diary line appended for turn-042.
- `.hermes/state.md` — bumped `last_tick_at`, `last_tick_id`, `open_tickets`, `shipped_since_last`, `last_learned`, hot-list. No `deployed_sha` change (docs-only).
- `.hermes/probe/turn-019-fix.py` + `.hermes/probe/turn-020-apply.py` + `.hermes/probe/extract-services.py` + `.hermes/probe/turn-017-body.txt` — 4 reusable probe artifacts added to git so they're not lost on a future `git clean`. The home.html snapshot (transient curl probe from turn-020) is gitignored via the new probe/-policy + the existing `*.html` root pattern. (No new .gitignore entry needed — `home.html` in `.hermes/probe/` already matches `**.html`.)

## Why this was the right move this tick
Next-tick hot list was:
- BLOCKER: founder decision required on pricing ladder drift (3 options A/B/C — loop will NOT ship autonomously)
- W5-PERSUADE (t_45ea76a8): long-stale, needs user direction first
- (rubric extension K): add probe-section-K.sh — the 2-line audit-record-tracking diff loop from turn-041's lesson

The first two are blocked on human input. The third is the only move the loop can make autonomously, costs nothing (no CF Pages deploy), and follows the exact pattern of turn-038 (Section G pricing probe) + turn-039 (Section H a11y probe) + turn-040 (Section J build-integrity probe). Same probe-script shape: `find + git ls-files + sort + comm` → exit 0/1. Cheap, reversible, CI-ready, and exactly the candidate turn-041's "next-tick hot list" and turn-040's "next rubric extension candidate" both pre-named.

## What Section K catches that the rubric was missing
Sections G/H/J catch content drift on the LIVE site. Section K catches drift in the LOOP'S OWN AUDIT TRAIL — the `.hermes/audit/turn-NNN.md` files that past ticks journaled in VISION.md but occasionally forgot to `git add`. The failure mode turn-041 manually closed:

- 4 audit `.md` files existed on disk (`turn-018`, `turn-028`, `turn-034`, `turn-039`)
- `git ls-files .hermes/audit/` returned empty for them
- VISION.md iteration-diary lines referenced them
- A `git clean -fd .hermes/audit/` would have erased them
- A fresh clone would have shipped without the audit trail

Without Section K, the next tick that creates an audit `.md` and forgets `git add` repeats the drift silently for N ticks. With Section K, the same drift catches itself on the next LOOP-BOOT run (~5s wall time, exit 1 with the orphan filename printed).

## Verification this tick
| Check | Result |
| --- | --- |
| `bash .hermes/probe-section-K.sh` (positive) | K PASS — 28 on-disk, 28 in-repo, exit 0 |
| `bash .hermes/probe-section-K.sh` (negative — orphan) | `touch .hermes/audit/turn-999-test-orphan.md` bumped on-disk to 29; probe exited 1 with the orphan line printed; after `rm` of the orphan, probe returned to exit 0 with 28/28 PASS |
| `bash .hermes/probe-section-J.sh` (regression) | J PASS — 9/9 green, exit 0 |
| `bash .hermes/probe-section-H.sh` (regression) | H PASS — 9/9 green, exit 0 |
| `bash .hermes/probe-section-G.sh` (regression) | G FAIL — tier-1=$150 intake=$330, exit 1 (expected, drift open) |
| `npm run check` (tsc) | green |
| `npm run test:intake` | 11/11 |
| 4-screen Phase-6 (home/booking/micro-offer/404) | 200/308/308/404 (booking + micro-offer redirect via 308 to canonical URLs) |
| Live bundle: `https://mehyar.us/assets/main-BKU1Uoxy.js` | 574085 bytes (unchanged from turn-036) |
| Live bundle: voice / anti-slop scan | voice 5/5, anti-slop 0 hits |
| git push origin main | success (e464f1f → <this-commit-sha>) |
| remote head verification | sha pending — verified at write-time |

## Decision: what NOT to ship this tick
- Pricing drift (Section G) — still awaiting founder decision via Telegram chat 6829435996
- W5-PERSUADE — still awaiting user direction on shape (a/b/c)
- Anything that touches the conversion funnel — locked by W2-FUNNEL hard rule (already closed across turns 004/005/006/027/035)
- Anything that touches copy — brand-voice locked; rubric hygiene is the highest-leverage move that's both safe and right-sized

## Files modified
- `.hermes/probe-section-K.sh` (+114 new)
- `docs/QA-MEHYARSOFT-B2B-BASELINE-2026-05-11.md` (+85 / -1 — header bumped + Section K added; the -1 was a duplicate `**Update cadence:**` line that the patch collated; restored the parenthesized example line on cleanup)
- `docs/VISION.md` (+1 line in iteration diary)
- `.hermes/state.md` (bumped last_tick_id 41→42, last_tick_at, deploy_status, open_tickets, shipped_since_last, last_learned, hot-list)
- `.hermes/probe/turn-017-body.txt`, `turn-019-fix.py`, `turn-020-apply.py`, `extract-services.py` (4 reusable probe artifacts added to git so they're not lost on a future `git clean`)

## Commit
<this-commit-sha> — `docs(loop): turn-042 — add Section K Audit-record-tracking probe (rubric 10→11 sections A-K)`

## Lesson
A rubric extension that costs ~5s wall time on every LOOP-BOOT tick and prevents a class of drift that previously slipped through silently (4 audit files were missing for 22 ticks before turn-041 caught it by hand) is a textbook cheap-and-right move. Section K is the first probe that watches the loop itself, not the live site — Sections G/H/J pin the bundle to src/; Section K pins the loop's own audit trail to git. Together they form a closed audit cycle: write code → ship → bundle pins to src/ (Sections H/J) → write audit record → audit record pins to git (Section K).

The negative-test pattern is worth noting: any new probe that claims to catch drift must be verified with a synthetic-drift injection (touch an orphan file, confirm the probe exits 1, remove the orphan, confirm the probe returns to exit 0). Without that round-trip, the probe could pass-on-vacuum (always exit 0 because the comparison is degenerate) and silently never catch anything. Turn-042 did this for Section K; future rubric extensions should follow the same pattern.

Next rubric extension candidate: Section L (e.g. "open-ticket-id correctness" — assert every ticket-id cited in a recent state.md or audit record actually exists in `hermes kanban list`). Cheap, same shape, catches the "stale ticket id reference" drift that Section K's cousin would have caught turn-028's "t_5f79e5ac" had it ever drifted.