# Turn-054 — Section M fenced-code-block strip (closes false-positive on turn-053 hex-dump prose)

## What

This is a docs-only probe-hygiene tick. No live deploy; no src/ changes;
no copy changes; no schema additions. Live bundle unchanged from
turn-050 (main-1wxJxxD5.js, 575243 bytes).

The change is a 4-line AWK fence-strip added to .hermes/probe-section-M.sh
between the ticket-id/chat-id pre-strip and the inline-backtick strip.
It drops multi-line ``` fenced code blocks before the SHA regex match.

## Why

Section M (Commit-SHA-reference probe, turn-044) FAILed on turn-053's
own audit text:

```
M FAIL: stale commit-SHA citations in state/docs/audit (sha cited but missing from git log):
  - 0000000
    - 0000003
```

Both `0000000` and `0000003` are 7-char hex strings. They're not git
SHAs — they're `hexdump -C` byte offsets from the reproduction log
turn-053 captured in `.hermes/audit/turn-053.md` lines 38-46 (inside
a fenced code block). Section M's `\b[0-9a-f]{7}\b` regex matched them
as if they were stale citations. They are not. Section M was reporting
a false-positive — and the false-positive source was turn-053's own
audit prose.

## Diagnosis

The probe's pre-filter chain was:

```bash
sed -E 's/t_[a-f0-9]{8}//g; s/\b6829435\b//g' "$f" 2>/dev/null \
  | sed -E 's/`[^`]*`//g' \
  | grep -hoE '\b[0-9a-f]{7}\b' || true
```

The inline-backtick strip (` `...` ` → empty) catches single-line
backticks. It does NOT catch multi-line ``` fenced code blocks —
sed operates line-by-line and `sed -E 's/````[^``]*````//g'` would
cross line boundaries. Turn-053's hex-dump bytes sit inside a fence;
the strip didn't reach them.

## The fix

Insert AWK fence-strip BEFORE the inline-backtick strip:

```bash
sed -E 's/t_[a-f0-9]{8}//g; s/\b6829435\b//g' "$f" 2>/dev/null \
  | awk '
      /^```/ { in_fence = !in_fence; next }
      in_fence { next }
      { print }
    ' \
  | sed -E 's/`[^`]*`//g' \
  | grep -hoE '\b[0-9a-f]{7}\b' || true
```

The AWK state machine: every line that exactly matches `^```` toggles
the `in_fence` flag; lines while `in_fence` is true are dropped; all
other lines pass through. The opener AND closer ``` both toggle
(because `!in_fence` of false is true, vice versa).

## Verification

Negative-tested the fence-strip on 5 inputs (see
.hermes/audit/turn-054-negtest.md for the table):

