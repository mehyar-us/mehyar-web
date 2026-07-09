# STATE — mehyar.us improve-loop

> O(1) warm-start. Updated at the END of every tick.
> First-party fields only — anything not on the live site/cf/repo goes elsewhere.

| field                          | value                                    |
| ------------------------------ | ---------------------------------------- |
| last_tick_at                   | 2026-07-09T14:00:00Z                     |
| last_tick_id                   | 22                                       |
| live_url                       | https://mehyar.us                        |
| deploy_target                  | Cloudflare Pages (github-org/mehyar-web) |
| repo                           | C:/Users/mehya/OneDrive/Documents/GitHub/mehyar-web |
| live_url_status                | up                                       |
| deployed_sha                   | 9f7c4c6                                  |
| deploy_status                  | green (turn-022 live @ https://mehyar.us/contact — 3 JSON-LD blocks: original ProfessionalService + FAQPage, plus route-injected @graph [WebPage, BreadcrumbList, ContactPage, Organization(email + 2 ContactPoints + Brooklyn NY), FAQPage(5 questions)]; /api/intake OPTIONS 204; cross-route smoke verified all 10 jsonld routes still serving their marker; bundle voice-scan clean; build green, test:intake 11/11; W4-SEO additive piece now covers 10/13 public routes) |
| cf_analytics_token_present     | yes                                      |
| cf_analytics_7d                | {visits: ?, conversions: ?, top_pages: ?} |
| open_tickets                   | 4  (ready: t_45ea76a8 W5-PERSUADE, t_b3048d53 LOOP-BOOT, t_90f2136f BOARD-HANDOFF, t_5ad10614 turn-014 anti-slop dup — todo: 0; closed this tick: t_140dc77d turn-021, t_96bc8b84 turn-021) |
| blocked_tickets                | 0  (was 1 — t_5f79e5ac CF Access cleanup auto-resolved; no token needed) |
| shipped_since_last             | 1                                        |
| vision_doc_version             | bootstrap-2026-07-08                     |
| last_learned                   | shipped ContactPage + WebPage + BreadcrumbList + Organization + FAQPage JSON-LD on /contact (turn-022, sha 9f7c4c6) — additive SEO via scripts/route-jsonld.json (same pattern as turns 16-21). /contact @graph has 5 blocks: WebPage (#webpage), BreadcrumbList (Home > Contact), ContactPage (#contactpage), Organization (#org-contact with email info@mehyar.us + 2 ContactPoints + Brooklyn NY address), FAQPage (5 questions). Closes the W4-SEO additive piece: 10/13 public routes now schema-equipped. Two lessons: (a) cross-route smoke after every additive SEO tick catches silent sibling regressions; (b) deploy:pages npm script is vestigial — real deploy is CF Pages auto from main on push, verify via git ls-remote + live curl. Next: LOOP-BOOT full VISION audit, OR W5-PERSUADE spec, OR address the 4 ready tickets on the mehyar-us board. |
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