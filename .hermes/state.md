# STATE — mehyar.us improve-loop

> O(1) warm-start. Updated at the END of every tick.
> First-party fields only — anything not on the live site/cf/repo goes elsewhere.

| field                          | value                                    |
| ------------------------------ | ---------------------------------------- |
| last_tick_at                   | 2026-07-09T01:58:00Z                     |
| last_tick_id                   | 4                                        |
| live_url                       | https://mehyar.us                        |
| deploy_target                  | Cloudflare Pages (github-org/mehyar-web) |
| repo                           | C:/Users/mehya/OneDrive/Documents/GitHub/mehyar-web |
| live_url_status                | up                                       |
| deployed_sha                   | 22dd6f0                                  |
| deploy_status                  | green (live bundle main-DPwQXa_h.js contains /micro-offer#intake) |
| cf_analytics_token_present     | yes                                      |
| cf_analytics_7d                | {visits: ?, conversions: ?, top_pages: ?} |
| open_tickets                   | 4                                        |
| blocked_tickets                | 1  (t_5f79e5ac)                          |
| shipped_since_last             | 1                                        |
| vision_doc_version             | bootstrap-2026-07-08                     |
| last_learned                   | shipped hero CTA move /contact -> /micro-offer#intake (turn-004, sha 22dd6f0) — hero "Book a Tech Audit" copy was an audit-intent signal routed through the slowest funnel (general /contact form). Now lands directly on the dedicated $330 audit page with the intake form in view (scrollY=2190). One-line href change, zero risk surface, immediately measurable: any visitor who clicks "Book a Tech Audit" now sees offer-specific framing + a form pre-tagged for micro_offer. W2-FUNNEL hero-CTA piece closed; deeper funnel smoke (t_0634816e) still queued. Next: t_0634816e end-to-end smoke, then W1-SLOP anti-slop copy pass. |
| cron_enabled                   | off                                      |
| cron_schedule                  | every 15m shallow; daily 09:00 deep      |
| telegram_chat_id               | 6829435996 (per cron prompt; not yet wired in state) |
| agent_roles_ready              | improver, deployer, tester, persuader, ideator |
| change_budget (per tick)       | 1 PR, 3 tickets                          |
| kill_switch                    | off                                      |

## next-tick hot list (max 3 items)
- t_0634816e: end-to-end Booking funnel smoke test on live site (W2-FUNNEL deeper piece; verify Booking + MicroOffer submit paths, CF Functions audit row, conversion tracking fires)
- W1-SLOP: anti-slop + brand-voice copy pass over public pages (move up the queue — SEO plumbing solid, voice score ≥4 required for any new string)
- LOOP-BOOT (t_b3048d53, P1, ready): audit live state against vision doc

## known unknowns
- CF API bearer token location (blocks META-UNBLOCK / t_5f79e5ac, still 545+h blocked)
- GSC sitemap submit path
- A/B test platform (if any)
- Whether to keep W3-PWA fully shell-cached or relax runtime cache if CF analytics shows no install prompt lift after 7d
- Lighthouse + axe a11y scores (no headless runner wired yet; deferred per turn-002 until first deploy succeeds — now satisfied at turn-003, blocker is browser tooling)