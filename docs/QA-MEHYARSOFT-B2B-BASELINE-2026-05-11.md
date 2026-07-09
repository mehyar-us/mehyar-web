# QA — mehyarSoft B2B baseline — 2026-05-11

> The "voice of correctness" the improve-loop reads every tick to define "shipped".
> Last update: 2026-07-09 (turn-028 — recreated from VISION.md reference; original
> document was referenced in `docs/VISION.md` "Current state" line but never
> committed to disk. This file restores the canonical baseline list from the
> shipped artifacts that exist on the live site as of this tick.)

## How to read this doc

Every item below is a **verifiable live-site check**. Each one ties to a
specific URL, file, build artifact, or runtime probe that the improver can
re-run on any tick to confirm the baseline still holds. If any item regresses
from PASS to FAIL/PARTIAL, that is a **P0 ticket regardless of other
priorities** (see `mehyar-us-improve-loop` skill, Phase 2 triage).

Tick verification budget: ≤4 screens — `home`, `/booking`, `/micro-offer`,
`/404` (per the project-specific instance of the `perpetual-tick-loop`
class budget). Use this doc for the full 13-item check on the LOOP-BOOT
audit tick; use the per-tick smoke for the steady-state improvement ticks.

---

## A. Surface & reachability (every item must be 200 OK on live curl)

| # | URL                                              | Status gate           |
| - | ------------------------------------------------ | --------------------- |
| 1 | `/`                                              | 200, leak ladder copy |
| 2 | `/services`                                      | 200, ItemList 7-offer |
| 3 | `/portfolio` + `/portfolio/{1..6}`               | 200, ItemList 6-each  |
| 4 | `/blog` + `/blog/{slug-of-3-posts}`              | 200, Blog index + 3   |
| 5 | `/about`                                         | 200, Person + AboutPage JSON-LD |
| 6 | `/contact`                                       | 200, ContactPage JSON-LD |
| 7 | `/booking`                                       | 200, FAQPage + BreadcrumbList |
| 8 | `/micro-offer`                                   | 200, $330 + FAQPage + priceRange |
| 9 | `/newsletter` (a.k.a. `/free-checklist`)         | 200, Checklist landing |
| 10 | `/sitemap.xml`                                   | 200, ≥22 <loc> entries |
| 11 | `/rss.xml`                                       | 200, 3 <item> entries |
| 12 | `/404` (cold path)                               | 200 with 404 body copy |
| 13 | `/robots.txt`                                    | 200, Sitemap line present |

## B. Audit-intent funnel realignment (W2-FUNNEL — closed across turns 004, 005, 006, 027)

Every audit-intent CTA on the live site must route to `/micro-offer#intake`
(or to `/contact?service=<slug>` for service-tagged offers where the slow
path is intentional). Run `grep -c "micro-offer#intake" dist/public/assets/main-*.js`
on a build artifact and confirm the count matches the latest shipped number.

**Permitted `/contact` hrefs** (each has a stated reason — do not regress):

- Footer nav (1 link — required)
- ContactSection mount on `/contact` page itself (1 link — required)
- PricingSection non-audit cards: `/contact?service=<slug>` for service-tagged
  routing on offers 2-6 (5 links — required for funnel stage matching)

**Audit-intent surface inventory (must equal 19 `micro-offer#intake` hits in
shipped bundle):**

- Hero on `/` — 1
- PricingSection audit card — 1
- Page-level CTAs on About (2), Blog sidebar (1), Services (1), 404 (1) — 5
- CTASection "Request the audit path" used on `/services` + `/portfolio` + `/portfolio/{1..6}` — 3
- BlogPost QuickAnswers across 3 posts — 3
- PortfolioDetail QuickAnswers across 6 patterns — 6

## C. Structured data (W4-SEO additive piece — 19 schema-equipped routes)

