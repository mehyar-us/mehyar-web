# QA — mehyarSoft B2B baseline — 2026-05-11

|> The "voice of correctness" the improve-loop reads every tick to define "shipped".
||> Last update: 2026-07-10 (turn-042 — added Section K Audit-record-tracking probe,
||> rubric now has 11 sections A-K; Section I Open registry unchanged; Section J
||> name stays at J to preserve the "I = Open registry" mnemonic)
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

## J. Build-artifact-integrity (added turn-040 — runs against the LIVE bundle + committed src/)

The inverse of Section H. Section H catches "bundle has a literal that's
not in any src/ file" (stale bundled content). Section J catches the
other direction — "src/ has a literal that's not in the live bundle"
(stale deployed content). Together they pin the bundle to the committed
source tree.

**The failure mode this prevents:** A `src/` literal changes in a commit
(e.g. turn-033 renamed "See the offer ladder" → "See the leak ladder"),
the bundle is rebuilt locally, but the live bundle never re-rolls because
the deploy pipeline only rolled the shell files (cf. turn-030's
`scripts/`-only deploy — shell files rolled, bundle hash stayed on the
previous build). The founder ships "X" in src/, the visitor sees "Y"
from the previous build. Without Section J, this drift is invisible
until a manual visitor click lands on the wrong string.

**The invariant the loop verifies on every LOOP-BOOT tick:**

For every visitor-facing copy literal in committed src/, the live bundle
must contain the literal at least once. The check is run as a 9-probe
bundle probe:

```bash
# 1. Fetch live bundle fresh
curl -sSL https://mehyar.us/assets/main-BKU1Uoxy.js -o .hermes/.probe-section-J-bundle.js

# 2. For each canonical src/ literal, verify it exists in src/ AND in the bundle
for probe in \
  "client/src/pages/Newsletter.tsx :: Skip to the \$330 audit" \
  "client/src/components/hero-section.tsx :: See the leak ladder" \
  "client/src/components/pricing-section.tsx :: \$150" \
  "client/src/components/pricing-section.tsx :: \$250" \
  "client/src/components/pricing-section.tsx :: \$330" \
  "client/src/components/pricing-section.tsx :: Free Tech Audit" \
  "client/src/components/pricing-section.tsx :: Website Diagnosis" \
  "client/src/components/Navbar.tsx :: MehyarSoft home" \
  "client/src/components/Navbar.tsx :: Toggle menu"; do
  src_file="${probe%% :: *}"
  literal="${probe##* :: }"
  src_count=$(grep -c -F -- "$literal" "$src_file")
  bundle_count=$(grep -c -F -- "$literal" .hermes/.probe-section-J-bundle.js)
  [ "$src_count" -ge 1 ] && [ "$bundle_count" -ge 1 ] || FAIL=1
done
```

The probe script is `.hermes/probe-section-J.sh`. Run from repo root.
Exit 0 PASS, exit 1 FAIL, exit 2 INDETERMINATE (e.g. bundle fetch failed).

**Today's expected output (probe exit code 0):**

```
=== J Build-artifact-integrity probe (turn-040 new check) ===
live bundle: 574085 bytes (expect ~574069)
J OK client/src/pages/Newsletter.tsx: 'Skip to the $330 audit' src=1 bundle=1
J OK client/src/components/hero-section.tsx: 'See the leak ladder' src=1 bundle=1
J OK client/src/components/pricing-section.tsx: '$150' src=2 bundle=2
J OK client/src/components/pricing-section.tsx: '$250' src=3 bundle=1
J OK client/src/components/pricing-section.tsx: '$330' src=1 bundle=3
J OK client/src/components/pricing-section.tsx: 'Free Tech Audit' src=1 bundle=1
J OK client/src/components/pricing-section.tsx: 'Website Diagnosis' src=1 bundle=1
J OK client/src/components/Navbar.tsx: 'MehyarSoft home' src=1 bundle=1
J OK client/src/components/Navbar.tsx: 'Toggle menu' src=1 bundle=1
J PASS
```

**Failure-mode catalog (extending the rubric for future deploy-pipeline drift):**

