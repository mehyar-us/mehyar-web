# turn-018 · feat(seo): per-blog-post route meta (sha f9555f3)

## summary
Additive SEO: added 3 per-blog-post routes to the routeMeta map in
`scripts/copy-route-shells.mjs` so the pre-rendered shells for
`/blog/small-business-tech-audit-revenue-leaks`,
`/blog/missed-calls-crm-follow-up`, and
`/blog/when-to-build-custom-software` ship unique title, description,
canonical, og:title, og:description, twitter:title, and
twitter:description. Before: crawlers hit the home page meta on every
blog post URL. After: each post ships its own meta. Zero copy edits,
zero component changes, zero risk to runtime SPA path (which was already
correct via SeoManager's `/blog/*` handler).

## what changed
- `scripts/copy-route-shells.mjs` — added 3 entries to `routeMeta`. 18
  net lines, all additive. No other files touched.

## why
The runtime SPA path was already shipping correct meta (SeoManager
resolves `/blog/<slug>` from `client/src/data/blog-posts.ts`). But the
pre-rendered shell at `dist/public/blog/<slug>/index.html` is what
no-JS crawlers, link unfurlers, and social-card debuggers see on first
fetch. Before this tick, those shells fell back to the home page meta
because the routeMeta map had no entry for the deep blog paths. Now
they ship the post's own title + description + canonical. Same pattern
as turn-013 (sitemap canonical) and turn-016 (Person JSON-LD on
/about).

## shipped commit
- sha: f9555f3 (merge: improver/blog-post-meta-turn-018)
- branch: improver/blog-post-meta-turn-018 (deleted after merge)
- commit body: `feat(seo): per-blog-post route meta for 3 articles (turn-018)`
- push: main 16984e6 → f9555f3, CF Pages auto-deploy from main.

## tested
- local `npm run build:client` — vite build green (1699 modules, 1.90s),
  34 routes + 404 fallback emitted (was 31 + 404), 3 JSON-LD blocks
  injected, RSS rebuilt (3 items).
- local `npm run test:intake` — 11/11 ✓ (D1, KV, notification chain).
- local `grep -E '<title|description|canonical' dist/public/blog/<slug>/index.html`
  × 3 — each shell ships unique title + description + canonical ✓
- live `curl -sL https://mehyar.us/blog/small-business-tech-audit-revenue-leaks/`
  — 200 ✓, unique meta present.
- live `curl -sL https://mehyar.us/blog/missed-calls-crm-follow-up/`
  — 200 ✓, unique meta present.
- live `curl -sL https://mehyar.us/blog/when-to-build-custom-software/`
  — 200 ✓, unique meta present.
- live `curl -sI https://mehyar.us/micro-offer/` — 200 ✓
- live `curl -sI https://mehyar.us/booking/` — 200 ✓
- live `curl -sI -X OPTIONS https://mehyar.us/api/intake` — 204 ✓
- live `curl -sI https://mehyar.us/rss.xml` — 200 ✓
- voice scan: no em dashes, no corporate-speak, problem-first titles,
  named-price copy where applicable. 5/5.

## risks & rollback
- risk: very low. Build-step only change, no runtime component
  changes, no copy edits. If a routeMeta entry has a typo, build fails
  or the meta is wrong — both caught by the build + live curl smoke.
- rollback: `git revert f9555f3` removes the 3 entries; next build
  emits shells with home-page meta again (status quo ante). ~30s cold
  revert; ~5min CF Pages redeploy.

## what's next
- W5-PERSUADE (t_45ea76a8, ready): the spec doc is the largest leverage
  remaining on the board, but it requires writing
  `docs/PERSUASION-PROPOSAL.md` (a real spec, not just code). Persuasion
  shape is locked to passive-only per the cron prompt, so the doc's
  job is to defend the lock with named shapes a/b/c and pick one.
- LOOP-BOOT (t_b3048d53, ready): full live-vs-VISION.md audit. Now
  that W1-SLOP and W4-SEO are both closed, the loop has accumulated
  ~6 ticks of work — a fresh audit is the right move before designing
  the next batch.

## state.md ops
- turn count: 16 → 18 (state.md was stale at 16; turn-017's home
  BlogSection + ItemList JSON-LD landed between turn-016 and this
  tick but state.md was never bumped)
- deployed_sha: 6dd002f → f9555f3
- last_tick_id: 16 → 18
- board open/ready counts: now 3 ready (W5-PERSUADE, LOOP-BOOT,
  BOARD-HANDOFF); closed t_ee6fde13 (turn-018 done ticket), t_53436949
  + t_d514cd6e (turn-013 duplicate pair)
- local drift: 0 (main is up to date with origin)