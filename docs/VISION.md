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

