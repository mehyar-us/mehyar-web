# QA — mehyarSoft B2B baseline — 2026-05-11

> The "voice of correctness" the improve-loop reads every tick to define "shipped".
> Last update: 2026-07-09 (turn-039 — added Section H Accessibility/SEO smoke probe,
> re-purposed old Section H to new Section I Open registry; rubric now has 9 sections A-I)
> document was referenced in `docs/VISION.md` "Current state" line but never
> committed to disk. This file restores the canonical baseline list from the
> shipped artifacts that exist on the live site as of this tick.)

## How to read this doc

Every item below is a **verifiable live-site check**. Each one ties to a
specific URL, file, build artifact, or runtime probe that the improver can
re-run on any tick to confirm the baseline still holds. If any item regresses
from PASS to FAIL/PARTIAL, that is a **P0 ticket regardless of other
priorities** (see `mehyar-us-improve-loop` skill, Phase 2 triage).

Tick verification budget: ≤4 screens — `home`, `/booking`, `/micro-offer`,
`/404` (per the project-specific instance of the `perpetual-tick-loop`
class budget). Use this doc for the full 13-item check on the LOOP-BOOT
audit tick; use the per-tick smoke for the steady-state improvement ticks.

---

## A. Surface & reachability (every item must be 200 OK on live curl)

| # | URL                                              | Status gate           |
| - | ------------------------------------------------ | --------------------- |
| 1 | `/`                                              | 200, leak ladder copy |
| 2 | `/services`                                      | 200, ItemList 7-offer |
| 3 | `/portfolio` + `/portfolio/{1..6}`               | 200, ItemList 6-each  |
| 4 | `/blog` + `/blog/{slug-of-3-posts}`              | 200, Blog index + 3   |
| 5 | `/about`                                         | 200, Person + AboutPage JSON-LD |
| 6 | `/contact`                                       | 200, ContactPage JSON-LD |
| 7 | `/booking`                                       | 200, FAQPage + BreadcrumbList |
| 8 | `/micro-offer`                                   | 200, $330 + FAQPage + priceRange |
| 9 | `/newsletter` (a.k.a. `/free-checklist`)         | 200, Checklist landing |
| 10 | `/sitemap.xml`                                   | 200, ≥22 <loc> entries |
| 11 | `/rss.xml`                                       | 200, 3 <item> entries |
| 12 | `/404` (cold path)                               | 200 with 404 body copy |
| 13 | `/robots.txt`                                    | 200, Sitemap line present |

## B. Audit-intent funnel realignment (W2-FUNNEL — closed across turns 004, 005, 006, 027)

Every audit-intent CTA on the live site must route to `/micro-offer#intake`
(or to `/contact?service=<slug>` for service-tagged offers where the slow
path is intentional). Run `grep -c "micro-offer#intake" dist/public/assets/main-*.js`
on a build artifact and confirm the count matches the latest shipped number.

**Permitted `/contact` hrefs** (each has a stated reason — do not regress):

- Footer nav (1 link — required)
- ContactSection mount on `/contact` page itself (1 link — required)
- PricingSection non-audit cards: `/contact?service=<slug>` for service-tagged
  routing on offers 2-6 (5 links — required for funnel stage matching)

**Audit-intent surface inventory (must equal 19 `micro-offer#intake` hits in
shipped bundle):**

- Hero on `/` — 1
- PricingSection audit card — 1
- Page-level CTAs on About (2), Blog sidebar (1), Services (1), 404 (1) — 5
- CTASection "Request the audit path" used on `/services` + `/portfolio` + `/portfolio/{1..6}` — 3
- BlogPost QuickAnswers across 3 posts — 3
- PortfolioDetail QuickAnswers across 6 patterns — 6

## C. Structured data (W4-SEO additive piece — 19 schema-equipped routes)

Every public route below must serve **≥2 JSON-LD blocks** on first byte (no
JS-required). Pass = `<script type="application/ld+json">` count ≥ 2 in the
fetched shell. /404 also accepts the single-file fallback.

| # | Route            | Required JSON-LD blocks                                              |
| - | ---------------- | -------------------------------------------------------------------- |
| 1 | `/`              | ProfessionalService + FAQPage + ItemList (BlogPosting)               |
| 2 | `/about`         | ProfessionalService + FAQPage + @graph(WebPage+Breadcrumb+Person+AboutPage) |
| 3 | `/services`      | ProfessionalService + FAQPage + @graph(WebPage+Breadcrumb+ItemList) |
| 4 | `/portfolio`     | ProfessionalService + FAQPage + @graph(WebPage+Breadcrumb+ItemList) |
| 5 | `/portfolio/1..6`| ProfessionalService + FAQPage + @graph(WebPage+CreativeWork+Breadcrumb) |
| 6 | `/blog`          | ProfessionalService + FAQPage + @graph(WebPage+Blog+Breadcrumb+ItemList) |
| 7 | `/blog/{3 slugs}`| ProfessionalService + FAQPage + BlogPosting                          |
| 8 | `/contact`       | ProfessionalService + FAQPage + @graph(WebPage+ContactPage+Breadcrumb+Organization) |
| 9 | `/booking`       | ProfessionalService + FAQPage + @graph(WebPage+Breadcrumb)           |
| 10 | `/micro-offer`   | ProfessionalService + FAQPage + Offer                               |
| 11 | `/newsletter`    | ProfessionalService + FAQPage + @graph(WebPage+Breadcrumb)           |
| 12 | `/404`           | ProfessionalService + FAQPage + @graph(WebPage+Breadcrumb)           |

