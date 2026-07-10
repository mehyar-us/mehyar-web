# turn-053 — fix(loop): probe-section-O CRLF-safe count (closes turn-052 latent bug class)

**Commit:** `e5ee4e7` on github main (pushed; live site unchanged — docs-only ship)
**Tick:** 53 (2026-07-10)
**Live bundle:** unchanged from turn-050 `main-1wxJxxD5.js` (575243 bytes, canonical across 4 routes per Section O probe)

## What shipped

A 1-file, +16/-3 patch to `.hermes/probe-section-O.sh` step 5 that closes the
**same** `grep -c | || echo 0` bug class turn-052 documented as a latent
defect in probe-section-J.sh. The hot list flagged Section P (CRLF-on-Windows
hardening rubric) as a candidate "only if 3+ scripts exhibit the same fix
pattern"; this tick found that the bug already lives on probe-section-O
itself — and fixed it directly without opening Section P (which would have
been premature at 2-instances-not-3).

## The bug (recap)

The original probe-section-O step 5 was:

```bash
SKIP_LITERAL_COUNT=$(grep -c -F -- "Skip to the" "$DISCOVERY_BUNDLE" 2>/dev/null || echo 0)
if [ "$SKIP_LITERAL_COUNT" -lt 1 ]; then
  ...
```

Two failure modes, both reproducible in this tick's verification:

1. **`|| echo 0` is dead.** `grep -c` exits 0 when count=0 (success with zero
   matches). The fallback never fires.
2. **`grep -c` emits `<n>\n`.** Even on LF-only input, the variable holds
   `"0\n0"` after the dead fallback, and bash's `[ "$var" -lt 1 ]` throws
   `integer expression expected` instead of cleanly FAILing.

**Reproduction this tick** (see `/tmp/test-j-bug.sh`):

```
raw count: |0
0| (len 3)
raw hex: 0000000   0  \n   0
0000003
C:/tmp/test-j-bug.sh: line 8: [: 0
0: integer expression expected
FAIL: 0
0
```

The probe currently PASSes in production because the `Skip to the` literal
always ships in the canonical bundle. The bug is **latent** — it would fire
the moment a future bundle-roll drops the skip-link (unlikely) or the
discovery regex matches a non-main-JS resource that doesn't carry the
literal. When that happens, the probe would emit `integer expression
expected` to stderr instead of the actionable `O FAIL: discovered bundle
has no 'Skip to the' literal` message.

## The fix

```bash
SKIP_LITERAL_COUNT=$(grep -c -F -- "Skip to the" "$DISCOVERY_BUNDLE" 2>/dev/null | head -1 | tr -d ' \t\r\n')
SKIP_LITERAL_COUNT=${SKIP_LITERAL_COUNT:-0}
if [ "$SKIP_LITERAL_COUNT" -lt 1 ]; then
  echo "O FAIL: discovered bundle has no 'Skip to the' literal (not the main JS bundle?)"
  ...
```

Three changes:

1. **`head -1`** — guards against any future pipe that returns multiple lines.
2. **`tr -d ' \t\r\n'`** — strips the trailing newline AND any CR (for CRLF
   inputs) AND any spaces or tabs (for misaligned grep output). Bash's `$(...)`
   doesn't strip CR automatically when piped through `tr` in this MSYS shell,
   so explicit strip is the safe move.
3. **No `|| echo 0` fallback** — `head -1` always returns at least one line,
   and `tr -d` on an empty string returns empty (covered by `${var:-0}`).

