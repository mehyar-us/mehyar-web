# QA Report — The Mayor PWA (signed-in app, mayor.mehyar.us)

**Date:** 2026-10-12
**Scope:** Code-level QA of the signed-in Mayor app (read-only; no live browser, no Stripe charges, no file modifications)
**Worktree:** `~/workspace/worktrees/mayor-transform` (branch `mayor/vision-transform`)
**Vision doc:** `workers/mayor/docs/mayor-vision.md` | **CoS spec:** `workers/mayor/docs/verticals/chief-of-staff.md`
**App source:** `workers/mayor/web/` (frontend) + `workers/mayor/src/` (worker backend)

---

## 1. Entry points & routing

### 1.1 What loads at `/`
`web/index.html` is the single-page entry (script → `web/main.ts`). Body opens on `data-view="chat"`.

- **Logged-out:** the chat view renders as a sign-in landing — "Continue with Google" / "Continue with Microsoft" CTAs, plus the offer block (`#offer-block`, rendered from the live billing catalog, price-free fallback if unreachable) and an FAQ ("How this works").
- **Tabs (logged-in):** sidebar nav → Today, Feed, Connectors, Plan & usage, Settings; plus the persistent **chat view** with an always-on assistant dock (composer) and a voice stage. **The UI is tabbed, not the vision's single conversation canvas** (see §2.6).

### 1.2 Sign-in flow (`src/auth/index.ts`, 275 lines)
better-auth (no email/password — disabled) with three OAuth providers:

| Provider | Start route | Notes |
|---|---|---|
| Google | `POST /api/auth/start/google` | PKCE + nonce-binding plugin, offline access; token vault in `auth_provider_grants` |
| Microsoft | `POST /api/auth/start/microsoft` | `common` tenant, minimal scopes |
| Zoho | `POST /api/auth/start/zoho` / `GET /api/auth/callback/zoho` | Custom flow (`src/auth/zoho.ts`) |

Identity sign-in vs connector reconnect share one flow: `POST /api/auth/start/:provider` takes `capabilities[]` + optional `tenantId`; reconnect forces re-consent so Google issues a fresh offline refresh token. Signed-in users re-use the same route with `link-social`.

### 1.3 After sign-in (`main.ts` → `init()` → `enterBusiness()`)
1. `GET /api/auth/get-session` → `GET /api/businesses`
2. **No membership → naming mode:** the conversation asks the business-name question; the owner's typed answer becomes the business (POST `/api/businesses`). *No form, no auto-created nameless business.* (`enterNamingMode`, `claimBusinessName`, web/main.ts)
3. **With a business:** `enterBusiness()` loads profile → conversation history → business profile → onboarding-progress bar → **Places onboarding mount** (Google listing lookup) → voice connect.

The onboarding is **conversational** (chat questions, cards interleaved, thin progress bar — `renderOnboardingProgress`, `src/onboarding.ts` question sets, `web/places-onboarding.ts`). It is **not** the vision's explicit 5-phase Chief of Staff agent interview (see §2.1).

---

## 2. Vision feature status

### 2.1 Chief of Staff onboarding conversation (Identify → Learn → Connect → Set rules → Hand off)
**PARTIAL.** Real pieces exist, the dedicated agent does not.

Implemented pieces:
- Conversational naming + vertical-aware question sets (`src/onboarding.ts`: generic 7-question set + per-vertical sets for salon/restaurant/plumbing_hvac/dental/auto_repair; `onboardingProgressForVertical`)
- Google Places "Is this you?" confirmation card → vertical follow-ups → next-steps (calendar / phone / TEST missed-call) (`web/places-onboarding.ts`, `src/onboarding.ts:confirmPlace`)
- Progress bar with remaining fields, "Continue setup" deep-links back into chat (`main.ts:renderOnboardingProgress`)
- Honest fit-check ("A straight answer first" card) after core questions (`src/fit-check.ts`)
- 42 vertical definition docs in `docs/verticals/` (vision asks 40+) — `chief-of-staff.md` is one of them

