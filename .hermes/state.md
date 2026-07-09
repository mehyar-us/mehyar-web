# STATE — mehyar.us improve-loop

> O(1) warm-start. Updated at the END of every tick.
> First-party fields only — anything not on the live site/cf/repo goes elsewhere.

| field                          | value                                    |
| ------------------------------ | ---------------------------------------- |
| last_tick_at                   | 2026-07-09T17:08:00Z                     |
| last_tick_id                   | 29                                       |
| live_url                       | https://mehyar.us                        |
| deploy_target                  | Cloudflare Pages (github-org/mehyar-web) |
| repo                           | C:/Users/mehya/OneDrive/Documents/GitHub/mehyar-web |
| live_url_status                | up                                       |
| deployed_sha                   | ef12663 (unchanged — turn-029 docs-only, deploy workflow filtered out docs/**; live site still on turn-027 sha; main @ 4b2497e on github) |
| deploy_status                  | green (turn-027 still live @ main-P-x17WD-.js; turn-029 4-screen Phase-6 smoke against recreated QA baseline all PASS — home/booking/micro-offer/404 each 200, each 3 JSON-LD blocks, same bundle; live bundle grep 19 micro-offer#intake / 7 'Request the $330 audit' / 1 'Request the audit path' / 21 /contact unchanged; 6-tier offer ladder all 6 price strings in bundle; anti-slop blacklist 0/7 hits; tsc green, test:intake 11/11) |
| cf_analytics_token_present     | yes                                      |
| cf_analytics_7d                | {visits: ?, conversions: ?, top_pages: ?} |
| open_tickets                   | 3  (ready: t_45ea76a8 W5-PERSUADE, t_b3048d53 LOOP-BOOT, t_90f2136f BOARD-HANDOFF — todo: 0; closed this tick: t_<turn-029>) |
| shipped_since_last             | 1 (docs only)                            |
| last_learned                   | shipped VISION.md 'Current state' line cross-link fix (turn-029, sha 4b2497e on github main / live still ef12663) — the line had the same wrong-filename drift turn-028 was created to repair on disk, but VISION.md itself still pointed at non-existent paths (missing `.md`, missing `-2026-05-11.md` suffix, not markdown links). Fixed: each ops doc now a proper markdown link to its actual filename; ops doc count corrected from '2 ops docs' (3 filenames listed) to '4 ops docs' (all 4 actually on disk: mehyarsoft-api-contract + FINAL-ACCEPTANCE-GATE-MEHYARSOFT-V1-2026-05-11 + QA-MEHYARSOFT-B2B-BASELINE-2026-05-11 + launch-intake-decision). Admin docs (2) also now linked. Same tick ran Phase-6 4-screen LOOP-BOOT partial against the recreated rubric — all 14 spot-check items PASS (sections A surface reachability + B audit-intent funnel counts + C structured-data + D voice 5/5 + E build gates + F anti-slop blacklist). Lesson: VISION.md 'Current state' must be cross-checked against disk on every docs-only tick that recreates a referenced file — recreating the doc closes the file-on-disk gap but does NOT automatically fix any line that *names* the doc. Both layers (file existence + reference correctness) are one state. Net deploy impact: NONE — docs-only commit, same as turn-028, live site still on turn-027 sha. |
| vision_doc_version             | bootstrap-2026-07-08                     |
| cron_enabled                   | off                                      |
| cron_schedule                  | every 15m shallow; daily 09:00 deep      |
| telegram_chat_id               | 6829435996 (per cron prompt; not yet wired in state) |
| agent_roles_ready              | improver, deployer, tester, persuader, ideator |
| change_budget (per tick)       | 1 PR, 3 tickets                          |
| kill_switch                    | off                                      |

## next-tick hot list (max 3 items)
- LOOP-BOOT (t_b3048d53, P1, ready): full 13-route live-vs-VISION.md audit — turn-029's 4-screen Phase-6 smoke proved the rubric works; full audit is now a viable deliverable tick (vs. previously blocked on rubric availability)
- W5-PERSUADE (t_45ea76a8, ready): propose persuasion shape a/b/c per docs/PERSUASION-PROPOSAL.md template (currently locked: passive only) — long-stale; needs user direction first
- (small): RSS `<pubDate>` staleness (still 2026-05-11 hardcoded in scripts/build-rss.mjs) — would require a deploy, not docs-only