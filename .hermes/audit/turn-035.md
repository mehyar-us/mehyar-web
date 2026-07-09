# turn-035 — hero secondary CTA target fix: /services → /#pricing

> Tick: 35
> When: 2026-07-09T22:25:00Z (UTC)
> Live site on: 5f49f9c (merge commit), bundle main-CqiU6zle.js (CF Pages build-time hash; content matches local main-BEFkljKi.js for the changed href)
> Local source on: 5f49f9c (HEAD)
> Prior tick: 34 (full 13-route LOOP-BOOT audit, all 7 rubric sections PASS)
> Verdict: ship

## Why this tick

State.md hot-list first item after the turn-034 audit was clean: "next 5-7 ticks of runway before another full audit; pick a 1-PR shipping win." Hot-list #3 flagged the src/-vs-scripts/ bundle-roll pattern needed one more data point.

Surfaced during Phase 2 (sense): a 1-tap bounce on the second-highest-leverage CTA on the home page. The hero section has two CTAs side-by-side:

- Primary: `Book a Tech Audit` → `/micro-offer#intake` (turn-004, correct)
- Secondary: `See the leak ladder` → `/services` (turn-033 voice fix changed only the *label*, not the target)

The "leak ladder" — the 6-tier pricing section (Free Tech Audit → $150, Website Diagnosis → $250, custom build small, custom build mid, retainer, hourly advisory) — lives on the home page at `/#pricing` (the `<section id="pricing">` in pricing-section.tsx). Clicking the secondary CTA and landing on `/services` shows the visitor the consulting-offer grid (tech-audit, website-booking-cleanup, missed-call-followup, etc.) — different content, different intent. The visitor has to scroll up the hero, click back, then scroll down the page to find the leak ladder they just clicked for. 1-tap bounce on a CTA the founder named in VISION.md as the proof of the offer.

Smallest possible reversible fix: change the `href` only, label unchanged. Class budget honored: 1 PR, 1 area, 1 file, 1 line.

## Section B — Audit-intent funnel (live bundle, post-deploy)

Counts against the new live JS bundle `main-CqiU6zle.js` (CF Pages built from sha 5f49f9c).

|| Counter | Live count | turn-033/034 baseline | Delta |
||---|---|---|---|
|| `micro-offer#intake` | 20 | 20 | 0 ✓ |
|| `Request the $330 audit` | 7 | 7 | 0 ✓ |
|| `Request the audit path` | 1 | 1 | 0 ✓ |
|| `/contact` | 20 | 20 | 0 ✓ |
|| `/#pricing` | 1 | 0 | +1 ✓ (the new CTA target) |

**Section B verdict: PASS — all baseline counters unchanged, new `/#pricing` wiring present.**

## Section D — Voice bar (live bundle)

|| Term | Live count | Expected |
||---|---|---|
|| `Leak ladder` | 2 | ≥2 (hero eyebrow + pricing eyebrow) |
|| `leak ladder` | 1 | ≥1 (sitemap /services description) |
|| `See the leak ladder` | 1 | ≥1 (hero CTA) |
|| `Offer ladder` | 0 | 0 |
|| `See the offer ladder` | 0 | 0 |

Total ladder-strings in bundle: 4 (matches turn-033 expected ledger: 2 Leak ladder + 1 See the leak ladder + 1 sitemap leak ladder).

Visitor copy on home hero: "Book a Tech Audit" + "See the leak ladder" — both hand-rolled, both match VISION.md voice bar. Voice 5/5.

**Section D verdict: PASS — voice reconciliation from turn-033 preserved; only the wiring changed.**

## Section F — Anti-slop blacklist (live bundle)

|| Term | Live count |
||---|---|
|| `secure intake` | 0 |
|| `trusted partner` | 0 |
|| `empowering businesses` | 0 |
|| `leverage our` | 0 |
|| `leverage AI` | 0 |
|| `in todays fast-paced` | 0 |
|| `Your trusted partner` | 0 |
|| `we leverage` | 0 |

Total: **0 / 8 hits** (rubric baseline: 0).

**Section F verdict: PASS — anti-slop blacklist clean.**

## Section E — Build gates

```
$ npm run check      → tsc green
$ npm run build      → vite build green; new bundle main-BEFkljKi.js (local) → main-CqiU6zle.js (CF Pages build-time hash)
$ npm run test:intake → 11/11 (D1+KV+notification)
```

**Section E verdict: PASS — both gates green.**

## Section G — Click-flow verification (smoke)

