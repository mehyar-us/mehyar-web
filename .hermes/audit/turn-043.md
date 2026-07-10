# turn-043 audit — Section L Open-ticket-id-reference probe

**Date:** 2026-07-10
**Type:** docs-only
**Commit:** 5b1809f (github main)
**CF Pages deploy:** none (docs-only — no src/, no build, no bundle change)
**Live bundle:** main-BKU1Uoxy.js (unchanged from turn-036)

## What shipped

- `.hermes/probe-section-L.sh` (+141 new) — Open-ticket-id-reference probe.
- `docs/QA-MEHYARSOFT-B2B-BASELINE-2026-05-11.md` grew 11→12 sections (A-L). New Section L is the rubric entry.
- `docs/VISION.md` diary line appended (turn-043 record).

## Probe behaviour

```
$ bash .hermes/probe-section-L.sh
=== L Open-ticket-id-reference probe (turn-043 new check) ===
cited ticket-ids in state/docs/audit: 28
ticket-ids in mehyar-us kanban DB:    47
L PASS: all 28 cited ticket-ids resolve to real DB rows (drift closed)
exit=0
```

## Negative-test (synthetic drift injection)

```
# Append a fabricated ticket id
$ echo "negative test ref t_ffffffff" >> .hermes/state.md
$ bash .hermes/probe-section-L.sh
=== L Open-ticket-id-reference probe (turn-043 new check) ===
cited ticket-ids in state/docs/audit: 29
ticket-ids in mehyar-us kanban DB:    47
L FAIL: stale ticket-id citations in state/docs/audit (id cited but missing from DB):
  - t_ffffffff
  Fix: either restore the ticket to the mehyar-us board, OR remove the citation from state.md/docs/audit/learned.
exit=1

# Restore state.md
$ mv .hermes/state.md.bak .hermes/state.md
$ bash .hermes/probe-section-L.sh
L PASS: all 28 cited ticket-ids resolve to real DB rows (drift closed)
exit=0
```

Bidirectional: ✓ forward direction (cited but not in DB) catches the bug. Reverse (in DB but not cited) is informational only — most open tickets aren't cited anywhere; that's normal.

## What did NOT change

- Live site (no CF Pages deploy).
- src/ tree.
- Bundle (main-BKU1Uoxy.js, 574085 bytes).
- Pricing drift (Section G still FAIL exit 1 — tier-1=$150 intake=$330, founder-decision-blocked).
- Open kanban tickets (W5-PERSUADE t_45ea76a8 ready, BOARD-HANDOFF t_90f2136f ready).
- Vision doc positioning / 6-tier offer ladder / anti-slop blacklist / brand voice.
- Cron wiring (still off; user said "explain first, then together").

## Verification matrix (turn-043)

| check | result |
|---|---|
| `tsc` | green |
| `test:intake` | 11/11 |
| 4-screen Phase-6 (home / /booking / /microoffer / /404) | 200/308/308/404 |
| Section G probe (pricing) | FAIL exit 1 (expected — founder decision pending) |
| Section H probe (a11y) | 9/9 PASS |
| Section J probe (build-integrity) | 9/9 PASS |
| Section K probe (audit-trail) | 28/28 PASS |
| **Section L probe (ticket-id)** | **28 cited / 47 in DB PASS exit 0** |
| Voice score | 5/5 unchanged |
| Anti-slop hits (local + live) | 0 |

## Lesson (also in learned.md)

Identifier-reference drift (Section L) is a different class from file-level drift (Sections G/H/J/K). The two together cover most "user re-verifies on receipt, finds the citation is a lie" failure modes. The cheapest implementation is python stdlib sqlite3 against the mehyar-us DB — no extra deps, no CLI required. The "in-db but never cited is informational, not failure" asymmetry is the right call: open tickets not appearing in state.md is normal; only the reverse (cited but missing) is a fabrication-class bug.

## Next rubric extension candidate (M)

Commit-SHA reference correctness — assert every commit-sha cited in state.md / VISION.md / audit actually exists in `git log`. Catches the cousin class of stale SHA references (turn-039 and turn-042 both backfilled SHAs across multiple files). Same python stdlib + temp-file pattern as Section L.