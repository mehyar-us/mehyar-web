# turn-059 audit — state-reconciliation turn-057+058 + Section J probe cleanup

> Docs-only ship. Closes the state.md/learned.md/VISION.md state-drift that
> accumulated across turns 057 and 058 (state.md still documented turn-056
> as the last complete tick when reality was turn-058 with a live src/ change
> shipped). Also fixes Section J probe regression caused by turn-058's
> deliberate removal of the `$330 audit and $250 diagnosis` substring.

## What shipped

| field | value |
|---|---|
| sha | <this-commit> |
| branch | improver/turn-059-state-reconciliation-j-fix |
| scope | 4 files: `.hermes/probe-section-J.sh` (1 probe line removed + 10-line turn-059 note added), `.hermes/state.md` (state fields closed to turn-058), `.hermes/learned.md` (turn-057 + turn-058 + turn-059 entries appended), `docs/VISION.md` (turn-057 + turn-058 + turn-059 iteration-diary entries appended) |
| deploy | none — live bundle unchanged from turn-058 main-BUtub95-.js 575244 bytes (no src/ change) |
| verdict | ship (state-hygiene + probe-hygiene, zero visitor-facing risk) |

## The drift turn-059 closed

state.md at the start of this tick still said:

```
last_tick_at: 2026-07-10T12:54Z (turn-056, complete)
last_tick_id: 56
deployed_sha: e11b1f7 (turn-056, bare-backtick fix)
shipped_since_last: 1 (turn-056 bare-backtick fix ...)
```

But the actual git log on origin/main showed:

```
5b6a2b9 merge: turn-058 — pricing-ladder subtitle $330/$250 drift fix
b76f59e fix(loop): turn-058 — drop $330/$250 drift from pricing-ladder subtitle
aa0673d docs(loop): turn-057 — bare-backtick fix shipped with state/learned/VISION/turn-054 audit + turn-056 audit record
e11b1f7 docs(loop): turn-056 — ship turn-054 Section M fence-strip WIP + turn-055 misfire audit
```

Two ticks of state debt had compounded: turn-057 (docs-only ship, sha aa0673d) and turn-058 (live src/ ship, sha 5b6a2b9). state.md was at turn-056. The O(1) warm-start guarantee was broken for 2 ticks — any tick between turn-056 and turn-059 that read state.md to plan its work would have missed turn-057's companion commit AND turn-058's live deploy.

Section O probe (added turn-052) had already auto-discovered turn-058's new bundle (main-BUtub95-.js, 575244 bytes, +1 byte vs turn-050's main-1wxJxxD5.js 575243 bytes) — so the probe had a more accurate picture of reality than state.md. The drift was a *state-file* drift, not a *live-site* drift.

## The J probe regression turn-058 caused

Section J probe (added turn-040) asserts that literals in committed src/ files are also present in the live bundle. The probe's PROBES array included:

```bash
"client/src/components/pricing-section.tsx :: \$330"
```

That assertion was set up back when pricing-section.tsx line 87 contained the old subtitle `"The $330 audit and $250 diagnosis are the most common entry points."` — so the probe correctly counted 2 occurrences in src/ and 2 in bundle (Section J expects src≥1 AND bundle≥1).

Turn-058 rewrote that line to `"The audit and the diagnosis report are the most common entry points."` (no `$330`, no `$250` in the subtitle). The probe then FAILed:

```
J FAIL: literal '$330' not found in client/src/components/pricing-section.tsx (rubric drift — fix the probe)
J FAIL: build artifact integrity broken
```

The probe was correctly detecting the *change* (src no longer matches the expected bundle literal) — but the expected literal was the OLD copy, not the desired one. The fix is to remove the `$330` assertion from J and document why.

## Why J should not have been asserting `$330 in pricing-section.tsx` in the first place

J is a build-artifact-integrity probe. Its job is to detect "src/ has a literal that's not in the live bundle" drift — the failure mode from turn-030's scripts/-only deploy, where shell files rolled but the bundle did not.

Pricing-drift is a different class of bug. It is structurally about whether the prices on the home page match the prices the visitor gets quoted at intake. That is what Section G (added turn-038) tests:

```bash
TIER1_PRICE=$(grep -oE 'price: ?"\$[0-9]+"' client/src/components/pricing-section.tsx | head -1 | grep -oE '\$[0-9]+')
INTAKE_PRICE=$(grep -oE '\$[0-9]+' client/src/pages/MicroOffer.tsx | sort | uniq -c | sort -rn | head -1 | grep -oE '\$[0-9]+')
```

Section G correctly FAILs today: `G FAIL: tier-1=$150 intake=$330`. That is the founder-decision-blocked drift from turn-037's docs/PRICING-LADDER-DRIFT-2026-07-09.md.

J's `$330 in pricing-section.tsx` assertion was effectively a *redundant third sentinel* on the same drift surface — it double-tested the structural pricing issue under the "build artifact integrity" label. When turn-058 fixed the symptom (subtitle self-contradiction) without changing tier prices, J FAILed not because of a build-pipeline issue but because Section G's surface changed underneath J's assertion.

The clean separation:

