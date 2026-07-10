# Persuasion Proposal — mehyar.us

> Created turn-046 to close the docs-path drift Section N probe flagged
> on its first run (t_45ea76a8 has been "ready awaiting user direction"
> since the bootstrap; this file was referenced from VISION.md / state.md /
> audit turn-016/018/025/031/044 but never landed on disk).
>
> Status: **TEMPLATE — awaiting founder shape pick (a / b / c / hybrid).**
> Once a shape is chosen, this file becomes the implementation spec;
> the loop fills in the chosen section and ships in ≤1 follow-up tick.

## Why this exists

W5-PERSUADE (`t_45ea76a8`) is the one open ready ticket on the `mehyar-us`
board. It asks: *"what persuasion shape should mehyar.us carry?"*

The hard rules already locked (per `mehyar-us-improve-loop` skill):

- **max 1 nudge / session**
- **never repeat after dismissal**
- **always-mute-on-Telegram-command**
- **never override copy**
- **no exit-intent modals** (forbidden by class)
- **no popups that block content**
- **passive-only default** — visitor clicks to ask. No proactive nudges.

The shape pick is the only thing that changes between options. The hard
rules above are non-negotiable across all three.

## The 3 candidate shapes

### Shape A — Sticky CTA bar (bottom-anchored, dismissible)

- One thin (48px) bar at viewport bottom when the visitor is NOT on
  /micro-offer, /booking, or /contact (don't pile CTAs on existing
  conversion pages)
- Copy: `Find the leak that costs the most. $330 flat.`
- Single button: `Get the audit` → `/micro-offer#intake`
- Close (×) button → localStorage flag for 7 days → silent thereafter
- Trigger: appears after 30s on-page OR after 60% scroll, whichever first
- Pass-through: visitors from direct `/micro-offer#intake` source see no bar
  (already converted; no point nagging)
- **Best for**: catching the visitor who reads the leak ladder, scrolls
  past the pricing cards, and is about to bounce without acting
- **Risk**: low — single CTA, single placement, no behavioral surprises
- **Reversible**: yes (one component, one config flag)

### Shape B — Inline offer-nudge on /blog and /services (post-content)

- After the last paragraph of a /blog post OR after the last /services
  card, inject one short paragraph in the founder voice:
  `Not sure which tier fits? The $330 audit gives you a written
  recommendation. Three days. No follow-up calls unless you ask.`
- Single inline link: `See the audit →` → `/micro-offer#intake`
- No button, no modal, no animation — just one paragraph of copy that
  matches the page's voice
- **Best for**: catching the visitor who reads content for context but
  doesn't see the leak ladder as the natural next step
- **Risk**: low — adds prose, doesn't change existing prose
- **Reversible**: yes (one paragraph component, scoped to /blog + /services)

### Shape C — Quiet social-proof line on home hero (testimonial-shaped)

- Add one short sentence under the existing hero copy:
  `17 NYC businesses shipped this with us since 2022.`
  (placeholder; real number goes in once founder confirms)
- No button, no link, no follow-on
- Hero CTA copy unchanged
- **Best for**: trust-building for visitors who haven't heard of mehyarsoft
  before and need a proof point before they'll click any CTA
- **Risk**: low — additive copy, no behavioral change
- **Reversible**: yes (one sentence in hero-section.tsx)
- **Caveat**: the number MUST be accurate. Until the founder confirms,
  the sentence is NOT shipped (state.md hot-list blocks Shape C on this).

## Hybrid (Shape A + Shape B + Shape C)

If the founder wants the full persuasion surface (max-1-per-session is
still the hard rule), pick all three but with Shape A firing LAST in
priority order: Shape C (hero proof) → Shape B (inline after content) →
Shape A (sticky bar only if neither earlier nudge fired AND visitor is
not on a conversion page).

This is the maximal version. Loop recommends starting with Shape A only
(smallest, most reversible, captures the largest single leak) and
adding B / C in subsequent ticks after measuring Shape A's lift.

## Anti-patterns explicitly rejected

- Exit-intent modals (class hard rule)
- "Wait! Before you go..." popups (voice bar)
- Anything that scrolls-with-content / blocks the page / hijacks input
- Chat widgets (out of scope; not the consultation model)
- "Limited time offer" urgency copy (founder voice rejects scarcity)
- Anything that asks for email before showing the leak ladder
- Anything that mimics a system notification (browser permission prompt, etc.)

## Decision request

Reply on this doc (or via Telegram to chat 6829435996):

- `ship A` — sticky bar only
- `ship B` — inline offer-nudge only
- `ship C` — hero social-proof line (requires accurate number from founder)
- `ship A+B+C` — full stack with priority order C→B→A
- `hold` — keep current passive-only state; close W5 as won't-do

Once the reply lands, the loop will:
1. Flesh out the chosen section below with concrete copy + file paths
2. Ship in ≤1 tick (one component per shape; max 3 components for A+B+C)
3. Verify against Section H a11y probe + Section G pricing-consistency probe
4. Update VISION.md "Pending questions" (remove this question once answered)
5. Close `t_45ea76a8` with the chosen shape documented in the comment

## Chosen shape — (filled in once founder replies)

*(empty until decision lands)*