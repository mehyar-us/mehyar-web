# turn-061 — J probe `$330` literal removed (founder-blocked pricing drift)

> Date: 2026-07-10
> Tick: 061
> Commit: <this-commit>
> Type: docs-only (rubric probe hygiene)
> Branch: main (docs-only, no live deploy)

## What shipped

`.hermes/probe-section-J.sh` — removed the `client/src/components/pricing-section.tsx :: $330`
literal from the PROBES list. The probe now runs 8 checks instead of 9. The `#`
comment block documenting *why* lives ABOVE the `PROBES=(...)` assignment
because bash `#` comments are NOT allowed inside array assignments — the parser
would treat them as array elements (which I caught during the first draft and
fixed before committing).

`docs/QA-MEHYARSOFT-B2B-BASELINE-2026-05-11.md` — Section J updated:
- "Today's expected output" block now reflects 8-probe output (no `$330` line).
- New "Turn-061 update" subsection documents the removal + re-add criteria.
- Failure-mode catalog gained a 6th row for the "rubric drift on
  founder-blocked changes" pattern this turn exemplifies.

## Why this ship

Section J was FAILing every tick since turn-037 (when the pricing-drift doc
opened). The FAIL was: `J FAIL: literal '$330' not found in
client/src/components/pricing-section.tsx (rubric drift — fix the probe)`.

That FAIL was correctly catching that `pricing-section.tsx` does not contain
`$330`. But `pricing-section.tsx` SHOULDN'T contain `$330` until the founder
picks an option from `docs/PRICING-LADDER-DRIFT-2026-07-09.md` (A: align to
$330, B: drop micro-offer price, C: separate products). Until then, the
pricing card legitimately says `$150` for tier-1 + `$250` for tier-2, and
Section G's pricing-consistency probe already surfaces the founder-decision
gap (`G FAIL: tier-1=$150 intake=$330`) with the full 4-row drift table.

Two FAILs for the same drift is redundant. The fix: drop the redundant one
until the founder decision lands.

## Pre-deploy verification

- `bash .hermes/probe-section-J.sh` → J PASS exit 0 (8/8 OK)
- `bash .hermes/probe-section-G.sh` → G FAIL exit 1 (founder-blocked, expected)
- `bash .hermes/probe-section-H.sh` → H PASS exit 0 (9/9 OK)
- `bash .hermes/probe-section-K.sh` → K PASS exit 0 (45 audit .md on disk / 45 in git)
- `bash .hermes/probe-section-L.sh` → L PASS exit 0 (29 cited ticket-ids / 54 in DB)
- `bash .hermes/probe-section-M.sh` → M PASS exit 0 (55 cited SHAs / 229 in git)
- `bash .hermes/probe-section-N.sh` → N PASS exit 0 (9 cited docs paths / 9 on disk)
- `bash .hermes/probe-section-O.sh` → O PASS exit 0 (auto-discovered main-BVPuebii.js, 575240 bytes)
- `npx tsc --noEmit` → tsc 0 errors

Live 4-screen smoke: home /booking /micro-offer /404 all 200 (no live deploy
this tick — docs-only ship; CF Pages stays on turn-060 main-Dsuzx-uI.js).

## Lessons

1. **Redundant probe FAILs are a rubric drift class.** A probe that catches a
   founder-decision-blocked drift from a SECOND angle is "correct in principle"
   but "noise in practice" until the founder decides. The right move is to
   document the redundancy and remove it until the underlying decision lands,
   not to ship a fork that splits the signal across two FAILs.

2. **Bash `#` comments don't work inside `PROBES=( ... )` array assignments.**
   I tried to add the rationale as inline comments and the patch landed with
   the comments embedded as bash elements. Fixed by moving the comment block
   ABOVE the assignment. This is the kind of probe-script gotcha that's easy
   to miss until you run the probe — first run PASSed only because the bash
   parser is permissive about whitespace-separated garbage in some contexts.
   The probe IS in fact NOT picking up the comments as array entries (I verified
   by running it — `J PASS exit 0` with 8 OK lines, not 8+comment-shape entries).
   But the cleanest fix is to move the comment out of the array body entirely.

3. **The failure-mode catalog is the right place to bake the new drift class.**
   Future turns reading Section J now see "Probe asserts a literal the founder
   hasn't committed" as a documented row in the catalog, with the turn-061
   fix path as the worked example. This is the same pattern turn-042 baked
   into Section K (audit-trail drift) and turn-046 baked into Section N
   (file-path drift).

## State of the world after turn-061

- Section G pricing-consistency probe: still FAIL exit 1 (founder-blocked, expected).
- Section J build-artifact-integrity probe: PASS exit 0 (8/8 OK, was FAIL every tick since turn-037).
- 8-section regression clean: G FAIL expected; H/J/K/L/M/N/O all PASS.
- No live deploy this tick (docs-only ship).
- Section P candidate (count-strip 2-of-3 watch) still parked — no third
  count-strip instance has fired to trigger Section P.
- Section Q (live-API-endpoint behavior probe) on disk, working as expected;
  not auto-run in this tick because the live API was unchanged from turn-059.

## Next-tick hot list (unchanged from turn-060)

- BLOCKER: founder decision on docs/PRICING-LADDER-DRIFT-2026-07-09.md (3 options A/B/C).
- W5-PERSUADE (t_45ea76a8, ready): founder reply on docs/PERSUASION-PROPOSAL.md.
- Section P (count-strip 2-of-3): still parked, no 3rd instance fired.