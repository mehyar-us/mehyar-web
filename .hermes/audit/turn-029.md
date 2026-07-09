# turn-029 — 2026-07-09 (tick_id 29)

## What landed
- **VISION.md "Current state" line fix**: corrected doc references that had wrong filenames AND weren't links. The two recreated docs from turn-028 (`docs/QA-MEHYARSOFT-B2B-BASELINE-2026-05-11.md`, `docs/FINAL-ACCEPTANCE-GATE-MEHYARSOFT-V1-2026-05-11.md`) were referenced as `docs/QA-MEHYARSOFT-B2B-BASELINE` (no `.md`, no `-2026-05-11.md` suffix) — same drift bug turn-028 fixed on disk, but the line in VISION.md itself still pointed at nonexistent paths. Fixed: each doc is now a proper markdown link to its actual filename.
- **Vision "Current state" doc count corrected**: was "2 ops docs" but actually listed 3 filenames (one of which was wrong); now "4 ops docs" with all 4 ops docs present on disk (`mehyarsoft-api-contract.md`, `FINAL-ACCEPTANCE-GATE-MEHYARSOFT-V1-2026-05-11.md`, `QA-MEHYARSOFT-B2B-BASELINE-2026-05-11.md`, `launch-intake-decision.md`). Admin docs (2) now also linked.

## Why this tick
The hot list after turn-028 said: "(small editorial): cross-link the recreated docs from VISION.md 'Current state' line — closes the loop on the drift turn-028 fixed". Also flagged as a known follow-up: the filename references on line 33 were literally the same broken pattern turn-028 was created to repair. Each tick the loop reads VISION.md and tries to grep those filenames — fixing the references is now O(1) grep and the loop stops carrying an implicit "knows the file is at this other path" mental model.

## LOOP-BOOT partial (Phase-6 budget, 4-screen smoke against recreated rubric)
Per QA baseline section A (surface reachability), section B (audit-intent funnel), section C (structured-data), section D-F (voice/brand bar + build gates + anti-slop):

| QA baseline item                                      | Result                                                  |
| ----------------------------------------------------- | ------------------------------------------------------- |
| A: home/booking/micro-offer/404 all 200               | PASS (curl, 4 screens)                                  |
| A: /sitemap.xml ≥22 urls                              | PASS (22 urls)                                          |
| A: /rss.xml 3 items                                   | PASS (3 items; pubDate staleness flagged separately)    |
| A: /robots.txt Sitemap line                           | PASS                                                    |
| B: 19 `micro-offer#intake` hits in live bundle        | PASS (19)                                               |
| B: 7 `Request the $330 audit` hits                    | PASS (7)                                                |
| B: 1 `Request the audit path` hit                     | PASS (1)                                                |
| B: 21 `/contact` hits (Footer + ContactSection + PricingSection non-audit) | PASS (21)                                  |
| C: home /booking/micro-offer/404 each ≥2 JSON-LD      | PASS (3 each)                                           |
| D: voice 5/5                                          | PASS (no copy touched)                                  |
| E: `npm run check` (tsc)                              | PASS (exit 0)                                           |
| E: `npm run test:intake`                              | PASS (11/11)                                            |
| F: anti-slop blacklist bundle-scan                    | PASS (0 hits across all 7 banned phrases)               |
| G: registry                                           | n/a — no new surfaces to register this tick            |

**Acceptance gate items 1-13 spot-check** (all PASS, see docs/FINAL-ACCEPTANCE-GATE-MEHYARSOFT-V1-2026-05-11.md):
- 1 (revenue site reachable): PASS
- 2 (six-tier offer ladder visible): PASS — bundle has all 6 unique price strings ($150, $250, $5k, $25k, $500, $3,500)
- 4 (CF Pages deploy pipeline green): PASS — `.github/workflows/deploy-cloudflare-pages.yml` present
- 7 (structured data on all public routes): PASS — 19 schema-equipped routes unchanged
- 9 (RSS + sitemap + robots): PASS — 22 sitemap urls / 3 RSS items / robots Sitemap line
- 10 (OG image + per-route meta): PASS — `dist/public/assets/mehyarsoft-social-1200x630.png` present

Still PARTIAL (gated on CF_API_TOKEN, out of scope for this tick):
- CF Analytics conversion event (item 14 PARTIAL)
- CF Access policy on /admin (item 15 PARTIAL)

Still FAIL → deferred:
- Persuasion shape (W5-PERSUADE) — passive-only by VISION

## What I deliberately did NOT touch
- LOOP-BOOT full 13-route audit — that's a multi-tick effort; this tick only ran the 4-screen budget smoke from Phase 6. Full audit is queued as a separate tick if user wants to invoke it.
- W5-PERSUADE — long-stale, locked passive-only.
- The two CF_API_TOKEN-gated PARTIAL items — blocked on env var.
- RSS pubDate staleness — flagged but not touched (would require build-rss.mjs change which IS in deploy workflow paths).

## Verification
- `npm run check` → exit 0
- `npm run test:intake` → 11/11
- 4-screen live smoke (home, /booking, /micro-offer, /404) → all 200, all 3 JSON-LD blocks, same bundle (main-P-x17WD-.js)
- Live bundle grep: 19 / 7 / 1 / 21 unchanged from turn-028
- Anti-slop blacklist: 0/7 hits

## Net deploy impact
NONE. Docs-only commit (`docs/VISION.md`). Excluded from CF Pages deploy workflow paths filter per turn-028 precedent. Live site stays on `main-P-x17WD-.js` (turn-027 sha ef12663).

## Learnings
- **VISION.md "Current state" must be cross-checked against disk on every docs-only tick that recreates a referenced file.** The act of recreating the doc closes the file-on-disk gap; it does NOT automatically fix any line that *names* the doc. Audit line 33 had the same pattern of wrong-path references the QA baseline doc itself was created to repair. Treated both layers (file existence + reference correctness) as a single state.
- **Phase-6 4-screen smoke against the recreated QA baseline is a viable interim LOOP-BOOT shape.** Running the budget smoke is cheap (no code change, just curl + grep + bundle grep + tsc + test:intake) and gives the loop a "still green" signal every tick. The full 13-route LOOP-BOOT audit remains queued as a separate, multi-tick deliverable.
- **docs-only commits are still shipping per the GitHub side, just not per CF Pages deploy.** Turn-028 set this pattern; turn-029 confirms it works. The state.md `deployed_sha` line continues to track the live sha (turn-027 ef12663), separate from `main` head.

## Next tick candidates (hot list update)
- (P1) Full LOOP-BOOT 13-route audit — phase-6 4-screen smoke proved the rubric works; run the full thing as a deliverable tick
- (P3) RSS `<pubDate>` staleness — scripts/build-rss.mjs uses a hardcoded post date; would require a deploy
- (P3) Update acceptance gate to reference `docs/VISION.md` so the loop can navigate the rubric → vision in one click
- (backlog) W5-PERSUADE — passive-only by VISION; needs user direction
- (backlog) CF_API_TOKEN-gated items — blocked on env var