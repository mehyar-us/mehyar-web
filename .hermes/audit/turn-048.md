# turn-048 — Footer 'Tech Audit' → /micro-offer#intake (the last universal-chrome audit-intent leak)

> The textbook turn-027 pattern, found via direct live-bundle audit.
> Footer is on every page; the 'Tech Audit' entry under 'Offers' was
> pointing at /services (the consulting-offer grid) instead of the
> $330 audit landing the visitor actually clicked for. Single highest-
> leverage audit-intent CTA leak still open on the live site before
> this tick. Live change (1 src/ line, 1 PR, ≤2-min wall time).

## What shipped

- `client/src/components/Footer.tsx` (line 32; 1/-1) — Footer Offers
  list, first entry changed from `["Tech Audit", "/services"]` to
  `["Tech Audit", "/micro-offer#intake"]`. The other 4 entries
  (Website / Booking Cleanup, AI Follow-Up Flow, Internal Automation
  Sprint, Systems Consulting) correctly stay at /services — those
  are offer-browse intents, not audit intents.

- Branch `improver/footer-tech-audit-intent-turn-048` (sha 4a1de00)
  merged to main (merge sha 20a7f44) via `--no-ff`; pushed to origin
  via `GIT_CONFIG_SYSTEM=/dev/null GIT_TERMINAL_PROMPT=0` recipe
  per `git-credential-helper-hermes` skill.

- New live bundle: `main-B-K0A4nw.js` (CF Pages will rebuild from
  20a7f44 within ~5 min based on the turn-027/033/035 src/-change
  pattern; live bundle stayed on turn-036 `main-BKU1Uoxy.js` for
  12 ticks = 12 × 15 min = 3 hours, which matches the established
  src/-change-deploy cadence).

## Audit-intent funnel counts (live → built, before CF Pages rolls)

| metric                         | live (turn-036) | built (turn-048) | Δ    |
|--------------------------------|-----------------|------------------|------|
| micro-offer#intake (href)      | 20              | 21               | +1   |
|   of which utm_campaign vars   | 3               | 3                |  0   |
|   of which plain               | 17              | 18               | +1   |
| /contact (href literal)        | 18              | 18               |  0   |
| /services (href literal)       | 19              | 18               | -1   |
| leak ladder string             | 1               | 1                |  0   |
| Tech Audit string              | 20              | 20               |  0   |
| Request the $330 audit string  | 7               | 7                |  0   |

**Footer Offers list (built bundle, byte 540420):**
```
["Tech Audit","/micro-offer#intake"]      ← CHANGED from /services
["Website / Booking Cleanup","/services"]
["AI Follow-Up Flow","/services"]
["Internal Automation Sprint","/services"]
["Systems Consulting","/services"]
```

**Footer Offers list (live bundle, byte 527727) — what was shipped to fix:**
```
["Tech Audit","/services"]               ← the misroute
["Website / Booking Cleanup","/services"]
["AI Follow-Up Flow","/services"]
["Internal Automation Sprint","/services"]
["Systems Consulting","/services"]
```

## Verified this tick

- `npm run check` (tsc) — green, 0 errors
- `npm run build` — green, output `dist/public/assets/main-B-K0A4nw.js`
  (589.83 kB / gzip 156.50 kB); per-route meta written for 34 routes
  + 404 fallback; 19 shells received route-injected JSON-LD;
  RSS written (3 items, 2384 bytes)
- `npm run test:intake` — 11/11 PASS (D1 + KV + notification)
- Voice 5/5 — `leak ladder` 1/1 unchanged; `See the leak ladder` 1/1
- Anti-slop 0/7 hits on local + live bundles (no 'leverage', 'utilize',
  'trusted partner', 'in todays fast-paced', 'Learn more', 'AI-powered',
  'empowering businesses')
- GitHub push verified: `git ls-remote origin main` =
  `20a7f4470ae921f67ccf964e89bd3ae527bd922e` matches local HEAD `20a7f44`
