# turn-033 · voice reconciliation: hero CTA + sitemap orphan → "leak ladder"

**sha:** `a1d3548` on github main (PR #3 squashed/merged)
**branch:** `improver/voice-leak-ladder-turn-033`
**live bundle:** `assets/main-DrrbqAOE.js` (574069 bytes; CF Pages rolled on src/ change)
**trigger:** working-tree drift spotted on turn-033 warm-start — turn-032's
"leak ladder" rename missed the home hero CTA and the Sitemap /services
row description. Both edits were uncommitted at start of tick.

## What shipped

Two source-level changes, voice reconciliation:

- **`client/src/components/hero-section.tsx`** — secondary CTA label changed
  `"See the offer ladder"` → `"See the leak ladder"` (CTA href `/services`
  unchanged). The visitor clicks and lands on `#pricing` which now uses
  "leak ladder" as its section eyebrow, so the label matches the section
  the visitor actually sees.

- **`client/src/pages/Sitemap.tsx`** — orphan from turn-032 committed:
  `/services` row description changed `"Offer ladder, pricing ranges, ..."`
  → `"Leak ladder, pricing ranges, ..."` so the sitemap route description
  matches the public-facing tier-list.

The VISION.md voice-bar bullet `"the offer ladder is the proof, not testimonials"`
is intentionally **left untouched** — that line is meta (a brand-principles
statement, not a visitor-facing label). Only visitor-facing strings were
migrated to "leak ladder."

## Verification

### Live bundle grep (`assets/main-DrrbqAOE.js`, HTTP 200, 574069 bytes)

| needle | count | expected | status |
|---|---|---|---|
| `See the leak ladder` | 1 | 1 (hero CTA) | ✅ |
| `Leak ladder` | 2 | 2 (hero + pricing eyebrow) | ✅ |
| `See the offer ladder` | 0 | 0 | ✅ |
| `offer ladder` | 0 | 0 (visitor-facing) | ✅ |
| `secure intake` | 0 | 0 | ✅ |
| `in today's fast-paced` | 0 | 0 | ✅ |
| `Your trusted partner` | 0 | 0 | ✅ |
| `empowering businesses` | 0 | 0 | ✅ |
| `we leverage` | 0 | 0 | ✅ |
| `we utilize` | 0 | 0 | ✅ |
| `micro-offer#intake` | 20 | ≥19 baseline | ✅ +1 (sitemap row now matches) |
| `Request the $330 audit` | 7 | 7 baseline | ✅ unchanged |
| `Request the audit path` | 1 | 1 baseline | ✅ unchanged |
| `/contact` | 20 | 21 baseline | ⚠ −1 (turn-032 documented move) |
| `$150` | 4 | ≥1 | ✅ |
| `$250` | 3 | ≥1 | ✅ |
| `$1,000` | 1 | ≥1 | ✅ |
| `$5,000` | 4 | ≥1 | ✅ |
| `$500` | 5 | ≥1 | ✅ |
| `$150/hr` | 1 | ≥1 | ✅ |

### /contact regression analysis (21 → 20, NOT a turn-033 regression)

The `/contact` count went from 21 (turn-027 onward, through turn-032) to 20
this tick. Diff shows turn-032 already moved tier 2's CTA from
`/contact?service=website-cleanup` → `/micro-offer#intake` (the audit-intent
funnel realignment piece, already documented in the turn-032 commit body
and the turn-027 funnel summary). The +1 micro-offer#intake (19 → 20) and
the −1 /contact (21 → 20) are the **same** turn-032 move, just measured
this turn. Net audit-intent funnel is unchanged from turn-027 spec:
all audit-intent CTAs land on /micro-offer#intake, all non-audit
service CTAs land on /contact.

### Home shell

- `dist/public/index.html` (live): 3 `application/ld+json` blocks (turn-030
  baseline preserved — no shell regressions)
- HTTP 200, 9248 bytes prerendered shell
- Bundle ref: `assets/main-DrrbqAOE.js` (DIFFERENT from turn-029/030's
  `main-P-x17WD-.js` — CF Pages rolled the bundle this tick because the
  change is client-side copy, not scripts/route-jsonld.json)

### Build gates

- `npm run check` (tsc) — exit 0, green
- No `npm run build` needed for this tick (no route-jsonld.json edit;
  turn-031 already established that JSON-LD-only ticks don't need the
  full vite build, and this isn't a JSON-LD tick anyway — it's a
  client-side copy tick that goes through vite via the next CF Pages
  build)

## Voice score

5/5 vs VISION.md voice bar:
- problem-first ✓ ("See the leak ladder" frames the next click as
  inspection, not browsing)
- no em dash ✓
- short sentence ✓ (3 words, single verb)
- named concrete noun ✓ ("leak ladder" is the VISION.md canonical term)
- no self-promotional language ✓

## Tickets filed

- **t_7f7dbdd7** (improver, completed) — turn-033 voice reconciliation

## Reusable artifacts

- None new this tick. The patch was a 1-line string edit; not worth a
  `scripts/` helper for a single occurrence.

## Lesson (learned.md)

A "named-ladder" tick after a section-level rename is a 2-place minimum
job, not a 1-place job: the visitor-facing CTA label that points at the
renamed section, AND any directory/index/footer descriptions that
preview the section. The turn-032 / Sitemap description drift was
benign but visible; the hero CTA drift would have been the kind of
"the offer ladder is the proof" voice-bar violation that the user
catches in 2 seconds. Bundle-grep "offer ladder" → 0 hits is now the
cheap post-rename verification. The new cheap post-rename check:
after any section-eyebrow rename, `grep -rn '<old-name>' client/src/`
should return 0 hits in visitor-facing copy (meta-noun mentions in
VISION.md / docs/ are fine; only src/components + src/pages matter).

## Next-tick hot list (carry forward, max 3)

- W5-PERSUADE (t_45ea76a8, ready, unassigned) — long-stale, needs user
  direction first; do not auto-pick
- LOOP-BOOT cadence — schedule next full 13-route audit in 5-7 ticks
  (rubric is now anchored to verified-this-tick entries from turn-031
  and turn-033)
- Investigate the bundle-hash-lag mechanism more deeply: turn-030/031
  observed that scripts/-only deploys don't roll the bundle, but
  turn-033 (src/ copy change) DID roll the bundle to `main-DrrbqAOE.js`.
  Pattern: scripts/ → shell-only deploy, src/ → shell+bundle deploy.
  Confirm against one more src/ tick to validate.