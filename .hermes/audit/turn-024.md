# turn-024 · /blog WebPage + Blog + BreadcrumbList + ItemList JSON-LD

- **Date**: 2026-07-09 15:19 UTC
- **Tick id**: 24
- **Branch**: `improver/blog-index-jsonld-turn-024`
- **Deployed sha**: `ab72cba` (main, after merge of `eca3e6d`)
- **Live**: https://mehyar.us/blog

## what shipped

4-block @graph injected into the pre-rendered `/blog/index.html` shell via the
`scripts/route-jsonld.json` pipeline (same idempotent marker pattern as
turns 16-23):

1. **WebPage** (`#webpage`) — page identity, mirrors the home `/about`/etc. shape
2. **Blog** (`#blog`) — schema.org/Blog type with `blogPost` array referencing
   the 3 individual `#blogposting` @ids (which are the per-post JSON-LD blocks
   already shipped in turn-019). This is the first place the Blog type appears
   on the site; cross-references the ProfessionalService @id for the publisher.
3. **BreadcrumbList** — Home > Blog
4. **ItemList** (`#post-index`) — 3 blog posts, descending by recency, mirrors
   the home page's `#blog-index` block but anchored to `/blog` so the index
   page has its own post-list semantic

Zero copy touched. Zero new dependencies. Zero new runtime code.

## metrics

- **Build**: green (vite 1.98s, 17 shells + 404)
- **Tests**: `test:intake` 11/11
- **Cross-route smoke**: 17/17 markers served (turn-022 pattern; looped over
  every jsonld-equipped route to confirm zero sibling regressions)
- **Voice scan**: clean (1 hit for "leverage" is a legitimate blog-post
  body use, not the corporate-speak "we leverage" pattern from the slop list)
- **/blog @graph blocks**: 4 (WebPage + Blog + BreadcrumbList + ItemList)
- **Live shell JSON-LD blocks**: 3 (original ProfessionalService + FAQPage +
  new route-injected @graph)

## W4-SEO additive piece — current coverage

17 routes with route-injected JSON-LD: home, about, blog, micro-offer,
booking, services, portfolio, portfolio/1..6, contact, 3 blog posts.

Remaining no-schema routes (intentionally): /404, /newsletter,
/free-checklist, /sitemap, /330 redirect, /billing, /billing-result,
/unsubscribe, /admin, /admin-opportunity-scout. Most of these are
utility/funnel/legal/admin — not high-value SERP surfaces.

## state.md reconciliation

- Was at turn-022 (sha 9f7c4c6) per state.md, but main was at turn-023
  (sha af2c138 — portfolio detail pages) and turn-023 was never journaled.
- Bumped state.md to turn-024 (sha ab72cba).
- Turn-023 ticket filed retroactively (`t_e54ad127`) and closed.
- Turn-021 ticket `t_96bc8b84` was still showing in ready (state.md claimed
  it was closed) — closed retroactively during this tick's reconciliation.
- VISION.md iteration diary appended with this tick's line.
- learned.md appended with the keys/indent/diff-noise lesson.

## lesson added (also in learned.md)

**Preserve original file format when programmatically editing JSON config
files.** `python -c "json.dump(...)"` re-sorts keys and re-indents the
whole file, generating a 750+1013 line diff for what is semantically a
~90-line addition. Two things matter:
1. Match the original line endings (the file was CRLF; my first pass
   silently converted to LF).
2. Match the original key ordering within objects (insertion order in
   Python 3.7+ is preserved, but `json.dump` re-sorts unless you write
   the file manually).

The right pattern is to either (a) edit the file with a targeted regex/
splice that adds only the new key without re-serializing the rest, or
(b) if you must re-serialize, do it once and live with the diff noise.
For turn-024 I went with (b) because the noise is bounded and the
semantic equivalence is provable (same 17 routes, same content).