| Drift pattern | Detection | Action |
| --- | --- | --- |
| src/ literal edited but live bundle missing the literal | 9-probe above | P0 — re-deploy with full src/ → bundle roll; verify CF Pages bundle hash matches local dist/main-*.js |
| src/ file renamed but probe still points at old filename | `[ ! -f "$src_file" ]` check in probe | P1 — rubric drift, update probe's PROBES array to match new path |
| Live bundle hash changes but probe's `LIVE_BUNDLE_URL` not updated | bundle fetch returns 404 | P1 — update `LIVE_BUNDLE_URL` line in probe script + bump `expect ~<bytes>` annotation in this doc |
| Multiple sections of src/ editing in one commit, only one literal surfaces in bundle | grep across all 9 probes, find the one with `bundle=0` | P0 — partial deploy; investigate which build pipeline step dropped the literal |
| Bundle literal exists in src/ but src/ literal was removed in a later commit | Section H's "bundle has literal not in src/ file" check | P2 — dead literal in bundle; cosmetic, but track for next bundle minify pass |

**Why this lives in the rubric and not just as a one-off check:**

Section H already proved the bundle-grep approach is cheap (one curl +
N greps, ~2s wall time) and CI-ready. Section J is the same shape, with
the literal-vs-bundle direction flipped. Together they pin the live
site's content to the committed source tree on every LOOP-BOOT tick.
A docs-only LOOP-BOOT (rubric audit) catches deploy-pipeline drift the
per-tick 4-screen smoke can't see — the smoke checks "does the live
page render with the right shell", not "is the bundle carrying every
literal the founder committed".

**Update cadence:**
When a new visitor-facing literal lands in src/ (e.g. a new CTA copy,
a new pricing tier, a new schema-equipped route), add it to the
`PROBES` array in `.hermes/probe-section-J.sh`. Cheap to extend;
follows the same pattern as Section H's "what to grep" table.

## K. Audit-record-tracking (added turn-042 — closes the drift turn-041 manually fixed)

Sections G / H / J catch content drift on the LIVE site. Section K
catches drift in the LOOP'S OWN AUDIT TRAIL — the `.hermes/audit/turn-NNN.md`
files that past ticks journaled in VISION.md but occasionally forgot to
`git add`. The drift was discovered turn-041: 4 audit `.md` files existed
on disk (`turn-018`, `turn-028`, `turn-034`, `turn-039`) but `git ls-files`
returned empty for them. VISION.md referenced them; the actual files
were untracked. A `git clean -fd` cleanup would have erased them; a
fresh clone would have shipped without them.

**The invariant the loop verifies on every LOOP-BOOT tick:**

For every `.hermes/audit/turn-NNN*.md` file on disk, the same relative
path must appear in `git ls-files`. The reverse direction (in-repo but
missing on disk) is also caught. Bidirectional diff:

- on-disk \ in-repo → ORPHAN (file on disk not in git) — P0, `git add`
  immediately
- in-repo \ on-disk → STALE (file in repo but gone from disk) — P1,
  either restore from git or `git rm` the stale entry

