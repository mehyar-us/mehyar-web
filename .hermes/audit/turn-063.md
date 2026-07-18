# turn-063 — Section H alias-renamed jsx() wrapper probe extension

**Date:** 2026-07-18
**Type:** docs-only ship (probe + python helper + negative test + rubric); no src/ change; no live deploy
**SHA:** <this-commit> on `mehyar-us/mehyar-web` main
**Live bundle:** unchanged `main-D9Djrf2D.js` (678,754 bytes) — verified via probe O at turn-063 start

## What happened

LOOP-BOOT probe sweep at the start of turn-063 re-ran Section H against the
live bundle, and the probe PASSed (49 landmarks, exit 0) — but the probe
script had accumulated in-progress WIP on disk from earlier in the day that
was not yet committed. Two untracked python helpers (`.hermes/probe-section-H-count-landmarks.py` + `.hermes/probe-section-H-count-landmarks-negative-test.py`) and a modified `.hermes/probe-section-H.sh` already on the working tree. Working-tree WIP per turn-050's `ship-the-WIP` lesson.

The WIP exists because turn-062's `jsx\(\"(tag)\"` regex (the JSX-direct-form
fix) was already correct on `main-p303-96M.js` (666,443 bytes, turn-062-era)
but a SECOND bundle roll landed between turn-062 and turn-063 — the new
`main-D9Djrf2D.js` (678,754 bytes) switched JSX emits from the bare-direct
form `jsx("tag")` to the alias-renamed wrapper `(0,X.jsx)("tag")`. This is
a minifier optimization that uses a numeric-index wrapper `(0, X.jsx)` to
call the `jsx` export without shadowing a local variable named `jsx`. The
turn-062 regex matched `jsx("tag")` but missed `(0,X.jsx)("tag")` once
the alias form landed — which would have re-FAILed Section H on the next
LOOP-BOOT run.

The in-progress WIP closed the gap before the regression had a chance to
fail. Same probe, same Section H rubric, same failure-mode catalog — but a
more robust regex (python-driven) that catches BOTH shapes in one pass.

## What was wrong / what changed

### `.hermes/probe-section-H.sh` (modified)
- Landmarks probe delegated from inline `grep -oE` to
  `python .hermes/probe-section-H-count-landmarks.py "$BUNDLE"`.
- Bash single-quote / alternation / backtick parsing for the new shape
  `(0,X.jsx)(\"tag\")` (where `X` is a single uppercase letter) is fragile
  across shell quote-stripping, so the canonical fix is to move the regex
  to python where regex literals are first-class.

### `.hermes/probe-section-H-count-landmarks.py` (NEW)
- Single regex union of (a) bare `jsx(\"tag\"|\`tag\`) and (b) alias
  `(0,X.jsx)(\"tag\"|\`tag\`).
- Optional opening quote handles the rare minifier case where the quote
  is omitted for single-word tag names.
- Returns integer count to stdout, exit 0 always.

### `.hermes/probe-section-H-count-landmarks-negative-test.py` (NEW)
- 5-case verification:
  1. Real bundle returns 49 (Section H design baseline)
  2. Synthetic shape (a) bare `jsx(\"tag\")` returns 6 (one of each landmark)
  3. Synthetic shape (b) alias `(0,N.jsx)(\"tag\")` returns 6
  4. Synthetic shape (c) alias `(0,N.jsx)(\`tag\`)` (backtick variant) returns 6
  5. Empty file returns 0; non-landmark file returns 0
- Verified all 5 cases at turn-063 boot. Probe-only docs-only ship, no
  side effects, safe to add to the loop's "run-on-every-tick" inventory.

### `docs/QA-MEHYARSOFT-B2B-BASELINE-2026-05-11.md` (modified)
- Section H "Today" cell updated to reflect new bundle + new counts:
  - 49 semantic landmarks (unchanged from turn-062, correct count on
    new bundle)
  - 63 aria-hidden (was 112 on the older bundle — count varies by
    bundle roll as minifier dead-code-eliminates unused icons)
  - 9 aria-label (was 6)
  - 4 sr-only (was 3)
  - bundle URL changed from `main-p303-96M.js` (turn-062) to
    `main-D9Djrf2D.js` (turn-063)
- Failure-mode catalog row 7 (added turn-062) updated with the
  turn-063 alias-form sub-finding: the alphabet can also flip from
  bare-direct `jsx(\"tag\")` to alias-renamed `(0,X.jsx)(\"tag\")` form,
  and the regex needs to handle both.

### `.gitignore` (modified)
- `.hermes/__pycache__/` added — repo-local python bytecode cache from
  the new helper. Same defensive pattern as `scripts/__pycache__/`
  (already gitignored).

## Verification

Pre-deploy local checks all green:

```
G FAIL exit 1 (founder-blocked, expected)         tier-1=$150 intake=$330
H PASS exit 0                                     49 landmarks, 63 aria-hidden, 9 aria-label, 4 sr-only
J PASS exit 0                                     8 src/→bundle assertions
K PASS exit 0                                     47 audit .md files on disk == 47 in git
L PASS exit 0                                     29 cited ticket-ids all resolve
M PASS exit 0                                     56 cited commit-SHAs all resolve
N PASS exit 0                                     9 cited docs/*.md paths all resolve
O PASS exit 0                                     live bundle auto-discovered, canonical across 4 routes
Q PASS exit 0                                     OPTIONS 2xx, POST 4xx, valid JSON envelope
tsc 0 errors
4-screen Phase-6: 200/200/200/200 (live /, /booking, /micro-offer, /404)
Negative test: 5/5 cases PASS (real 49, shape a 6, shape b 6, shape c 6, empty 0, no-landmark 0)
```

## State of the world

- Section G pricing-consistency drift: still founder-blocked, awaiting
  reply on `docs/PRICING-LADDER-DRIFT-2026-07-09.md` (turn-037 options
  A/B/C).
- W5-PERSUADE: still ready, founder reply needed on
  `docs/PERSUASION-PROPOSAL.md`.
- Section H: probe now self-heals across all known JSX-emit shapes
  (bare-direct `jsx(\"tag\")` + alias-renamed `(0,X.jsx)(\"tag\")` ×
  quote style {double, backtick, none}). Negative-test pair locks
  the contract.
- Live bundle rolled twice since turn-062 to `main-D9Djrf2D.js`
  (678,754 bytes); the new probe passes on the new bundle without
  further changes.
- Loop continues to ship docs-only probe-hygiene ticks while waiting
  on founder decisions. Cron activation still pending.
