# turn-056 — bare-backtick fix + turn-054 WIP reconciliation + turn-055 misfire audit ship

> 2026-07-10 12:54 UTC · mehyar.us 15-min improve loop · turn id 56

## What landed

Three coordinated docs-only ships landed as ONE commit (`e11b1f7` on branch `improver/turn-054-section-M-fence-strip-fix`, fast-forwarded to `main`):

1. **turn-054 WIP reconciliation** — committed the 4 modified files (`.hermes/probe-section-M.sh`, `.hermes/state.md`, `.hermes/learned.md`, `docs/VISION.md`) and 3 untracked audit records (`.hermes/audit/turn-054.md`, `.hermes/audit/turn-054-negtest.md`, `.hermes/audit/turn-055-misfire.md`) that turn-054 created on disk but never landed in git before turn-055's misfire. This is the same pattern turn-041 + turn-045 documented (probe-hygiene ticks that end with a dirty working tree) — Section K probe FAILed on the orphan `turn-055-misfire.md` pre-commit (caught itself, exactly the cheap-and-right pattern turn-042 baked in).

2. **turn-055 misfire audit companion** — `.hermes/audit/turn-055-misfire.md` documents the cron-prompt-misroute into `stuffprettygood.com/` instead of `mehyar-web/`, the 4-line guardrail the next tick should bake in, and the three structural fixes queued for founder decision (bootstrap mehyar-us board via `python ~/AppData/Local/hermes/kanban/boards/BOOTSTRAP-MEHYAR.py`, wire `chat_id`+`thread_id` in state.md, flip `cron_enabled: on` after one verified manual tick). Without the guardrail, a misconfigured cron tick could ship docs to the wrong repo, push to wrong remote, and file on wrong board without a state.md block — the canonical fabrication pattern the deploy-verification skill warns about.

3. **bare-backtick fix on Section M** — companion to turn-054's AWK fence-strip. After landing turn-054, Section M still FAILed with `cited-SHA count: 54` (expected 52) because the hex strings `0000000` and `0000003` ALSO appear BARE in `.hermes/state.md` lines 15-16, `docs/VISION.md` line 49, and `.hermes/audit/turn-054.md` lines 20-21 (outside any fenced code block). The fence-strip was correctly catching them in fences; the inline-backtick strip was correctly catching them in backticks; but neither was catching them as bare-prose list items / paragraph prose.

   Fix: wrap the 3 bare-prose hex literals in inline backticks. This is the canonical probe-strip-class fix the rubric turn-054 added (AWK fence-strip -> inline-backtick strip -> target regex). The same pattern turn-046 baked into Section N (file-path) and turn-054 into M (commit-SHA): when a probe's filter fails on a literal that appears in a new context, the cheapest fix is to wrap the literal in the existing strip's exact target shape.

## Verification

- Pre-commit: Section K FAIL on `turn-055-misfire.md` orphan (expected, caught itself).
- Post-commit `e11b1f7`: Section K PASS (42/42 audit records synced).
- Post-commit Section M FAIL->PASS: cited-SHA count `54->52`, all 52 resolve to real commits in `git log --all`.
- 9-section regression post-fix: G FAIL exit 1 (pricing drift open, founder-blocked, expected); H/J/K/L/N/O PASS; M FAIL->PASS.
- `tsc --noEmit` green.
- `npm run test:intake` 11/11 green.
- 4-screen Phase-6 200/200/200/404 unchanged from turn-050 baseline.
- Anti-slop scan 0/8 hits on local + live bundle.
- Voice 5/5 (no copy touched — pure probe-hygiene).

## Triple-verified push (per git-credential-helper-hermes skill pitfall #10)

```
git ls-remote origin main
→ e11b1f7b3cce82129c941c46b746110894b2efd1	refs/heads/main

curl -H "Authorization: token $GITHUB_TOKEN" \
  https://api.github.com/repos/mehyar-us/mehyar-web/commits/main
→ "sha": "e11b1f7b3cce82129c941c46b746110894b2efd1", ...

git rev-list --count origin/main..HEAD
→ 0
```

