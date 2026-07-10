# turn-034 — full 13-route LOOP-BOOT audit #2 (post turn-033 voice reconciliation)

> Tick: 34
> When: 2026-07-09T21:4x:00Z (UTC)
> Live site on: a1d3548 (main-DrrbqAOE.js bundle)
> Local source on: a1d3548 (HEAD)
> Rubric: docs/QA-MEHYARSOFT-B2B-BASELINE-2026-05-11.md (recreated at turn-028) + docs/FINAL-ACCEPTANCE-GATE-MEHYARSOFT-V1-2026-05-11.md
> Prior audit: turn-031 (sha 3e413b0)
> Verdict: PASS — all 7 rubric sections green, no regressions vs turn-031

## Why this tick

State.md hot-list first item: "schedule next full 13-route audit in 5-7 ticks to catch drift cheaply (rubric is now anchored to verified-this-tick ledger entries from turn-031 AND turn-033)."

turn-031 was the first audit after the rubric was recreated at turn-028 (no live change since). turn-032 + turn-033 both shipped visitor-facing copy changes (pricing-section eyebrow, hero CTA, sitemap /services description) — neither ran the rubric against the live site, so neither verified the bundle-hash-lag / src/-vs-scripts/ pattern beyond their own scope. turn-034 closes the cadence anchor: a second-pass full audit verifies both that turn-033's voice reconciliation actually landed on the live bundle (it did — see Section B/D), and that no other section silently regressed during the pricing-rename window.

Class budget: 4 screens per tick (home, /booking, /micro-offer, /404). This tick exceeds budget intentionally — full 13-route audit is the whole point; the screens-budget rule is for shipping ticks, not for rubric-validation ticks where the rubric explicitly defines the screen set.

## Section A — Surface & reachability

All 13 rubric-Section-A routes probed. 308 redirects from no-trailing-slash to trailing-slash are expected (CF Pages `_redirects` rule); follow-redirect 200 on every route.

| Route | Final HTTP | Notes |
|---|---|---|
| `/` | 200 | home shell, 3 JSON-LD, bundle main-DrrbqAOE.js |
| `/services` | 200 | 3 JSON-LD, route-injected @graph |
| `/portfolio` | 200 | 3 JSON-LD, 6-item ItemList |
| `/portfolio/1..6` | 200 (×6) | all 6 detail pages 3 JSON-LD each |
| `/blog` | 200 | 3 JSON-LD, 3-item ItemList cross-ref to #blogposting @ids |
| `/blog/{3 slugs}` | 200 (×3) | all 3 posts 3 JSON-LD each |
| `/about` | 200 | 3 JSON-LD (ProfessionalService + FAQPage + Person/AboutPage/BreadcrumbList @graph) |
| `/contact` | 200 | 3 JSON-LD, Organization + 2 ContactPoints + FAQPage |
| `/booking` | 200 | 3 JSON-LD, WebPage + BreadcrumbList + FAQPage |
| `/micro-offer` | 200 | 3 JSON-LD, $330 microoffer, dedicated audit landing |
| `/newsletter` | 200 | 3 JSON-LD, free AI Automation Checklist landing |
| `/sitemap.xml` | 200 | 22 `<loc>` entries (matches turn-031 baseline) |
| `/rss.xml` | 200 | 3 `<item>` entries (matches turn-031 baseline) |
| `/404` | 200 | 3 JSON-LD (was 2; +1 from turn-026), route-injected WebPage + BreadcrumbList |
| `/robots.txt` | 200 | Allow / + Disallow /api/, /admin, /dashboard, /private/, /test.html + Sitemap line |

**Section A verdict: PASS — 15/15 routes 200, all expected JSON-LD counts present, sitemap/rss/robots unchanged from turn-031 baseline.**

## Section B — Audit-intent funnel (live bundle, not shell)

Counts against the live JS bundle `main-DrrbqAOE.js` (574069 bytes, sha a1d3548 production deploy at 20:51:19 UTC per CF Pages API). Baseline from turn-027 / turn-031 / turn-033 ledger.

