# VISION — mehyar.us

> The single source of truth the improve-loop reads every tick.
> Last updated: 2026-07-08 (bootstrap).

## Who we are
NYC-based software & AI automation consultancy. Founder-led (Mehyar Swelim, 10+ yrs,
pharma/regulated-systems background). We find and fix the leaks in small businesses'
public paths — bad websites, missed calls, manual work, disconnected tools.

## What we sell (the leak-ladder)
Six tiers, public on the homepage:
1. **$150 — Free Tech Audit**            entry, no-pitch
2. **$250 — Website Diagnosis Report**   fast turnaround
3. **Custom-build small**               $1k-$5k range
4. **Custom-build mid**                 $5k-$25k range
5. **Quarterly retainer**               $500-$3,500/mo
6. **Hourly advisory**                  $150/hr

## Voice (brand bar — read this before every edit)
- problem-first, never self-promotional
- opinionated, not generic
- "we" sparingly; "I" once for the founder story
- never: em dash in casual copy, "in today's fast-paced world", generic CTAs ("Learn more")
- always: short sentences, specific numbers, hand-rolled metaphors
- the offer ladder is the proof, not testimonials

## Current state (verified 2026-07-08)
- 8 public pages: Home, About, Services, Portfolio, Blog, Contact, Booking, MicroOffer
- 5 utility pages: BillingCheckout, BillingResult, Newsletter, Unsubscribe, Sitemap
- 2 internal: Admin, AdminOpportunityScout
- 2 admin docs: docs/admin-dashboard-plan.md, docs/gov-opportunity-engine.md
- 2 ops docs: docs/mehyarsoft-api-contract.md, docs/FINAL-ACCEPTANCE-GATE, docs/QA-MEHYARSOFT-B2B-BASELINE
- has Cloudflare Web Analytics wired
- has schema.org ProfessionalService JSON-LD
- has dark mode toggle
- has 6-tier offer ladder visible
- has intake forms via Cloudflare Functions

## Pending questions for the user
- Telegram chat/topic id where loop reports should land
- Which persuasion shape (a/b/c) — see [W5]
- Change-budget comfort (default 1 PR/tick, 3 tickets/tick)

## Iteration diary (append-only)
each tick writes ONE line: `YYYY-MM-DD · <what shipped or learned>`.
this is the loop's memory. longer notes go to `.hermes/audit/turn-NNN.md`.

(append below — never overwrite history)

