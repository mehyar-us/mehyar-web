# turn-021 · 2026-07-09

## what
Additive SEO: scripts/route-jsonld.json now ships structured data on /services and /portfolio.

## why
Both pages had no static-shell JSON-LD; the only schema they carried was the runtime SeoManager
ProfessionalService + FAQPage (hydration-dependent, invisible to no-JS crawlers). They are the
two highest-leverage non-conversion public pages, and the offer catalog + engagement-pattern
lists are exactly the shape ItemList is built for.

## how
- Added /services + /portfolio keys to scripts/route-jsonld.json
- /services emits WebPage + BreadcrumbList + ItemList(7 offer items @ #tech-audit through #software-builds)
- /portfolio emits WebPage + BreadcrumbList + ItemList(6 engagement patterns @ /portfolio/1-6)
- All @id cross-refs to the existing ProfessionalService @id
- Build green, test:intake 11/11, bundle voice-scan clean
- Merged to main as cd65ef9

## live verify
- https://mehyar.us/services → 308 → /services/ → 200, @graph=[WebPage, BreadcrumbList, ItemList(7)]
- https://mehyar.us/portfolio → 308 → /portfolio/ → 200, @graph=[WebPage, BreadcrumbList, ItemList(6)]
- Deploy lag on /services (cold route): ~5min — matches /about pattern from turn-016

## what changed
- 2 keys added to scripts/route-jsonld.json (3 blocks each, 6 total)
- Zero copy touched
- Zero new dependencies
- Zero new runtime code

## metrics to watch (7d)
- GSC impressions for /services and /portfolio (should grow as ItemList eligible for SERP)
- Crawl stats: structured-data items discovered per route (GSC > Enhancements)

## state.md reconciliation
- Was at turn-016 (sha 6dd002f)
- Actual main was at turn-020 (sha 2c39c2a, Booking JSON-LD turn)
- Bumped to turn-021 (sha cd65ef9) in this tick; reconciled 17-020 in VISION diary