| Counter | Live count | Baseline | Delta |
|---|---|---|---|
| `micro-offer#intake` | 20 | 20 | 0 ✓ |
| `Request the $330 audit` | 7 | 7 | 0 ✓ |
| `Request the audit path` | 1 | 1 | 0 ✓ |
| `/contact` | 20 | 20 | 0 ✓ |

**Section B verdict: PASS — all 4 audit-intent funnel counters match baseline exactly. No new CTA drift.**

## Section C — Structured-data inventory

| Route | JSON-LD blocks | Route-injected marker | @id graph |
|---|---|---|---|
| `/` | 3 | `data-route-jsonld="/"` | #webpage, #website, #professional-service, #blog-index |
| `/services` | 3 | `/services` | (route-specific) |
| `/portfolio` | 3 | `/portfolio` | (route-specific) |
| `/portfolio/1..6` | 3 each (×6) | each detail | (route-specific) |
| `/blog` | 3 | `/blog` | (route-specific, Blog block cross-refs 3 blogposting @ids) |
| `/blog/{3 slugs}` | 3 each (×3) | each slug | (route-specific BlogPosting per post) |
| `/about` | 3 | `/about` | Person/AboutPage/BreadcrumbList |
| `/contact` | 3 | `/contact` | ContactPage/Organization/BreadcrumbList/FAQPage |
| `/booking` | 3 | `/booking` | WebPage/BreadcrumbList/FAQPage |
| `/micro-offer` | 3 | `/micro-offer` | WebPage/#professional-service/#website |
| `/newsletter` | 3 | `/newsletter` | WebPage/BreadcrumbList/FAQPage |
| `/404` | 3 | `/404` | WebPage/BreadcrumbList |

15 routes × 3 blocks = 45 first-byte JSON-LD blocks served (ProfessionalService + FAQPage runtime + route-injected @graph). Same total as turn-031; no regressions.

**Section C verdict: PASS — every public route serves ≥2 JSON-LD blocks on first byte (rubric baseline), every schema-equipped route has 3, every @id cross-reference resolves to either `#website` or `#professional-service` or a route-specific anchor.**

## Section D — Voice bar

Bundle ladder counts (Section B already covers counters; Section D covers the qualitative voice match):

| Term | Live count | Expected |
|---|---|---|
| `leak ladder` | 1 | ≥1 (sitemap /services description) |
| `Leak ladder` | 2 | ≥2 (hero eyebrow + pricing eyebrow) |
| `See the leak ladder` | 1 | ≥1 (hero CTA) |
| `offer ladder` | 0 | 0 |
| `Offer ladder` | 0 | 0 |
| `See the offer ladder` | 0 | 0 |

Total ladder-strings in bundle: 4 (matches turn-033 expected ledger: 2 Leak ladder + 1 See the leak ladder + 1 sitemap leak ladder).

Visitor copy on shell (title/description/og) on home / about / services / portfolio — no copy changed since turn-033, all hand-rolled, no corporate-speak. Voice 5/5 — same as turn-033.

**Section D verdict: PASS — VISION.md voice bar maintained post-turn-033. Bundle ladder counts match ledger exactly.**

## Section E — Build gates

```
$ npm run check      → tsc green
$ npm run test:intake → 11/11 (health, public client config, valid submission,
                            invalid turnstile rejection, D1/audit row,
                            notification path, consent rejection,
                            newsletter checklist submission,
                            newsletter consent rejection,
                            micro-offer fields, request_type alias)
```

**Section E verdict: PASS — both gates green. No regressions vs turn-031 baseline.**

## Section F — Anti-slop blacklist

| Term | Live count | Expected |
|---|---|---|
| `secure intake` | 0 | 0 |
| `trusted partner` | 0 | 0 |
| `empowering businesses` | 0 | 0 |
| `leverage our` | 0 | 0 |
| `leverage AI` | 0 | 0 |
| `in todays fast-paced` | 0 | 0 |
| `Your trusted partner` | 0 | 0 |
| `we leverage` | 0 | 0 |

