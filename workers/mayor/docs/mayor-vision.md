# The Mayor — Muse for Local Businesses

## What "Muse-like" means here

Muse works because it has four things: persistent memory of the user, tools
that act in the world, the ability to connect anything in one click, and a
personality you recognize. The Mayor is the same shape, pointed at a business
instead of a codebase.

| Muse | The Mayor |
|---|---|
| Remembers your project | Remembers the business: services, prices, regulars, slow Tuesdays |
| Reads/writes files, runs commands | Books appointments, texts customers, answers the phone |
| One-click MCP connectors | One-click connections: calendar, phone, payments, reviews |
| Subagents for parallel work | Per-vertical agents (salon, restaurant, plumber…) with shared memory |
| Artifacts you can open | Dashboard cards: today's book, open leads, money in/out |
| Proactive suggestions | Notices the slow Thursday, the lapsed regular, the unanswered lead |

## Architecture

One Cloudflare Worker (`mehyar-mayor`), one D1 database, Durable Objects for
voice/phone sessions. Every model call routes through the shared AI Gateway
(`mayor-businesses`): caching, fallbacks, per-business rate limits, one cost
dashboard.

- **Tenant isolation:** every row carries `tenant_id`. Every tool call checks
  it. One business can never see another's customers, calls, or money.
- **Memory:** business facts, customer notes, and playbooks persist per tenant.
  The agent reads them before every conversation — that's what makes it feel
  like "the one who runs the front" instead of a chatbot.
- **Authority tiers:** read-only → draft for approval → act automatically
  inside owner-set rules. The owner decides the tier per action type.
- **Connections:** OAuth vault (Google, Microsoft, Telnyx, Twilio, Zoho today).
  Adding a connection is one tap; the agent gets a scoped token, never the
  owner's password.

## Onboarding — the Chief of Staff

The public site promises "start small, make it useful." The signed-in flow
delivers it through a general onboarding agent — the Chief of Staff
(`docs/verticals/chief-of-staff.md`). Not a form. A conversation.

1. **Identify** — "What kind of business is it?" Maps the owner to one of
   40+ vertical agent definitions. Handles hybrids, flags missing verticals.
2. **Learn the place** — name, neighborhood, services and prices, hours,
   how customers reach them today. The agent structures it; the owner
   corrects.
3. **Connect** — one-tap cards ordered by value for that vertical: calendar,
   phone, Google Business Profile. Skip anything; the agent re-asks later
   when the missing connection would have helped.
4. **Set the rules** — authority tiers (book directly vs. check first),
   missed-call policy, notification preferences. Sane defaults.
5. **Hand off** — introduces the vertical agent by name. The Chief of Staff
   steps back but returns on "change how I'm set up."

Proactive from day one: it spots the wrong hours on the Google profile, the
unconnected calendar after three missed calls, the slow Thursday — each with
a one-tap fix. Under five minutes, completable between customers, phone in
one hand.

## Visual direction

Mobile-first, app-like. The owner runs the business from their phone.

- **Chat-first home:** the agent is the interface. Cards and buttons appear
  inside the conversation, not in a separate dashboard maze.
- **Glanceable cards:** today's bookings, missed calls needing follow-up,
  money in this week. Each card is one thumb-tap deep.
- **Connection cards:** every integration is a card with a logo, one line on
  what it unlocks, and a Connect button. Connected cards show status, not
  settings.
- **Proactive feed:** the agent surfaces things — slow day Thursday, regular
  hasn't booked in 6 weeks, 3 unanswered leads. Each item has a one-tap action
  (approve, edit, dismiss).
- **No desktop-only flows.** If it can't be done on a phone, it doesn't ship.

## The verticals

40+ agent definitions in `docs/verticals/`, covering every NYC local business
type that matters — from barbershops to funeral homes, food trucks to
pharmacies. The Chief of Staff matches the owner to the right one on day one.

## What we don't do

- No refunds, ever. Purchases are final; the product states it plainly.
- The agent never claims to be human. Every phone call opens with AI disclosure.
- Calls and texts never happen without the owner's explicit connection and
  consent acknowledgement.
- Payment code is frozen. The worker's billing stays exactly as it is.