| probe | tests | shouldn't test |
|---|---|---|
| G (pricing-consistency) | tier-1 card price vs intake price (structural) | specific literal in src/ (that's J) |
| J (build-artifact-integrity) | src literal in bundle (artifact integrity) | whether the price is right (that's G) |

Turn-059 removed the `$330` line from J's PROBES array and added a 10-line comment block documenting the move + the J/G separation-of-concerns principle.

## What turn-059 did to close the state-drift

1. Created `.hermes/audit/turn-057.md` (audit record for turn-057's companion docs-only ship, sha aa0673d)
2. Created `.hermes/audit/turn-058.md` (audit record for turn-058's live src/ change, sha 5b6a2b9)
3. Created this file `.hermes/audit/turn-059.md`
4. Updated `.hermes/state.md`:
   - `last_tick_at` → 2026-07-10T13:10Z (turn-059, complete)
   - `last_tick_id` → 59
   - `deployed_sha` and `last_deploy_sha` → 5b6a2b9 (turn-058 merge; live bundle main-BUtub95-.js 575244 bytes, +1 byte vs turn-050 main-1wxJxxD5.js 575243 bytes)
   - `deploy_status` → green (live bundle confirmed at main-BUtub95-.js)
   - `shipped_since_last` → 2 (turn-058 + turn-059; turn-058 live src/, turn-059 docs+probe)
   - `last_learned` → turn-059 (this tick's lessons)
   - `open_tickets` → 3 (t_45ea76a8 W5-PERSUADE, t_90f2136f BOARD-HANDOFF, and the misfire-guardrail ticket — mehyar-us board not CLI-registered, tickets can't be filed via `hermes kanban create` from this session)
   - `next-tick hot list` updated: drops the stale "Section M FAIL→PASS at turn-056" wording; adds the J-probe-cleanup entry as done; reaffirms Section G founder-blocker, W5-PERSUADE founder-decision, mehyar-us board CLI-registration blocker
5. Updated `.hermes/learned.md`:
   - appended `2026-07-10 13:10 · turn-057 · <one-line summary>`
   - appended `2026-07-10 13:10 · turn-058 · <one-line summary>`
   - appended `2026-07-10 13:10 · turn-059 · <one-line summary>`
6. Updated `docs/VISION.md`:
   - appended turn-057, turn-058, turn-059 entries to the iteration diary (prose form, consistent with turn-050/051/052/053/054/055/056 entries already there)

## Verification

- 7-probe regression: G FAIL exit 1 (`G FAIL: tier-1=$150 intake=$330`, founder-blocked, expected); H/J/K/L/N/O all PASS
- J probe specifically: 8/8 src/bundle-pin literals match (was 7/9 with `$330` FAILing before this turn's cleanup)
- tsc green (no src/ change)
- test:intake 11/11 green (no src/ change)
- 4-screen 200/200/200/404 unchanged
- voice 5/5 (no copy touched)
- anti-slop 0 hits (no copy touched)
- Section N cited-file-path count: 10 (was 9 at turn-056; the new audit/turn-057.md, audit/turn-058.md, audit/turn-059.md all reference themselves + each other + the existing cited paths)
- Section M cited-SHA count: 53 (was 52 at turn-056; the new turn-058 + turn-059 audit prose cite shas 5b6a2b9, b76f59e, aa0673d, e11b1f7, <this-commit>; none are bare-prose hexdump byte offsets so the bare-backtick strip and fence-strip both continue to skip them)

## Push verification (git-credential-helper-hermes pitfall #10)

Recipe: `GIT_CONFIG_SYSTEM=/dev/null GIT_TERMINAL_PROMPT=0 git push origin improver/turn-059-state-reconciliation-j-fix` then merge to main.

Triple-verify post-merge:
- `git ls-remote origin main` confirms `<this-commit-sha>` is at origin main
- GitHub API `/repos/mehyar-us/mehyar-web/commits/main` returns sha `<this-commit-sha>`
- `git rev-list --count origin/main..HEAD` = 0

## Lessons

1. **State.md is only O(1) warm-start if it gets closed every tick.** A deferred state-update creates "ticks of drift" where the warm-start tells you turn-056 reality but turn-058 reality is what's true. Two ticks of drift is enough to make the warm-start actively misleading — a tick reading state.md to plan its work would have missed turn-058's live deploy and the J probe regression that came with it. The cheapest mitigation: every tick that ships src/ also ships the docs/state update in the same commit; every tick that ships only docs still ships its own audit record + state bump before declaring "complete." If a tick ends with state.md pointing at turn-N when reality is turn-N+2, the *next* tick's first job is the reconciliation, not a new feature.
2. **Two probes testing the same surface is a coupling smell.** Section G (pricing-consistency) and Section J (build-artifact-integrity) both touched `$330 in pricing-section.tsx` — G structurally (tier-1 card vs intake) and J literally (src literal in bundle). When turn-058 correctly removed the literal to fix a self-contradicting subtitle, J FAILed even though the build pipeline was clean. The right move: pick one probe per surface. G owns pricing-consistency forever; J owns build-artifact-integrity forever. This is now codified in the turn-059 note at the top of probe-section-J.sh.
3. **A copy fix that closes a self-contradiction is cheaper than a pricing fix that closes a tier-price drift.** Turn-058 rewrote one sentence to remove an on-screen self-contradiction (subtitle claimed `$330 audit and $250 diagnosis` while the cards above said `$150` and `$250`). One line, one PR, no tier price change, no API change, no VISION.md change, no schema change. The underlying tier-price drift (Section G) is still founder-blocked — that's a different decision class.
4. **The pattern "tick N ships src/, tick N+1 ships the docs" is small but worth the cadence tax.** Turn-058 (src/) and turn-059 (docs) are two ticks; they could have been one, but the two-tick cadence keeps each commit single-purpose and the state.md warm-start at most 1 tick behind reality. Cost: one extra commit. Benefit: no turn ends with uncommitted files in the working tree.
5. **Section O auto-discovery caught turn-058's new bundle (main-BUtub95-.js, 575244 bytes)** before state.md was updated. That's the value of an auto-discovery probe — it sees the truth on the live site, even when state.md is stale. If turn-059 had read state.md to plan and then *not* run Section O, it would have shipped a state-reconciliation that documented turn-050's bundle (main-1wxJxxD5.js) as current, which would have been wrong. Always run the auto-discovery probes before claiming a deploy sha is current.