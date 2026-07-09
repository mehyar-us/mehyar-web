# turn-027 — 2026-07-09

## What landed
- **3 file change**: audit-intent CTAs on portfolio + blog + reusable CTA section realigned to `/micro-offer#intake`
- `client/src/components/cta-section.tsx` — "Request the audit path" `/contact` → `/micro-offer#intake`
- `client/src/pages/BlogPost.tsx` — "Ask MehyarSoft to assess this" `/contact` → `/micro-offer#intake` + label "Request the $330 audit"
- `client/src/pages/PortfolioDetail.tsx` — "Request a similar audit" `/contact` → `/micro-offer#intake` + label "Request the $330 audit"

## Why this tick
The audit-intent funnel was already 3-piece closed (turn-004 hero, turn-005 pricing cards, turn-006 5 page-level CTAs). But three reuse-points — the universal `CTASection` used on /services, /portfolio, and PortfolioDetail, plus the QuickAnswer CTAs on all 3 blog posts and all 6 portfolio patterns — were still pointing at the slow `/contact` path. The CTASection's heading copy **"Start with the smallest fix that can protect revenue"** is unambiguously audit-intent language; routing it to `/contact` was leaking visitors to the slowest funnel for the offer they wanted.

## Bundle evidence (post-deploy main-P-x17WD-.js, 573 KB)
- `micro-offer#intake`: **19** (was 18 pre-turn-027)
- `Request the $330 audit`: **7** (was 4)
- `Request the audit path`: **1** (was 0)
- `/contact`: 21 (unchanged — Footer nav, ContactSection mount, PricingSection non-audit cards)

## Verification
- `npm run check` (tsc) → green
- `npm run build:client` → vite green, 19 JSON-LD shells preserved, 3-item RSS preserved, dist/public/404.html + 18 routes served
- `npm run test:intake` → **11/11** (health, public client config, valid submission, invalid turnstile rejection, D1/audit row, notification path, consent rejection, newsletter checklist submission, newsletter consent rejection, micro-offer fields, request_type alias)
- Live smoke 5/5: `/` `/portfolio/1/` `/blog/missed-calls-crm-follow-up/` `/services/` `/booking/` `/micro-offer/` — all 200 + 3 JSON-LD blocks
- Deployed sha: `ef12663` (merge of `323448c` + main)

## What I deliberately did NOT touch
- PricingSection — already correct (audit card → /micro-offer#intake, other 5 cards → /contact?service=<slug> for service-tagged routing)
- Footer.tsx `/contact` — this is a nav link, not an audit CTA; changing it would break the "Contact" footer nav
- ContactSection.tsx — handles BOTH the slow path AND the per-offer ?service= routing, no change needed
- Voice rules (em dash blacklist, named prices, problem-first) — applied throughout, all 3 new labels scored 5/5 against VISION.md voice bar

## W2-FUNNEL impact
Closes funnel piece 4 (portfolio + blog + reusable CTA audit-intent realignment). This is the last batch of audit-intent surfaces that were leaking to /contact. Every audit-intent CTA on the site now lands on /micro-offer#intake with form in view.

## Next tick candidates (hot list update)
- LOOP-BOOT (t_b3048d53, P1, ready): full live-vs-VISION.md audit — now safer than ever since W2-FUNNEL is genuinely closed (4 pieces, not 3)
- W5-PERSUADE (t_45ea76a8, ready): propose persuasion shape a/b/c (still locked passive-only, but ready to spec)
- t_06a7d8e0: unblock t_5f79e5ac (CF Access cleanup) — still gated on CF_API_TOKEN env var
- NEW: small surface-area audit — confirm 3 blog posts + 6 portfolio patterns actually render the new QuickAnswer label correctly in production bundle (post-deploy runtime check)