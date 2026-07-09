# STATE — mehyar.us improve-loop

> O(1) warm-start. Updated at the END of every tick.
> First-party fields only — anything not on the live site/cf/repo goes elsewhere.

| field                          | value                                    |
| ------------------------------ | ---------------------------------------- |
| last_tick_at                   | 2026-07-09T10:50:00Z                     |
| last_tick_id                   | 21                                       |
| live_url                       | https://mehyar.us                        |
| deploy_target                  | Cloudflare Pages (github-org/mehyar-web) |
| repo                           | C:/Users/mehya/OneDrive/Documents/GitHub/mehyar-web |
| live_url_status                | up                                       |
| deployed_sha                   | cd65ef9                                  |
| deploy_status                  | green (turn-021 live @ https://mehyar.us/services and /portfolio — 6 new JSON-LD blocks (3 per route); /services @graph=[WebPage, BreadcrumbList, ItemList(7 offer items)], /portfolio @graph=[WebPage, BreadcrumbList, ItemList(6 engagement patterns)]; route-injected via scripts/inject-route-jsonld.mjs; build green, test:intake 11/11, bundle voice-scan clean; deploy lag for cold /services route = ~5min; state.md reconciled turn-017-020) |
| cf_analytics_token_present     | yes                                      |
| cf_analytics_7d                | {visits: ?, conversions: ?, top_pages: ?} |
| open_tickets                   | 4  (ready: t_45ea76a8 W5-PERSUADE, t_b3048d53 LOOP-BOOT, t_90f2136f BOARD-HANDOFF, t_5ad10614 turn-014 anti-slop dup — todo: 0; closed this tick: t_140dc77d turn-021) |
| blocked_tickets                | 0  (was 1 — t_5f79e5ac CF Access cleanup auto-resolved; no token needed) |
| shipped_since_last             | 1                                        |
| vision_doc_version             | bootstrap-2026-07-08                     |
| last_learned                   | shipped WebPage + BreadcrumbList + ItemList JSON-LD on /services and /portfolio (turn-021, sha cd65ef9) — additive SEO via scripts/route-jsonld.json, same pattern as turns 17-20. /services @graph has 7-item ItemList (offer catalog $150 → custom build, anchored by price), /portfolio has 6-item ItemList (engagement patterns /portfolio/1-6). Zero copy risk. route-jsonld.json pipeline now covers 9/13 public routes (home, about, micro-offer, booking, 3 blog posts, services, portfolio). Next: /contact schema is the last additive W4-SEO piece; OR W5-PERSUADE spec; OR LOOP-BOOT full VISION audit. |
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