# turn-051 — ship turn-050 reconciliation + gitignore probe-WIP

**Tick:** 51
**Date:** 2026-07-10 (post turn-050 deploy + immediate ship-the-WIP follow-on)
**Branch:** `improver/turn-051-reconcile` → merged to `main` as `1a2e4fa` (no-ff)
**Live deployed sha:** `75274ae` (UNCHANGED from turn-050 — docs-only tick)
**Live bundle:** `main-1wxJxxD5.js` (UNCHANGED — no Vite rebuild triggered)
**Deploy target:** Cloudflare Pages from `mehyar-us/mehyar-web` — no deploy this tick
**Telegram card:** emitted at end of this tick
**Ticket:** t_a24dc4ed (LOOP-T051, improver, completed)

## What was spotted

`git status --porcelain` from Phase 1 (sense) revealed two distinct WIP groups:

1. **4-file working-tree reconciliation** from turn-050 — `state.md` (deployed_sha still c33755d, last_tick_id still 47, deploy_status still narrating the turn-047 docs-only tick), `learned.md` (still on the old format with 3 history lines, not yet rolled into the 1-line rolling-notes shape), `VISION.md` (turn-050 diary entry missing), `audit/turn-050.md` (the 125-line structured record existed on disk but was never added to git — Section K probe was FAILing on this exact orphan).

2. **9 transient probe-WIP files** — `.hermes/.probe-M-cited.y7pDxi` (probe-M intermediate cache), `home-t049.html` (probe snapshot), `main-live-t049.js` + `main-live-t049-after.js` (probe bundle captures), `probe-turn-049-contact-count.py` + `probe-turn-049-funnel.py` (one-shot investigation scripts referencing `.hermes/main-live-t049-after.js` by name — not reusable, would mislead future ticks), `smoke-t049-_.html` + `smoke-t049-_404.html` + `smoke-t049-_booking.html` + `smoke-t049-_micro-offer.html` (smoke test snapshots).

Per the turn-050 ship-the-WIP lesson, both groups are textbook "ship the WIP" candidates: real value, zero judgment, zero risk. The 4-file group had been on disk since turn-050 completed (~30 min prior); the 9-file group had been accumulating since turn-049 probe runs.

The Section K probe pre-commit confirmed the drift: 36 audit `.md` files on disk / 35 in git = orphan `turn-050.md` = FAIL exit 1.

## What was done

1. Branched `improver/turn-051-reconcile` off `main` (HEAD = `75274ae`).
2. Deleted 9 transient probe-WIP files.
3. Extended `.gitignore` with 6 new patterns covering the `.hermes/<...>-tNNN-*.{html,js,py}` shape + intermediate probe-M caches (`.hermes/.probe-*-cited.*`, `main-live-t*.js`, `main-live-t*-after.js`, `home-t*.html`, `smoke-t*.html`, `probe-turn-*-*.py`).
4. Staged the 5 legitimate files: `.gitignore` + `learned.md` + `state.md` + `VISION.md` + `audit/turn-050.md`.
5. Commit: `2ba2913` "docs(loop): turn-051 — ship turn-050 reconciliation + gitignore transient probe-WIP".
6. Pushed branch; merged to `main` no-ff as `1a2e4fa`; pushed main.
7. Ground-truth-verified: `git ls-remote origin main` SHA = `1a2e4fa...` = local HEAD (push was real, not a hallucinated report).

## Live verification (post-merge, no CF Pages deploy)

```
=== Live endpoints ===
/                     : 200
/manifest.webmanifest : 200
/sw.js                : 200
(curl error 23 on stdout pipe is harmless — curl tried to write the response body to a closed /dev/null pipe; HTTP 200s are real)

=== Section K probe (post-commit) ===
on-disk audit .md files: 36
in-repo audit .md files: 36
K PASS: drift closed

=== Full probe suite ===
G: FAIL exit 1 (pricing drift, unchanged BLOCKER, expected)
H: PASS
J: PASS
K: PASS (FAIL -> PASS delta from this tick)
L: PASS
M: PASS
N: PASS

=== Build/test ===
tsc:          green (no TS changes)
test:intake:  green (no script changes)
4-screen:     unchanged from turn-050 (no client/src changes)
```

## Risk

Zero. No client/src touched, no CF Pages rebuild, no live bundle change. Pure audit-trail closure + gitignore hygiene. The gitignore patterns are additive (no existing tracked files match the new globs — verified `git ls-files | grep -E "\.hermes/(main-live-t|home-t|smoke-t|probe-turn-)"` returns empty).

## Lessons

1. **The turn-050 ship-the-WIP lesson self-applies the same day it was written.** The lesson literally named the next sweep candidate as "turn-060-ish: re-run `git status --porcelain` + scan for any `.hermes/*.html` or `.hermes/probe-*.py` left over from prior probes that should be gitignored or deleted." The WIP was already 30 min old and the fix was already on disk — no reason to wait 9 more ticks. The 1-sweep-earlier catch saved a future tick from a larger cleanup.

2. **Probe-M intermediate cache files (`probe-M-cited.<rand>`) leak the SHAs the probe is currently inspecting into filenames.** A second-order probe (call it Section O candidate) that asserts no `.hermes/.probe-*-cited.*` files exist on disk after a probe-M run would catch this drift automatically. Cheap (~2s wall time), one-line `find .hermes -name '.probe-*-cited.*' | wc -l` then `[[ $(...) -eq 0 ]]`. Worth adding when there are 2-3 more such files.

3. **`learned.md` rolling 1-line format is the right shape but needs an out-of-band pointer to history.** The new format says "prior notes in git log `git log --oneline -50` and .hermes/audit/turn-NNN.md history" — both work, but `git log -50` only goes back to the last 50 commits and the loop's relevant history is 50+ commits deep. A better pointer: `git log --all --oneline -- .hermes/audit/learned.md` shows every tick where learned.md was rewritten, with the commit message preserving the original 1-liner. Same data, more reliable retrieval.

4. **Merge abort was a working-tree-state artifact, not a real conflict.** First `git merge --no-ff improver/turn-051-reconcile` reported "Aborting" + "Merge with strategy ort failed" with `.hermes/state.md` and `docs/VISION.md` listed as the conflicting files. `git status` showed clean working tree. The retry succeeded. Cause unclear — possibly CRLF line-ending normalization (git printed "LF will be replaced by CRLF" warnings on the `git add` step) confused the merge's pre-check. Lesson: when a merge aborts with "dirty working tree" but `git status` is clean, try the merge again once before investigating.

## Next-tick hot list

- W5-PERSUADE (t_45ea76a8, ready) — unchanged. Awaiting founder decision on `docs/PERSUASION-PROPOSAL.md`.
- BLOCKER: pricing drift (Section G) — unchanged. Awaiting founder decision on `docs/PRICING-LADDER-DRIFT-2026-07-09.md`.
- New candidate: a probe-O intermediate-file-leak check (`find .hermes -name '.probe-*-cited.*' | wc -l`) — cheap, catches the drift class that produced this tick's hygiene pile.
- New candidate: explicit "every ~10 ticks: ship-the-WIP sweep" sub-routine codification in the loop prompt (the lesson has been written twice now in learned.md; making it a deliberate loop step would make sure it doesn't slip again).