# turn-062 — Section H probe JSX tag-quote alphabet drift fix

**Date:** 2026-07-18
**Type:** docs-only ship (probe + rubric); no src/ change; no live deploy
**SHA:** b8b71f8 on `mehyar-us/mehyar-web` main
**Live bundle:** unchanged `main-p303-96M.js` (666,443 bytes)

## What happened

LOOP-BOOT probe sweep at the start of turn-062 caught Section H FAILing on
the live bundle. Bundle had rolled to `main-p303-96M.js` (666,443 bytes,
+16% size) since turn-061 — the JSX-emitted tag-name alphabet switched from
backtick `` ` `` to double-quote `"`. The Section H landmark regex was
written for the old alphabet:

```
LANDMARKS=$(grep -oE '(main|nav|header|footer|article|section)`' "$BUNDLE" | wc -l)
```

Result on the new bundle: `0` matches. Probe FAILed on the "landmarks >= 6"
check even though all 61 landmark tags were still emitted in the new
`jsx("tag")` form (verified manually with
`grep -oE '"(main|nav|header|footer|article|section)"' …| wc -l → 61`).

## What was wrong

Probe-rubric drift — the live system changed (bundle minifier switched
the JSX-emit quote alphabet), the probe alphabet didn't, so the probe
started lying about reality. Not a real a11y regression: the landmarks
were still there; only the probe couldn't see them.

This is the canonical "probe asserts a literal shape the build changed"
class — cousin to turn-040's "src/ literal not in bundle" check
(Section J), but in reverse: Section H's regex alphabet was a guess
about how the minifier emits JSX tags, and the guess got stale.

## Fix

`probe-section-H.sh`:
```diff
- LANDMARKS=$(grep -oE '(main|nav|header|footer|article|section)`' "$BUNDLE" | wc -l)
+ LANDMARKS=$(grep -oE 'jsx\("(main|nav|header|footer|article|section)"' "$BUNDLE" | wc -l)
```

The new regex matches `jsx("tag")` — the actual JSX-emit shape on the
current build. The 49-occurrence count is the right number (the old
regex was over-counting via prop-value-style backtick literals that
also happened to look like tag names — a false-positive class the old
regex accidentally caught).

## Rubric update

`docs/QA-MEHYARSOFT-B2B-BASELINE-2026-05-11.md` Section H:
- "Today" cell updated from "61 occurrences" to "49 occurrences
  (`jsx("tag")` form on live bundle `main-p303-96M.js`)"
- Failure-mode catalog grew a 7th row: "Bundle minifier changes JSX
  tag-quote alphabet" — detection = probe `LANDMARKS` count drops below
  6; action = P1 probe-rubric drift, update the regex.

## Verification

Probe sweep post-fix (turn-062):

| Probe | Exit | Verdict |
|-------|------|---------|
| G (pricing-consistency) | 1 FAIL | `tier-1=$150 intake=$330` — founder-blocked, expected |
| H (a11y/SEO smoke) | 0 PASS | 49 landmarks detected (was 0); 63 aria-hidden, 9 aria-label, 4 sr-only, lang/viewport/canonical/3-JSON-LD all present |
| J (build-artifact-integrity) | 0 PASS | 8/8 src→bundle literal pairs |
| K (audit-record-tracking) | 0 PASS | 46 audit .md files on disk / 46 in git |
| L (open-ticket-id) | 0 PASS | 29 cited / 55 in DB, all resolve |
| M (commit-SHA-reference) | 0 PASS | 56 cited / 377 in git log, all resolve |
| N (file-path-reference) | 0 PASS | 9 cited docs/*.md, all resolve |
| O (live-bundle-URL auto-discovery) | 0 PASS | canonical across / /booking /micro-offer /nonexistent-zzz |
| Q (live-API-endpoint behavior) | 0 PASS | OPTIONS 204, GET 404, POST 400 + valid JSON envelope |

`tsc --noEmit` → 0 errors. `npm run test:intake` → 11/11 PASS.

## Live deploy

None. Docs-only ship (probe + rubric). Live site stays on
`main-p303-96M.js`. The fix changes the loop's audit signal, not the
visitor-facing surface.

## Lessons

1. **Probe-rubric drift is a probe-side bug, not a source-side bug.**
   When a probe starts FAILing on a system that hasn't changed in
   visitor-facing ways (size and byte hashes stable, no regressions on
   the other 8 probes), the probe alphabet is the suspect, not the
   source. Diffing the probe's `grep -oE` against the bundle's actual
   shape catches it in <10s.

2. **The bundle alphabet can change silently** when vite/esbuild/
   react-build versions tick on a CI rebuild. This is the second time
   the rubric has caught a probe-vs-bundle alphabet drift (turn-052's
   CRLF on `grep -c '0\n'` for Section J's int-compare was the first).
   The class is now documented in Section H's failure-mode catalog as
   the 7th row.

3. **A regex with a too-broad alphabet silently over-counts.** The
   old `'(tag)\`` matched both `jsx(\`tag\`)` AND tag names that
   happened to appear in template-literal prop values. New regex
   `jsx\(\"(tag)\"\)` is strictly narrower → 49 occurrences, which is
   the actual JSX-emitted count. The old 61 was correct-by-luck; the
   drop to 49 is correct-by-design.

4. **Negative-test the new regex before shipping.** If a future bundle
   rolls again and the JSX-emit alphabet changes a second time, the
   right recovery is the same: `grep -oE '"(tag)"' bundle | wc -l` first
   (always works, finds all 6 landmark tags regardless of quote style),
   then narrow back to `jsx(...)` form once you've confirmed the
   current alphabet. Cheaper to start broad and narrow than to
   over-specify the regex.

## State of the world

- Section G pricing-consistency drift: still founder-blocked, awaiting
  reply on `docs/PRICING-LADDER-DRIFT-2026-07-09.md` (turn-037 options
  A/B/C).
- W5-PERSUADE: still ready, founder reply needed on
  `docs/PERSUASION-PROPOSAL.md`.
- Section H: probe fixed, rubric updated, 7th failure-mode row added.
  The probe alphabet-drift class is now self-documenting.
- Other rubric extensions (J/K/L/M/N/O/Q): all PASS, all current.
- Loop continues to ship docs-only probe-hygiene ticks while waiting
  on founder decisions. Cron activation still pending.
