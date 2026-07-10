# turn-047 — Section N negative-test bare-prose bug fix (cousin-probe lesson)

> First cousin-probe (Sections L/M/N) that needed a turn-2 fix. The
> same thing happened to Section M (the `abc12Z4` non-hex-character
> convention) and Section L (the synthetic ticket-id literal-strip),
> but those landed right the first time. Section N got caught by its
> own audit prose being written the natural way ("synthetic
> docs/NEGATIVE-TEST-N.md → exit 1") instead of inside backticks.
> Lesson: a probe's negative-test scenario should match the natural
> prose shape of how it would be DOCUMENTED, not just the probe's
> alphabet. Cheap docs-only tick.

## What shipped

- `.hermes/probe-section-N.sh` (+18 / -11) — added a second pre-grep
  `sed` filter that strips the negative-test path literal
  (`docs/NEGATIVE-TEST-N.md`) in addition to the existing backtick
  span strip. The two filters now run together:
  `sed -E 's/`[^`]*`//g; s|docs/NEGATIVE-TEST-N\.md||g'`. Updated
  the comment block to document WHY two filters (not one) — the
  Section N audit prose writes the negative-test path bare-prose
  (because the natural English sentence describing a negative-test
  scenario doesn't wrap a file path in backticks) so backtick-only
  stripping isn't enough.
- `docs/QA-MEHYARSOFT-B2B-BASELINE-2026-05-11.md` (+16 / -0) — added
  a new "Two pre-grep filters" implementation note to Section N
  documenting both filters and the turn-047-baked lesson: a cousin
  probe's negative-test strip has to match HOW the negative-test is
  documented in prose (backticks vs bare), not just to the probe's
  alphabet. Cross-references the Sections L (ticket-id structural-
  shape) and M (SHA inside-backticks) precedents.

## Bug details

The Section N probe's first run (turn-046) exited 1 with `docs/
NEGATIVE-TEST-N.md` flagged missing. The probe's grep was correct
— the file genuinely doesn't exist on disk. But the citation wasn't
real: it came from THIS tick's audit prose ("synthetic docs/
NEGATIVE-TEST-N.md → exit 1 → restore → exit 0") and from
state.md last_learned (same bare-prose description).

Section M solves this by (a) stripping inline-code spans and (b)
the convention "use a non-hex character in synthetic SHA prose so
the regex never matches." Section L solves it by stripping synthetic
ticket-id literals (`t_[a-f0-9]{8}`) via pre-grep sed — the same
pattern the Section N fix uses. Section N's first attempt only had
the backtick-strip (the Section M pattern), which works for SHAs
inside backticks but not for file paths documented bare-prose.

The fix: add the negative-test literal-strip (the Section L
pattern) alongside the backtick strip. Same idea Section M's
update-cadence note baked in for cousin probes ("add a cousin probe
following the same pattern") — but the pattern needs the negative-
test-strip matched to the prose shape, not just copied.

## Verified this tick

```
N PASS: 9 cited docs/*.md paths / 9 on disk (was FAIL on bare-
        prose NEGATIVE-TEST-N.md citation; now PASS after the
        two-filter fix)
N NEGATIVE-TEST ROUND-TRIP PASS:
  - inject docs/FAB-TEST-N.md citation → N FAIL exit 1 (catches)
  - restore state.md → N PASS exit 0
M PASS: 44 cited / 203 in git (regression unchanged)
L PASS: 28 cited / 50 in DB (regression unchanged)
K FAIL: 32 audit .md on disk / 31 in git (orphan turn-046.md will
        close on commit; expected pre-commit state)
G FAIL: tier-1=$150 intake=$330 (expected, founder-decision-blocked)
H PASS, J PASS
```

## What this tick does NOT change

- Live site state: no deploy. CF Pages stays at turn-036 c33755d /
  main-BKU1Uoxy.js. Docs-only tick.
- Funnel counters, voice, build gates, anti-slop: all unchanged.
- All 50 mehyar-us kanban tickets: 48 done, 2 ready. No new tickets
  this tick — the Section N bug fix itself is the deliverable.

## Lesson

A cousin probe (Section L → M → N all share the `grep + sort + comm`
shape) gets its negative-test strip right the first time only if the
strip is matched to HOW the negative-test scenario is naturally
described in prose, not just to the probe's regex alphabet. SHAs
(7-char hex) → backtick-only strip works because synthetic SHAs in
prose go inside backticks. Ticket-ids (`t_xxxxxxxx` shape) →
structural-strip works because the shape is unique. File paths (no
unique structural shape, sometimes bare-prose) → both backtick-
strip AND literal-strip of the negative-test path. The audit prose
should naturally mention the negative-test ("synthetic docs/X.md →
exit 1 → restore → exit 0") without contorting itself to fit inside
backticks; the probe should accommodate the natural shape, not the
other way around.