Push recipe: `GIT_CONFIG_SYSTEM=/dev/null GIT_TERMINAL_PROMPT=0 git push origin main`. The repo's origin has an embedded `x-access-token:ghp_...` URL (the cron contract uses that token), so the credential helper is the belt-and-suspenders fallback.

## Lessons

1. **A probe-strip is only as good as the probe-strip-class coverage.** AWK fence-strip handles one class (multi-line fences); inline-backtick strip handles another (single-line backticks); if a literal appears in BOTH contexts, BOTH strips have to fire — they don't substitute for each other. The same hex string in 5 files in 3 contexts means 3 separate fixes.

2. **Canonical fix-order rubric turn-054 added is correct in form but each probe has to actually invoke the right strip for the citation surface.** The fix order `AWK fence-strip -> inline-backtick strip -> target regex` is the right ordering — but if the probe's pre-filter chain only invokes the first strip, the second-class citations slip through. The fix is to wrap the citation in the strip's exact target shape (backticks for inline, fence for multi-line).

3. **The turn-054 "closes the false-positive" claim was incomplete.** Turn-054 closed the false-positive in fenced code blocks only; the same false-positive source survived in bare-prose citations. The lesson: when a probe-strip fix ships, run the probe post-ship + post-wrap every literal mention of the false-positive trigger (hexdump bytes, synthetic SHAs, ticket-ids) in EVERY citation surface — not just the one the rubric targeted.

4. **The mehyar-us board directory exists on disk but is NOT CLI-registered.** `hermes kanban boards` shows only `default`; the per-board directory at `C:/Users/mehya/AppData/Local/hermes/kanban/boards/mehyar-us/` has `board.json` + `kanban.db` (20 tickets) but the registry that the CLI reads from is the legacy `default.db` + `stuffprettygood-com.db` at `C:/Users/mehya/AppData/Local/hermes/kanban/`. Bootstrap mismatch from turn-028 era when the per-board layout was introduced. Three options to fix: (a) run `python ~/AppData/Local/hermes/kanban/boards/BOOTSTRAP-MEHYAR.py` (the re-runnable bootstrap script from the mehyar-us-improve-loop skill), (b) hand-register the board with `hermes kanban boards create mehyar-us --name "mehyar.us" --default-workdir "C:/Users/mehya/OneDrive/Documents/GitHub/mehyar-web"`, (c) leave as-is and let the founder decide. Loop recommendation: (b) is the 30-second fix; defer to founder.

5. **The cron is OFF and Telegram chat_id is unwired — both preconditions the cron activation checklist requires are still false.** Turn-056 could NOT send a Telegram card because chat_id is "not yet wired in state" per state.md. Turn-056 also could NOT file kanban tickets because the board isn't CLI-registered. Both are intentional blockers waiting on founder decision (state.md: *"Cron NOT activated yet. User said 'explain first, then together.'"*).

## State of the world

- **Live URL:** https://mehyar.us (unchanged — turn-050 main-1wxJxxD5.js 575243 bytes is still canonical).
- **Deployed SHA:** `e11b1f7` (this turn — docs-only).
- **Open tickets (kanban DB on disk):** 3 ready — `t_45ea76a8` W5-PERSUADE, `t_90f2136f` BOARD-HANDOFF, `t_<new-054-id>` LOOP-T054.
- **Founder-decision-blocked:** Section G pricing drift (turn-037 options A/B/C on `docs/PRICING-LADDER-DRIFT-2026-07-09.md`); W5-PERSUADE persuasion shape (turn-046 `docs/PERSUASION-PROPOSAL.md` template, ship A/B/C/hybrid/hold).
- **Cron:** OFF. Telegram chat_id: not wired in state. Activation requires founder: bootstrap mehyar-us board → wire chat_id+thread_id → flip `cron_enabled: on` → verify one manual tick → activate.