# turn-041 — working-tree hygiene (docs-only)

**sha:** bf1a21b (companion: this file)
**branch:** main → github main (verified via api.github.com at write-time)
**deploy:** none — docs-only, live bundle main-BKU1Uoxy.js unchanged from turn-036 c33755d
**author:** improver (mehyar-us-improve-loop, cron 15m shallow)

## What shipped

6 files changed, 434 insertions(+):

| file | type | what |
| --- | --- | --- |
| `.gitignore` | edit (+24) | block future recurrence of root-level *{_live.html, mehyar_*.html, mehyar_*.xml, *_live.html, p_[N].html, ...} probe snapshots, the probe-section-{H,J} cached bundle/home files, and the `.hermes/audit/*` non-.md noise |
| `.hermes/audit/turn-018.md` | add (84 lines) | past-tick audit record, never committed |
| `.hermes/audit/turn-028.md` | add (45 lines) | past-tick audit record, never committed |
| `.hermes/audit/turn-034.md` | add (152 lines) | past-tick audit record, never committed |
| `.hermes/audit/turn-039.md` | add (74 lines) | past-tick audit record, never committed |
| `.hermes/patch_home_jsonld.py` | add (55 lines) | reusable turn-030 script (adds WebPage + BreadcrumbList JSON-LD to home entry in scripts/route-jsonld.json — CRLF + 2-space-indent + idempotent + handles existing blocks as no-op) |

## Files removed (untracked, not referenced anywhere)

24 root-level probe captures (blog_live.html, home_live.html, the mehyar_*_live.html/.xml set, mo_live*.html, nf.html, p_[1-6].html, micro-live-fresh.html) plus 2 cached probe bundles (.hermes/.probe-section-{H,J}-bundle.js).

## Why this tick

Working-tree status before turn-041:

```
69 untracked files
```

- 24 stale root-level curl snapshots (probe runs that `curl -o <name>.html` into the repo root instead of `.hermes/audit/`)
- ~40 stale artifacts in `.hermes/audit/` (HTML captures, JS bundle snapshots, PNGs, PR JSONs, telegram-card-*.txt) — only the structured `.md` files are legitimate loop records
- 2 cached probe bundles from probe-section-{H,J}.sh runs
- 4 audit `.md` files that past ticks created on disk but forgot to `git add`
- 1 reusable python script (turn-030's patch_home_jsonld.py) that was untracked

Two separate drifts:
1. **Accumulation drift** — every probe run adds 1-3 untracked files; never removed, never gitignored. The risk: a fast tick that does `git add -A` ships 70+ probe snapshots to main. (Hasn't happened yet but the surface area kept growing.)
2. **Audit-record-tracking drift** — 4 audit `.md` files exist on disk in `.hermes/audit/` but were never `git add`-ed. Past ticks journaled them in VISION.md, but the actual files never landed in the repo. They'd have shown up as missing if anyone did a `git ls-files .hermes/audit/` check.

The audit-record drift was the more embarrassing one — VISION.md iteration-diary lines referenced `audit/turn-018.md`, `audit/turn-028.md`, `audit/turn-034.md`, `audit/turn-039.md` (via "Audit log: .hermes/audit/turn-XXX.md" in the corresponding telegram-card-*.txt). The files existed on disk but not in git.

## Verification matrix

| check | result |
| --- | --- |
| `npm run check` (tsc) | green, 0 errors |
| `npm run test:intake` | 11/11 PASS |
| 4-screen Phase-6 (home/booking/micro-offer/this-does-not-exist) | 200 / 200 / 200 / 404 (booking + micro-offer redirect via 308 to canonical URLs) |
| Section G probe (`bash .hermes/probe-section-G.sh`) | FAIL exit 1 (tier-1=$150 intake=$330 — pricing drift still open, founder-decision-blocked, expected) |
| Section H probe (`bash .hermes/probe-section-H.sh`) | PASS — 9/9 green on live bundle main-BKU1Uoxy.js (574085 bytes) |
| Section J probe (`bash .hermes/probe-section-J.sh`) | PASS — 9/9 green on live bundle main-BKU1Uoxy.js (574085 bytes) |
| Voice 5/5 | unchanged (no copy touched) |
| Anti-slop blacklist 0 hits on local + live | unchanged |
| git push origin main | success (999496f → bf1a21b) |
| remote head verification (api.github.com GET /repos/mehyar-us/mehyar-web/commits/main) | sha bf1a21b4312f4e8b100c6ac2f947cc04e431993d, msg "chore(loop): turn-041 — working-tree hygiene" ✓ |
| working tree | 69 untracked → 6 untracked (4 audit `.md` now tracked, 1 reusable `.py` now tracked; `.hermes/probe/` left for next tick — contains mixed transient snapshot + script files) |

## Open after this tick

- `.hermes/probe/` dir is still untracked (5 files: home.html snapshot, 3 turn-017/019/020 .py probe scripts, 1 extract-services.py). Worth a follow-up tick to decide which are reusable vs transient.
- Section G pricing drift still FAIL — founder decision required on docs/PRICING-LADDER-DRIFT-2026-07-09.md options A/B/C. Loop will NOT ship pricing autonomously.
- W5-PERSUADE (t_45ea76a8) still ready, still founder-decision-blocked (passive-only locked).
- Live bundle main-BKU1Uoxy.js still on turn-036 c33755d — no CF Pages deploy this tick.

## Lesson (long-form)

A docs-only hygiene tick is a 10-minute wall-time investment that prevents two real failure modes:

1. **The "git add -A ships probe snapshots" failure mode.** Fast ticks under time pressure reach for `git add -A`. Without gitignore patterns blocking the noise, every probe snapshot is one fast tick away from main. 24 root-level `.html/.xml` files + 80 `.hermes/audit/*` artifacts = 104 files at risk. Now they're gitignored; future `git add -A` is safe.

2. **The "audit record exists on disk but not in repo" failure mode.** This one is sneakier — VISION.md journaled 4 turns as having "audit/turn-NNN.md" records, but `git log --diff-filter=A -- .hermes/audit/turn-018.md` returns empty. The file was created and journaled but never added. The drift only surfaces when someone runs `git ls-files .hermes/audit/` vs `ls .hermes/audit/turn-*.md` and compares. The new gitignore `!.hermes/audit/*.md` exception now allows the next tick to see untracked `.md` files in audit/ via `git status` — previously the noise drowned them out.

The cheapest recurring check is one line:

```bash
ls .hermes/audit/turn-*.md 2>/dev/null | xargs -I{} basename {} .md | sort > /tmp/on-disk.txt
git ls-files .hermes/audit/turn-*.md | xargs -I{} basename {} .md | sort > /tmp/in-repo.txt
diff /tmp/on-disk.txt /tmp/in-repo.txt && echo OK || echo DRIFT
```

Worth adding as `probe-section-K.sh` (the rubric-extension candidate the turn-040 diary noted) — track audit-record-tracking drift automatically.