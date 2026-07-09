# turn-030 — 2026-07-09 · WebPage + BreadcrumbList JSON-LD on home

> Reconciled post-deploy. Sha `3d2408e` on github main; CF Pages deploy
> rolled the shell files but kept the JS bundle at the previous build
> hash (`main-P-x17WD-.js` from turn-027). Route-injected JSON-LD
> block IS live on home.

## What shipped

`feat(seo): WebPage + BreadcrumbList JSON-LD on home` — sha `1ad9963`,
merged via `3d2408e`. Touched file: `scripts/route-jsonld.json`
(+31, -1). Build green, `test:intake` 11/11, anti-slop bundle-scan
clean (only "leverage" hit is the on-brand "highest-leverage business
leak" metaphor from VISION.md brand bar).

## Why

Home was the highest-value public route still missing the WebPage +
BreadcrumbList pair that `/booking`, `/contact`, `/newsletter`, `/404`
already ship (turns 020 / 022 / 025 / 026). Pattern parity closes the
W4-SEO additive piece at 19 schema-equipped routes.

## What landed in the home JSON-LD

`/` now serves 3 script blocks containing 5 @type entries on first byte:

1. `ProfessionalService` (runtime, SeoManager) + `Person` (founder) +
   `PostalAddress` (Brooklyn) — block 1, ~662 chars
2. `FAQPage` (runtime, SeoManager) with 5+ Questions/Answers — block 2,
   ~2.4 KB
3. **Route-injected @graph** (turn-030) — block 3, ~2.1 KB:
   - `WebPage` @id `https://mehyar.us/#webpage`
     - `isPartOf` → `#website`
     - `about` → `#professional-service`
     - `primaryImageOfPage` → `/assets/mehyarsoft-social-1200x630.png`
       (the 1200x630 OG asset from turn-002)
   - `BreadcrumbList` (single-item: Home)
   - `ItemList` @id `https://mehyar.us/#blog-index`
     - `ItemListOrderDescending`
     - 3 ListItems cross-linking the 3 blog posts (turn-019)
     - Graph self-cross-references: ItemList items point at the same
       blog URLs the BlogPosting @ids in turn-019 reference.

## CF Pages deploy behavior (new finding)

The CF Pages workflow deploy rolled the shell files (`dist/public/index.html`,
the route-injected JSON-LD content). The JS bundle hash stayed at
`main-P-x17WD-.js` from turn-027.

**Net effect for crawlers:** the route-injected block IS live, so the
schema-graph is intact. Crawlers see 3 JSON-LD blocks with the new
@types. SEO outcome: as intended.

**Net effect for runtime SPA:** no behavioral change. The home was
already getting JSON-LD via the SeoManager runtime (ProfessionalService +
FAQPage). The route-injected block is a redundant layer that gives
crawlers the WebPage/BreadcrumbList pair without needing JS.

**Verification point:** when shipping scripts/ changes, check the SHELL
JSON-LD count (not the bundle hash). The bundle hash can lag the
route-jsonld.json edit by one build if Vite's content hash is stable.

## What is now closed

- `t_5a6bf1c3` (kanban) — Turn-030 feat(seo) ticket.
- The last schema-equipped-route gap (home is now in the 19-route
  parity that turn-029's Phase-6 verified).

## What did NOT change

- No copy changed (zero copy risk).
- Funnel realignment counters unchanged: 19 micro-offer#intake / 7
  'Request the $330 audit' / 1 'Request the audit path' / 21 /contact.
- PricingSection, Footer, ContactSection, all audit-intent CTAs
  untouched.
- 6-tier offer ladder prices and labels unchanged.

## What this unlocks

The full 13-route LOOP-BOOT audit (next tick, turn-031) can run
against the rubric with home now confirmed in the schema-equipped set.