## D. Voice / brand bar (read every tick before any copy change)

Each new string scored 1-5 against `docs/VISION.md` voice rules:

- 5/5: problem-first, opinionated, specific numbers, hand-rolled metaphor,
  short sentences
- 4/5: same as 5 minus one micro-issue (e.g. "Learn more" CTA, em dash in
  casual copy)
- 3/5: corporate-speak, generic, or self-promotional
- ≤2: reject and rewrite; do not ship

**Hard rejects** (any of these = automatic rewrite, no exceptions):

- "in today's fast-paced world" / "we leverage" / "we utilize" / "Your
  trusted partner" / "AI-powered" without naming what's powered
- Em dashes in casual copy (allowed in technical specs, code comments, and
  JSON-LD only)
- Exit-intent modals (class-level hard rule; passive persuasion only)
- Generic CTAs ("Learn more", "Click here", "Get started" without context)

## E. Build & test gates

Every shipped tick must pass:

- `npm run check` (tsc) — green
- `npm run build:client` — vite green, dist/public/<19 routes> served,
  inject-route-jsonld.mjs reports ≥19 injected shells, build-rss.mjs
  emits /rss.xml with 3 items
- `npm run test:intake` — 11/11 (health, valid submission, invalid
  turnstile rejection, D1/audit row, notification path, consent rejection,
  newsletter checklist, newsletter consent rejection, micro-offer fields,
  request_type alias, public client config)

## F. Anti-slop blacklist (project-specific, additive to class baseline)

Bundle-scan every tick that touches copy. Acceptable hits = 0.

```
Empowering businesses with custom web apps, CRM & automation
we leverage / we utilize
Your trusted partner
AI-powered  (without naming what's powered)
secure intake   (corporate-speak; rewrite to "send your details" or named $)
in today's fast-paced world
Let's talk / Learn more / Click here  (as primary CTA copy)
```

If any of these appear in a fresh bundle, it is a W1-SLOP regression and
the tick must either fix it or roll back.

## G. Pricing-consistency (added turn-038 — surfaces the drift documented at docs/PRICING-LADDER-DRIFT-2026-07-09.md)

Every visitor-facing price string on a public surface must agree with the
price the corresponding intake page actually charges. Drift between
"stated price" (marketing ladder) and "charged price" (intake) is a silent
conversion killer — visitors see one number, click through, then see a
larger number on the form, and bail.

**The invariant the loop verifies on every LOOP-BOOT tick:**

For every tier card on the public leak ladder (`pricing-section.tsx`), the
named price must equal the price charged by the intake page that tier's
CTA routes to. The check is run as a 3-grep bundle probe:

```bash
# 1. Capture tier-1 price string from pricing-section.tsx
TIER1_PRICE=$(grep -oE 'price: ?"\$[0-9]+"' client/src/components/pricing-section.tsx | head -1 | grep -oE '\$[0-9]+')

# 2. Capture the price the tier-1 CTA target charges
#    (today tier-1 CTAs land on /micro-offer#intake; MicroOffer.tsx renders $330)
INTAKE_PRICE=$(grep -oE '\$[0-9]+' client/src/pages/MicroOffer.tsx | sort | uniq -c | sort -rn | head -1 | grep -oE '\$[0-9]+')

# 3. FAIL if TIER1_PRICE != INTAKE_PRICE
[ "$TIER1_PRICE" = "$INTAKE_PRICE" ] && echo "G PASS" || echo "G FAIL: tier-1=$TIER1_PRICE intake=$INTAKE_PRICE"
```

**Today's expected output (intentional FAIL — drift is open):**

```
G FAIL: tier-1=$150 intake=$330
```

This FAIL is **expected and tracked** until founder decision lands on
`docs/PRICING-LADDER-DRIFT-2026-07-09.md` (options A/B/C). Once a decision
ships, this check should turn green. The FAIL is the rubric working — it
caught the drift that turns 005 / 028 / 031 / 034 all missed.

**Pass criteria (after the decision lands):**

