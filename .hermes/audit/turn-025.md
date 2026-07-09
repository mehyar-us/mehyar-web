# turn-025 — 2026-07-09 — sha 9479e23

## tick
- id: 25
- branch: improver/newsletter-jsonld-turn-025
- target: /newsletter (free AI Automation Checklist landing — top-of-funnel lead-capture, no alias)
- type: feat(seo) — additive WebPage + BreadcrumbList + FAQPage JSON-LD

## what shipped
- Added `/newsletter` entry to scripts/route-jsonld.json: WebPage (#webpage), BreadcrumbList (Home > Free AI Automation Checklist), FAQPage (6 questions: what is the checklist, who it's for, is it free + spam-free, checklist vs $330 audit, PHI safety, what happens after signup).
- Reusable scripts/add-newsletter-jsonld.py: detects existing CRLF/LF, parses + re-serializes with indent=2 + ensure_ascii=False, rewrites with the same newline style. Idempotent (skips if /newsletter already exists). Result: 91 inserted / 0 deleted (vs turn-024's 750+1013 line diff noise from a one-line patch that touched the whole file's serialization).

## build + test
- `npm run build:client` → vite green, `Injected per-route JSON-LD into 18 shell(s)` (was 17 at turn-024).
- `npm run test:intake` → 11/11 (health, public client config, valid submission, invalid turnstile rejection, D1/audit row, notification path, consent rejection, **newsletter checklist submission**, **newsletter consent rejection**, micro-offer fields, request_type alias). newsletter form_type exercised in local mock CF Functions.
- W2-FUNNEL 4-screen smoke: home/booking/micro-offer/404 all 200 with correct titles.
- Cross-route JSON-LD smoke: 12/12 routes served. home/blog/blog-post/about/micro-offer/booking/services/portfolio/portfolio/1/portfolio/6/contact = 3 blocks each. /404 = 2 blocks (unchanged). /newsletter = 3 blocks (was 2, +1 from new route-injected @graph).

## live verification
- https://mehyar.us/newsletter now serves:
  - <script type="application/ld+json"> ProfessionalService (org head, unchanged)
  - <script type="application/ld+json"> FAQPage (org head, unchanged)
  - <script type="application/ld+json" data-route-jsonld="/newsletter"> @graph [WebPage, BreadcrumbList, FAQPage(6)]
- CF Pages auto-deploy from main confirmed: live @id https://mehyar.us/newsletter#webpage served at 90s after push.

## kanban
- filed: t_7cdb5b85 (improver, status=done)
- open tickets: still 3 (W5-PERSUADE / LOOP-BOOT / BOARD-HANDOFF, all ready)

## lessons
1. **Top-of-funnel capture routes without aliases are the highest-leverage additive SEO targets.** /newsletter was the last obvious candidate — it's the only public route that exists purely as a lead-capture surface (no /330→/micro-offer, /book→/booking, /free-checklist→/newsletter alias). Pattern for finding more: scan dist/public/ for routes whose copy-route-shells.mjs entry has no alias — those need their own @graph; aliased routes inherit the canonical target's schema.
2. **Idempotent format-preserving JSON edits are the right pattern for additive config files.** scripts/add-newsletter-jsonld.py detects existing line endings, re-serializes with same indent + ensure_ascii=False + same key insertion order, and is idempotent. 91-line diff vs 1013-line diff noise for the same semantic addition is the win.

## next-tick candidates
- W5-PERSUADE spec (t_45ea76a8) — pick shape a/b/c from docs/PERSUASION-PROPOSAL.md template
- LOOP-BOOT full VISION audit (t_b3048d53) — 5 ticks since W1-SLOP closed, worth checking for regressions
- Schema /404 (currently 2 blocks, no route-injected @graph)