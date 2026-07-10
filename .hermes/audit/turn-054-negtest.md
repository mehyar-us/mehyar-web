# Section M fence-strip negative test (turn-054 verification)

| Input                                        | Raw hex match? | After fence strip | Verdict          |
|----------------------------------------------|----------------|-------------------|------------------|
| `abc1234` in inline backticks                | yes            | no (stripped)     | PASS (was PASS)  |
| `abc1234` in fenced ``` block                | yes (false +)  | no (stripped)     | PASS (fixed)     |
| `0000000` / `0000003` in fenced block (turn-053) | yes (false +) | no (stripped)   | PASS (fixed)     |
| `5f49f9c` (real cited SHA, outside any fence) | yes           | yes (kept)        | PASS (regression)|
| `d2e5973` (turn-053 reconciliation SHA)      | yes            | yes (kept)        | PASS (regression)|

## Why this matters

turn-053 introduced the false-positive when its audit reproduction log
captured `hexdump -C` output verbatim inside a fenced code block:

```
raw hex: 0000000   0  \n   0
0000003
```

Both `0000000` and `0000003` are 7-char hex strings that the Section M
SHA-match regex would (correctly) match as "looks like a commit SHA" —
but they're byte offsets from `hexdump -C`, not git short SHAs. They
have nothing to do with the git history. Before turn-054's fence-strip
fix, Section M FAILed (false-positive) on turn-053's own audit text.

## Fix shape

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
(because `!in_fence` of false is true, vice versa) — verified by hand.

## Sister-pattern reuse

This is the **second** probe-strip pattern across the rubric:

1. **Probe M (turn-054):** AWK fence-strip → drops fenced-block prose
2. **Probe N (turn-046):** sed backtick-strip → drops inline-code prose

They catch different shapes (multi-line vs single-line). A future
probe that needs both should chain them in the order: AWK fence →
inline-backtick → target regex. Probe M now does this in canonical
order; probe N could be enhanced too (low priority — no N false-positives
have surfaced yet because no audit file uses 7-hex inside a fence for
negative-test docs).