Missing (spec-vs-code gap):
- **No Chief-of-Staff agent persona exists.** Zero matches for "chief of staff" anywhere in `src/` or `web/` outside `docs/verticals/chief-of-staff.md` and one marketing meta description (`src/not-found-page.ts`). There is no structured Identify → Learn → Connect → Set-rules → Hand-off interview, no named handoff to the vertical agent, no "returns on 'change how I'm set up'" behavior.
- **"Set the rules" phase is unimplemented:** no authority-tier questions, no missed-call policy question ("text them back right away, or wait for morning?"), no notification-preference setup. The vision's 5th phase is absent.

### 2.2 Proactive engine (slow-day, lapsed regulars, unanswered leads, ≤3 nudges/day, never overnight)
**IMPLEMENTED — and `proactive-stub.ts` is not a stub** (misleading legacy name; it's the live UI↔API adapter).

- **Detectors** (`src/proactive-detectors.ts`, 381 lines): `slow_day` (open gaps tomorrow vs scheduling policy, min gap from vertical `detectorParams`, default 120 min), `lapsed_regular` (per-vertical lapsed windows, e.g. salon 56d, restaurant 60d), `unanswered_lead` (inbound SMS with no reply within vertical window, default 120 min), `no_show_risk` (confirmed bookings for recorded no-showers with no reminder), `missed_call_followup` (missed call, no text-back after 15 min; plus a record-time immediate card via `ensureMissedCallFollowupCard`). Insert idempotent on `(tenant_id, detector, dedupe_key)`.
- **Gating** (`src/proactive.ts`, 634 lines): `surfaceGate()` blocks quiet hours **21:00–08:00 business-local** (`inQuietHours`) and enforces `MAX_NUDGES_PER_DAY = 3` via `mayor_nudge_log`. Briefing fires once per local day in the 08:05–08:10 window, nudge-capped.
- **Scheduler:** worker `scheduled()` handler (`src/index.ts:590-603`) runs `runProactiveCycle()` on a `*/5 * * * *` cron (`wrangler.production.jsonc`). Cycle = detect → build suggestion card → surface (gated) → notify owners → log nudge.
- **Routes (live):** `GET …/briefing`, `GET …/roi`, `GET …/suggestions`, `POST …/suggestions/{id}/(send|edit|dismiss)`, `POST …/proactive/settings` (`src/index.ts:368-387`).
- **UI** (`web/proactive-ui.ts`): morning briefing + suggestion cards (exactly **Send / Edit / Dismiss** — vision's ≤3 actions ✓) pinned at top of Today and in-chat "Today at a glance"; ROI dashboard in Feed; honest "simulated — no real SMS was sent" labeling; undo window on dismiss.
- **Safety:** real SMS only when owner flips `liveSms` (owner/manager-only `POST …/proactive/settings`) **and** an authorized Telnyx connection with a selected number exists; everything else logs as simulated.

### 2.3 Connection cards: one-tap OAuth for calendar, phone, Google Business Profile
**PARTIAL** (OAuth part is real; "one-tap" is not uniform).

- **Calendar — IMPLEMENTED:** Google / Microsoft / Zoho one-tap OAuth with scoped capabilities (`web/connections.ts`, `src/auth/index.ts`); in-conversation `connector_card` events with Connect OAuth buttons (`web/connector-cards.ts`, `src/connector-cards.ts`); secrets go straight to the encrypted credential store, never through chat.
- **Phone — IMPLEMENTED, multi-step (not one-tap):** Telnyx OAuth ("Sign in with Telnyx") *or* manual Telnyx API key; Twilio is manual API-key entry. Guided choice UI ("I need a business number" / "I already have a provider") with provider signup/pricing links (`main.ts:renderPhoneConnection`, `renderPhoneGuide`). Recording-consent gate blocks all calls until acknowledged.
- **Google Business Profile — PARTIAL:** a `google_business` card exists in the connector catalog (`src/connector-guides.ts:104`, `authKind:'oauth'`, via the Google grant), but the guide itself says: *"Today this Google connection powers calendars and Gmail. Business Profile reads (reviews, hours) build on the same secure sign-in."* No Google Business Profile Management API reads found in `src/` (only the public Places API listing lookup). Vision's "so I see your reviews and hours" is not delivered yet.

### 2.4 Glanceable cards (today's bookings, missed calls, money this week — one thumb-tap deep, ≤3 actions each)
**PARTIAL.**

- Chat-home "Today at a glance": briefing summary + top suggestion card + link into full Today view (`proactive-ui.ts:chatHome`).
- Today view: "Needs your attention" rows (each one tap → dialog), "Up next" appointment previews, tasks. Appointments/customers/tasks are modal dialogs now, not pages (Crew 5).
- Suggestion cards: exactly 3 actions (Send / Edit / Dismiss) ✓.
- Gaps vs vision: there is no unified trio of "today's bookings / missed calls / money **this week**" cards — money appears as the **monthly** ROI dashboard in the Feed view ("This month with The Mayor"), not a weekly glanceable card.

### 2.5 Authority tiers (read-only → draft for approval → act automatically)
**PARTIAL.** The *mechanics* exist; the owner-settable *tiers* do not.

- **Draft-for-approval is the de-facto tier:** appointment booking is always propose → review → confirm (`web/workday.ts:reviewProposal`); phone bookings require a separate caller confirmation; suggestion sends require Send/Edit/Dismiss per card; proactive SMS is simulation-mode unless the owner flips `liveSms`.
- **Missing:** the vision's owner-set per-action-type choice ("book it straight away or check with you first?"). `scheduling-policy.ts` has no approval/authority field, and the onboarding "Set the rules" phase doesn't exist (§2.1). Effectively the app is fixed at draft-for-approval + per-card approval; "act automatically" exists only via the `liveSms` toggle for suggestion sends.

### 2.6 Conversation canvas vs tabbed dashboard
**MISSING (vision not adopted).** The app is tabbed: **Today · Feed · Connectors · Plan & usage · Settings**, with the chat view as the default/home tab plus a persistent composer dock. Cards do interleave into the conversation (connector cards, proactive chat-home), and the chat is treated as home — but the "one conversation canvas replaces tabbed views / no dashboard maze" direction is not implemented; the five-tab structure *is* the current architecture.

### 2.7 Voice: tap-to-talk, voice calls, AI disclosure
**IMPLEMENTED** (disclosure verified in code).

- **Tap-to-talk:** `web/tap-to-talk.ts` — a testable state machine (idle → consent → permission → listening → thinking → speaking), barge-in interrupt, 30s permission timeout, plain-words teaching hints; first-run voice-consent sheet states *"you are talking with The Mayor, an AI assistant"* (`web/voice-consent.ts`).
- **In-PWA voice calls:** `@cloudflare/voice` `VoiceClient` + `web/voice-call.ts` with watchdog/timeout honesty; readiness probe before starting.
- **Phone calls (telephony):** Telnyx inbound answering stack (`src/telnyx-answer.ts`, `telnyx-voice-bridge.ts`, `telnyx-voice.ts`).
- **AI disclosure — verified:** `src/phone-voice.ts:48` — *"Proactive AI disclosure: the first thing a caller hears identifies the agent as AI"* → `Hi, I'm ${name}, an AI assistant. How can I help?`; `src/phone-assistant-persona.ts:50` — *"You are AI, and you say so at the start of every call — plainly, in your own words, before anything else… Do not … claim to be human."* Vision's "never claims to be human" rule holds.

### 2.8 Speak-and-show (visuals animate with speech)
**MISSING / aspirational.** The only speech-adjacent visuals are state animations: the pulsing `.voice-ring` during speaking/listening states (`web/style.css`), the live status line, and interim transcript text. No booking-timeline building as words are spoken, no counting-up revenue numbers, no information-carrying animation tied to speech content. (`web/proactive-ui.ts` contains zero animation/synced-visual code.)

---

## 3. Test suite results

`npm test` (`vitest run`) in `workers/mayor` — unit only, no network/credentials required:

- **88 test files — 983 tests — ALL PASSED** (40.5s). Zero failures, zero skipped in the run.
- Coverage spans: proactive engine & detectors, voice (consent, call wrapper, tap-to-talk, diagnostics), billing catalog & runtime, missed-call text-back, onboarding, scheduling, connections, reply-guard, attention cycle, profile refresh.
- Integration suite (`test:integration`) was **not** run — it needs live credentials/network and is out of scope per the task.

---

## 4. Billing UI check (in-app)

All figures are catalog-driven (`src/billing/plans.ts` → `/api/billing/catalog` → UI; never hardcoded in copy):

| Item | Status | Evidence |
|---|---|---|
| Free / Pro tiers shown | ✅ | "Plan & usage" tab renders plan cards from `data.plans`; logged-out offer block renders Free + Pro from the live catalog |
| $14/month | ✅ | `PRO_PRICE_CENTS = 1400` (`src/billing/plans.ts:307`); checkout dialog: *"Pro is $14 per month for this business"* (`web/workday.ts`) |
| Credit packs $4/$8/$12 | ✅ | "One-time usage packs": Small $4 / Medium $8 / Large $12 (400/800/1200 cents, `src/billing/plans.ts:311-313`); rendered in Plan & usage with honest expiry/no-rollover copy |
| No-refunds copy | ✅ | *"Purchases are final — no refunds."* — logged-out offer block (`web/offer-block.ts:29`, SSR twin `src/offer-block-ssr.ts:44`), `web/pricing.html`; *"All purchases are final. We do not offer refunds."* — `web/public/terms.html` |

Note: the in-app Pro upgrade dialog does not restate the no-refunds line inline (copy lives in offer block + pricing + terms). See B3.

---

## 5. Tenant isolation spot-check

- All business-data query paths carry `tenant_id`: proactive, appointments, customers, tasks, SMS/missed-call, billing, memory, connections, custom connectors. Actor membership is enforced via `requireMembership` (incl. `OPERATORS` for proactive/billing routes).
- HTTP business routes are all `^/api/businesses/([a-f0-9]{32})/…` with the actor bound from the session (`src/index.ts`).
- Two files with tenant-less queries, both reviewed and explainable, **not** cross-tenant exposure:
  - `src/business-audit.ts` — the separate one-time `/audit/` funnel; queries are keyed by audit order ID + analysis lease token (order-scoped ownership verified through Stripe payment-intent metadata), not by business tenant.
  - `src/mvp-maintenance.ts` — scheduled cron housekeeping (`mayor_rate_limits`, `mayor_custom_tool_proposals`) keyed by rowid/subject prefix with bounded deletes.
- No tool/query in the signed-in app path was found writing or reading another tenant's rows.

---

## 6. Blockers — missing keys/secrets and what degrades

| Secret | Status in prod (per code comments) | What degrades without it |
|---|---|---|
| `AI_GATEWAY_ACCOUNT_ID` / `AI_GATEWAY_TOKEN` | **Absent in prod** (standing note) | **Not a hard blocker:** `src/ai-gateway.ts` falls back to the direct Workers AI binding (`env.AI.run`). All model calls still work. Lost: 1h response caching, gateway-configured fallbacks, per-tenant rate limits, unified cost/latency dashboard; the `cf-aig-skip-cache` anti-cross-tenant cache-leak header doesn't apply on the direct path |
| `GOOGLE_PLACES_API_KEY` | **Absent in prod** — human step (code comment at `src/index.ts:458`) | Places onboarding degrades gracefully: search/details/confirm-place routes answer with the "not available" flag and the client falls back to the manual question flow (`web/places-onboarding.ts`: *"Business lookup isn't available right now — answer the questions in chat instead"*). No Google listing auto-fill |
| `GOOGLE_CLIENT_ID` / `MICROSOFT_CLIENT_ID` (+ secrets) | If absent | Sign-in buttons disabled with honest copy ("Google sign-in is being connected…"); app unusable for new sign-ins until configured |
| Telnyx / Twilio credentials | Per-business, owner-supplied | Phone features inert: no answering, no SMS, no text-backs; UI shows setup guides; simulation mode available for the money-loop test path |
| Stripe keys / `MAYOR_STRIPE_PORTAL_CONFIGURATION` | If absent | Billing readiness message: *"Payments are being prepared. You can keep using Free."*; checkout/portal buttons disabled; test-mode banner when in test |

Note: the vision's "Payment code is frozen" holds — billing code is untouched by this branch's UX work (catalog-driven, price-verification on webhooks).

---

## 7. Bug list (severity-ranked)

| # | Severity | Title | Detail |
|---|---|---|---|
| B1 | Low | `web/proactive-stub.ts` is a misleading name | The module is the **live** proactive UI↔API adapter (calls real `/briefing`, `/suggestions`, `/roi` routes); the "STUB" header and 404-fallback path are legacy. A new reader will assume the engine isn't real. Rename to `proactive-api.ts` or update the header. |
| B2 | Medium | No owner-settable authority tiers per action type | Vision's "Set the rules" step never shipped: bookings are always draft-for-approval, suggestion sends always need per-card Send, `liveSms` is the only automatic-act toggle. There is no "book directly vs check first" or missed-call-policy setting anywhere (`scheduling-policy.ts` has no approval field). |
| B3 | Low | No-refunds line missing from in-app upgrade dialog | The Pro checkout dialog (`web/workday.ts`) doesn't restate "Purchases are final — no refunds"; the copy exists on the logged-out offer block, pricing page, and terms. Add one line to the checkout dialog for in-flow parity. |
| B4 | Medium | Vision "one conversation canvas" not adopted | Tabbed architecture (Today/Feed/Connectors/Plan & usage/Settings) retained; vision's "no dashboard maze" is the larger pending transform, which this branch's Phase 1 has not started. |
| B5 | Low | GBP card over-promises reads | The Google Business Profile connector guide frames GBP as available, then admits *"Today this Google connection powers calendars and Gmail"* — reviews/hours reads aren't wired. Honest but a gap vs the vision's connection-card value lines. |
| B6 | Low | `inQuietHours` hardcodes 21:00–08:00 | Vision says "never overnight" without specifying hours; the 21:00–08:00 window is not owner-configurable (no setting in onboarding or Settings). Fine as a default, but the vision's notification-preference step would want this adjustable. |

---

## 8. Summary verdicts

| Vision feature | Status |
|---|---|
| Chief of Staff onboarding conversation (5 phases) | **PARTIAL** — conversational onboarding + Places lookup exist; dedicated 5-phase CoS agent does not; "Set the rules" phase missing |
| Proactive engine (slow-day, lapsed regulars, unanswered leads, ≤3 nudges/day, never overnight) | **IMPLEMENTED** — real detectors, gating, 5-min cron, live routes, honest UI |
| Connection cards (one-tap OAuth: calendar, phone, GBP) | **PARTIAL** — calendar one-tap OAuth ✅; phone multi-step ✅; GBP reads not wired |
| Glanceable cards (today's bookings, missed calls, money this week; ≤3 actions) | **PARTIAL** — cards exist across Today/chat/Feed, 3-action suggestion cards ✅; no unified weekly-money card |
| Authority tiers (read-only → draft → auto) | **PARTIAL** — draft-for-approval everywhere; no owner-settable tiers |
| Conversation canvas vs tabbed dashboard | **MISSING** — tabbed app is the current architecture |
| Voice (tap-to-talk, calls, AI disclosure) | **IMPLEMENTED** — disclosure verified in code (`phone-voice.ts:48`, `phone-assistant-persona.ts:50`) |
| Speak-and-show | **MISSING** — aspirational; only state animations exist |
| Billing: Free/Pro, $14/mo, $4/$8/$12 packs, no-refunds | **IMPLEMENTED** |
| Test suite | **983/983 pass** (88 files) |
| Tenant isolation | **OK** — spot-check clean in the app path |
| Blockers | AI Gateway absent → direct-WAI fallback (functional); Places key absent → manual onboarding (graceful); telephony/Stripe per-business or config-gated |

**Net:** the app is a working, tested, tenant-isolated PWA with a real proactive engine, real OAuth connections, catalog-driven billing, and honest degradation paths. The transformation gap is concentrated in the vision's *experience* layer — the Chief-of-Staff conversational agent (esp. "Set the rules"), the single-canvas UI, and speak-and-show visuals — which Phase 1 has not yet built. No data-safety or billing-integrity issues found.
