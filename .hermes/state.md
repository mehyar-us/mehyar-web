# STATE — mehyar.us improve-loop

> O(1) warm-start. Updated at the END of every tick.
> First-party fields only — anything not on the live site/cf/repo goes elsewhere.

| field                          | value                                    |
| ------------------------------ | ---------------------------------------- |
| last_tick_at                   | 2026-07-09T15:19:00Z                     |
| last_tick_id                   | 24                                       |
| live_url                       | https://mehyar.us                        |
| deploy_target                  | Cloudflare Pages (github-org/mehyar-web) |
| repo                           | C:/Users/mehya/OneDrive/Documents/GitHub/mehyar-web |
| live_url_status                | up                                       |
| deployed_sha                   | ab72cba                                  |
| deploy_status                  | green (turn-024 live @ https://mehyar.us/blog — 3 JSON-LD blocks: original ProfessionalService + FAQPage, plus route-injected @graph [WebPage, Blog(blogPost[]→3 post #blogposting @ids), BreadcrumbList(Home>Blog), ItemList(3 posts)]; cross-route smoke 17/17 markers served; build green, test:intake 11/11; W4-SEO additive piece closed at 17 schema-equipped routes; turn-023 retroactively journaled (portfolio detail WebPage+CreativeWork+BreadcrumbList) and turn-021 stuck-ready t_96bc8b84 closed during reconciliation) |
| cf_analytics_token_present     | yes                                      |
| cf_analytics_7d                | {visits: ?, conversions: ?, top_pages: ?} |
| open_tickets                   | 3  (ready: t_45ea76a8 W5-PERSUADE, t_b3048d53 LOOP-BOOT, t_90f2136f BOARD-HANDOFF — todo: 0; closed this tick: t_0c2ece0e turn-024, t_e54ad127 turn-023 retroactive, t_96bc8b84 turn-021 retroactive cleanup) |
| shipped_since_last             | 1                                        |
| last_learned                   | shipped /blog WebPage + Blog + BreadcrumbList + ItemList JSON-LD (turn-024, sha ab72cba) — blog index now schema-equipped, Blog block's blogPost[] cross-references the 3 individual #blogposting @ids from turn-019 (graph is now self-cross-referencing across the blog surface). W4-SEO additive piece closed at 17 schema-equipped routes (home, about, blog, micro-offer, booking, services, portfolio, portfolio/1..6, contact, 3 blog posts). Three lessons: (a) preserve original file format when programmatically editing JSON config files (CRLF endings + insertion order matter — first naive pass silently converted LF→CRLF and re-sorted all keys, generating 750+1013 line diff noise for a ~90-line semantic add); (b) cross-route smoke after every additive SEO tick catches silent sibling regressions — 17/17 markers confirmed live; (c) state.md drift accumulates silently — turn-022 was the last journaled tick but main had moved to turn-023 without a journal entry; turn-024 reconciled by filing turn-023 retroactively and closing stuck-ready t_96bc8b84 that state.md had falsely claimed was already done. Next: LOOP-BOOT full VISION audit (t_b3048d53) or W5-PERSUADE spec (t_45ea76a8) or schema /404 + /newsletter. |
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