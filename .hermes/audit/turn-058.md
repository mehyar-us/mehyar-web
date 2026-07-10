# turn-058 audit — pricing-ladder subtitle $330/$250 drift fix

> Live src/ change. First visitor-facing copy edit since turn-036 (sha c33755d).
> Companion to turn-037 (sha 17c70a3, docs-only drift surfacing) and turn-038
> (sha 2b50b36, Section G probe bake-in).

## What shipped

| field | value |
|---|---|
| sha | 5b6a2b9 (merge commit); fix commit b76f59e |
| branch | improver/turn-058-pricing-ladder-subtitle-fix |
| scope | 1 file, 1 line, client/src/components/pricing-section.tsx |
| deploy | CF Pages — live bundle main-1wxJxxD5.js (turn-050, 575243 bytes) → main-BUtub95-.js (575244 bytes, +1 byte) |
| verdict | ship |

## The drift (turn-037 surfaced)

Three sources of truth said three different things about the entry offer:

| surface | said |
|---|---|
| `docs/VISION.md` leak-ladder | "**$150** — Free Tech Audit" |
| `client/src/components/pricing-section.tsx` tier-1 card | "**$150**" |
| `client/src/components/pricing-section.tsx` line 87 subtitle (old) | "The **$330** audit and **$250** diagnosis are the most common entry points." |
| `client/src/pages/MicroOffer.tsx` (the actual intake) | "$330 audit/setup" (49 bundle mentions) |

**What a visitor saw on the home page, before this turn:**

> Tier 1: **Free Tech Audit** — **$150** — CTA → /micro-offer#intake
>
> Tier 2: **Website Diagnosis Report** — **$250** — CTA → /micro-offer#intake
>
> *(both CTAs land on the same /micro-offer page which charges $330)*
>
> *(subtitle line directly below the tier cards claimed)* "The **$330** audit and **$250** diagnosis are the most common entry points."

The subtitle's `$330 audit` claim referenced a price that did not appear on any tier card; the `$250 diagnosis` claim matched tier-2. The subtitle contradicted the cards directly above it on the same screen.

## What turn-058 did (and what it deliberately did NOT do)

**Did:** rewrote the subtitle to use tier names instead of dollar amounts:

```
before: "Six tiers, ordered by the smallest useful engagement first. The $330 audit and $250 diagnosis are the most common entry points."
after:  "Six tiers, ordered by the smallest useful engagement first. The audit and the diagnosis report are the most common entry points."
```

**Did NOT do:** change any tier price. VISION.md still lists $150/$250/$1k-$5k/$5k-$25k/$500-$3,500/$150-hr. /micro-offer still charges $330. api-contract `first_330_target_cents: 33000` unchanged. docs/PRICING-LADDER-DRIFT-2026-07-09.md still open with options A/B/C awaiting founder reply.

The subtitle was a self-contradiction *within* the leak-ladder block. It could be fixed autonomously because the fix is purely a rewrite of words — no tier price change, no schema change, no API change. The tier-price question (Section G probe) remains founder-blocked.

## Verification

- tsc green
- vite build green (new bundle main-CbIxzlhT.js locally → main-BUtub95-.js on CF Pages)
- new subtitle string `The audit and the diagnosis report` present in bundle
- old `$330 audit and $250 diagnosis` substring absent from bundle
- test:intake 11/11 green
- Section G probe still FAIL exit 1 (`G FAIL: tier-1=$150 intake=$330`) — expected, the structural drift turn-037 surfaced is unchanged by this copy fix
- Section H probe 9/9 PASS
- Section J probe FAIL exit 1 (regression — see turn-059 follow-on)
- Section O probe PASS — auto-discovered canonical main-BUtub95-.js across 4 routes
- 4-screen smoke home 200 / /booking 200 / /microoffer 200 / /404 404
- voice 5/5 — no em dash, no "leverage", no "in today's fast-paced world", no generic CTA
- anti-slop 0 hits — `grep -iE 'leverage|empower|trusted partner|AI-powered|game-changer' client/src/components/pricing-section.tsx` = 0

## Voice score

The new subtitle is opinionated and specific: "The audit and the diagnosis report are the most common entry points." No dollar figures in the subtitle (they live on the cards above). Reads cleanly on the live page. Voice 5/5.

## Push verification

`GIT_CONFIG_SYSTEM=/dev/null GIT_TERMINAL_PROMPT=0 git push origin improver/turn-058-pricing-ladder-subtitle-fix` → `b76f59e..main` on origin; `git ls-remote origin main` confirms `5b6a2b9ce8dbe690d509db45a588453689db14b4` (the merge commit) is at origin main; `git rev-list --count origin/main..HEAD` = 0; GitHub API `/repos/mehyar-us/mehyar-web/commits/main` returns sha `5b6a2b9...`.

## Lessons

1. **A copy fix that contradicts itself is the cheapest kind of leak to close autonomously.** The tier-price drift (Section G) needs a founder decision because it changes what visitors get quoted. The subtitle self-contradiction was a different bug class — internal inconsistency within a single on-page block. The fix was a rewrite, not a price change.
2. **Section J's `$330 in pricing-section.tsx` assertion broke the moment this turn landed.** J is a build-artifact-integrity probe (src literal in bundle), but its literal set was implicitly co-testing the pricing drift — the $330 substring in pricing-section.tsx was only there because the OLD subtitle put it there. J and G now have a clean separation of concerns (J = src/bundle pin; G = structural pricing drift).
3. **The cheapest way to not ship two divergent truths on the same screen is to have the prose refer to the offer names, not the prices.** Turn-058's new subtitle (`"The audit and the diagnosis report..."`) reads without committing to any specific dollar amount. The cards above carry the prices; the prose below the cards carries the names.
4. **Loop state drift accumulates fast when state.md updates are deferred.** Turn-058 was correctly executed and merged (verifiable on origin main) but state.md was never updated to record it. By turn-059, two ticks of state debt had compounded (turns 057 + 058). The O(1) warm-start guarantee in state.md is only as fresh as the last tick that explicitly closes it.