Every public route below must serve **≥2 JSON-LD blocks** on first byte (no
JS-required). Pass = `<script type="application/ld+json">` count ≥ 2 in the
fetched shell. /404 also accepts the single-file fallback.

| # | Route            | Required JSON-LD blocks                                              |
| - | ---------------- | -------------------------------------------------------------------- |
| 1 | `/`              | ProfessionalService + FAQPage + ItemList (BlogPosting)               |
| 2 | `/about`         | ProfessionalService + FAQPage + @graph(WebPage+Breadcrumb+Person+AboutPage) |
| 3 | `/services`      | ProfessionalService + FAQPage + @graph(WebPage+Breadcrumb+ItemList) |
| 4 | `/portfolio`     | ProfessionalService + FAQPage + @graph(WebPage+Breadcrumb+ItemList) |
| 5 | `/portfolio/1..6`| ProfessionalService + FAQPage + @graph(WebPage+CreativeWork+Breadcrumb) |
| 6 | `/blog`          | ProfessionalService + FAQPage + @graph(WebPage+Blog+Breadcrumb+ItemList) |
| 7 | `/blog/{3 slugs}`| ProfessionalService + FAQPage + BlogPosting                          |
| 8 | `/contact`       | ProfessionalService + FAQPage + @graph(WebPage+ContactPage+Breadcrumb+Organization) |
| 9 | `/booking`       | ProfessionalService + FAQPage + @graph(WebPage+Breadcrumb)           |
| 10 | `/micro-offer`   | ProfessionalService + FAQPage + Offer                               |
| 11 | `/newsletter`    | ProfessionalService + FAQPage + @graph(WebPage+Breadcrumb)           |
| 12 | `/404`           | ProfessionalService + FAQPage + @graph(WebPage+Breadcrumb)           |

## D. Voice / brand bar (read every tick before any copy change)

Each new string scored 1-5 against `docs/VISION.md` voice rules:

- 5/5: problem-first, opinionated, specific numbers, hand-rolled metaphor,
  short sentences
- 4/5: same as 5 minus one micro-issue (e.g. "Learn more" CTA, em dash in
  casual copy)
- 3/5: corporate-speak, generic, or self-promotional
- ≤2: reject and rewrite; do not ship

**Hard rejects** (any of these = automatic rewrite, no exceptions):

- "in today's fast-paced world" / "we leverage" / "we utilize" / "Your
  trusted partner" / "AI-powered" without naming what's powered
- Em dashes in casual copy (allowed in technical specs, code comments, and
  JSON-LD only)
- Exit-intent modals (class-level hard rule; passive persuasion only)
- Generic CTAs ("Learn more", "Click here", "Get started" without context)

## E. Build & test gates

Every shipped tick must pass:

- `npm run check` (tsc) — green
- `npm run build:client` — vite green, dist/public/<19 routes> served,
  inject-route-jsonld.mjs reports ≥19 injected shells, build-rss.mjs
  emits /rss.xml with 3 items
- `npm run test:intake` — 11/11 (health, valid submission, invalid
  turnstile rejection, D1/audit row, notification path, consent rejection,
  newsletter checklist, newsletter consent rejection, micro-offer fields,
  request_type alias, public client config)

## F. Anti-slop blacklist (project-specific, additive to class baseline)

Bundle-scan every tick that touches copy. Acceptable hits = 0.

```
Empowering businesses with custom web apps, CRM & automation
we leverage / we utilize
Your trusted partner
AI-powered  (without naming what's powered)
secure intake   (corporate-speak; rewrite to "send your details" or named $)
in today's fast-paced world
Let's talk / Learn more / Click here  (as primary CTA copy)
```

If any of these appear in a fresh bundle, it is a W1-SLOP regression and
the tick must either fix it or roll back.

## G. Open registry

This doc is the voice-of-correctness. As new surfaces ship (e.g. an admin
dashboard, a newsletter cron, a new offer tier), add the acceptance items
here in the appropriate section and bump the "Last update" header.