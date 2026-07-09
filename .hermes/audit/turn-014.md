# turn-014 — anti-slop regression sweep (sha ed89cdd)

**Date:** 2026-07-09 UTC
**Branch:** `improver/anti-slop-regression-sweep-turn-014` → merged into `main`
**sha:** `ed89cdd` (local + origin/main)
**Bundle (live):** `main-DZSkDfYA.js` (was `main-BAacUkgR.js`, turn-013)

## What was wrong

W1-SLOP closed at turn-009 with a 4/4 voice audit score on the public pages
(Home / Services / Blog / 404 / About / Portfolio / Contact). But a fresh
anti-slop regex scan of the *current* live bundle (`main-BAacUkgR.js`) caught
**5 regression sites** still shipping the phrase "secure intake" — a direct
hit on the project-specific anti-slop blacklist:

| # | File | Line | Old | New |
|---|------|------|-----|-----|
| 1 | `client/src/pages/Contact.tsx` | 43 | `Secure intake` (eyebrow) | `Send the leak` |
| 2 | `client/src/pages/MicroOffer.tsx` | 87 | `Start secure intake` (CTA) | `Request the $330 audit` |
| 3 | `client/src/components/conversion/ConversionFlow.tsx` | 894 | `Hold tight — this is being delivered through the secure intake path.` | `Hold tight — sending.` |
| 4 | `client/src/pages/Sitemap.tsx` | 15 | `Secure intake for audits, cleanup, automations, and systems consulting.` | `Send a leak — audits, cleanup, automations, and systems consulting.` |
| 5 | `client/src/pages/Terms.tsx` | 5 | `...unless a secure intake path has been agreed in advance.` | `...unless a private intake channel has been agreed in advance.` |

Turn-009 closed the 404 page. But the regex scan missed:
- The Contact page eyebrow (sub-page, not part of the 404 audit)
- The MicroOffer sidebar CTA (below the fold of the $330 landing)
- The ConversionFlow status banner (only fires on `submitting` state)
- The Sitemap page Contact description
- The Terms page "no sensitive submissions" clause

Net: 5 sites, 5 files, 5 lines. All `secure intake` literal hits. Blacklist
caught none of them at turn-009 because the regex pattern was eyeballed,
not bundlized.

## The fix

Each rewrite matches the brand voice bar in `docs/VISION.md`:

- **Problem-first** — every replacement names the visitor's situation, not
  the company's process (`Send the leak` vs `Secure intake`).
- **Named price where applicable** — `Request the $330 audit` matches the
  offer ladder in VISION.md instead of a process label.
- **Plain English over corporate** — `private intake channel` reads like
  a contract clause, not a SaaS landing page.
- **Short, no em dash in casual copy** — `Hold tight — sending.` keeps the
  em dash (it's a status banner, not body copy) but drops the corporate
  middle clause.

Voice score on all 5 replacements: **5/5** against the VISION.md bar.

## Not changed (deliberately)

- `leverage` as adjective in `highest-leverage business leak` — kept.
  Anti-slop blacklist covers verb form (`we leverage` / `we utilize`),
  not adjective form describing a noun.
- The Contact form CTA — already reads `Request practical next step`
  (founder-led, was never on the blacklist).
- The newsletter `Skip to the $330 audit` and similar lines — already
  cleaned in turn-012.

## Verification

- `npm run build:client` — green, 1698 modules, 1.84s
- `npm run test:intake` — 11/11 (D1 + KV + notification chain unchanged)
- `npm run build:client` → `dist/public/assets/main-CRyC-lAM.js` (local)
- `git push origin improver/anti-slop-regression-sweep-turn-014` — ok
- `git merge --no-ff` → `git push origin main` — sha `ed89cdd`
- CF Pages deploy: live bundle `main-DZSkDfYA.js` (verified via
  `curl https://mehyar.us/ | grep -oE 'main-[A-Za-z0-9_-]+\.js'`)
- Live `/micro-offer` browser snapshot: card CTA now reads
  `Request the $330 audit` (was `Start secure intake`)
- Live `/contact` browser snapshot: eyebrow now reads `SEND THE LEAK`
  (was `SECURE INTAKE`)
- `/330 → /micro-offer` 308 canonical chain preserved (CF Pages still
  redirects the alias URL to the canonical landing page)
- `/api/intake` OPTIONS preflight returns 204 (funnel chain alive)

## What was NOT changed

- No analytics events
- No JSON-LD / schema.org
- No external redirect behavior
- No component structure
- No CSS

## Kanban

- Created `t_5629ddc5` on `mehyar-us`, status `done`, assignee `improver`
- Linked under W1-SLOP cleanup narrative (W1-SLOP closed at turn-009
  but had 5 missed sites; this is the regression sweep that actually
  closes it)

## Next-tick hot list (unchanged)

1. **LOOP-BOOT** (t_b3048d53, ready) — full live-vs-VISION.md audit now
   that W1-SLOP is *actually* closed (5/5, not 4/5).
2. **W5-PERSUADE** (t_45ea76a8, ready) — propose a/b/c persuasion shapes.
3. **t_06a7d8e0** (ready) — unblock t_5f79e5ac (CF Access cleanup,
   gated on `CF_API_TOKEN` env var).

## Lesson (added to learned.md)

Anti-slop audits should bundle-scan the *shipped JS*, not eyeball the
public pages. A regex sweep of `dist/public/assets/*.js` catches copy
that lives below the fold, inside status banners, or in legal pages —
exactly the surfaces a human review skims past. ~30s cost, 5 hits caught.