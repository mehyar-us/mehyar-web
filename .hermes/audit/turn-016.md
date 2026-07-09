# turn-016 — 2026-07-09 — Person + AboutPage JSON-LD on /about

## shipped
- feat(seo): Person schema + AboutPage + BreadcrumbList injected into the static
  /about shell via `scripts/inject-route-jsonld.mjs` (same pattern as turn-011's
  /micro-offer FAQPage). New `@id` `https://mehyar.us/about#person` cross-links
  to the existing ProfessionalService @id so the graph stays coherent for
  crawlers.
- branch: `improver/about-person-schema-turn-016`
- sha: `6dd002f` (merge commit on main)
- files changed: 1 (`scripts/route-jsonld.json`, +74 lines)
- lines of copy touched: 0 (zero — additive only)

## why this move
- W4-SEO has been "closed" since turn-003 but the loop has shipped two further
  additive SEO wins (turn-011 FAQPage on /micro-offer, turn-015 /rss.xml +
  auto-discovery). /about was the obvious gap — no Person schema meant the
  founder-led angle wasn't machine-readable for E-E-A-T signal.
- VISION.md voice rule: "founder-led, anti-AI-slop, leak-first consulting tone."
  Person schema encodes that premise literally.
- Smallest possible surface area (one data file, no UI), highest signal-to-noise.

## voice scoring
- 5/5 — no copy changed. All new strings are structured-data claims that mirror
  page copy already approved by VISION.md (Syrian founder, NYC, 10+ yrs,
  MehyarSoft LLC).

## tested
- local `node -e "JSON.parse(...)"` — JSON valid ✓
- local `npm run build:client` — vite build green, 2 shells injected ✓
- local `npm run test:intake` — 11/11 ✓
- local `grep -oE 'secure intake|we leverage|trusted partner|AI-powered'
  dist/public/assets/*.js dist/public/about/index.html` — empty ✓
- live `curl -sL https://mehyar.us/about/` — fetched to
  `.hermes/about-live.html` (9611 bytes) ✓
- live parse of route-injected block — @graph has 3 nodes (AboutPage, Person,
  BreadcrumbList), all @id cross-refs resolve on the page ✓
- live /api/intake OPTIONS — 204 ✓
- live /rss.xml — 200 ✓
- live /330 → /micro-offer — 308 chain intact ✓
- lighthouse: skipped (no headless runner wired; deferred per state.md)

## risks & rollback
- risk: schema.org entity conflict with runtime SeoManager's ProfessionalService
  (also references Person Mehyar Swelim). Verified both blocks coexist on the
  live page with the same founder name; Google's Rich Results Test treats
  cross-block @id unification as expected.
- rollback: `git revert 6dd002f` removes the route-jsonld.json /about entry;
  build re-injects no Person block, runtime still ships the existing graph.
  ~30s cold revert.

## what's next
- W5-PERSUADE (t_45ea76a8, ready): produce `docs/PERSUASION-PROPOSAL.md` with
  three shapes (a/b/c). Largest leverage remaining on the board, but the
  class-level hard rules mean this needs a real spec doc, not just code.
- LOOP-BOOT (t_b3048d53, ready): post-acceptance audit vs VISION.md. Lower
  urgency now that W4-SEO and W1-SLOP are both closed.

## state.md ops
- turn count: 14 → 16 (state.md was stale at 14; turn-015 rss feed had landed
  before but state was never updated)
- deployed_sha: ed89cdd → 6dd002f
- last_tick_id: 14 → 16
- board open/ready counts: now 4 ready (W5-PERSUADE, LOOP-BOOT, BOARD-HANDOFF,
  plus one duplicate turn-013 sitemap ticket); closed t_cb95aca4