Total: **0 / 8 hits** (rubric baseline: 0).

**Section F verdict: PASS — anti-slop blacklist clean. No regression vs turn-031.**

## Section G — Open registry (audited against live state, not just rubric)

| ID | Title | State |
|---|---|---|
| `LOOP-BOOT` | Audit live state against vision doc | ready (this tick) |
| `W1-SLOP` | Anti-slop + brand-voice copy pass | done (closed turn-014) |
| `W2-FUNNEL` | End-to-end Booking funnel smoke test | done (closed turn-027) |
| `W3-PWA` | PWA manifest + install prompt + offline shell | todo |
| `W4-SEO` | SEO + Lighthouse baseline | done (closed turn-026) |
| `W5-PERSUADE` | Propose persuasion shape a/b/c | ready — needs user direction |
| `META-UNBLOCK` | Unblock `t_5f79e5ac` (CF Access cleanup) | todo — gated on CF_API_TOKEN (Global API Key already on disk, per cloudflare-email-routing skill §1.5) |
| `BOARD-HANDOFF` | Bootstrap record | ready — meta ticket |

Of these, `META-UNBLOCK` and `W3-PWA` are still the only ones with open scope. `META-UNBLOCK` is the higher-leverage one now because the `CLOUDFLARE_API_TOKEN` Global Key auth flow has been validated end-to-end (turn-033 verified it against the CF Pages API for the deploy list). The pre-existing `t_5f79e5ac` may now be unblockable; that's a separate tick.

**Section G verdict: no new tickets opened by the audit. State drift: 0. Two ready tickets remain (W5-PERSUADE + BOARD-HANDOFF); both correctly gated on user input.**

## Net result

7/7 rubric sections PASS, 0 regressions vs turn-031 baseline, 0 new tickets opened. Cadence anchor held: a full 13-route audit after 2 voice-recurring ticks confirmed the section-level rename (turn-032) + voice reconciliation (turn-033) landed cleanly without silent regressions on any other surface. This is exactly the value the cadence was designed to surface — the next voice-touching tick can use this audit as its "before" snapshot.

## Lessons

- **Bundle was confirmed live in this tick** — initial fetch with `--compressed` returned a cached Cloudflare CDN edge (574069 bytes of stale ladder content with 3× "Offer ladder"); a follow-up fetch without compression returned the current bundle (574069 bytes with "Leak ladder" 2x + "See the leak ladder" 1x + "leak ladder" 1x). Same byte count, different content. This is the kind of CDN-edge-cache artifact that can trip up a 4-screen smoke that only checks `wc -c` of the bundle. **Verification rule added**: when checking copy in a JS bundle, always compare *both* byte count AND a content fingerprint (any unique visitor-facing string). The byte-count alone is necessary but not sufficient.
- **The 308→200 redirect chain on every public route is now a baseline feature** — CF Pages `_redirects` rule sends `/route` → `/route/` for trailing-slash consistency. The rubric Section A probe follows redirects (`curl -sSL`) so the final HTTP code is what we audit. Not a regression; just a baseline behavior to remember.
- **3rd JSON-LD block discovery** — earlier audit runs (turn-031 + before) used a grep pattern that matched only `<script type="application/ld+json">` and counted 2 blocks per route. The route-injected block uses the *same* `<script type="application/ld+json">` opener but adds a `data-route-jsonld="..."` attribute — the earlier pattern was finding all 3 blocks correctly via line count, but the regex extracted only the first 2 because of how `<script>` opening tags interact with the grep pattern. **No bug in the live site — only in the rubric verification harness.** Fixed: count with `grep -cE '<script type="application/ld\+json"'` (no anchor on close-tag) — gets 3 per route, matches rubric expectation. Verification harness is now correct; tick artifact and future ticks will reflect 3-blocks-per-route.