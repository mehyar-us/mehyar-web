# STATE — mehyar.us improve-loop

> O(1) warm-start. Updated at the END of every tick.
> First-party fields only — anything not on the live site/cf/repo goes elsewhere.

| field                          | value                                    |
| ------------------------------ | ---------------------------------------- |
| last_tick_at                   | 2026-07-09T16:06:00Z                     |
| last_tick_id                   | 26                                       |
| live_url                       | https://mehyar.us                        |
| deploy_target                  | Cloudflare Pages (github-org/mehyar-web) |
| repo                           | C:/Users/mehya/OneDrive/Documents/GitHub/mehyar-web |
| live_url_status                | up                                       |
| deployed_sha                   | a3d386c                                  |
| deploy_status                  | green (turn-026 live @ https://mehyar.us/404 — 3 JSON-LD blocks: original ProfessionalService + FAQPage, plus route-injected @graph [WebPage #webpage (Route not found | MehyarSoft), BreadcrumbList(Home > Route not found)]; cross-route smoke 10/10 unchanged from turn-025; build green, test:intake green) |
| cf_analytics_token_present     | yes                                      |
| cf_analytics_7d                | {visits: ?, conversions: ?, top_pages: ?} |
| open_tickets                   | 3  (ready: t_45ea76a8 W5-PERSUADE, t_b3048d53 LOOP-BOOT, t_90f2136f BOARD-HANDOFF — todo: 0; closed this tick: t_<new-026>) |
| shipped_since_last             | 1                                        |
| last_learned                   | shipped /404 WebPage + BreadcrumbList JSON-LD (turn-026, sha a3d386c) — 19th schema-equipped route (was 18). The 404 shell is a single file at dist/public/404.html, not a directory — added a small /404 fallback branch to scripts/inject-route-jsonld.mjs so the existing dist/public/<route>/index.html pattern handles the special case without breaking the other 18 routes. Reusable scripts: add-404-jsonld.py (JSON append, CRLF/indent-2/idempotent) + patch-inject-route-jsonld-404.py (injector patch, marker-comment idempotent). Cross-route smoke 10/10 unchanged (home, booking, micro-offer, newsletter, about, services, portfolio, contact, blog, free-checklist all serving their pre-turn-026 JSON-LD block count). Build green, test:intake green. |
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
