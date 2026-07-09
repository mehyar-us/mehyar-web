# STATE — mehyar.us improve-loop

> O(1) warm-start. Updated at the END of every tick.
> First-party fields only — anything not on the live site/cf/repo goes elsewhere.

| field                          | value                                    |
| ------------------------------ | ---------------------------------------- |
| last_tick_at                   | 2026-07-09T22:25:00Z                     |
| last_tick_id                   | 35                                        |
| live_url                       | https://mehyar.us                        |
| deploy_target                  | Cloudflare Pages (github-org/mehyar-web) |
| repo                           | C:/Users/mehya/OneDrive/Documents/GitHub/mehyar-web |
| live_url_status                | up                                       |
| deployed_sha                   | 5f49f9c (turn-035 hero secondary CTA target /services → /#pricing; PR improver/hero-cta-pricing-turn-035 merged; CF Pages built main-CqiU6zle.js from 5f49f9c; content-fingerprint verified /#pricing=1) |
| deploy_status                  | green (turn-035 WIRE-FIX — 1 line src/ change rolled both shell AND bundle; live bundle now has 1x /#pricing (turn-033 had 0) and 1x "See the leak ladder"; audit-intent funnel 20/7/1/20 match turn-033 baseline exactly; voice 5/5; anti-slop 0/8; tsc green; test:intake 11/11; src/-vs-scripts/ bundle-roll pattern locked with 3/3 data points — src/ change rolls bundle, scripts/ change does not) |
| cf_analytics_token_present     | yes                                      |
| cf_analytics_7d                | {visits: ?, conversions: ?, top_pages: ?} |
| open_tickets                   | 2  (ready: t_45ea76a8 W5-PERSUADE, t_90f2136f BOARD-HANDOFF — todo: 0; closed this tick: t_<turn-035-id> turn-035 hero CTA target fix) |
| shipped_since_last             | 1 (src/ — wire: hero secondary CTA /services → /#pricing; sha 5f49f9c; bundle rolled to main-CqiU6zle.js) |
| last_learned                   | shipped turn-035 hero secondary CTA target fix (sha 5f49f9c live; main @ 5f49f9c on github; PR improver/hero-cta-pricing-turn-035 merged). 1-tap bounce closed: hero 'See the leak ladder' now scrolls to the actual 6-tier pricing section on the home page, not the unrelated /services consulting-offer grid. W2-FUNNEL hero secondary-CTA piece finally closed (turn-004=primary CTA target, turn-033=secondary CTA label, turn-035=secondary CTA target). src/-vs-scripts/ bundle-roll pattern locked with 3/3 data points (turn-027/turn-033/turn-035 src/ all rolled bundle; turn-030 scripts/ did not). Local build main-BEFkljKi.js → CF Pages build main-CqiU6zle.js (hash differs by build host; verify by content-fingerprint, not by exact hash). Cheap post-rename / post-add CTA check added: list every href in the live bundle and verify each one is the URL the visitor expects to land on, not the URL a developer pasted during build. Voice 5/5. |
| vision_doc_version             | bootstrap-2026-07-08                     |
| cron_enabled                   | off                                      |
| cron_schedule                  | every 15m shallow; daily 09:00 deep      |
| telegram_chat_id               | 6829435996 (per cron prompt; not yet wired in state) |
| agent_roles_ready              | improver, deployer, tester, persuader, ideator |
| change_budget (per tick)       | 1 PR, 3 tickets                          |
| kill_switch                    | off                                      |

## next-tick hot list (max 3 items)
- W5-PERSUADE (t_45ea76a8, ready): propose persuasion shape a/b/c per docs/PERSUASION-PROPOSAL.md template (currently locked: passive only) — long-stale; needs user direction first
- (small): follow-up LOOP-BOOT cadence — schedule next full 13-route audit in 3-5 ticks to catch drift cheaply (rubric is now anchored to verified-this-tick ledger entries from turn-031 AND turn-033 AND turn-034)
- (small): STALE — the META-UNBLOCK hot-list reference points to t_5f79e5ac which is now done (closed 2026-07-09 04:48, "Already-resolved: 0 Access apps on account..."). Removed; was a state.md carry-over from before the t_5f79e5ac resolution. No active meta-unblock work remains.