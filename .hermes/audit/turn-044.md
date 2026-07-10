# turn-044 — Section M Commit-SHA-reference probe

> Added the second identifier-reference-class probe to the LOOP-BOOT
> rubric. Sections G/H/J catch file-level drift on the live site;
> Section K catches audit-trail drift; Section L catches ticket-id
> reference drift; **Section M catches commit-SHA reference drift.**

## What shipped

- `.hermes/probe-section-M.sh` (+130 lines) — new probe that snapshots
  every 7-char commit-SHA referenced in state/docs/audit surfaces,
  strips ticket-ids (Section L's) + the telegram chat-id (decimal),
  then runs `git log --all --format=%H | cut -c1-7 | sort -u` and
  one-way diffs cited \ git. Exit 0 PASS, 1 FAIL, 2 INDETERMINATE.
- `docs/QA-MEHYARSOFT-B2B-BASELINE-2026-05-11.md` (+120 lines) —
  rubric grew from 12 sections (A-L) to 13 sections (A-M). Sections
  I (Open registry) + J (Build-artifact-integrity) + K (Audit-record-
  tracking) + L (Open-ticket-id-reference) all unchanged (preserves
  the I/J/K/L mnemonics turn-040/042/043 locked in). New Section M
  documents the commit-SHA-reference drift class + a 6-row failure-
  mode catalog + 5 implementation gotchas (the most important: MSYS
  path translation for `git -C`).

## Verified this tick

```
=== M Commit-SHA-reference probe (turn-044 new check) ===
cited commit-SHAs in state/docs/audit: 48
7-char SHA prefixes in git log:        201
M PASS: all 42 cited commit-SHAs resolve to real commits (drift closed)
```

**Negative-test:** appending `abc12Z4` to `.hermes/state.md` bumped
cited count to 49, probe exited 1 with the offending line printed
(`M FAIL: stale commit-SHA citations... abc12Z4`); after
`git checkout .hermes/state.md` the probe returned to exit 0 with
42 cited / 201 in git PASS. Bidirectional drift detection verified.

## Regression-runs (other sections, this tick)

- Section G pricing-consistency: still FAIL exit 1
  (tier-1=$150 intake=$330 — founder-decision-blocked, expected)
- Section H a11y probe: 9/9 PASS
- Section J build-integrity probe: 9/9 PASS
- Section K audit-trail probe: 30/30 PASS
- Section L ticket-id probe: 28 cited / 49 in DB PASS exit 0
- **Section M commit-SHA probe: 42 cited / 201 in git PASS exit 0** (new)

## Build/test gates

- tsc green
- test:intake 11/11
- 4-screen Phase-6: home 200 / /booking 308 / /micro-offer 308 / /404 200
- voice 5/5 unchanged
- anti-slop 0 hits on local + live

## Implementation gotchas (in the rubric)

The Section M probe hit two non-obvious issues that Section L did not:

1. **`git -C` rejects MSYS-style paths on Windows.** The first run
   exited 1 with all 42 cited SHAs flagged stale because the inner
   `git -C "$REPO_ROOT" log --all` silently produced 0 rows of output
   (the exit 128 was swallowed by `|| true`). The fix: convert
   `$REPO_ROOT` to `C:/...` form via `sed -E 's|^/([A-Za-z])/|\1:/|'`
   before passing to `git -C`. Section L dodged this because it uses
   python (not git) for the in-DB read.

2. **Ticket-ids share the 7-char hex word-shape with SHAs.** Both
   `t_<8 hex>` ticket-ids and bare 7-char SHAs match
   `\b[0-9a-f]{7,8}\b`. Without pre-stripping the ticket-ids via
   `sed -E 's/t_[a-f0-9]{8}//g'`, Section L's 28 ticket-ids would
   all falsely FAIL Section M as "stale commit-SHA citations."
   Added an explicit `s/\b6829435\b//g` for the telegram chat-id too
   (decimal not hex, but `\b` still matches it because it's
   all-digits).

3. **Inline-code backticks hold the synthetic-SHA example.** First
   pass did NOT strip backtick spans. The probe's own negative-test
   prose documents `abc1234` inside backticks (e.g. `` `abc1234` ``)
   and that re-broke the probe on every audit doc that describes
   the negative-test. The fix: `sed -E 's/`[^`]*`//g'` runs after
   the ticket-id strip and before the hex grep.

4. **Bare-prose synthetic SHAs need a non-hex character.** Inline-
   code stripping handles `` `abc1234` ``, but state.md carries
   the same synthetic id in BARE prose (no backticks) describing
   the negative-test. Cannot safely strip bare prose without
   losing real citations. The convention: name synthetic test
   SHAs with a non-hex char (`abc12Z4` not `abc1234`) so the
   probe's `[0-9a-f]{7}` regex never matches them. Same insight
   as the chat-id strip — example values must live outside the
   probe's alphabet.

## Lessons

- **Identifier-reference drift is now closed for the two highest-volume
  identifier classes the loop cites.** Sections L (ticket ids) + M
  (commit SHAs) together catch "the loop cites a name that no longer
  resolves" — the failure class that has hit the loop several times
  in past ticks (turn-039 and turn-042 both backfilled SHAs across
  multiple files; future ticks could cite a SHA that's been force-
  pushed away; same story for ticket-ids). The two together are ~10s
  total wall time, both CI-ready.
- **MSYS path handling is a per-tool problem, not a global rule.**
  Section L's python-sqlite3 read works fine with `/c/Users/...`
  paths because python's `os.path.exists` accepts them (after
  conversion to `C:/...`). Section M's `git -C` does NOT accept
  `/c/Users/...` even though bash sees the path fine. The probe
  carries its own conversion for that reason. If a future Section
  N probe needs a third tool, the path-handling block needs to grow
  — keep it close to the tool, not centralized.
- **The negative-test pattern is now standard for new probes.** Every
  Section K/L/M probe has been verified with a synthetic-drift
  injection (touch an orphan / append a fake id / append a fake SHA),
  confirming exit 1 + restoration confirms exit 0. Without that
  round-trip, a probe could pass-on-vacuum and silently never catch
  anything.

## Next rubric extension candidate (N)

File-path references in `docs/` and `state.md` that no longer exist
on disk. The loop cites a lot of doc paths (`docs/PRICING-LADDER-
DRIFT-2026-07-09.md`, `docs/PERSUASION-PROPOSAL.md`, etc.) — if any
of those files gets renamed or moved, the citations silently rot.
Same pattern: grep + ls + comm -23. ~3s wall time.

## Hot list update (for the next-tick state.md carry-over)

- BLOCKER (unchanged from turn-037): founder decision required on
  docs/PRICING-LADDER-DRIFT-2026-07-09.md. Section G probe keeps
  detecting it on every audit.
- W5-PERSUADE (t_45ea76a8, ready): still awaiting user direction.
- (rubric extension N): file-path reference drift — assert every
  file path cited in recent state.md / VISION.md / audit actually
  exists on disk. Catches the third identifier class after Section
  L (ticket ids) and Section M (commit SHAs). Cheap (~3s wall time),
  same grep + ls + sort + comm shape. Catches doc-rename drift that
  has happened before (turn-028 recreated the missing QA baseline
  doc; turn-029 fixed the VISION.md cross-links — both were path-
  reference drift events the loop fixed manually).