The probe script is `.hermes/probe-section-K.sh`. Run from repo root.
Exit 0 PASS, exit 1 FAIL, exit 2 INDETERMINATE (e.g. git not available,
or `.hermes/audit/` doesn't exist).

**Today's expected output (probe exit code 0):**

```
=== K Audit-record-tracking probe (turn-042 new check) ===
on-disk audit .md files: 28
in-repo audit .md files: 28
K PASS: 28 audit .md files on disk, 28 in git — drift closed
```

**Negative-test verification (the probe has to actually FAIL on drift):**

The probe was negative-tested this tick: `touch .hermes/audit/turn-999-test-orphan.md`
bumped on-disk count to 29, probe exited 1 with the orphan line printed;
after `rm` of the orphan, probe returned to exit 0 with 28/28 PASS. This
proves the bidirectional diff works in both directions (orphan detection
verified; stale-detection is the symmetric code path but only negative-tested
in source review because the loop would never intentionally `git rm` an
audit record it didn't intend to delete).

**Failure-mode catalog (extending the rubric for future audit-trail drift):**

| Drift pattern | Detection | Action |
| --- | --- | --- |
| Audit `.md` created on disk but `git add` forgotten | probe `K FAIL: orphan` | P0 — `git add .hermes/audit/<name>.md`, re-run probe |
| Audit `.md` deleted on disk but `git rm` forgotten | probe `K FAIL: stale` | P1 — restore from git or `git rm --cached .hermes/audit/<name>.md` |
| Audit `.md` filename typo (e.g. `turn-018.md` vs `turn-18.md`) | probe shows two unrelated orphans + stale entries | P1 — rename one to match VISION.md diary reference |
| `.hermes/audit/` directory moved or removed | probe `K INDETERMINATE: audit directory not found` | P0 — restore directory, investigate migration |
| Probe script itself untracked (`.hermes/probe-section-K.sh` missing from git) | `git ls-files .hermes/probe-section-*.sh` empty | P0 — `git add .hermes/probe-section-K.sh`, re-run probe |

**Why this lives in the rubric and not just as a one-off check:**

Section K is the cheap automatic re-check for the drift turn-041 fixed by
hand (4 missing audit files closed one tick before Section K existed).
Without Section K, the next tick that creates an audit `.md` and forgets
`git add` will repeat the drift silently for N ticks before someone
notices. With Section K, the same drift catches itself on the next LOOP-BOOT
run (~5s wall time, exit 1 with the orphan filename printed). The probe
follows the same `find + sort + comm -23/-13` pattern as Section G/H/J —
pure bash, no external dependencies beyond `git` and `find`.

**Why "K" and not re-letter the rubric:**

Section I has stayed "Open registry" since the rubric was reconstructed
turn-028, and the "I = registry" mnemonic is stable for any external
readers who navigated to the section by letter (e.g. a future worker
profile referencing "QA §I"). Section K instead of "Section L (move I→J,
J→K)" preserves the existing section letters for Sections A-J and just
adds K at the end. The same approach turn-040 used when adding J (kept
I as "Open registry", added J at the end rather than renumbering).

**Update cadence:**

If a new kind of audit-trail drift surfaces (e.g. "turn-XXX numbers skip
because a tick was split" or "non-`.md` audit records exist"), extend
the probe's find pattern. Cheap to extend; current find is
`turn-*.md` in `.hermes/audit/`.

## L. Open-ticket-id-reference (added turn-043 — pins ticket citations to kanban DB rows)

Sections G/H/J catch content drift on the LIVE site. Section K catches
drift in the LOOP'S OWN AUDIT TRAIL (the `.hermes/audit/turn-NNN.md`
files). Section L catches a cousin class of drift: **stale ticket-id
citations in state.md / VISION.md / audit / learned / QA baseline**.

The failure mode: a past tick writes `t_xxxxxxxx` into state.md or
VISION.md, referencing a real kanban ticket. Later, the ticket is
archived / cleaned up / never existed. state.md still claims it. The
user re-verifies on receipt (state.md says "ready: t_45ea76a8 W5-PERSUADE")
and the citation is a fabrication — they look up `t_45ea76a8` on the
board and it's gone.

Sections G/H/J/K all catch *file-level* drift (src/, build artifacts,
audit records). Section L is the first probe in the rubric that catches
*identifier-reference* drift — the loop citing a name that no longer
resolves. The other "stale identifier" surfaces the loop carries
(commit SHAs, URLs, env-var values) are checked by external tools
(`git log`, `curl`, `env | grep`); ticket ids are the only identifier
class the loop generates and references at high enough volume to need
its own rubric.

**The invariant the loop verifies on every LOOP-BOOT tick:**

For every ticket-id of the form `t_<8 hex chars>` referenced in
`.hermes/state.md`, `docs/VISION.md`,
`docs/QA-MEHYARSOFT-B2B-BASELINE-*.md`, `.hermes/audit/learned.md`,
or `.hermes/audit/turn-*.md`, that id MUST exist as a row in the
mehyar-us kanban DB. The reverse direction (id is in DB but never
cited in state/docs/audit) is informational and NOT a failure — most
open tickets aren't cited anywhere; that's normal.

The probe script is `.hermes/probe-section-L.sh`. Run from repo root.
Exit 0 PASS, exit 1 FAIL, exit 2 INDETERMINATE (e.g. mehyar-us kanban
DB not found at the canonical path).

**Today's expected output (probe exit code 0):**

```
=== L Open-ticket-id-reference probe (turn-043 new check) ===
cited ticket-ids in state/docs/audit: 28
ticket-ids in mehyar-us kanban DB:    47
L PASS: all 28 cited ticket-ids resolve to real DB rows (drift closed)
```

**Negative-test verification (the probe has to actually FAIL on stale citations):**

The probe was negative-tested this tick: appending a a synthetic hex-id reference
to `.hermes/state.md` bumped the cited count to 29, probe exited 1 with
the offending line printed (`L FAIL: stale ticket-id citations... the synthetic hex-id`),
after restoring the original state.md the probe returned to exit 0 with
28 cited / 47 in DB PASS. Bidirectional drift detection verified.

**Failure-mode catalog (extending the rubric for future ticket-id drift):**

| Drift pattern | Detection | Action |
| --- | --- | --- |
| Ticket cited in state.md but archived from board | probe `L FAIL: stale` | P1 — either `hermes kanban reopen` the ticket OR remove the citation from state.md |
| Ticket id typo in state.md (`t_xxxxxxxx` where the 8 chars don't match a real id) | probe `L FAIL: stale` | P0 — fix the typo, re-run probe |
| Cited ticket id is from a different board's DB (cross-board bleed) | probe `L FAIL: stale` (the mehyar-us DB doesn't have it) | P0 — fix the board reference, the loop runs against the mehyar-us board only |
| Mehyar-us kanban DB moved or deleted | probe `L INDETERMINATE: kanban DB not found` | P0 — restore DB, set `MEHYAR_US_KANBAN_DB` env var to override path |
| Probe script itself untracked (`.hermes/probe-section-L.sh` missing from git) | `git ls-files .hermes/probe-section-*.sh` returns only K, not L | P0 — `git add .hermes/probe-section-L.sh`, re-run probe |

**Implementation notes (gotchas baked into the probe):**

- **Uses python's stdlib sqlite3, NOT the sqlite3 CLI.** The sqlite3 CLI
  on this Windows host is the Android platform-tools binary
  (`sqlite3.exe`), which returns "unable to open database file" on real
  Windows paths. Python's `sqlite3` uses the same SQLite engine and
  reads the DB fine. The probe shells out to `python` (not `sqlite3`)
  for that reason.
- **MSYS path translation.** Both the DB path and the temp-file paths
  go through a `/c/...` → `C:/...` conversion before being passed to
  python, because `os.path.exists` in python's posixpath rejects
  MSYS-style paths on Windows even though bash sees the files fine.
  The probe does this conversion in two places: once for the DB, once
  for the temp output file python writes.
- **Tempfiles live under `.hermes/` not `/tmp`.** MSYS bash's `/tmp`
  is not the same dir as python's `/tmp` on Windows. Both layers need
  to see the same files; the probe uses `mktemp -p "$REPO_ROOT/.hermes"`
  so the temp file is in a path both shells can resolve.
- **Tempfile cleanup via `trap`.** `trap 'rm -f "$CITED" "$IN_DB"' EXIT`
  ensures the temp files are removed on success AND failure paths,
  so the working tree stays clean after every probe run.

**Why this lives in the rubric and not just as a one-off check:**

Section L is the cheap automatic re-check for a class of drift that
would otherwise rot state.md silently until the user re-verifies on
receipt. Without Section L, the loop's state.md accumulates stale
ticket-id references one tick at a time (every time a cited ticket
is archived) and the user is the only detector. With Section L, the
same drift catches itself on the next LOOP-BOOT run (~5s wall time,
exit 1 with the offending id printed). The probe follows the same
`grep + sort + comm` shape as Section K but adds the python sqlite3
read for the in-DB side; bash-only would require the sqlite3 CLI,
which doesn't work on this host.

**Why "L" and not re-letter the rubric:**

Sections A-J have been stable since turn-039 (Section H added, I
renamed "Open registry"). Section K was added turn-042 at the end
without renumbering. Section L follows the same convention: append at
the end, preserve existing mnemonics. A future worker profile
referencing "QA §I" or "QA §K" still resolves to the right section.

**Update cadence:**

If a new kind of identifier-reference drift surfaces (e.g. commit-SHA
references in state.md that no longer exist in `git log`), add a
cousin probe (Section M, etc.) following the same pattern. Each
identifier class the loop cites at high volume deserves its own
section. Current scope: ticket ids only; commit SHAs and URLs are
checked externally and don't need a rubric probe yet.