- The 3-grep probe above exits 0
- `docs/VISION.md` leak-ladder prices match `pricing-section.tsx` prices
- The intake page that tier-1 / tier-2 CTAs route to charges the named price
- A 4th grep confirms the price string appears in the live bundle ≥ 1 time
  per public route that references it (so the price isn't only in src/,
  it's actually shipping)

**Why this lives in the rubric and not just on the drift doc:**

The drift doc explains the open issue and the decision space. The rubric
section is the **automated re-check** — it runs on every LOOP-BOOT tick and
catches the next drift before it ships. The two layers together mean: a
founder decision closes the doc, and the rubric verifies the close stuck.

**Failure-mode catalog (extending the rubric for future drift patterns):**

| Drift pattern | Detection | Action |
| --- | --- | --- |
| pricing-section price ≠ intake charge | 3-grep probe above | P0 — surface, do not auto-ship fix |
| VISION.md price ≠ pricing-section.tsx price | `diff <(grep -oE '\$[0-9]+' docs/VISION.md) <(grep -oE 'price: ?"\$[0-9]+"' client/src/components/pricing-section.tsx)` | P1 — rubric drift, founder must approve VISION change |
| Multiple tiers routing to same intake page | `grep -c 'href="/micro-offer' client/src/components/pricing-section.tsx` > 1 | P2 — funnel realignment needed (turn-005 lesson) |
| /micro-offer page charge ≠ api-contract `first_330_target_cents` | `grep -oE '\$[0-9]+' client/src/pages/MicroOffer.tsx` vs api-contract.md | P0 — revenue-side change, founder only |

## H. Accessibility/SEO smoke (added turn-039 — runs against the LIVE bundle, not src/)

A Lighthouse-grade a11y + SEO smoke measured against the deployed bundle
and the home shell. Designed to be cheap to run (one `curl` + a few greps)
and CI-ready (exit 0 PASS, exit 1 FAIL). The probe script is
`.hermes/probe-section-H.sh`.

**What it checks:**

| Check | Why | Today |
| --- | --- | --- |
| `Skip to <content>` link in bundle | Keyboard users must be able to bypass nav | PASS — "Skip to the $330 audit" |
| Semantic landmark tags (`<main>`, `<nav>`, `<header>`, `<footer>`, `<article>`, `<section>`) | Screen readers use these to navigate | PASS — 61 occurrences |
| `aria-hidden` on decorative icons | Icons that aren't meaningful should be hidden from AT | PASS — 112 occurrences |
| `aria-label` on icon-only controls | Icon buttons need accessible names | PASS — 6 occurrences |
| `sr-only` (visually-hidden) text | AT-only labels for sighted users can't see | PASS — 3 occurrences |
| `<html lang="en">` on every public shell | Screen readers switch pronunciation by lang | PASS |
| `<meta name="viewport">` on every public shell | Mobile rendering depends on this | PASS |
| `<link rel="canonical">` on every public shell | Avoid duplicate-content penalties | PASS |
| ≥2 JSON-LD blocks on home shell (cheap re-check of Section C) | SEO baseline | PASS — 3 blocks |

**Today's expected output (probe exit code 0):**

```
=== H Accessibility/SEO smoke probe (turn-039 new check) ===
live bundle: 574085 bytes (expect ~574069)
H OK skip-link: 'Skip to the $330 audit'
H OK landmarks: 61 semantic landmark tag occurrences
H OK aria-hidden: 112 occurrences
H OK aria-label: 6 occurrences
H OK sr-only: 3 occurrences
H OK lang: lang="en"
H OK viewport: present
H OK canonical: present
H OK JSON-LD: 3 blocks on home shell
H PASS
```

**Run command:**

```bash
bash .hermes/probe-section-H.sh
```

**Pass criteria:**

- All 9 sub-checks return `H OK <name>`
- Probe exits 0
- Total bundle byte size is within ±1% of the previous probe's reading
  (the script logs `expect ~574069` based on turn-039's canonical bundle)

**Failure-mode catalog (extending the rubric for future a11y regressions):**

| Drift pattern | Detection | Action |
| --- | --- | --- |
| Skip-link removed from Navbar | `grep -oE 'Skip to[^"]+'` empty on bundle | P1 — Lighthouse "Skip to main content" fail; AT keyboard users affected |
| `<html lang=>` missing or changed | probe `LANG` empty | P0 — SEO + a11y baseline |
| New SVG icon added without `aria-hidden` | new `<svg>` literals not wrapped in `aria-hidden` | P2 — a11y noise (AT announces decorative icons) |
| New icon-only button without `aria-label` | `aria-label` count drops below 5 | P1 — screen reader users can't use the button |
| Viewport meta removed (e.g. theme rebuild) | probe `VIEWPORT` empty | P0 — mobile rendering broken |
| Canonical link missing | probe `CANONICAL` empty | P1 — duplicate-content risk |

**Why this lives in the rubric and not just as a one-off check:**

Lighthouse audits are heavyweight (chromium, headless, ~30s+ per run) and
expensive to wire into every LOOP-BOOT tick. The probe is the **cheap
proxy** — grep-able bundle literals that map to Lighthouse categories
(SEO, accessibility, best-practices) without needing a browser. When the
probe goes red, that's the "real Lighthouse will complain" signal — the
founder or a worker can then run the full Lighthouse audit to confirm
and produce the readable report.

**The probe runs against `main-BKU1Uoxy.js` (turn-036 live bundle).**
Update the `LIVE_BUNDLE_URL` line at the top of the script when a new
shipped bundle lands. The script logs `expect ~<bytes>` so the loop can
spot a hash change without diffing the full file.

## I. Open registry

This doc is the voice-of-correctness. As new surfaces ship (e.g. an admin
dashboard, a newsletter cron, a new offer tier, a new pricing tier), add
the acceptance items here in the appropriate section and bump the "Last
update" header.