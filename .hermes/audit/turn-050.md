# turn-050 — PWA proper 192/512/1024 icons + sw.js cache bust

**Tick:** 50
**Date:** 2026-07-10 (post turn-049 merge)
**Branch:** `improver/pwa-icons-turn-050` → merged to `main` as `75274ae`
**Live deployed sha:** `75274ae`
**Live bundle:** (PWA assets updated; JS bundle unchanged at `main-1wxJxxD5.js`)
**Deploy target:** Cloudflare Pages from `mehyar-us/mehyar-web`
**Telegram card:** emitted at end of this tick

## What was spotted

Working-tree had uncommitted WIP from a previous tick — `manifest.webmanifest`
had been re-shaped (single mehyarsoft-mark.png → properly-sized 192 + 512 + 1024 +
favicon.svg) and `sw.js` had been bumped `mehyar-shell-v1 → v2`. The two new
PNG files (`mehyarsoft-mark-192.png`, `mehyarsoft-mark-512.png`) had been
dropped in `client/public/assets/` but the whole change set was never
committed + pushed.

Verified the live state was still on the OLD manifest:
- `curl https://mehyar.us/manifest.webmanifest | grep mehyarsoft-mark*` → only
  `mehyarsoft-mark.png` (the old single-asset form, referenced twice for 192
  and 512 — a real PWA anti-pattern).
- The 192/512 PNGs were on disk but served 404 from CF Pages (not in the
  deploy bundle).

The fix was sitting in the working tree, never shipped. This is the textbook
"real value, no risk, no judgment needed" tick.

## What was done

1. Branched `improver/pwa-icons-turn-050` off `main` (HEAD = 908c180, turn-049).
2. Staged the 4 working-tree files: manifest.webmanifest + sw.js + 2 PNGs.
3. Commit: `7341557` "feat(pwa): proper 192/512/1024 icons in manifest + cache
   bust (turn-050)".
4. Pushed branch; merged to `main` no-ff as `75274ae`; pushed main.
5. Verified CF Pages rebuilt and now serves the new manifest.

## Live verification (post-deploy)

```
=== PWA assets (5/5 200) ===
/manifest.webmanifest: 200
/sw.js: 200
/assets/mehyarsoft-mark-192.png: 200
/assets/mehyarsoft-mark-512.png: 200
/assets/mehyarsoft-mark.png: 200  (kept for legacy/fallback)

=== Manifest icons live ===
mehyarsoft-mark.png         (1024x1024 any)
/assets/mehyarsoft-mark-192.png  (192x192 any maskable)
/assets/mehyarsoft-mark-512.png  (512x512 any)
/assets/mehyarsoft-favicon.svg   (any)

=== sw.js live ===
VERSION: mehyar-shell-v2 (was v1 — cache bust confirmed)
SHELL_ASSETS precache: mehyarsoft-mark.png + 192 + 512 + favicon.svg

=== 4-screen smoke (no regressions) ===
/ : 200
/booking : 308 → 200 (final /booking/)
/micro-offer : 308 → 200 (final /micro-offer/)
/404 : 200

=== Live funnel realignment (W2-FUNNEL baseline 20/7/1/21) ===
micro-offer#intake: 21 (+1 from turn-049 newsletter inline checklist)
/contact: 20 (-1 from turn-027 + turn-049 NewsletterSignup variant routing)

=== Probes (all PASS, no regressions) ===
H (accessibility/SEO smoke) : PASS
J (build artifact integrity) : PASS
K (audit-record tracking)   : PASS
L (open-ticket-id reference) : PASS
M (commit-SHA reference)    : PASS
N (file-path reference)     : PASS
G (pricing consistency)     : FAIL (expected — open BLOCKER on
                             docs/PRICING-LADDER-DRIFT-2026-07-09.md)
```

## Risk

Zero. Pure additive PWA hygiene. The new manifest icons were already on
disk (just not deployed). The sw.js bump `v1 → v2` is the standard
mechanism for getting returning visitors off the old shell cache; the
old shell cache name was always going to age out anyway.

No copy touched. No page-chrome touched. No conversion path touched.

## Lesson

The WIP pile-up is a recurring failure mode for this loop. Pattern:

1. Working tree accumulates real work across many ticks (often from
   parallel experiments or interrupted ticks).
2. Next "real" tick comes along, picks a different project, and never
   clears the WIP.
3. Real value stays uncommitted → undeloyed → undelivered to visitors.

Cheap recurring check that catches this:

```bash
git -C mehyar-web status --porcelain | head -20
```

If there are `M client/public/...` or `?? client/public/assets/...`
entries with **content already on disk**, that's a "ship the WIP" tick
candidate. Pure no-judgment work, high value, zero risk.

## Tickets

- W3-PWA (t_45ea76a8... no, that's W5. The actual W3-PWA ticket id
  needs a board lookup; will be noted on next tick).

  Wait — confirmed via board: W3-PWA is the PWA ticket. State.md notes
  open tickets: t_45ea76a8 (W5-PERSUADE) + t_90f2136f (BOARD-HANDOFF).
  W3-PWA closed piece-by-piece across turns 001-018 (initial manifest
  + service worker). This tick is the manifest icon proper-sizing
  polish piece — closure note added to W3-PWA ticket history.

- BOARD-HANDOFF (t_90f2136f, ready) still awaits user activation.
- W5-PERSUADE (t_45ea76a8, ready) still awaits founder shape pick.

## Loopboard state

Tick 50, sha 75274ae, deploy green, no regressions.