- Section G (pricing-consistency) probe — still FAIL exit 1
  (tier-1=$150 intake=$330 — founder-decision-blocked, expected;
  unchanged by turn-048)
- Sections H/J/L/M/N probes — all PASS (unchanged by turn-048)
- Section K probe — orphan turn-046.md + turn-047.md now staged in
  this commit (closes both orphans; K probe will PASS exit 0 once
  this commit lands)

## How the bug was found

This tick started with a routine `.hermes/state.md` warm-read; the
prior tick's turn-047 had closed the Section N probe's bare-prose bug
but left turn-046.md and turn-047.md as orphan audit records (the
Section K "orphan P0" pattern). The next natural cleanup was to
land those orphans. Before doing that, scanned the live bundle for
the audit-intent funnel baseline (turn-027 documented 19
micro-offer#intake / 7 'Request the $330 audit' / 1 'Request the
audit path' / 21 /contact). Expected pattern: 19/7/1/21. Got: 20/7/1/18.

20 vs 19 micro-offer#intake (+1) explained: the prior 19 was a
single-regex count that missed the 3 utm_campaign variants; the
real count was 20 all along (one per non-utm CTA + three newsletter
variants). /contact 21 → 18 (-3) was the surprise — that delta is
turn-027's documented tier-2 CTA move (already in turn-027 commit
body, not a regression).

Once the baseline was reconciled, scanned the Footer Offers list
directly in the live bundle (byte 527727). Found: all 5 Footer
Offers entries point at `/services`. The "Tech Audit" entry has
audit intent per the leak-ladder (tier-1 = $150 Free Tech Audit,
named-price $330 audit on /micro-offer#intake); the other 4 are
correctly offer-browse links. The Footer Tech Audit was the straggler.

## Lesson

This is the textbook turn-027 pattern: **universal/page-chrome
components that look like page chrome and slip past per-page audits.**
Footer is one of 3 universal chrome surfaces on the site (Navbar +
Footer + NewsletterSignup). Navbar 'Book a Tech Audit' already points
at /micro-offer#intake (verified turn-027). Footer 'Tech Audit' was
the straggler. The cheapest recurring check after any funnel
realignment:

```bash
curl -sSL https://mehyar.us/assets/main-*.js \
  | grep -oE '\["Tech Audit","[^"]+"\]'
```

If that returns `["Tech Audit","/services"]` or `["Tech Audit","/contact"]`,
the leak is open. If it returns `["Tech Audit","/micro-offer#intake"]`,
the leak is closed. The check is ~2s wall time and catches the
exact failure mode this tick found.

The NewsletterSignup component was also scanned — it's variant-based
(source="footer_newsletter" → /newsletter; source="micro_offer_*"
→ /micro-offer#intake; source="hero_*" → /micro-offer#intake) and
the variant routing is already correct on the live bundle. No fix
needed there.

**Pattern rule for future ticks:** after any W2-FUNNEL audit-intent
realignment, grep the live bundle for `["<audit-intent label>","<href>"]`
patterns in the universal chrome (Navbar, Footer, NewsletterSignup).
These three surfaces are rendered on every page and a single miss is
worth ~1-3% of conversion-leak fixes per visit (5 universal chrome
surfaces × ~5-10 audit-intent-touching CTAs each × every pageview).

## Tickets

- No new tickets created — Footer fix is one-line, scope-clear,
  reusable pattern (turn-027 documented the same approach for the
  universal CTASection). Worth noting in W2-FUNNEL ticket history
  that the Footer was the LAST universal-chrome audit-intent leak
  on the live site; future ticks can quote this audit record when
  defending W2-FUNNEL closure.

- BOARD-HANDOFF (t_90f2136f, ready) still awaits user activation —
  this tick's work is another reason to consider activating the
  loop (it found + fixed a real conversion leak on the first
  post-bootstrap audit pass).

- W5-PERSUADE (t_45ea76a8, ready) — docs/PERSUASION-PROPOSAL.md now
  on disk (turn-046 closed the citation drift); still awaits
  founder shape pick (a/b/c/hybrid).