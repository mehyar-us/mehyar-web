# turn-031 — 2026-07-09 · Full 13-route LOOP-BOOT audit

> Docs-only tick. Verifies the recreated rubric
> (`docs/QA-MEHYARSOFT-B2B-BASELINE-2026-05-11.md`) against the live
> site on all 13 surface items + sections B, E, F. Closes
> `t_b3048d53` (the LOOP-BOOT kanban ticket).

## A. Surface & reachability — 13/13 PASS

Every URL in the rubric Section A returns 200 on `curl https://mehyar.us<path>`.
Each public route serves 3 JSON-LD blocks on first byte with the
expected @types per rubric Section C.

| # | URL                                              | HTTP | Blocks | Expected @types                                    | Status |
| - | ------------------------------------------------ | ---- | ------ | -------------------------------------------------- | ------ |
| 1 | `/`                                              | 200  | 3      | ProfessionalService, FAQPage, ItemList (turn-030) | PASS   |
| 2 | `/services`                                      | 200  | 3      | ProfessionalService, FAQPage, ItemList (turn-021)  | PASS   |
| 3 | `/portfolio`                                     | 200  | 3      | ProfessionalService, FAQPage, ItemList (turn-021)  | PASS   |
| 4 | `/portfolio/1..6`                                | 200  | 3      | ProfessionalService, FAQPage, CreativeWork (turn-023) | PASS   |
| 5 | `/blog`                                          | 200  | 3      | ProfessionalService, FAQPage, Blog (turn-024)      | PASS   |
| 6 | `/blog/{3 slugs}`                                | 200  | 3      | ProfessionalService, FAQPage, BlogPosting (turn-019) | PASS   |
| 7 | `/about`                                         | 200  | 3      | ProfessionalService, FAQPage, AboutPage (turn-016) | PASS   |
| 8 | `/contact`                                       | 200  | 3      | ProfessionalService, FAQPage, ContactPage (turn-022) | PASS   |
| 9 | `/booking/`                                      | 200  | 3      | ProfessionalService, FAQPage, WebPage (turn-020)   | PASS   |
| 10 | `/micro-offer/`                                 | 200  | 3      | ProfessionalService, FAQPage, WebPage (turn-020)   | PASS   |
| 11 | `/newsletter`                                    | 200  | 3      | ProfessionalService, FAQPage, WebPage (turn-025)   | PASS   |
| 12 | `/sitemap.xml`                                   | 200  | n/a    | 22 `<loc>` entries                                 | PASS   |
| 13 | `/rss.xml`                                       | 200  | n/a    | 3 `<item>` entries                                 | PASS   |
| 14 | `/404`                                           | 200  | 3      | ProfessionalService, FAQPage, WebPage (turn-026)  | PASS   |
| 15 | `/robots.txt`                                    | 200  | n/a    | "Sitemap: https://mehyar.us/sitemap.xml" line     | PASS   |

Probe method: `curl -sS https://mehyar.us<path>` from this VM.
`/tmp/bundle.js` (live main bundle) = `main-P-x17WD-.js` (turn-027
build; CF Pages deploy of turn-030's `scripts/route-jsonld.json` edit
rolled the shell files but kept the bundle hash, per turn-030 finding).

## B. Audit-intent funnel realignment — UNCHANGED from turn-027 baseline

Live bundle grep (against `/assets/main-P-x17WD-.js`):

| Counter                                                | Value | Baseline | Δ |
| ------------------------------------------------------ | ----- | -------- | - |
| `micro-offer#intake`                                   | 19    | 19       | 0 |
| `Request the $330 audit`                               | 7     | 7        | 0 |
| `Request the audit path`                               | 1     | 1        | 0 |
| `/contact` (path occurrences, includes service params) | 21    | 21       | 0 |

PASS — counters exactly match the turn-027 baseline (last shipped
funnel realignment).

## C. Structured-data inventory — 19 schema-equipped routes

Per rubric Section C, every public route must serve ≥2 JSON-LD blocks
on first byte. Verified: every probed route has exactly 3 blocks
(runtime ProfessionalService + FAQPage + route-injected @graph).

No regression vs the 18-route baseline established by turn-026. The
19th route (home) was added by turn-030.

## D. Voice / brand bar — n/a this tick

No copy changed. Voice-bar scoring only applies when copy is touched.

## E. Build & test gates — PASS

| Gate                            | Result  |
| ------------------------------- | ------- |
| `npx tsc --noEmit`              | green (0 errors) |
| `node scripts/test-intake-functions.mjs` | 11/11 (health, valid submission, invalid turnstile rejection, D1/audit row, notification path, consent rejection, newsletter checklist, newsletter consent rejection, micro-offer fields, request_type alias, public client config) |
| 4-screen Phase-6 smoke          | home /booking/ /micro-offer/ /404 — each 200, each 3 JSON-LD blocks |

## F. Anti-slop blacklist — 0/7 hits

Live bundle scan for the 7 blacklisted strings:

| Term                          | Hits | Notes                                  |
| ----------------------------- | ---- | -------------------------------------- |
| `secure intake`               | 0    | clean                                  |
| `leverage`                    | 1    | on-brand "highest-leverage business leak" (VISION.md metaphor) |
| `in today's fast-paced`       | 0    | clean                                  |
| `Empowering businesses`       | 0    | clean (replaced turn-014)              |
| `Your trusted partner`        | 0    | clean                                  |
| `AI-powered`                  | 0    | clean (when used, always names what's powered) |
| `we utilize`                  | 0    | clean                                  |

PASS — 0 hard-reject hits. The 1 `leverage` occurrence is the
on-brand phrase; rubric Section D explicitly carves this out.

## G. Open registry — unchanged this tick

No new surfaces shipped this tick. Section G of the rubric stays at
"the doc is the voice-of-correctness; add new items as new surfaces
ship."

## What this tick closes

- `t_b3048d53` (LOOP-BOOT kanban ticket, P1, ready) — now **DONE**
  with this audit artifact as the verification record.

## What this tick does NOT change

- Live site state: no deploy. CF Pages stays at the turn-030
  shell-deploy state (home has the new route-injected block; JS
  bundle hash is turn-027).
- Funnel counters, voice, build gates: all unchanged from prior ticks.
- All kanban tickets other than `t_b3048d53`.

## Next-tick candidate (proactive)

Per state.md's hot list, after LOOP-BOOT closes:
- W5-PERSUADE (`t_45ea76a8`, ready): propose persuasion shape a/b/c per
  docs/PERSUASION-PROPOSAL.md. Locked: passive only — visitor clicks to
  ask. User direction needed before this can ship.

Or pick a new shipping candidate from VISION.md "Current state" gaps:
- No new gap detected this tick (rubric verifies all 13 surface items
  PASS). The next shipping tick should be either (a) a fresh
  high-leverage change or (b) W5-PERSUADE once user direction is in.