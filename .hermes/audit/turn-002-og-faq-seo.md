# turn-002 — 2026-07-09 — OG image + FAQPage JSON-LD + priceRange schema

## Why this tick
W4-SEO is hot-listed as highest-leverage / smallest-risk (no conversion-path touch).
Live `/` already had strong on-page copy + ProfessionalService JSON-LD, but the
social-share OG image was an SVG (no preview in Slack / LinkedIn / Facebook
because those expect 1200x630 raster), and there was no FAQPage schema even
though the home page already shows 3-5 Q/A blocks (QuickAnswer + WhyChooseUs).

## What shipped (commit b6486c2)
- `scripts/build-og-image.py` — deterministic Pillow script that emits a 1200x630
  brand-aligned PNG (gradient bg, soft glow, hero headline, offer-pill, footer).
- `client/public/assets/mehyarsoft-social-1200x630.png` — 62 KB PNG, RGB.
- `client/index.html`:
  - og:image + twitter:image swapped SVG -> 1200x630 PNG.
  - Added og:image:width / height / alt and twitter:image:alt.
  - Added FAQPage JSON-LD (5 Q/A) — content matches existing on-page copy,
    no copy change.
  - Extended ProfessionalService with `priceRange: "$$"` and `image` (the new
    OG image) for richer SERP.

## Build + deploy
- `npm run build:client`: green (1698 modules, 34 routes copied, 7.04 KB
  index.html).
- `git push origin main`: green (b413ee6 -> b6486c2).
- Live verification (post-deploy):
  - `curl https://mehyar.us/` -> HTTP 200, 6929 bytes (was 3754) — the extra
    bytes are the FAQPage + extended meta.
  - 3 references to `social-1200x630.png` in served HTML.
  - 1 FAQPage JSON-LD block in served HTML.
  - `/assets/mehyarsoft-social-1200x630.png` -> 63935 bytes, confirmed 1200x630 RGB.
- Conversion-path smoke (rule: always exercise on a touch): `/booking`,
  `/micro-offer` both HTTP 200 with the same SPA shell (no regression).

## What this does NOT change
- No copy edit. Hero "Book a Tech Audit" still routes to `/contact` (the
  underlying `/micro-offer` link leak is real, but it's a W2-FUNNEL move,
  not a W4-SEO move; deferred).
- No routing change.
- No conversion-path code touched.
- Service worker unchanged; `/api/` still excluded from cache.

## Risks / things to watch
- Google may not surface the FAQ rich result until next crawl; FAQPage
  eligibility requires the Q/A to be visible to users, which it already is.
- LinkedIn / Slack / Facebook crawler caches take 24-72h to refresh; the
  preview improvement will be visible gradually, not instantly.
- Per-page meta overrides are the bigger W4-SEO remaining work — every
  non-home route currently inherits the home's title/description/OG,
  which weakens share CTR for the conversion pages specifically.

## Next tick candidate
W4-SEO turn-3: Lighthouse + axe a11y baseline against live. After that,
per-page meta overrides (especially /booking, /micro-offer, /services).

Or: switch to W2-FUNNEL and execute the hero-CTA -> /micro-offer move
under proper funnel-exercise discipline.