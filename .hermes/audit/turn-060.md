# turn-060 — /free-checklist canonical consolidation to /newsletter (sha <this-commit>)

## What shipped

One-line change in `client/src/components/SeoManager.tsx`: the `/free-checklist` entry of `staticMeta` now has `path: "/newsletter"` instead of `path: "/free-checklist"`. Same title, same description (free checklist copy); the runtime SPA's `SeoManager` now emits `<link rel="canonical">` and `og:url` pointing at `https://mehyar.us/newsletter` even when the visitor lands on `https://mehyar.us/free-checklist`.

This brings the **runtime SPA** canonical assignment into alignment with what the **static shell** at `dist/public/free-checklist/index.html` already shipped — the build-time `scripts/copy-route-shells.mjs` entry for `/free-checklist` already used `path: '/newsletter'` (line 110), so the pre-rendered shell was already pointing canonical + og:url at `/newsletter`. The drift was that the React SPA's runtime `SeoManager` was overriding the canonical to point at `/free-checklist` itself. This turn closes that drift.

## Why it matters

- **Duplicate-content consolidation.** `/free-checklist/` and `/newsletter/` serve the same React component (`Newsletter.tsx`), the same content, the same intent. Both URLs are listed in the sitemap (`scripts/build-rss.mjs` does NOT list them, but `client/public/sitemap.xml` does). Google sees two URLs serving the same content and splits crawl + ranking juice between them. Consolidating canonical on `/newsletter` makes one URL win.
- **The richer URL wins.** `/newsletter` already ships the WebPage + BreadcrumbList + FAQPage JSON-LD @graph (from `scripts/route-jsonld.json` line 145+), and the static shell carries it. `/free-checklist` had no JSON-LD @graph injected. Consolidating on `/newsletter` means Google indexes the richer snippet (FAQ rich result eligible).
- **Visitor URL unchanged.** No copy changed. No UI changed. Visitors hitting `/free-checklist/` still see the same Newsletter form, same headline, same CTA. Only the `<head>` canonical/og:url URL target changed.
- **308 redirect preserved.** The trailing-slash redirect (308 → `/free-checklist/`) is unchanged. The SPA at `/free-checklist/` still renders Newsletter.tsx. Only the SEO meta URL flipped.
- **Reversible.** Reverting `path: "/newsletter"` → `path: "/free-checklist"` is a 1-line change in the same file. No data shape change, no DB migration, no infra change.

## Before / after

**Before (live as of 2026-07-10T17:19Z):**

`curl https://mehyar.us/free-checklist/` → SPA-rendered HTML head contained:
- `<link rel="canonical" href="https://mehyar.us/free-checklist" />`
- `<meta property="og:url" content="https://mehyar.us/free-checklist" />`

**After (live after CF Pages rebuild ships, turn-060 sha):**

`curl https://mehyar.us/free-checklist/` → SPA-rendered HTML head will contain:
- `<link rel="canonical" href="https://mehyar.us/newsletter" />`
- `<meta property="og:url" content="https://mehyar.us/newsletter" />`

Both URLs continue to render the same page (Newsletter.tsx). Sitemap still lists both (slim-down to one is a separate follow-up). Only the canonical signal flipped.

## Build / test evidence

- `npx tsc --noEmit` — 0 errors
- `npm run test:intake` — 11/11 green (health, public client config, valid submission, invalid turnstile rejection, D1/audit row, notification path, consent rejection, newsletter checklist submission, newsletter consent rejection, micro-offer fields, request_type alias)
- `npm run build` — green, `main-Dsuzx-uI.js` bundle (new hash, 590.91 kB / 156.69 kB gzip; was `main-BUtub95-.js` from turn-058/059); 34 per-route shells written, 19 shells had JSON-LD injected, RSS at `dist/public/rss.xml` rebuilt (3 items, 2384 bytes)
- 9-section regression check (post-build):
  - G FAIL exit 1 — expected (founder-blocked per `docs/PRICING-LADDER-DRIFT-2026-07-09.md`)
  - H PASS — canonical present on home shell + 3 JSON-LD blocks
  - J PASS — Navbar aria-labels consistent between src/ and bundle
  - L PASS — 29 cited ticket-ids all resolve in kanban DB
  - M PASS — 55 cited commit-SHAs all resolve in git log
  - N PASS — 9 cited `docs/*.md` paths all resolve
  - O PASS — live bundle auto-discovered, canonical across 4 routes
