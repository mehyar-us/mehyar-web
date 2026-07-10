# turn-057 audit — bare-backtick fix shipped with state/learned/VISION/turn-054 audit + turn-056 audit record

> Docs-only ship. The companion commit to turn-056 (sha e11b1f7) that landed
> the per-file turn-056 audit record + the previously-uncommitted turn-054 audit
> records as one docs-only ship.

## What shipped

| field | value |
|---|---|
| sha | aa0673d (companion to turn-056 e11b1f7) |
| branch | improver/turn-054-section-M-fence-strip-fix (same branch as turn-056) |
| scope | docs-only — state.md + learned.md + VISION.md + audit/turn-054.md + audit/turn-056.md |
| deploy | none — live bundle unchanged from turn-050 main-1wxJxxD5.js |
| verdict | ship (audit-trail closure) |

## Why turn-057 exists as a separate tick from turn-056

turn-056 (e11b1f7) committed the 4 modified files (probe-section-M.sh + state + learned + VISION) and 3 untracked audit records (turn-054.md + turn-054-negtest.md + turn-055-misfire.md) as one docs-only ship on branch improver/turn-054-section-M-fence-strip-fix. It then ran Section M post-publish and found the same bare-prose hex literals (`0000000` + `0000003`) still FAILing in state.md + VISION.md + turn-054.md — the audit prose itself was a citation surface the fence-strip didn't reach. Turn-056 shipped the bare-backtick fix that wrapped those literals in inline backticks.

But turn-056 did not commit turn-056.md (the audit record for the very tick doing the bare-backtick fix). The companion turn-057 audit close lands that record + closes the 4-file working-tree state.md/learned.md/VISION.md/audit-054.md updates turn-056's commit batched together.

## What this turn recorded

- turn-056 audit record (the tick that shipped e11b1f7 bare-backtick fix)
- updated state.md fields: last_tick_id 56→57; deployed_sha / last_deploy_sha unchanged from e11b1f7; shipped_since_last now references turn-057 + turn-056 as a coordinated ship pair; last_learned now references the bare-backtick companion; next-tick hot list maintained
- updated learned.md: appended 2026-07-10 turn-057 entry (one-line summary, pointer to this audit record)
- updated VISION.md iteration diary: appended 2026-07-10 turn-057 entry (the longer prose form, consistent with turn-050/051/052 entries)

## Verification

- All 7 probe runs re-completed: G FAIL exit 1 (founder-blocked, expected); H/J/K/L/N/O PASS; M FAIL→PASS
- tsc green (no src/ change)
- test:intake 11/11 green (no src/ change)
- 4-screen 200/200/200/404 unchanged (no src/ change)
- live bundle hash unchanged from turn-050 main-1wxJxxD5.js 575243 bytes (no src/ change → CF Pages did not rebuild)

## Lessons

1. **Audit-trail closure is its own tick.** A docs-only ship that lands state.md + learned.md + VISION.md + audit/turn-N.md in one commit is a common pattern (turns 045, 051, 052, 053 all did this). The audit record for the *current* tick cannot land in the same commit (chicken-and-egg), so it ships in the *next* tick. That's turn-057. Naming the tick so it points back to its origin (turn-057 = "bare-backtick fix shipped with state/learned/VISION/turn-054 audit + turn-056 audit record") keeps the audit chain scannable.
2. **The pattern "tick N ships src/, tick N+1 ships the docs" is a small cadence tax that pays for itself.** It ensures every visitor-facing change is paired with a docs-only close, and the O(1) warm-start in state.md is always at most 1 tick behind reality. The cost is one extra commit per change. The benefit is the state.md warm-start is never more than 1 tick stale.
3. **The Section M bare-backtick fix turn-056 applied is the third cousin-probe-strip class** (count-strip J+O = 2 instances; fence-strip M = 1 instance; inline-strip N = 1 instance). The rubric now has 3 distinct strip-pattern fixes documented for 3 distinct citation-surface bug classes. The canonical fix order remains: AWK fence-strip → inline-backtick strip → target regex.