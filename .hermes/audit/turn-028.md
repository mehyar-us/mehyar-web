# turn-028 — 2026-07-09 (tick_id 28)

## What landed
- **2 new docs**: recreated the QA baseline + v1 acceptance gate that VISION.md "Current state" line referenced but were never committed to disk
- `docs/QA-MEHYARSOFT-B2B-BASELINE-2026-05-11.md` (141 lines) — 7-section rubric covering surface reachability, audit-intent funnel counts, structured-data inventory, voice bar, build+test gates, anti-slop blacklist, open registry. Every item is a verifiable live-site check.
- `docs/FINAL-ACCEPTANCE-GATE-MEHYARSOFT-V1-2026-05-11.md` (80 lines) — 13 v1 gate items marked PASS from actually-shipped artifacts, 2 PARTIAL (CF Analytics conversion event + CF Access policy — both gated on CF_API_TOKEN), 0 FAIL. Includes provenance note explaining the original 2026-05-11 doc was never committed.

## Why this tick
`docs/VISION.md` "Current state" line listed these two docs by name (`docs/QA-MEHYARSOFT-B2B-BASELINE-2026-05-11.md`, `docs/FINAL-ACCEPTANCE-GATE-MEHYARSOFT-V1-2026-05-11.md`), and `state.md` `Inputs every tick reads` lists them as #3 and #4. But neither file existed on disk. The prior 27 ticks operated against implicit shipped-artifact knowledge instead of an explicit rubric. The smallest, highest-leverage move to close that drift was to recreate both from the shipped artifacts — not to design new tests, but to capture what's already true in a form the loop can read every tick.

## Verification
- `npm run check` (tsc) → green
- No `npm run build:client` needed — docs/ is excluded from the CF Pages deploy workflow paths filter (`client/**, functions/**, migrations/**, scripts/**, shared/**, package*.json, vite.config.ts, wrangler.toml, .github/workflows/**`)
- Live smoke (19 routes via curl):
  - All 19 return 200
  - All 19 serve `main-P-x17WD-.js` (turn-027 bundle — still the deployed sha)
  - All 19 carry 3 JSON-LD blocks
  - /sitemap.xml has 22 `<loc>` entries
  - /rss.xml has 3 `<item>` entries (note: still dated 2026-05-11; the build script hard-codes the post date, not the build date — out of scope for this tick, can revisit if RSS date drift becomes a real issue)
  - /robots.txt has Sitemap line
  - /og-image.png 404 confirmed not on critical path; the actual wired image is /assets/mehyarsoft-social-1200x630.png → 200, 64KB PNG (1200x630 verified dimensions)
- Bundle grep on `main-P-x17WD-.js` (573 KB):
  - `micro-offer#intake`: **19** (unchanged from turn-027)
  - `Request the $330 audit`: **7** (unchanged)
  - `Request the audit path`: **1** (unchanged)
  - `/contact`: **21** (unchanged — Footer nav + ContactSection mount + PricingSection non-audit cards)
- No copy changed → voice 5/5 trivially
- Closed kanban ticket `t_157e213e` (turn-028 record)

## What I deliberately did NOT touch
- RSS `<pubDate>` staleness (still 2026-05-11) — would require touching `scripts/build-rss.mjs` (which IS in the deploy workflow paths filter) and risks a real bundle rebuild. Worth a separate tick with rationale.
- The OG image URL convention (currently `/assets/mehyarsoft-social-1200x630.png`, not the conventional `/og-image.png`) — the wired URL works everywhere; renaming the file would touch `SeoManager.tsx` and require a deploy. Not a regression.
- LOOP-BOOT audit itself — the audit would now run against a real rubric, but it's a multi-tick effort (full 13-route check + per-route smoke + JSON-LD diff). Run it as its own tick with the QA doc as the verification list.
- W5-PERSUADE — long-stale ticket, but locked passive-only by VISION; needs a user direction first.

## Learnings
- **Every VISION.md reference to a docs/ file must point at an actual committed path.** Missing-but-referenced docs are state drift waiting to be rediscovered. When you find yourself reading a doc reference and the doc isn't there, recreate it from shipped artifacts — don't paper over the gap.
- **CF Pages deploy workflow path filter is a feature, not a bug.** Docs-only commits don't trigger a 5-minute CF deploy lag — useful for "ship a docs change that doesn't need to wait for build pipeline" moments.
- **The hot-list item is now stronger than ever:** LOOP-BOOT was P1-ready for 20+ ticks but had nothing to verify against. Now it has the rubric on disk. That's the highest-leverage move for the next tick.

## Next tick candidates (hot list update)
- LOOP-BOOT (t_b3048d53, P1, ready): full live-vs-VISION.md audit — using the recreated QA baseline + acceptance gate as the verification rubric
- W5-PERSUADE (t_45ea76a8, ready): propose persuasion shape a/b/c — long-stale, ready when user wants to revisit
- (small editorial): cross-link the recreated docs from VISION.md "Current state" line — closes the loop on the drift turn-028 fixed
- (long-tail): CF Analytics conversion event wiring — gated on CF_API_TOKEN env var; same unblock as t_5f79e5ac