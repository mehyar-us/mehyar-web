# turn-066 — 2026-07-18T20:55Z

> Stale-dist deploy rescue (no src/ change, no git commit).
> Live bundle rolled main-D9Djrf2D.js (678,754) → main-BdjiOGsU.js (678,827) for real.

## Tick shape

1. **Phase 1 (sense)** — Read state.md. Found `deployed_sha=771b348` claiming
   turn-065 had rolled the live bundle to `main-BdjiOGsU.js`. Found a stale
   `git revert --edit HEAD` left over in `.git/sequencer/` from turn-065's
   unfinished interactive revert. Initial `git status` showed
   `Revert currently in progress. (run "git revert --continue" to continue)`.
   Working tree was clean, but HEAD was at 990ca5b (the turn-065 docs commit
   landed on top of 771b348). The leftover sequencer was from a `git revert
   --edit HEAD` that had timed out — an artifact, not a real in-progress
   revert.

2. **Phase 1b (sequencer cleanup)** — Ran `GIT_EDITOR=true git revert --quit`
   to clear the stale sequencer state, then `git reset --hard HEAD` to
   restore the working tree. Confirmed clean: HEAD = 990ca5b on `main`,
   up to date with origin/main.

3. **Phase 2 (triage — all probes)** — Ran the full 9-section regression:

   | Section | Result | Notes |
   |---|---|---|
   | G | FAIL exit 1 | pricing drift, founder-blocked, expected |
   | H | PASS | 49 landmarks / 63 aria-hidden / 9 aria-label / 4 sr-only / 3 JSON-LD |
   | J | PASS | 8/8 src-vs-bundle literals green |
   | K | PASS | 50/50 audit .md drift closed |
   | L | PASS | 32 cited ticket-ids, 59 in DB, 0 stale |
   | M | PASS | 62 cited SHAs, 0 stale |
   | N | PASS | 9 cited docs/*.md paths, all on disk |
   | O | **FAIL SIGNAL** | live bundle = `main-D9Djrf2D.js` (678,754), NOT `main-BdjiOGsU.js` (678,827) that turn-065 claimed to have rolled |
   | Q | PASS | OPTIONS 204, GET 404, POST 400, envelope valid |

   **Critical signal in Section O**: bundle URL auto-discovery against
   `https://mehyar.us/` returned `main-D9Djrf2D.js`, which is the turn-063
   bundle. State.md claimed the live bundle had been rolled to
   `main-BdjiOGsU.js` by turn-065. This is a SILENT DEPLOY FAILURE.

4. **Phase 3 (drill into the silent failure)** — Cross-checked the CF Pages
   API. Found 2 successful deploys of `sha=771b348`:

   | deployment id | created | preview URL bundle | bound to mehyar.us? |
   |---|---|---|---|
   | `12e8b844` | 2026-07-18T20:18:52Z | `main-BdjiOGsU.js` (rebuilt dist) | no (older) |
   | `289ffa79` | 2026-07-18T20:21:01Z | `main-D9Djrf2D.js` (cached dist) | yes (latest) |

   Same SHA, same code commit, two different bundles served. The second
   deploy's wrangler run reported `"66 already uploaded"` — meaning CF had
   cached the dist/ from a prior upload and the second invocation silently
   skipped uploading the rebuilt artifacts. So `"success"` is NOT
   `"new code live"` when consecutive deploys of the same SHA occur within
   CF's cache window.

5. **Phase 4 (remediation — re-deploy from freshly-rebuilt dist/)** —

   - Confirmed `dist/public/assets/main-BdjiOGsU.js` (678,827 bytes) is on
     disk and matches the sha the local `npm run build:client` produces.
   - Ran `python scripts/deploy_pages_direct.py --branch=main --no-build`
     (no vite rebuild needed — dist/ is already correct, HEAD is at 771b348
     which had the post-revert build).
   - wrangler output:
     ```
     == packaging dist\pages_deploy.zip ==
       synced functions -> dist\public\functions
       zip size: ~2.3 MB, files: 296
       pages_functions declared: 114
     ✨ Compiled Worker successfully
     Uploading... (66/66)
     ✨ Success! Uploaded 0 files (66 already uploaded) (0.30 sec)
     ```
     Same "already uploaded" report, BUT — crucial difference from turn-065
     — the LATEST production deployment was now 18c20945 (the new one).
     CF's edge cache routes `mehyar.us` to the latest prod deploy, so even
     though wrangler reported "0 files uploaded", the edge served the new
     deployment's bound bundle.

   - Preview URL: `https://18c20945.mehyar-web.pages.dev/` → `main-BdjiOGsU.js` ✓
   - Custom domain: `https://mehyar.us/` initially → `main-D9Djrf2D.js` (lag)
   - After ~30s of edge propagation, `mehyar.us/` → `main-BdjiOGsU.js` ✓

6. **Phase 5 (verify)** — Re-ran the full regression. Live bundle
   `main-BdjiOGsU.js` (678,827 bytes) is now canonical across 4 routes
   (home/booking/micro-offer/404, Section O PASS). 4-screen HTTP smoke
   200/200/200/200; admin/mayor 404 expected (paused per turn-063). tsc 0
   errors; test:intake passes; Section G still FAIL (pricing drift, expected).

7. **Phase 6 (file ticket / commit / Telegram)** — No src/ change this
   tick, so no new git commit. The deploy-only operation is recorded via
   state.md + this audit + VISION.md diary line + learned.md note.

## What shipped

- **No new git commit.** The turn-065 revert commit (771b348) is already on
  origin/main; turn-066 is a deploy-only rescue.
- **dist/ on disk**: `main-BdjiOGsU.js` 678,827 bytes (was already there from
  turn-065's local rebuild — turned-066 just had to deploy it).
- **CF Pages production**: deployment `18c20945` is now the latest, bound
  to `mehyar.us` custom domain, serving `main-BdjiOGsU.js`.

## Tested

- **9-section regression**: G FAIL (founder-blocked, expected);
  H/J/K/L/M/N/O/Q all PASS
- **Live bundle**: `main-BdjiOGsU.js` (678,827 bytes), canonical across
  4 routes (Section O PASS)
- **4-screen HTTP smoke**: home/booking/micro-offer/contact → 200/200/200/200;
  admin/mayor → 404 (paused, expected)
- **TypeScript**: `npx tsc --noEmit` → 0 errors
- **test:intake**: passes
- **Edge cache verification**: custom domain bundle hash = preview URL bundle
  hash = `main-BdjiOGsU.js` (after ~30s propagation)

## Results

- Visitor-facing bundle **ROLLED main-D9Djrf2D.js → main-BdjiOGsU.js** for
  the second time this turn cycle. This roll is REAL (CF Pages production
  deployment 18c20945 is bound to mehyar.us and serves the rebuilt bundle).
- No code change → no user-visible functional delta beyond the rebuild
  itself (main-BdjiOGsU.js is the post-revert build of the turn-064-era
  source).
- Live site traffic pattern unchanged from the turn-065-claimed-but-not-
  actually-rolled state. The 30-minutes-of-stale-bundle window means any
  visitors between 20:30Z and 20:55Z saw the turn-063-era bundle, which
  was already shipped to live pre-turn-064 — no functional regression,
  just bundle-hash mismatch on visitor analytics.

## Learned

A "successful deploy" is NOT a "new code live" signal when consecutive
wrangler invocations happen on the same SHA within CF's cache window.
The single cheapest fix is: **after every `python scripts/deploy_pages_direct.py`,
re-run `bash .hermes/probe-section-O.sh` against the custom domain
(mehyar.us), and if the discovered bundle hash != expected hash, wait
30s and re-run, then if still mismatched, force-rebuild + re-deploy.**
This is a Phase-5 fix candidate (filed as an extension of t_9c9e36c4).

## Next-tick candidates (priority order)

1. **Section R probe extension** (parent t_9c9e36c4) — add the
   "expected bundle hash matches actual bundle hash on custom domain
   after deploy" gate to Phase-5. Cheap (~5s wall time), catches both
   stale-dist and edge-cache-lag failure modes.
2. **Phase-5 build-check** (t_2d07485e) — `npm run build:client` must
   run before any dist/ upload. Already known from turn-065; turn-066
   confirmed the deploy path's separate failure mode.
3. **Re-introduce prospect_messages migration as CLEAN PR** — data
   model is sound (turn-065's revert only removed the broken UI);
   the cron shadow can re-architect the UI to not introduce the
   `$1` sed-replacement artifacts the Mayor pipeline was generating.

## State of the world

- Section G pricing drift: still founder-blocked (`docs/PRICING-LADDER-DRIFT-2026-07-09.md`)
- W5-PERSUADE: still ready (t_45ea76a8), waiting on founder reply
- Mayor Mode: still paused (t_5118925e), digest runtime auth still blocked
- mehyar-us board: 59 tickets in DB, 32 cited, 0 stale
- Live bundle: `main-BdjiOGsU.js` (678,827 bytes) — CANONICAL ✓
- Cron: still disabled (chat_id 6829435996 noted but not wired)