2026-07-09 · shipped 1200x630 OG PNG + FAQPage JSON-LD + priceRange schema (turn-002, sha b6486c2) — social previews now real images, FAQPage eligible for SERP rich result. Pure additive SEO.
2026-07-09 · shipped per-route meta on pre-rendered shells (turn-003, sha 406eba0) — 13 high-value routes ship unique title/description/canonical/og/twitter; closed W4-SEO. Also wired scripts/** into CF Pages deploy workflow.
2026-07-09 · shipped hero CTA move /contact → /micro-offer#intake (turn-004, sha 22dd6f0) — "Book a Tech Audit" copy now lands on the dedicated $330 audit landing with form in view. Closed W2-FUNNEL hero-CTA piece.
2026-07-09 · shipped per-offer CTA labels + service-tagged /contact routing on pricing cards (turn-005, sha c8d2507) — six pricing cards had identical "Book a Tech Audit" copy and the same /contact href, so visitors browsing AI Follow-Up / Internal Sprint / Architecture / Retainer were mis-routed into the slowest funnel for an offer that didn't match. Fixed: per-row ctaLabel + ctaHref; cards 1-5 now route /contact?service=<slug> so ContactSection mounts mode=booking_call with the service slug in serviceCategory (form submission carries the offer slug into CF Functions audit row). Closed W2-FUNNEL piece 2/2.
2026-07-09 · shipped 5 page-level audit CTAs → /micro-offer#intake (turn-006, sha f4a60cd) — About×2, Blog sidebar, Services, 404 now all land on the dedicated $330 audit landing (form in view). Hero (turn-004) + pricing cards (turn-005) + page-level audit CTAs (turn-006) = full audit-intent funnel realignment; W2-FUNNEL closed piece 3/3.
2026-07-09 · shipped 404 audit-CTA path clarity (turn-009, sha 7fb8a30) — body copy replaced corporate-speak "secure intake request" with named-price ($330) + dual-CTA direction (audit button → /micro-offer#intake, sitemap → /sitemap) + hand-rolled metaphor "Wrong address." Voice 5/5; W1-SLOP closed piece 4/4. Same tick end-to-end W2-FUNNEL smoke verified: live /api/intake OPTIONS 204 + POST safe-failure path; live /micro-offer has $330 meta + 1200x630 OG; local npm run test:intake 11/11 (D1+KV+notification). All 6 audit-intent routes confirmed → /micro-offer#intake. Closes t_0634816e + t_bad8156f.

2026-07-09 · shipped anti-slop regression sweep (turn-014, sha ed89cdd) — bundle-scanned dist/public/assets/*.js and caught 5 'secure intake' sites turn-009 eyeball audit missed (Contact eyebrow, MicroOffer sidebar CTA, ConversionFlow status banner, Sitemap Contact description, Terms "no sensitive submissions" clause). Each rewritten to match VISION.md brand bar: problem-first, named price where applicable, plain English over corporate, 5/5 voice. W1-SLOP actually closed now (5/5, not 4/5). Build green, test:intake 11/11, /330 → /micro-offer 308 chain preserved. Lesson added to learned.md: bundle-scan every tick that touches copy — sub-pages, legal pages, and below-the-fold CTAs are where copy drifts back to default.

2026-07-09 · shipped /rss.xml + auto-discovery (turn-015, sha 770eab9) — build-time RSS feed from blog index via scripts/build-rss.mjs, with `<link rel="alternate" type="application/rss+xml">` auto-injected into home + 404 shells. Feedly / NetNewsWire / FeedReader now have a hand-rolled subscription surface. Zero copy risk; pure additive.

2026-07-09 · shipped Person + AboutPage + BreadcrumbList JSON-LD on /about (turn-016, sha 6dd002f) — additive founder E-E-A-T structured data via the same scripts/inject-route-jsonld.mjs pattern as turn-011's FAQPage. New @id https://mehyar.us/about#person cross-links to existing ProfessionalService @id so the graph stays coherent for crawlers. Zero copy changed (zero copy risk). Voice 5/5. Build green, test:intake 11/11, bundle voice-scan clean, live /about/ confirmed: 3 JSON-LD blocks (2 runtime SeoManager + 1 route-injected), all @id cross-refs resolve. W4-SEO additive piece closed.

2026-07-09 · shipped home BlogSection + ItemList JSON-LD + per-blog-post BlogPosting JSON-LD + /booking WebPage + BreadcrumbList + FAQPage + navbar Book a Tech Audit → /micro-offer#intake (turns 017-020, shas 16984e6 / f9555f3 / 311456e / 2c39c2a) — additive SEO + funnel realignment on the booking intent path. State.md drifted through these (skipped id bumps on 17, 18, 19); reconciled in turn-021 to tick_id=21.

2026-07-09 · shipped WebPage + BreadcrumbList + ItemList JSON-LD on /services and /portfolio (turn-021, sha cd65ef9) — additive SEO on the two highest-leverage public pages that previously relied entirely on SeoManager runtime. /services @graph has 7-item ItemList (offer catalog $150 → custom build, anchored by price), /portfolio has 6-item ItemList (engagement patterns /portfolio/1-6). Zero copy touched. Build green, test:intake 11/11, bundle voice-scan clean, live @graph confirmed on both routes. CF Pages deploy lag for /services cold route = ~5min (matches /about pattern). W4-SEO additive piece extended; remaining /contact.

2026-07-09 · shipped ContactPage + WebPage + BreadcrumbList + Organization + FAQPage JSON-LD on /contact (turn-022, sha 9f7c4c6) — additive SEO on the booking-intent mirror of /booking, closes the W4-SEO additive piece. /contact @graph = [WebPage (#webpage), BreadcrumbList (Home > Contact), ContactPage (#contactpage), Organization (#org-contact with email info@mehyar.us + 2 ContactPoints + Brooklyn NY address), FAQPage (5 questions: how-to-contact, fastest-start path, manual reply vs auto, PHI-adjacent safety, what happens after submit)]. Live shell now carries 3 JSON-LD blocks: original ProfessionalService + FAQPage + new route-injected @graph. All 10 jsonld-equipped routes still serving their marker — zero regressions on home, about, micro-offer, booking, services, portfolio, 3 blog posts. W4-SEO additive piece: 10/13 public routes now schema-equipped.


2026-07-09 · shipped /blog WebPage + Blog + BreadcrumbList + ItemList JSON-LD (turn-024, sha ab72cba) — blog index now schema-equipped, Blog block blogPost[] cross-references the 3 individual #blogposting @ids from turn-019 (graph is now self-cross-referencing). W4-SEO additive piece closed at 17 schema-equipped routes. State reconciled: turn-023 retroactively journaled, t_96bc8b84 stuck-ready closed.
2026-07-09 · shipped /newsletter WebPage + BreadcrumbList + FAQPage JSON-LD (turn-025, sha 9479e23) — free AI Automation Checklist landing (top-of-funnel lead-capture, no alias) now schema-equipped with 6-question FAQPage. W4-SEO additive piece extended to 18 schema-equipped routes. Reusable scripts/add-newsletter-jsonld.py preserves original file format (CRLF + indent=2 + same key order); result 91 inserted / 0 deleted.

2026-07-09 · shipped /404 WebPage + BreadcrumbList JSON-LD (turn-026, sha a3d386c) — the last schema-less public route now ships 3 JSON-LD blocks (was 2). The 404 shell is a single file at dist/public/404.html, not a directory — added a small /404 fallback branch to scripts/inject-route-jsonld.mjs so the existing dist/public/<route>/index.html pattern handles the special case without breaking the other 18 routes. Reusable scripts: add-404-jsonld.py (JSON append, CRLF/indent-2/idempotent) + patch-inject-route-jsonld-404.py (injector patch, marker-comment idempotent). W4-SEO additive piece closed at 19 schema-equipped routes. No copy changed — voice 5/5. Build green, test:intake green, cross-route 10/10 unchanged (home, booking, micro-offer, newsletter, about, services, portfolio, contact, blog, free-checklist all serving their pre-turn-026 JSON-LD block count).
