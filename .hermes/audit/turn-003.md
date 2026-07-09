# Turn-003 — 2026-07-09 01:25 UTC — per-route meta on pre-rendered shells

## What shipped
- `scripts/copy-route-shells.mjs` now mirrors the `staticMeta` map from
  `client/src/components/SeoManager.tsx` and applies per-route rewrites
  of `<title>`, `<meta name="description">`, `<meta name="robots">`,
  `og:title`, `og:description`, `og:url`, `twitter:title`,
  `twitter:description`, and the canonical link on every
  `dist/public/<route>/index.html`.
- `.github/workflows/deploy-cloudflare-pages.yml`: added `scripts/**` to
  the `paths:` filter so future edits to `copy-route-shells.mjs` trigger
  a CF Pages redeploy.

## Why
Pre-rendered route shells were serving the home page's `<title>` and
`<meta description>` on every URL. Search crawlers, social-card
unfurlers, and link-preview tools that don't execute JS saw identical
metadata site-wide. `/booking`, `/micro-offer`, `/contact`, `/services`,
`/about` all showed up in SERPs and link previews as "MehyarSoft LLC |
NYC Software & AI Automation Consultant" — the home title. This is the
bug W4-SEO was opened for.

## Verified live
Pulled after CF Pages deployed (~25s after merge). All routes serve
their own meta:
- `/` → "MehyarSoft LLC | NYC Software & AI Automation Consultant"
- `/services/` → "Services & Pricing | MehyarSoft Software Automation Consulting"
- `/about/` → "Founder Story | MehyarSoft LLC NYC Software Consultant"
- `/contact/` → "Contact MehyarSoft | Request a Tech Audit or Consulting Call"
- `/booking/` → "Book a Consulting Call | MehyarSoft"
- `/micro-offer/` → "$330 Website + Booking Leak Audit | MehyarSoft"
- `/blog/` → "Blog & Insights | MehyarSoft Tech Audit & Automation Notes"
- `/portfolio/` → "Engagement Patterns | MehyarSoft Consulting Work Examples"
- `/newsletter/` → "Free AI Automation Checklist | MehyarSoft"
- `/330/` → "$330 Website + Booking Leak Audit | MehyarSoft"
- `/privacy-policy/`, `/terms/`, `/sitemap/`, `/free-checklist/` → all correct
- Admin routes: `noindex,nofollow,noarchive` + "Owner-only MehyarSoft admin area."

`/portfolio/<id>/` and `/blog/<slug>/` deep links still serve the home
shell (they use the dynamic `SeoManager` swap on the client). Acceptable
for this turn — those aren't the money paths and the client-side swap
still works for visitors that land via internal nav.

## Tests run locally
- `npm run check` (tsc) — green
- `npm run test:intake` — green (1 lead created, notification sent)
- `npm run build:client` — green, 34 route shells + 404 fallback emitted

## Git
- Branch: `improver/per-route-meta`
- Merge commit: `406eba0`
- PR-style merge commit: `merge: improver/per-route-meta — per-route meta on pre-rendered shells`

## Tickets
- Closed `t_d0e60303` (W4-SEO — "SEO + Lighthouse baseline from clean state")
  with result summary noting the per-route meta delivery.
- Filed `t_f94599ea` (done) as the turn-003 done ticket.

## Lessons
- **Vite SPA + Cloudflare Pages + prerender shells** = static HTML on
  every URL, but the JS-routed `<SeoManager>` swap only runs after JS
  loads. Every crawlers + unfurlers needs the meta baked into the
  static shell.
- The build pipeline had the right structure (`copy-route-shells.mjs`
  pre-writes shells to `dist/public/<route>/index.html`), but the
  rewrite step was using a single hardcoded home-page string. Mirroring
  the `staticMeta` map into the build script is the cleanest fix; a
  future improvement could read `staticMeta` directly from a `.json`
  export so the two files can't drift.
- **Always wire build-pipeline scripts into the deploy workflow path
  filter.** Before this turn, edits to `scripts/**` silently never
  triggered CF deploy, so any meta change would have shipped the right
  `dist/` but the deploy pipeline wouldn't have caught the new build
  artifact until someone pushed a watched-path change.

## Next tick (turn-004)
Hot list: W2-FUNNEL (move hero CTA → /micro-offer) → W1-SLOP (anti-slop
copy pass) → LOOP-BOOT (live state audit).