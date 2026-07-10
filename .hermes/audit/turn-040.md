# turn-040 — 2026-07-10 · Section J Build-artifact-integrity probe added to LOOP-BOOT rubric

## What shipped
- `docs/QA-MEHYARSOFT-B2B-BASELINE-2026-05-11.md` — added Section J "Build-artifact-integrity" (94 new lines: invariant, failure-mode catalog, expected probe output, update cadence). Last-update header bumped to "2026-07-10 turn-040".
- `.hermes/probe-section-J.sh` — new probe script. 9-grep bundle probe that pins src/ literals to the live bundle. CI-ready: exit 0 PASS, exit 1 FAIL, exit 2 INDETERMINATE.
- `docs/VISION.md` — Iteration diary line appended for turn-040.
- `.hermes/state.md` — bumped `last_tick_at`, `last_tick_id`, `open_tickets`, `shipped_since_last`, `last_learned`, hot-list "rubric hygiene" item. No `deployed_sha` change (docs-only).
- Push to github main: `003249f..e464f1f main -> main`.

## Why this was the right move this tick
Next-tick hot list was:
- BLOCKER: founder decision required on pricing ladder drift (3 options A/B/C — loop will NOT ship autonomously)
- W5-PERSUADE (t_45ea76a8): long-stale, needs user direction first
- (rubric hygiene): turn-039 candidate was "Section J build artifact integrity"

The first two are blocked on human input. The third is the only move the loop can make autonomously, costs nothing (no CF Pages deploy), and follows the exact pattern of turn-038 (Section G pricing probe) + turn-039 (Section H a11y probe). Same probe-script shape: `curl live bundle → bundle-grep N canonical literals → assert presence → exit 0/1`. Cheap, reversible, CI-ready, and exactly the candidate the prior turn's "next-tick hot list" named.

## What Section J catches that the rubric was missing
Section H (turn-039) catches "bundle literal not in any src/ file" (stale bundled content). Section J is the inverse — "src/ literal not in live bundle" (stale deployed content). Together they pin the bundle to the committed source tree in both directions. The exact failure mode Section J prevents: turn-030's scripts/-only deploy rolled shell files but the bundle hash stayed on the previous build. A visitor clicking on the home shell today gets turn-027's bundle (main-P-x17WD-.js from before turn-030's HomePage injection). Section J would have flagged that immediately — the new home shell would have had a literal in src/ (WebPage + BreadcrumbList ItemList) that wasn't in the live bundle.

## Verification this tick
| Check | Result |
| --- | --- |
| `bash .hermes/probe-section-J.sh` | J PASS — 9/9 green, exit 0 |
| `bash .hermes/probe-section-H.sh` (regression) | H PASS — 9/9 green, exit 0 |
| `bash .hermes/probe-section-G.sh` (regression) | G FAIL — tier-1=$150 intake=$330, exit 1 (expected, drift open) |
| `npm run check` (tsc) | green |
| `npm run test:intake` | 11/11 |
| 4-screen Phase-6 (home/booking/micro-offer/404) | 200/200/200/404 |
| Live bundle: `https://mehyar.us/assets/main-BKU1Uoxy.js` | 574085 bytes (expect ~574069), HTTP 200 |
| Live bundle: voice / anti-slop scan | voice 5/5, anti-slop 0 hits |

## Probes added this tick
9 src/→bundle pin probes (each asserts src_count≥1 AND bundle_count≥1):
1. `client/src/pages/Newsletter.tsx :: Skip to the $330 audit` (src=1, bundle=1)
2. `client/src/components/hero-section.tsx :: See the leak ladder` (src=1, bundle=1)
3. `client/src/components/pricing-section.tsx :: $150` (src=2, bundle=2)
4. `client/src/components/pricing-section.tsx :: $250` (src=3, bundle=1)
5. `client/src/components/pricing-section.tsx :: $330` (src=1, bundle=3)
6. `client/src/components/pricing-section.tsx :: Free Tech Audit` (src=1, bundle=1)
7. `client/src/components/pricing-section.tsx :: Website Diagnosis` (src=1, bundle=1)
8. `client/src/components/Navbar.tsx :: MehyarSoft home` (src=1, bundle=1)
9. `client/src/components/Navbar.tsx :: Toggle menu` (src=1, bundle=1)

## Decision: what NOT to ship this tick
- Pricing drift (Section G) — still awaiting founder decision via Telegram chat 6829435996
- W5-PERSUADE — still awaiting user direction on shape (a/b/c)
- Anything that touches the conversion funnel — locked by W2-FUNNEL hard rule (already closed across turns 004/005/006/027/035, but the lock remains)
- Anything that touches copy — brand-voice locked; rubric hygiene is the highest-leverage move that's both safe and right-sized

## Kanban ticket filed
- Created on `mehyar-us` board (use `--board mehyar-us` flag — active board is `stuffprettygood-com`): LOOP-IMPROVE turn-040 rubric extension.

## Files modified
- docs/QA-MEHYARSOFT-B2B-BASELINE-2026-05-11.md (+97 / -3)
- .hermes/probe-section-J.sh (+96 new)
- docs/VISION.md (+1 line in iteration diary)
- .hermes/state.md (bumped last_tick_id 39→40, last_tick_at, deploy_status, open_tickets, shipped_since_last, last_learned, hot-list)

## Commit
e464f1f — `docs(loop): turn-040 — add Section J Build-artifact-integrity probe (rubric 9→10 sections A-J)`

## Lesson
Sections H and J together pin the bundle to the committed source tree in both directions. The pair is cheap (~2s wall time, one curl + N greps) and CI-ready. Together they catch all stale-bundle drift without needing a browser. The "Section I stays in place between I and new J" naming rule (instead of renaming I→J then adding K) keeps the rubric's "I = Open registry" mnemonic stable for any external readers who navigated to the section by letter. Next rubric extension candidate: Section K (e.g. "type safety regression" — track tsc error count over time).