# STATE — mehyar.us improve-loop

> O(1) warm-start. Updated at the END of every tick.
> First-party fields only — anything not on the live site/cf/repo goes elsewhere.

| field                          | value                                    |
| ------------------------------ | ---------------------------------------- |
| last_tick_at                   | 2026-07-09T18:25:00Z                     |
| last_tick_id                   | 31                                       |
| live_url                       | https://mehyar.us                        |
| deploy_target                  | Cloudflare Pages (github-org/mehyar-web) |
| repo                           | C:/Users/mehya/OneDrive/Documents/GitHub/mehyar-web |
| live_url_status                | up                                       |
| deployed_sha                   | 3d2408e (turn-030 home JSON-LD; CF Pages deploy rolled the shell files — route-injected WebPage/BreadcrumbList/ItemList block IS live on / — but JS bundle hash stayed main-P-x17WD-.js from turn-027; main @ 3d2408e on github) |
| deploy_status                  | green (turn-030 SHELL PARTIAL — shell file deploy rolled route-injected JSON-LD on home, JS bundle hash lag is benign for SEO outcome; full 13-route LOOP-BOOT audit turn-031 all PASS — 13/13 routes 200, 3 JSON-LD blocks each, expected @types match, bundle funnel counters unchanged from turn-027 baseline (19 micro-offer#intake / 7 'Request the $330 audit' / 1 'Request the audit path' / 21 /contact), anti-slop 0/7 hits, tsc green, test:intake 11/11) |
| cf_analytics_token_present     | yes                                      |
| cf_analytics_7d                | {visits: ?, conversions: ?, top_pages: ?} |
| open_tickets                   | 2  (ready: t_45ea76a8 W5-PERSUADE, t_90f2136f BOARD-HANDOFF — todo: 0; closed this tick: t_5a6bf1c3 turn-030, t_b3048d53 LOOP-BOOT) |
| shipped_since_last             | 1 (docs only)                            |
| last_learned                   | shipped turn-030 home JSON-LD reconciliation + turn-031 full 13-route LOOP-BOOT audit (sha 3d2408e live; main @ 3d2408e on github; LOOP-BOOT rubric verified-this-tick — 0 regressions across A/B/C/E/F sections). Two distinct CF Pages deploy behaviors now documented: (a) docs-only commits don't trigger any deploy workflow run (turn-028/029/031 this tick all docs/** only); (b) scripts/ changes trigger shell-deploy — route-injected JSON-LD content lands in dist/public/index.html and goes live, but JS bundle hash can lag by one build. The bundle-hash lag is benign for SEO outcome (crawlers read the shell JSON-LD which is the artifact that matters for SEO ticks) and benign for runtime behavior (the route-injected block was redundant with SeoManager runtime). Lesson: for scripts/ ticks, verify the shell artifact that matters (JSON-LD block count, @types, @id cross-refs), not the bundle hash. Turn-031 was the first full 13-route LOOP-BOOT run; zero regressions is the right answer for a rubric that was just rebuilt at turn-028. Next tick: the rubric ledger has a verified-this-tick entry, so future LOOP-BOOT runs can detect drift cheaply. |
| vision_doc_version             | bootstrap-2026-07-08                     |
| cron_enabled                   | off                                      |
| cron_schedule                  | every 15m shallow; daily 09:00 deep      |
| telegram_chat_id               | 6829435996 (per cron prompt; not yet wired in state) |
| agent_roles_ready              | improver, deployer, tester, persuader, ideator |
| change_budget (per tick)       | 1 PR, 3 tickets                          |
| kill_switch                    | off                                      |

## next-tick hot list (max 3 items)
- W5-PERSUADE (t_45ea76a8, ready): propose persuasion shape a/b/c per docs/PERSUASION-PROPOSAL.md template (currently locked: passive only) — long-stale; needs user direction first
- (small): follow-up LOOP-BOOT cadence — schedule next full 13-route audit in 5-7 ticks to catch drift cheaply (rubric is now anchored to verified-this-tick ledger entry from turn-031)
- (small): investigate CF Pages bundle-hash-lag mechanism — when scripts/route-jsonld.json edits, can the JS bundle be invalidated alongside the shell? (no behavior change needed; just a deploy cleanliness question)