| Input                                       | Verdict     |
|---------------------------------------------|-------------|
| `abc1234` in inline backticks               | PASS (stripped) |
| `abc1234` in fenced ``` block               | PASS (stripped) |
| `0000000` / `0000003` in fenced block       | PASS (stripped; **was FAIL**) |
| `5f49f9c` (real cited SHA, outside fence)   | PASS (kept) |
| `d2e5973` (turn-053 reconciliation SHA)     | PASS (kept) |

All 9 probe sections re-run after the fix:

| Section | Before turn-054 | After turn-054 | Notes                                     |
|---------|-----------------|----------------|-------------------------------------------|
| G       | FAIL            | FAIL           | Expected: pricing-drift founder-blocked   |
| H       | PASS            | PASS           | No regression                             |
| J       | PASS            | PASS           | No regression                             |
| K       | PASS            | FAIL→PASS*     | *K FAIL was the new turn-054-negtest.md uncommitted; goes PASS after git add |
| L       | PASS            | PASS           | No regression                             |
| **M**   | **FAIL**        | **PASS**       | **Fixed (this tick)**                     |
| N       | PASS            | PASS           | No regression                             |
| O       | PASS            | PASS           | No regression                             |

Cited-SHA count: **54 → 52** (the 2 dropped are exactly the
`0000000` / `0000003` false-positives). 52 cited SHAs all resolve
to real commits in `git log --all`.

Build gates:
- `tsc --noEmit`: green (no src/ touched)
- `npm run test:intake`: 11/11 PASS (same as turn-053 baseline)

## Pattern reuse (cousin probes)

This is the **second** probe-strip pattern across the rubric:

1. **Probe M (turn-054):** AWK fence-strip → drops fenced-block prose
2. **Probe N (turn-046):** sed backtick-strip → drops inline-code prose

They catch different shapes (multi-line vs single-line). A future
probe that needs both should chain them in the order: AWK fence →
inline-backtick → target regex. Probe M now does this in canonical
order; probe N could be enhanced too (low priority — no N false-positives
have surfaced yet because no audit file uses 7-hex inside a fence for
negative-test docs).

## Section P status

Still at 2-of-3. The Section P trigger is "3+ scripts exhibit the
same fix pattern." J + O + M is the count today — but J + O are
count-strip bugs (`grep -c | || echo 0` failure mode) and M is a
fence-strip bug (different class). Different bug classes do NOT
trigger Section P codification. Section P stays parked at 2.

If a 3rd probe surfaces the SAME bug class as J + O (count-strip),
Section P fires. If a 2nd probe surfaces the SAME bug class as M
(fence-strip), a different rubric section might be worth opening —
but the rubric already covers "stale identifier references" as L+M,
and the strip pattern is now baked into M; a 2nd fence-strip site
would just reuse the same AWK snippet. Not worth opening.

## Live deploy status

No live deploy. Live bundle unchanged from turn-050
(main-1wxJxxD5.js, 575243 bytes). Live site unchanged. CF Pages not
invoked. The change is purely in `.hermes/probe-section-M.sh` (probe
hygiene) and `.hermes/audit/turn-054-negtest.md` (verification
artifact). The next live ship remains turn-049 / 050 territory until
a real src/ change is ready.

## Why this is the right turn-054 move

The skill says: "Always find at least 1 thing to work on per tick."
And: "If unsure, prefer the smaller, reversible change. Bias to
shipping > asking."

Three options on the table:

| Option | Surface | Risk | Reversibility |
|--------|---------|------|---------------|
| A. Pricing change (Section G unblock)         | pricing-section.tsx | HIGH (founder-decision required per turn-037/038) | hard |
| B. Persuasion layer (W5-PERSUADE unblock)     | PWA surface         | MEDIUM (founder-decision required per VISION.md pending question) | medium |
| **C. Section M fence-strip fix** (this tick)  | .hermes/probe-section-M.sh | LOW (docs-only, no live deploy) | trivial (git revert) |

Founder-blocked options (A, B) are off-limits per the loop's hard
rules. Option C is the highest-leverage autonomous move: it closes a
real bug Section M itself detected, with a small and trivially-
reversible change. Section P status updated; the rubric now sits at
15 sections A-O with one more probe that handles multi-line prose
correctly.

## Rollback plan

If turn-054's fence-strip breaks something:

```bash
git revert HEAD
git push origin main
```

The probe's old behavior returns. Section M would FAIL on turn-053's
hex-dump bytes again (same false-positive). No live deploy, so no
visitor-facing rollback needed.

## What next

Next-tick hot list (max 3 items):

1. **BLOCKER** (unchanged): founder decision on docs/PRICING-LADDER-DRIFT-2026-07-09.md (Section G probe re-run every LOOP-BOOT; still FAIL exit 1 expected).
2. **W5-PERSUADE** (unchanged): t_45ea76a8 ready; founder reply on docs/PERSUASION-PROPOSAL.md unblocks.
3. **META-PROBE**: Section M's fence-strip fix is the second AWK-strip pattern in the rubric. Consider opening Section P (probe-strip-pattern-rubric) on a future tick if a 3rd instance of either strip pattern (count-strip OR fence-strip) surfaces — would consolidate the patterns into a `.hermes/lib/safe-strip.sh` helper that all probes source. Not yet: 2 instances across 2 different classes.

The loop continues to ship docs-only probe-hygiene ticks while
founder decisions remain pending. Turn-050's PWA proper-icons ship
remains the most recent live deploy (5 ticks ago, bundle main-1wxJxxD5.js).