This matches the canonical pattern probe-section-J.sh has used since
turn-052 — same idiom, same defensive stripping, same `${var:-0}` default.
Two probes now share the pattern; the third instance that would have
triggered Section P (per the hot list's "3+ scripts" criterion) has not
yet surfaced.

## Verification

Negative-tested the fix on three inputs via `/tmp/test-count-pattern.sh`:

| Input | Raw count | After fix | Verdict |
|---|---|---|---|
| Empty file | `0\n` | `0` | caught count=0 (PASS) |
| File without `Skip to the` literal | `0\n` | `0` | caught count=0 (PASS) |
| Real bundle `main-1wxJxxD5.js` | `1\n` | `1` | found 1 occurrence (PASS) |

All three cases produce a single-char integer (length=1, no embedded
newlines) suitable for `[ ... -lt 1 ]` comparison.

## Probe suite this tick (all green except G)

| Section | Probe | Exit | Notes |
|---|---|---|---|
| G | Pricing-consistency | 1 (FAIL) | tier-1=$150 intake=$330 — founder-blocked, expected |
| H | Accessibility/SEO smoke | 0 (PASS) | auto-discovered main-1wxJxxD5.js; 9/9 green |
| J | Build-artifact-integrity | 0 (PASS) | auto-discovered main-1wxJxxD5.js; 9/9 green |
| K | Audit-record-tracking | 0 (PASS) | 38/38 audit .md files on disk and in git |
| L | Open-ticket-id-reference | 0 (PASS) | all cited ticket-ids resolve to real DB rows |
| M | Commit-SHA-reference | 0 (PASS) | all cited commit-SHAs resolve to real commits |
| N | File-path-reference | 0 (PASS) | all cited docs/*.md paths resolve to real files |
| **O** | **Live-bundle-URL auto-discovery** | **0 (PASS)** | **CRLF-safe count fix (this tick); main-1wxJxxD5.js canonical across 4 routes** |

The fix is **transparent on the happy path** — same PASS output as turn-052,
same canonical URL, same byte count. The only observable difference is
internal: the count is now clean on every input shape, including the
hypothetical count=0 failure mode that would have produced a cryptic
`integer expression expected` error instead of the intended FAIL message.

## What didn't change

- **Live site.** Docs-only ship. Live bundle stays on turn-050
  `main-1wxJxxD5.js`. No CF Pages deploy this tick.
- **Pricing ladder.** Section G still FAIL exit 1. Founder decision still
  pending on `docs/PRICING-LADDER-DRIFT-2026-07-09.md` (3 options A/B/C).
- **Persuasion shape.** W5-PERSUADE (`t_45ea76a8`, ready) still awaiting
  founder `ship A` / `ship B` / `ship C` / `ship A+B+C` / `hold`.
- **Bundle URL hard-codes in H and J probes.** Out of scope for this tick;
  the H/J probes source `LIVE_BUNDLE_URL` from a hard-coded value but
  cross-check it against Section O's discovery output. The probe-section-O
  fix is the canonical place for the bug; H and J don't have the count=0
  bug because their `grep -oE | wc -l` patterns don't have a `|| echo`
  fallback (and `wc -l` returns clean integers on MSYS — verified in this
  tick's count-pattern probe).

## Why not Section P (CRLF-on-Windows hardening rubric)?

The hot list named Section P as a candidate "only if 3+ scripts exhibit
the same `grep -c ... | tr -d '\n\r '` fix pattern." After this tick:

- **probe-section-J.sh**: 2 instances of `grep -c -F | tr -d '\n\r '`
  (lines 111, 113) — already fixed in turn-052.
- **probe-section-O.sh**: 1 instance — fixed this tick (was originally
  `grep -c -F | || echo 0`, the bug-class variant).

**Total: 2 fixed instances across 2 probes.** The hot list's 3+ threshold
is not yet met, so Section P stays a candidate, not a rubric extension.
If a third `grep -c | || echo 0` or `grep -c | unstripped-newline` pattern
ever surfaces in any probe, Section P becomes the right move (probably
codifying the `head -1 | tr -d ' \t\r\n'` + `${var:-0}` pattern as a shared
helper). Today, two isolated fixes is below the threshold.

## Lessons

1. **A probe that patches its own input is a self-defending invariant;
   a probe that patches its own count is the same idea one level deeper.**
   Section O (turn-052) was about discovering the bundle URL fresh on every
   run. This tick's fix is about ensuring the count-on-bundle check uses
   the same defensive shape the bundle discovery uses. The pattern: any
   `grep | $other_command` chain that ends in an integer comparison needs
   the explicit `head -1 | tr -d` strip, because `grep -c` and `wc -l`
   emit newlines that bash's `$(...)` only sometimes strips depending on
   host shell, input encoding, and intervening pipe shape.
2. **`|| echo 0` is almost never the right defensive pattern for `grep -c`.**
   grep exits 0 on count=0 (success with no matches). The fallback never
   fires. The right defense is `${var:-0}` AFTER stripping, not a fallback
   that doesn't fire. J's pattern (turn-052) is the canonical fix; O's
   original code was the textbook anti-pattern.
3. **The "3+ scripts" threshold for rubric extensions is the right gate.**
   This tick was tempted to open Section P as a new rubric on a 2-instance
   pattern (J + O). That's premature: two isolated fixes is below the
   threshold the hot list set, and a rubric section that's "fixes for two
   known bugs" is more friction than value. Wait for the third instance.
   The right move today was: fix the bug, document the class, log the
   2-of-3 tally, and move on. Section P stays a candidate.
4. **The negative-test pattern catches what the happy path hides.**
   `O PASS` on the live bundle tells us nothing about whether the count=0
   path actually fires a FAIL. The 3-case probe in `/tmp/test-count-pattern.sh`
   (empty file → count=0; file without literal → count=0; real bundle →
   count=1) is the only verification that proves the fix works on the
   failure mode it's supposed to catch. Same negative-test philosophy
   turn-042 baked into Section K, turn-046 into Section N, and turn-052
   into Section O. Every probe that claims to catch drift must be
   verified with synthetic drift injection.

## Failure-mode catalog (Section O, post-turn-053 update)

| Drift pattern | Detection | Action |
|---|---|---|
| Probe hard-coded URL `main-X.js` no longer matches home page's `main-Y.js` | Section O PASS + H/J PASS on discovered URL | Impossible post-this-tick — H/J also auto-discover |
| Probe's hard-coded URL fetches 404 (CF edge evicted the stale bundle) | Section O step 3 FAIL on HTTP status | Fix the hard-code; until fixed, J's "stale deploy" FAIL is the signal |
| Home page references different bundle hashes across routes (mid-deploy race) | Section O step 4 FAIL on route-hash mismatch | Retry next tick; if persistent, deploy is racing itself |
| Discovery regex matches a sub-resource that isn't the main JS bundle | Section O step 5 FAIL on literal miss (CRLF-safe count, this tick) | Update regex pattern |
| Vite switches to modulepreload or inlines the bundle | Section O step 1 INDETERMINATE | Broaden the discovery regex |
| Section O step 5 `grep -c` count gets 0 but pipe mishandles the trailing newline | Now caught — `[ -lt 1 ]` compares clean integer (this tick) | If ever fires: surface `O FAIL: discovered bundle has no 'Skip to the' literal` (not `integer expression expected`) |

## Next-tick candidates

- **Section P (still candidate):** 2 instances now (J + O), need 3+ to
  promote. Codify the `head -1 | tr -d ' \t\r\n'` + `${var:-0}` pattern
  into a shared helper if a third instance ever surfaces.
- **Founder decision still pending:** pricing-drift (Section G) + persuasion
  shape (W5-PERSUADE). The cheapest loop move is waiting for these.
- **Anti-slop + bundle-scan: nothing new this tick** — no copy changed,
  bundle still main-1wxJxxD5.js from turn-050.

---

**Files touched:**
- `.hermes/probe-section-O.sh` (+16/-3, CRLF-safe count via `head -1 | tr -d ' \t\r\n'` + `${var:-0}`; banner updated; failure-mode catalog updated with the new row)

**Commit chain:** working-tree → `e5ee4e7` on main. Local = remote verified (`a6d3236..e5ee4e7`).