The fix is a `href` change. To verify it actually points at the right anchor:

```bash
$ curl -sSL "https://mehyar.us/" | grep -oE 'main-[A-Za-z0-9_-]+\.js'
main-CqiU6zle.js

$ curl -sSL "https://mehyar.us/assets/main-CqiU6zle.js" | grep -oE '"/#pricing"|See the leak ladder'
"/#pricing"
See the leak ladder
```

The new bundle's `"/#pricing"` literal is the wouter `Link href` value (the only place in the app that should produce that string). The wouter Link will route to home + scroll-to-anchor, landing the visitor on the leak ladder (the actual 6-tier pricing section). 

For a full live click test (browser_navigate + click + verify scroll position), the local ClickFlow smoke would be needed; this tick is the wire-level fix only. The next 4-screen smoke (Phase 6) is the click-flow confirmation.

## CF Pages deploy pattern: src/ change rolls the bundle, scripts/ doesn't

This is the **third confirmed src/-change tick** (after turn-033 and turn-035). Pattern:

| Tick | Type of change | Bundle rolled? | New bundle hash |
|---|---|---|---|
| turn-027 | src/ (CTAs) | yes | (turn-027 baseline) |
| turn-030 | scripts/ (route-jsonld.json) | NO (shell only) | main-P-x17WD-.js (turn-029 carryover) |
| turn-033 | src/ (hero CTA label + sitemap) | yes | main-DrrbqAOE.js |
| turn-035 | src/ (hero CTA href) | yes | main-CqiU6zle.js |

**Pattern locked**: src/ change → both shell AND bundle roll. scripts/ change → shell rolls, bundle stays. Hot-list #3 from turn-034 ("confirm src/-vs-scripts/ bundle-roll pattern with one more src/-change tick") is now closed with 3 of 3 data points in agreement.

Note: turn-035's local build produced `main-BEFkljKi.js`; CF Pages produced `main-CqiU6zle.js`. This is normal — the same source produces different hashes on different machines when source order, mangler config, or build-host mtimes differ. Verification is by content fingerprint (e.g. `/#pricing` literal present), not by exact hash match.

## Net result

1-line src/ change (1 href) shipped, CF Pages rolled both shell AND bundle, all 4 audit-intent funnel counters match baseline, voice bar 5/5, anti-slop 0/8, build + test gates green, src/-vs-scripts/ bundle-roll pattern locked with 3 of 3 data points.

This closes the W2-FUNNEL hero secondary-CTA piece that turn-004 missed. The primary CTA (`Book a Tech Audit` → `/micro-offer#intake`) was wired correctly at turn-004; the secondary CTA label was fixed at turn-033; the secondary CTA *target* was finally fixed at turn-035.

## Lessons

- **Section-anchor hrefs are a separate dimension from copy.** Turn-004 (primary CTA) + turn-033 (secondary CTA label) + turn-035 (secondary CTA target) are three independent layers of "wire the visitor's intent to the right surface." A loop that audits only the label and the count misses the wiring. Cheap post-rename / post-add CTA check: `grep -oE 'href[:=]"[^"]*"|<a [^>]*href="[^"]*"' <bundle>` — list every href in the bundle and verify each one is the URL the visitor expects to land on, not the URL a developer pasted during build. The visitor will click the wrong link exactly once.
- **`src/` vs `scripts/` deploy pattern locked with 3 of 3 data points.** Hot-list #3 from turn-034 closed. Pattern: src/ rolls shell + bundle; scripts/ rolls shell only. This is a useful heuristic for "will the change I just made show up in the live bundle?" — the answer is "yes if you touched client/src/, no if you only touched scripts/." Note: this is the pattern for CF Pages; other hosts (Vercel, Netlify) may differ.
- **The bundle hash mismatch (local main-BEFkljKi.js vs live main-CqiU6zle.js for the same commit) is normal and expected.** The right verification is content fingerprint, not hash. The 1-line src/ change is verifiable via a single `grep -oE '"/#pricing"' <live-bundle>` returning 1.
- **1-tap bounce on the second-most-visible CTA on the page is a real conversion drag.** The hero is the highest-leverage real-estate on the home page; a CTA that lands the visitor on the wrong page is wasted intent. This is the kind of thing LOOP-BOOT audits don't catch (it audits reachability + structured data + voice, not click-flow intent), but a 30-second "what does each hero CTA actually point at?" check would catch it. Adding to next-LOOP-BOOT rubric: Section A.2 — "every hero CTA href matches a section that exists on the destination page (not just a 200 response)."