- K FAIL exit 1 (pre-fix) — on-disk audit file `turn-059.md` was never committed. Closed by this turn: `git add .hermes/audit/turn-059.md` + `git add .hermes/audit/turn-060.md` ship together. K PASS post-fix.
- Live smoke: `curl -sSL https://mehyar.us/newsletter/ | grep -oE 'canonical[^>]*newsletter'` returns 1 (already correct); `curl -sSL https://mehyar.us/free-checklist/ | grep -oE 'canonical[^>]*free-checklist'` returns 1 (the drift this turn closes; will return 0 after CF Pages rebuild deploys).

## What this turn does NOT touch

- **Pricing drift** — Section G probe still FAIL exit 1. `/micro-offer` still advertises "$330 audit + setup plan" (the MicroOffer intake charge, NOT a leak-ladder tier). Founder decision per `docs/PRICING-LADDER-DRIFT-2026-07-09.md` (options A/B/C) is still required. Loop will not ship pricing changes autonomously.
- **W5-PERSUADE** — still `t_45ea76a8 ready`, founder reply on `docs/PERSUASION-PROPOSAL.md` unblocks.
- **Cron activation** — still founder-decision-gated; chat_id 6829435996 noted but not wired in `state.md`; `cron_enabled=off`.
- **Loop hygiene sibling classes** — Section P (3rd count-strip instance) still parked at 2-of-3; classes (b) fence-strip + (c) inline-strip still at 1 instance each, watching for 2nd.

## Lessons

1. **A drift class can live on two surfaces for the same route.** The `/free-checklist` static shell (pre-rendered by `scripts/copy-route-shells.mjs`) and the runtime SPA (mounted by `SeoManager`) can disagree on the same canonical URL. Build-time + runtime both need to point at the same target — fixing only one half leaves the other half's drift still serving crawlers.
2. **The static shell is what no-JS crawlers see; the SPA is what Google sees with JS.** Google indexes BOTH — first the static shell (cheap), then the SPA-rendered HTML post-hydration (richer). Both need canonical pointing at the same URL or the consolidation half-lands.
3. **Audit-record hygiene debt is cheap to close but easy to forget.** Turn-059's audit file was on disk (turn-059 ran to completion in the previous tick) but never committed because the previous tick shipped and the next tick started without re-staging the audit. Section K probe caught it. Adding audit files to the same commit as the audit's own tick is the right pattern.

## Files changed this tick

- `client/src/components/SeoManager.tsx` — `/free-checklist` `staticMeta` entry: `path: "/free-checklist"` → `path: "/newsletter"` (1 line).
- `.hermes/audit/turn-059.md` — added to commit (was on disk, untracked from previous tick).
- `.hermes/audit/turn-060.md` — this file.
- `.hermes/state.md` — turn-060 ship record + deployed_sha update.
- `.hermes/learned.md` — turn-060 learned note.
- `docs/VISION.md` — append-only iteration diary: turn-060 line.

## Next-tick hot list (carryover from turn-059 + delta)

- **Pricing drift (founder-blocked):** Section G probe FAIL exit 1 still expected. When founder replies on `docs/PRICING-LADDER-DRIFT-2026-07-09.md` with option A/B/C, the next tick ships the chosen fix in a single tick (build + test:intake + 4-screen smoke + push + state update + Telegram card). Expected ~15 min decision-to-live.
- **W5-PERSUADE (t_45ea76a8, ready):** still waiting on `docs/PERSUASION-PROPOSAL.md` decision. Loop recommendation: start with Shape A (sticky CTA bar) only — smallest, most reversible, captures the largest single leak — then add B/C after measuring Shape A's lift.
- **Section P candidate (probe-strip patterns):** rubric at 3 distinct classes (count-strip 2 instances, fence-strip 1, inline-strip 1). Section P threshold watches count-strip only. No new instance this tick.
- **Cron activation:** still requires founder decision ("explain first, then together"). State persists.