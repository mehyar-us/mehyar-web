# turn-022 · 2026-07-09

## what
Additive SEO: scripts/route-jsonld.json now ships structured data on /contact.
This closes the W4-SEO additive piece — every high-leverage public route now
has static-shell JSON-LD that no-JS crawlers, social unfurlers, and
link-preview tools can see on first byte.

## why
/contact was the last high-traffic public route without route-injected
JSON-LD. The runtime SeoManager emits a ContactPage + BreadcrumbList + Org
with ContactPoint + 1-question FAQ, but only after React hydration — too
late for crawlers that don't execute the SPA bundle. The route already
ships a 308 → /contact/ redirect from CF Pages (trailing slash policy),
so the deployed shell at /contact/ is the canonical target.

## how
- Added /contact key to scripts/route-jsonld.json
- /contact emits 5 blocks via the @graph wrapper:
  1. WebPage (#webpage) — title/desc/isPartOf/about/primaryImageOfPage
  2. BreadcrumbList — Home > Contact
  3. ContactPage (#contactpage) — founder-reviewed intake intent
  4. Organization (#org-contact) — email info@mehyar.us + 2 ContactPoints
     (intake email + customer-support phone), Brooklyn NY postal address
  5. FAQPage — 5 questions covering: how-to-contact, fastest-start path,
     manual reply vs auto, PHI-adjacent safety, what happens after submit
- All @id cross-refs to the existing ProfessionalService @id
- Build green, test:intake 11/11, bundle voice-scan clean
- Merged to main as 9f7c4c6 (sha a874c8e on the branch)

## live verify
- https://mehyar.us/contact → 308 → /contact/ → 200, 3 JSON-LD blocks total:
  - original ProfessionalService + FAQPage (still present, untouched)
  - new route-injected @graph: WebPage + BreadcrumbList + ContactPage + Organization + FAQPage
- 10 Questions + 10 Answers across both FAQPages (5+5), all live
- 2 ListItems in BreadcrumbList (Home, Contact) — correct
- 2 ContactPoints (intake email, customer-support phone) — correct
- /api/intake OPTIONS 204 — conversion path healthy
- All 10 jsonld-equipped routes still serving their marker (no regressions
  on home, about, micro-offer, booking, services, portfolio, 3 blog posts,
  and now contact)

## what changed
- 1 key added to scripts/route-jsonld.json (5 blocks, 130 lines)
- Zero copy touched
- Zero new dependencies
- Zero new runtime code
- W4-SEO additive piece now covers 10/13 public routes:
  home, about, micro-offer, booking, contact, services, portfolio,
  3 blog posts
- Remaining no-schema routes are utility / funnel / legal:
  /404, /newsletter, /free-checklist, /330 redirect, /privacy-policy,
  /terms, /sitemap, /unsubscribe, /billing

## metrics to watch (7d)
- GSC impressions for /contact (should grow as FAQPage + ContactPage
  become eligible for SERP rich result)
- Crawl stats: structured-data items discovered per route
  (GSC > Enhancements)

## state.md reconciliation
- Was at turn-021 (sha cd65ef9)
- Bumped to turn-022 (sha 9f7c4c6)
- VISION.md iteration diary appended
- learned.md appended with bundle-scan + cross-route-smoke pattern