# turn-046 — Section N File-path-reference probe (rubric 13→14 A-N)

> The third identifier-drift cousin, completing the (L → M → N) trio
> of cheap-and-right rubric extensions. Section N caught a real drift
> on its first run (the long-missing `docs/PERSUASION-PROPOSAL.md`)
> AND passed its negative-test round-trip — textbook rubric extension
> pattern. Docs-only tick; no CF Pages deploy; live site stays on
> turn-036 c33755d.

## What shipped

- `.hermes/probe-section-N.sh` (+139 new) — a `grep + sort + comm`-shape
  probe that snapshots every `docs/<name>.md` path cited in
  `.hermes/state.md`, `docs/VISION.md`, the rubric + gate docs, the
  pricing-drift doc, `.hermes/learned.md`, AND every
  `.hermes/audit/turn-*.md` (globbed at runtime), then `test -f`s each
  one against the repo root. Cites-not-on-disk = FAIL exit 1.
- `docs/PERSUASION-PROPOSAL.md` (+173 new) — created to close the real
  drift the probe flagged on first run. W5-PERSUADE has been
  "ready awaiting user direction" since the bootstrap; the file had been
  referenced from VISION.md + state.md + audit turn-016/018/025/031/044
  since turn-016 but never landed on disk. Template ships with all 3
  shape options (sticky CTA bar / inline offer-nudge / hero social-proof)
  + a hybrid option + the locked hard rules + the decision-request
  format. Once the founder replies with `ship A` / `ship B` / `ship C`
  / `ship A+B+C` / `hold`, the loop fleshes out the chosen section and
  ships in ≤1 follow-up tick.
- `docs/QA-MEHYARSOFT-B2B-BASELINE-2026-05-11.md` (+101 new section) —
  rubric grew from 13 sections (A-M) to 14 sections (A-N). New Section
  N: probe shape + output sample + negative-test verification +
  7-row failure-mode catalog + 6 implementation notes + why-N-not-
  renumber rationale. Section M's "update cadence" note already
  anticipated Section N ("add a cousin probe (Section N, etc.) following
  the same pattern") so the append-at-end pattern stays clean.

## What this tick does NOT change

- Live site state: no deploy. CF Pages stays at the turn-036 bundle
  (`main-BKU1Uoxy.js`) and the turn-027 shell-deploy state. This is a
  docs-only tick.
- Funnel counters, voice, build gates, anti-slop: all unchanged.
- All 50 mehyar-us kanban tickets: 48 done, 2 ready (W5-PERSUADE +
  BOARD-HANDOFF bootstrap record). No new tickets this tick — the
  Section N probe itself is the deliverable.

## Verified this tick

```
G FAIL: tier-1=$150 intake=$330      # expected — founder-decision-blocked
H PASS    # 9/9 a11y/SEO smoke (live bundle main-BKU1Uoxy.js, 574085 bytes)
J PASS    # 9/9 build-integrity (src <-> bundle)
K PASS    # 32 audit .md on disk, 32 in git (no new orphans)
L PASS    # 28 cited ticket-ids / 50 in DB
M PASS    # 44 cited commit-SHAs / 203 in git (was 42 cited — PERSUASION-PROPOSAL.md cited turn-044/-045 references for the L→M→N chain)
N PASS    # 9 cited docs/*.md paths / 9 on disk (caught the missing PERSUASION-PROPOSAL.md on first run, then closed it)
```

**The probe caught its own target on first run.** Initial probe run
exited 1 with `docs/PERSUASION-PROPOSAL.md` listed as missing — the
file had been referenced from VISION.md and state.md since the
bootstrap but never created. The same tick that added the probe also
created the missing file (option-a fix from the probe's failure-mode
catalog), then re-ran the probe → exit 0 with 9 cited / 9 on-disk.

**Negative-test round-trip:** appended `docs/NEGATIVE-TEST-N.md` to
`.hermes/state.md` → cited count bumped to 10, probe exited 1 with
the offending path printed → `git checkout -- .hermes/state.md` →
re-ran probe → exit 0 with 9 cited. Round-trip verified.

## Build/test gates

- tsc: not re-run (docs-only change, no .ts/.tsx touched)
- test:intake: not re-run (no code change)
- 4-screen Phase-6: home 200 (verified via curl); /booking 200, /micro-offer 200, /404-test 404
- voice 5/5: unchanged (no copy touched)
- anti-slop 0 hits: unchanged (no copy touched)

## Next-tick candidate (proactive)

- **W5-PERSUADE (`t_45ea76a8`, ready):** the proposal template is now on
  disk and Section N PASS confirms the citation resolves. Founder reply
  on the doc (or Telegram chat 6829435996) with `ship A` / `ship B` /
  `ship C` / `ship A+B+C` / `hold` unblocks this. Loop recommendation:
  start with Shape A (sticky CTA bar) only — smallest, most reversible,
  captures the largest single leak — and add B / C in subsequent ticks
  after measuring Shape A's lift.
- **Pricing-consistency BLOCKER (Section G FAIL):** docs/PRICING-LADDER-
  DRIFT-2026-07-09.md has 3 decision options (A: align to $330; B: drop
  micro-offer price; C: treat as two separate products). Awaiting
  founder decision. Loop will NOT ship pricing changes autonomously.
- **Rubric extension O candidate:** if a new identifier-drift surface
  surfaces (e.g. URLs cited in audit prose that no longer resolve,
  env-var values that were renamed, telemetry events referenced in
  state.md but no longer emitted), add Section O following the same
  pattern. Current scope: ticket ids (L) + commit SHAs (M) + file
  paths (N). Sections K/O could pair as the audit-trail-vs-file-trail
  versions of the same drift class.

## Lesson

The third cousin-class rubric extension worked exactly as the first
two (L, M) did: the probe was cheap to write (~3 minutes), caught a
real drift on first run (the long-missing PERSUASION-PROPOSAL.md),
shipped its own fix in the same tick, passed its negative-test
round-trip, and is now CI-ready for every future LOOP-BOOT audit.
The "fabrication direction" principle (cited-but-missing = FAIL,
not-cited = informational) holds across all three identifier classes
(ticket ids, commit SHAs, file paths). The pattern: a probe that
catches drift on first run + closes its own target in the same tick
is the textbook cheap-and-right rubric extension — Section N is now
the third data point in that pattern.

The Section M doc note that pre-anticipated Section N ("add a cousin
probe (Section N, etc.) following the same pattern") was on the mark —
when the rubric's own prose names a future extension, building it in
the next natural lull (the docs-only cadence-anchor between shipping
ticks) closes the loop cheaply. The next natural lull candidate is a
deep-tick shipping candidate, but no shipping candidate has been
identified as more urgent than the founder-decision-blocked pricing
drift — so Section N stays the highest-leverage move available until
the founder replies.