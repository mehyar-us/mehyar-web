# FINAL ACCEPTANCE GATE — mehyarSoft v1 — 2026-05-11

> The ship/no-ship decision rubric for the v1 launch. Recreated 2026-07-09
> (turn-028) — `docs/VISION.md` "Current state" line referenced this file
> but it was never committed to disk. This doc restores the v1 acceptance
> rubric from the actually-shipped artifacts and reuses the LOOP-BOOT audit
> shape for ongoing verification.

## Gate status (live, as of turn-028 / sha ef12663)

| #  | Gate                                                    | Status | Evidence                                            |
| -- | ------------------------------------------------------- | ------ | --------------------------------------------------- |
| 1  | Public revenue site reachable on mehyar.us              | PASS   | 19/19 routes 200; verified turn-027 + turn-028       |
| 2  | Six-tier offer ladder visible on home                   | PASS   | $150 / $250 / $1k-$5k / $5k-$25k / $500-$3500 / $150 |
| 3  | Audit-intent funnel closed (W2-FUNNEL, 4-piece)         | PASS   | turn-004 + 005 + 006 + 027; 19 `micro-offer#intake` |
| 4  | Cloudflare Pages deploy pipeline green                  | PASS   | `.github/workflows/deploy-cloudflare-pages.yml`     |
| 5  | Cloudflare intake (CF Functions) shipped                | PASS   | `functions/api/intake.js` + D1 + KV + notification  |
| 6  | Intake test suite green                                 | PASS   | `npm run test:intake` 11/11                         |
| 7  | Structured data on all public routes (W4-SEO)           | PASS   | 19 schema-equipped routes                           |
| 8  | Voice + brand bar (W1-SLOP)                            | PASS   | Anti-slop blacklist bundle-scan clean               |
| 9  | RSS + sitemap + robots                                 | PASS   | /rss.xml 3 items; /sitemap.xml 22 urls; /robots.txt |
| 10 | OG image + per-route meta on every shell                | PASS   | 1200x630 PNG; per-route title/desc/canonical/og/tw  |
| 11 | CF Web Analytics wired                                  | PASS   | beacon injected; cf_analytics_token_present = yes   |
| 12 | Email consent + suppression list wired                  | PASS   | suppression_list table; consent_contact required    |
| 13 | Founder E-E-A-T signals                                 | PASS   | Person + AboutPage + Organization JSON-LD            |

## Gate items still PARTIAL (not blocking v1)

- **CF Analytics conversion tracking** — beacon is wired, but conversion
  attribution from `/micro-offer#intake` form submit to a CF Analytics
  custom event is **not yet wired**. The intake POST writes a D1 audit row
  and triggers a notification email, but the visit → submit pair is not
  surfaced as a single conversion in the CF Analytics dashboard. Tracked
  under ticket `t_5f79e5ac` (CF Access cleanup) — gated on `CF_API_TOKEN`
  env var.

## Gate items still FAIL (deferred)

- **CF Access policy on /admin** — admin route returns 200 without auth
  guard. Blocked on the same `CF_API_TOKEN` dependency. Tracked under
  ticket `t_5f79e5ac`.

- **Persuasion shape (W5-PERSUADE)** — currently locked passive-only.
  Proposal at `docs/PERSUASION-PROPOSAL.md` will land once a/b/c is
  chosen by the user.

## How to run this gate

1. `npm run check` → must exit 0
2. `npm run build:client` → must report ≥19 shells injected + 3 RSS items
3. `npm run test:intake` → must report 11/11
4. Live curl probe of the 13 URLs in section A of the QA baseline doc
   → must all return 200
5. Bundle-scan the dist/public/assets/main-*.js for anti-slop blacklist
   → must report 0 hits
6. Cross-check the audit-intent grep counts in section B of the QA
   baseline → must match the latest shipped numbers

If any of steps 1-3 fail, **block the merge**. If steps 4-6 surface a
regression from PASS to FAIL/PARTIAL, file a P0 ticket and roll back
unless the tick has an approved exception.

## Gate refresh cadence

This gate is re-validated on the **LOOP-BOOT audit tick** (full
verification) and on **every improvement tick that touches conversion paths**
(budget-limited 4-screen smoke per `mehyar-us-improve-loop` skill, Phase 6).
Steady-state ticks that don't touch conversion paths only need the
anti-slop bundle-scan (step 5) and the live URL spot-check for the
route they touched.

## Provenance

Original gate defined 2026-05-11 alongside the v1 launch-intake decision
(`docs/launch-intake-decision.md`). Recreated 2026-07-09 (turn-028) because
the original markdown was referenced in `docs/VISION.md` "Current state"
but never committed to the repo — every prior tick operated against the
shipped artifacts instead of against this rubric. Going forward, the gate
and the QA baseline doc together form the "shipped = green on this list"
definition that `perpetual-tick-loop` reads every tick.