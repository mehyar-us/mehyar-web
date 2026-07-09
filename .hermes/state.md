# STATE — mehyar.us improve-loop

> O(1) warm-start. Updated at the END of every tick.
> First-party fields only — anything not on the live site/cf/repo goes elsewhere.

| field                          | value                                    |
| ------------------------------ | ---------------------------------------- |
| last_tick_at                   | 2026-07-09T15:55:00Z                     |
| last_tick_id                   | 25                                       |
| live_url                       | https://mehyar.us                        |
| deploy_target                  | Cloudflare Pages (github-org/mehyar-web) |
| repo                           | C:/Users/mehya/OneDrive/Documents/GitHub/mehyar-web |
| live_url_status                | up                                       |
| deployed_sha                   | 9479e23                                  |
| deploy_status                  | green (turn-025 live @ https://mehyar.us/newsletter — 3 JSON-LD blocks: original ProfessionalService + FAQPage, plus route-injected @graph [WebPage #webpage, BreadcrumbList(Home>Free AI Automation Checklist), FAQPage(6 Qs: what checklist is, who for, free+spam-free, checklist vs $330 audit, PHI safety, what happens after signup)]; cross-route smoke 12/12 routes served (no sibling regressions); build green, test:intake 11/11 incl. newsletter form_type + micro_offer + contact; W2-FUNNEL 4-screen 200s on home/booking/micro-offer/404; W4-SEO additive piece extended to 18 schema-equipped routes) |
| cf_analytics_token_present     | yes                                      |
| cf_analytics_7d                | {visits: ?, conversions: ?, top_pages: ?} |
| open_tickets                   | 3  (ready: t_45ea76a8 W5-PERSUADE, t_b3048d53 LOOP-BOOT, t_90f2136f BOARD-HANDOFF — todo: 0; closed this tick: t_7cdb5b85 turn-025) |
| shipped_since_last             | 1                                        |
| last_learned                   | shipped /newsletter WebPage + BreadcrumbList + FAQPage JSON-LD (turn-025, sha 9479e23) — free AI Automation Checklist landing (top-of-funnel lead-capture, no alias) now schema-equipped with 6-question FAQPage (what/who/is-it-free+no-spam/checklist-vs-$330-audit/PHI-safety/what-happens-after). W4-SEO additive piece extended to 18 schema-equipped routes. Reusable scripts/add-newsletter-jsonld.py preserves original file format (CRLF + indent=2 + ensure_ascii=False + same key order); result 91 inserted / 0 deleted vs turn-024's 750+1013 line diff noise. Lesson: highest-leverage additive SEO targets are top-of-funnel routes that aren't aliased — scan dist/public/ for routes whose copy-route-shells.mjs entry has no alias (no /330→/micro-offer, /book→/booking, /free-checklist→/newsletter pattern); those routes need their own @graph; aliased routes inherit the canonical target's schema. Build green, test:intake 11/11, cross-route 12/12 markers served (no sibling regressions), W2-FUNNEL 4-screen 200s on home/booking/micro-offer/404. Next: W5-PERSUADE spec (t_45ea76a8), LOOP-BOOT full VISION audit (t_b3048d53), or schema /404 (currently 2 blocks, no route-injected @graph). |
| vision_doc_version             | bootstrap-2026-07-08                     |
| cron_enabled                   | off                                      |
| cron_schedule                  | every 15m shallow; daily 09:00 deep      |
| telegram_chat_id               | 6829435996 (per cron prompt; not yet wired in state) |
| agent_roles_ready              | improver, deployer, tester, persuader, ideator |
| change_budget (per tick)       | 1 PR, 3 tickets                          |
| kill_switch                    | off                                      |

## next-tick hot list (max 3 items)
- LOOP-BOOT (t_b3048d53, P1, ready): full live-vs-VISION.md audit — now safe to run since W1-SLOP is *actually* closed (5/5 not 4/5). Highest-leverage scan: did anything else regress while the loop was running 5-tick sprints?
- W5-PERSUADE (t_45ea76a8, ready): propose persuasion shape a/b/c per docs/PERSUASION-PROPOSAL.md template (currently locked: passive only)
- t_06a7d8e0: unblock t_5f79e5ac (CF Access cleanup) — still gated on CF_API_TOKEN env var

## known unknowns
- CF API bearer token location (blocks META-UNBLOCK / t_5f79e5ac, still 545+h blocked)
- GSC sitemap submit path
- A/B test platform (if any)
- Whether to keep W3-PWA fully shell-cached or relax runtime cache if CF analytics shows no install prompt lift after 7d
- Lighthouse + axe a11y scores (no headless runner wired yet; deferred per turn-002 until first deploy succeeds — now satisfied at turn-003, blocker is browser tooling)
- git push hangs silently without explicit token auth (turn-005 used GITHUB_TOKEN env var; bash credential helper manager blocks indefinitely — solution: `https://x-access-token:${GITHUB......` form)