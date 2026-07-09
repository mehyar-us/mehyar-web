# turn-012 — decircularize in-app /330 audit CTAs (sha 3e53591)

**Date:** 2026-07-09 UTC
**Branch:** `improver/funnel-decircularize-330-links` → merged into `main`
**sha:** `3e53591` (local + origin/main)
**Bundle:** `dist/public/assets/main-DoEhE6J-.js` (local) — wait for CF Pages deploy

## What was wrong

Turn-010 (sha 3a5c73c) consolidated `/330` → `/micro-offer` as the canonical URL
for the $330 audit landing page. After that fix, 5 in-app audit CTAs still pointed
at `/330?request_type=micro_offer&utm_campaign=*#intake`:

- `client/src/pages/MicroOffer.tsx` — hero "Request the $330 audit/setup path" (line 60)
- `client/src/pages/MicroOffer.tsx` — sidebar "Start secure intake" (line 87)
- `client/src/pages/Newsletter.tsx` — hero "Skip to the $330 audit" (line 28)
- `client/src/pages/Newsletter.tsx` — bottom "Request the $330 audit" (line 69)
- `client/src/components/conversion/ConversionFlow.tsx` — newsletter-thank-you surface (line 897)

`https://mehyar.us/330?request_type=micro_offer&utm_campaign=330_micro_offer#intake`
served:
- `308 → /micro-offer?request_type=micro_offer&utm_campaign=330_micro_offer`
- `308 → /micro-offer/?request_type=micro_offer&utm_campaign=330_micro_offer`
- `200`

Two extra round-trips before the fragment could scroll to `#intake`. The
landing page itself (the page visitors are already on) was sending them
through a 308 chain to land back on the same page — measurable money-path
regression, 4 turns after the canonical fix.

## The fix

Replaced all 5 in-app hrefs with direct `/micro-offer#intake` links,
preserving each `utm_campaign` tag as a URL query parameter (not fragment —
query is what GoogleAnalytics reads at the next page view). Bundle scan
confirms zero `/330?request_type` references in `dist/public/assets/*.js`.

External `/330` inbound links still funnel through the canonical 308
(preserves the SEO consolidation). The `GoogleAnalytics.trackOfferView`
match on `/330` and `/330/` is kept (intentionally — external referrers
that still use the old URL still fire `offer_view` after redirect).

## Verification

- `npm run build:client` — green, 1698 modules, 1.92s incremental rebuild
- `npm run test:intake` — 11/11 (health, public client config, valid submission,
  invalid turnstile rejection, D1/audit row, notification path, consent rejection,
  newsletter checklist, newsletter consent rejection, micro-offer fields,
  request_type alias)
- `git push origin improver/funnel-decircularize-330-links` — ok
- `git merge --no-ff` → `git push origin main` — sha 3e53591
- Bundle scan: zero `/330?request_type` in `dist/public/assets/*.js`
- Live bundle on Cloudflare: `main-D8VVSJFw.js` (turn-011, OLD bundle) — pending
  CF Pages deploy to swap in the new bundle. Workflows queued as of 07:21:11Z,
  expected deploy window 5-15min from push.

## What was NOT changed

- No copy
- No analytics event names
- No schema.org / JSON-LD
- No external `/330` redirect behavior (CF Pages 308 chain preserved)
- No `request_type` parameter handling — `Contact.tsx` still reads it for
  `/contact?request_type=micro_offer` deep links, that path is fine

## Kanban

- Created `t_3db968b8` on `mehyar-us`, status `done`
- Linked under W2-FUNNEL cleanup narrative (no W2-FUNNEL ticket was open
  to scope this against — W2-FUNNEL was closed at turn-009; this is a
  regression fix in that work, not a new funnel change)

## Next-tick hot list (unchanged)

1. LOOP-BOOT (t_b3048d53, ready) — full live-vs-VISION.md audit now that
   the W1/W2 closures have all settled
2. W5-PERSUADE (t_45ea76a8, ready) — propose a/b/c persuasion shapes
3. t_06a7d8e0 (ready) — unblock t_5f79e5ac (CF Access cleanup, gated on
   `CF_API_TOKEN` env var)
