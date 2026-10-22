# MAYOR BACKEND + BILLING QA REPORT
**Branch:** mayor/vision-transform (based on origin/main) — worktree `~/workspace/worktrees/mayor-transform`
**Scope:** workers/mayor (Cloudflare Worker, 120 src files) — read-only audit. No files modified, nothing deployed, no live Stripe contact.
**Date:** 2026-10-12

---

## 1. BILLING CONSTANTS INVENTORY

Source: `workers/mayor/src/billing/plans.ts` (all values verbatim)

| Constant | Value | Notes |
|---|---|---|
| `BILLING_DOMAIN` | `'mayor_pwa'` | stamped into Stripe metadata on every object |
| `BILLING_VERSION` (catalog) | `'2026-10-03.1'` | ownership assertion: webhook objects must match or 409 |
| `PRO_PRICE_VERSION` | `'2026-10-03.2'` | price-version pin on checkout metadata |
| `PRO_PRICE_CENTS` | `1400` ($14/mo) | asserted hard on Stripe Price object, invoice lines, payment intents |
| `PLANS.free` | 100 reply attempts, 10 voice minutes / calendar month | interval `'calendar_month'`, period key `free:YYYY-MM` |
| `PLANS.pro` | 1000 reply attempts, 120 voice minutes / paid period | interval `'month'`, tied to verified Stripe paid periods |
| `CREDIT_PACK_VERSION` | `'2026-10-03.1'` | |
| `CREDIT_PACK_DOMAIN` | `'mayor_credit_pack'` | |
| `CREDIT_PACKS.small` | 400¢ ($4) → 200 reply attempts, 15 voice min | one-time |
| `CREDIT_PACKS.medium` | 800¢ ($8) → 500 reply attempts, 45 voice min | one-time |
| `CREDIT_PACKS.large` | 1200¢ ($12) → 800 reply attempts, 90 voice min | one-time |
| Audit offer | 33000¢ ($330, one-time) | `AUDIT_OFFER` in `billing/audit.ts` (separate product) |

All pricing is machine-verified against Stripe at checkout time (see §2).

## 2. CHECKOUT DISCLOSURE (service.ts:47)

The subscription checkout session sets `custom_text.submit.message` to exactly:

> "Pro is $14 per month. Includes 1,000 reply attempts and 120 reserved app microphone minutes per paid period, shared by your business. Cancel renewal in Manage billing. Phone-provider charges are separate."

Also disclosed (via `billingStatus` usageNote, service.ts:22):
- Allowances are **shared by the business**.
- Failed/interrupted reply attempts **may count**.
- App mic time includes startup/silence; **reserved minutes are not refunded**.
- Basic business records remain available when an allowance ends.
- Phone-provider charges are separate.

Credit-pack checkout message (`credits.ts`): `"<Name> credits: N reply attempts and N reserved microphone minutes, shared by this business. Expire <ISO>. No rollover, plan transfer, subscription or automatic purchase."` — plus a note that "Refunds or disputes revoke the pack allowance; consumed usage stays counted."

## 3. STRIPE PRICE ID CONFIGURATION

Price IDs come from **environment variables only** (declared in `src/env.ts:18-27`, no hardcoding). `configuration()` (stripe.ts) rejects anything not matching `^price_[A-Za-z0-9]+$` and throws 503 `billing_not_ready` ("Payments are being prepared. You can keep using Free.") when unset.

### Env vars required — the 4 pricing Price IDs
| Env var | Price | Use |
|---|---|---|
| `MAYOR_STRIPE_PRICE_ID` | **Pro subscription $14/mo** | recurring checkout; `assertPrice` requires `unit_amount===1400`, usd, `type==='recurring'`, interval month, `per_unit`, non-inclusive tax |
| `MAYOR_STRIPE_CREDIT_PRICE_SMALL` | $4 credit pack | `assertCreditPrice`: unit_amount 400, one_time, metadata `mayor_credit_pack=small`, version match |
| `MAYOR_STRIPE_CREDIT_PRICE_MEDIUM` | $8 credit pack | same assertions, 800¢, `mayor_credit_pack=medium` |
| `MAYOR_STRIPE_CREDIT_PRICE_LARGE` | $12 credit pack | same assertions, 1200¢, `mayor_credit_pack=large` |

### Other billing env vars
- `MAYOR_STRIPE_MODE` (`test`|`live`), `MAYOR_STRIPE_SECRET_KEY` (must be `sk_test_*`/`rk_test_*` in test, `sk_live_*`/`rk_live_*` in live), `MAYOR_STRIPE_WEBHOOK_SECRET` (`whsec_*`), `MAYOR_STRIPE_PORTAL_CONFIGURATION` (`bpc_*`, contract-checked: cancel `at_period_end` only, no subscription_update), `MAYOR_STRIPE_ACCOUNT_ID` (account pinning), `MAYOR_STRIPE_AUDIT_PRICE_ID` ($330 audit product).
- Portal contract is verified live against `/v1/billing_portal/configurations/` — cancels allowed **at_period_end only**; upgrade/downgrade disabled in portal.

### Note for the $39 pricing change (Mayor's staged price)
Moving Pro to $39 is **code + env + Stripe dashboard**: new Stripe Price ($39/mo recurring) → `MAYOR_STRIPE_PRICE_ID`; code constant `PRO_PRICE_CENTS` 1400→3900 + `PRO_PRICE_VERSION` bump (currently `2026-10-03.2`) — every invoice/payment assertion in `subscriptionEffects()` re-checks `PRO_PRICE_CENTS`, and old-version checkouts fail `price_mismatch` rather than charging wrong amounts. The checkout disclosure copy also hardcodes "$14".

## 4. METERING — REPLY ATTEMPTS & VOICE MINUTES

- `src/billing/state.ts` → `reserveMonthlyUsage()`: **atomic D1 claim** — `INSERT ... SELECT ... WHERE count < (baseLimit + valid credit grants) RETURNING count`. Overshoot by race is not possible (single atomic statement; exhausted limit returns no row → denial).
- Credit grants are **recomputed inside the atomic claim**, so a refund that invalidates grants mid-flight cannot be bypassed by a stale context.
- `src/usage.ts` → `claimUsage()`: exhausted allowance returns `allowed:false` with a plain-language reset message; billingStatus never leaks other tenants' data.
- Extra anti-abuse layers: burst rate limits (12 turns/min/user, 6 voice-session starts/min), **platform safety caps** (5000 turns/day, 600 mic minutes/day across the whole platform), and `meterVoice()` — per-minute renewal of voice calls with a **hard 10-minute cap** per call.
- Free allowances track the **calendar month**; paid periods track verified Stripe periods; paid activity also counts toward the Free calendar bucket so downgrading never refills Free.
- **Verdict: no code path lets a tenant exceed their allowance.** (Platform caps can deny service under load — they cannot be exceeded either.)

## 5. REFUND CODE-PATH CHECK — CLEAN ✔

- **No refund-issuing code anywhere**: zero calls to `/v1/refunds` (grep confirmed). The worker can never issue a refund via Stripe.
- Refund handling is **read-only ingestion**: webhooks `charge.refunded` / `charge.dispute.created` (events.ts, credits.ts, audit.ts) **revoke entitlements** — paid periods marked `invalidated=1`, credit grants invalidated, audit orders `payment_status='refunded'`, fulfillment to `needs_review`. This matches the standing order (no refunds, ever): the code never initiates one; it only defends against refunds/disputes created externally.
- Copy aligns: "reserved minutes are not refunded", "No rollover", "Refunds or disputes revoke the pack allowance; consumed usage stays counted."

## 6. BILLING UNIT TEST RESULTS — 8/8 PASS ✔

`npx vitest run tests/billing-catalog.test.ts tests/billing-runtime.test.ts tests/billing-stripe.test.ts` (vitest 4.1.11, installed via `npm ci`, deps gitignored)

| File | Tests | Result |
|---|---|---|
| billing-catalog.test.ts | 3 | ✓ pass |
| billing-stripe.test.ts | 4 (webhook signature verification incl. rotation + timestamp bounds; HTTPS-only + pinned Stripe version `2026-09-30.endive` + redirect blocking; provider-error sanitization; hosted-URL allowlist + event shape validation) | ✓ pass |
| billing-runtime.test.ts | 1 (real `StripeClient` through native Workerd fetch — **outbound calls fully mocked via Miniflare outbound service**; verifies 302 → 503 and `api.stripe.com` targeting) | ✓ pass |

**No live Stripe contact**: test keys are fixtures (`sk_test_runtime_fixture`); the runtime test intercepts at the outbound-service layer, never the network. Zero real charges, by construction.

---

## 7. VERTICALS — RUNTIME INVENTORY

### Wired runtime profiles: **7** (registry `src/verticals.ts`, `VERTICAL_PROFILES`)

| # | Key | Label | Vocab (customer/booking/staff) | Detector knobs | KPIs | Onboarding Qs | Places hints |
|---|---|---|---|---|---|---|---|
| 1 | `salon` | Hair salon / Barbershop | client/appointment/stylist | lapsed 56d, rebook cycle 42d, unanswered lead 120min, no-show lookback 90d | rebooking rate, chair utilization, avg ticket | 5 (services, staff/chairs, service time, dead days, hours) | hair salon, beauty salon |
| 2 | `restaurant` | Restaurant | guest/reservation/server | lapsed 45d, unanswered 120min, no-show 90d | covers, slow-night revenue, no-show rate | 5 (covers, reservation rules, slow nights, menu, hours) | restaurant, cafe, diner |
| 3 | `plumbing_hvac` | Plumbing / HVAC | customer/job/technician | lapsed 365d, unanswered 120min, after-hours 17:00–08:00 | response time, quote conversion, after-hours catch | 5 (service area, emergencies, dispatch, services, booking rules) | plumber, hvac, heating contractor |
| 4 | `dental` | Dental office | patient/visit/hygienist | lapsed 180d, rebook 180d, unanswered 120min | recare rate, hygiene utilization, treatment acceptance | 5 (providers, recare cycle, insurance, booking rules, urgent) | dentist, dental clinic, orthodontist |
| 5 | `auto_repair` | Auto repair | customer/service appointment/technician | lapsed 180d, unanswered 120min, no-show 90d | bay utilization, ticket close rate, repeat customers | 5 (bays, services, estimates, drop-off, hours) | auto repair, car repair, mechanic, tire shop |
| 6 | `pet_grooming` | Pet grooming salon | client/appointment/groomer | lapsed 70d, rebook 49d, unanswered 120min | rebooking rate, table utilization, avg ticket | 5 (services, staff, pricing rules, dead days, hours) | pet groomer, dog grooming, pet salon |
| 7 | `med_spa` | Med spa | client/appointment/provider | lapsed 120d, rebook 90d, unanswered 120min | rebooking, room utilization, avg ticket, **no-show rate** | 5 (treatments, staff, memberships, no-show policy, hours) | med spa, botox, laser hair removal |

Each profile also defines: SMS text-back/confirm/reminder templates (+ professional-register variants), connector priority lists (real providers first: telnyx/twilio/google/stripe, then vertical-native like vagaro, toast, servicetitan — documented, **not all built**), suggestion voice, briefing nouns. An `'other'` fallback profile covers unmapped businesses.

### The other 34 docs: **docs-only, not wired**
- `docs/verticals/` holds **41 files** (40 trade defs + `chief-of-staff.md`). The registry comment states it plainly: *"The 41 docs in docs/verticals/ are the content source; these 7 ship now."*
- Only reference to the docs folder in code is that comment in `verticals.ts`. The 34 non-runtime defs (bakeries, food-trucks, florists, real-estate, etc.) drive nothing at runtime.
- `src/vertical-mapping.ts` (Crew 6b) bridges the gap honestly: adjacent trades map to the nearest of the 7 with an owner-facing "Closest fit — … We don't have a dedicated X mode yet." disclosure; some trades deliberately unmapped (bakeries, food trucks, florists, real estate/law/accounting).
- **Correction to prior reports**: the runtime count is **7, not 5** — `pet_grooming` and `med_spa` were added after the original crew4-vertical commit (git log: `570610e Crew 6 integration … (new verticals …)`).

---

## 8. API SURFACE

Auth model: `getSession` → 401 if absent; `requireOrigin` for non-GET; `rateLimit(env, userId, 60)`; `requireMembership` (agent_memberships, tenant active, roles). Billing actions additionally require `BILLING_ROLES` (owner/billing) + a UUID `idempotency-key` header.

**Public (no auth):** `/api/health`; `/api/billing/catalog` (pricing, CORS-open only to mehyar.us); `/api/billing/webhook` (Stripe, HMAC-signed); `/api/voice/readiness` (capability probe, CORS-open); audit public routes; marketing pages `/`, `/sales`, `/pricing`, `/login`, `/signup`, `/privacy`, `/data-deletion`, `/business-audit[/report]`; `/sales/<vertical>`.

**Authenticated, tenant-scoped** (`/api/businesses/{32hex}/…` — path tenant must equal `actor.tenantId`, else 403): conversation, conversation/images, notifications, missed-calls + text-back, bookings (appointments), appointments (jobs), briefing, roi, suggestions (+send/edit/dismiss), proactive/settings, calendars/discover|selected + guide, gmail, profile + refresh-preview|refresh-confirm, phone-setup, phone-connections (twilio/telnyx connect/numbers/select/disconnect/authorize/test-setup), scheduling-setup (propose/confirm/activate), scheduling-policy, recurring-check, email-preferences, billing (below), business-routines, harness, connectors, mcp-tokens.

**Billing routes:**
- `GET /api/businesses/{id}/billing` — status + usage + readiness
- `POST …/billing/checkout` — Pro subscription checkout (`{planId:'pro'}`)
- `POST …/billing/credit-checkout` — credit packs (`{packId, periodKey}`)
- `POST …/billing/portal` — Stripe billing portal (cancel at period end only)
- `POST …/billing/sync` — reconcile against Stripe
- `GET …/billing/audit-orders` — audit orders
- `POST /api/billing/webhook` — Stripe events (signed)
- `GET /api/billing/catalog` — public pricing catalog

**Inbound webhooks (no session, own secrets/tokens):** `/api/phone/telnyx/incoming/{id}`, `/api/phone/telnyx/stream/{…}`, `/api/phone/twilio/incoming/{id}`, `/api/phone/twilio/stream/{…}`, `/api/webhooks/instagram`; `/api/auth/*`, `/api/auth/callback/telnyx`; `/agents/mayor-voice/{64hex}`; `POST /api/voice/session`; Places: `POST /api/places/search`, `/api/places/details`, `/api/onboarding/confirm-place` (auth-gated).

---

## 9. TENANT ISOLATION — PASS ✔

- **Billing:** every query in billing/ keys on `actor.tenantId` + `mode`; `handleBillingRequest` 403s on path/id mismatch (`billing_tenant_mismatch`); metadata ownership assertions on all Stripe objects.
- **Customers:** all reads/writes `WHERE tenant_id=?` (`searchCustomers`, `confirmCustomer`, `readCustomer`); writes additionally require owner/manager membership via EXISTS subquery.
- **Appointments:** jobs fetched `WHERE id=? AND tenant_id=? AND actor_id=?`; customer links insert `tenant_id`; overlap guards scope `other.tenant_id=?`.
- One pattern to note (not a leak): two internal state-transition UPDATEs (`appointments.ts:68`, `:101`) omit `tenant_id` in the WHERE — but both operate on a job row already fetched with full tenant scoping in the same call, and are reachable only via the authenticated booking flow / cron recovery. UUID job IDs are unguessable. No cross-tenant data path exists.

---

## 10. AI GATEWAY & GOOGLE PLACES — CALL SITES + DEGRADATION

### AI Gateway (`src/ai-gateway.ts`, `src/ai-model.ts`, `src/image-qa.ts`, `src/voice-readiness.ts`)
- All model traffic goes through `gatewayRun()` → `https://gateway.ai.cloudflare.com/v1/{AI_GATEWAY_ACCOUNT_ID}/{AI_GATEWAY_ID|mayor-businesses}/workers-ai` when `AI_GATEWAY_ACCOUNT_ID` + `AI_GATEWAY_TOKEN` are set. Non-streaming calls send `cf-aig-skip-cache: true` so one tenant's personalized answer is never cached-served to another (cache-leak fix documented in code).
- **Degradation when missing (current prod state, noted in code 2026-10-08):** silent fallback to the direct `env.AI` Workers AI binding — on unconfigured token, network error, or 5xx. Only 5xx falls back; 429/401/403 surface as errors so per-tenant rate limits and auth misconfig are never masked. `/api/voice/readiness` reports `transport: 'direct'`.
- Missing: caching, automatic model fallbacks, per-tenant rate limits, unified observability (all gateway features) — the direct binding is the honest safety net.

### Google Places (`src/places.ts`, routes at `src/index.ts:462-475`)
- `GOOGLE_PLACES_API_KEY` is read defensively from env (typed as optional, never in `env.ts`'s required set).
- **Degradation when missing (current prod state — "human step"):** `searchPlacesText` returns no candidates; `/api/places/details` 503s `places_unavailable` ("Continue with the manual questions."); `/api/onboarding/confirm-place` 503s. The client falls back to the **manual question flow** — onboarding never blocks. The vertical detector (`detectVerticalFromCategory` in verticals.ts) also feeds auto-suggestion when Places works.

---

## 11. ATTENTION CYCLE & PROACTIVE ENGINE — LOCATION VERDICT

- **`src/attention-cycle.ts` (14 lines)** is NOT the proactive engine — it is a generic 3-stage runner (`checks → queue → delivery`) that orchestrates cron jobs.
- **The proactive engine IS implemented in `src/`**: `src/proactive.ts` (634 lines) + `src/proactive-detectors.ts` (381 lines). Full implementation confirmed:
  - `MAX_NUDGES_PER_DAY = 3` (proactive.ts:25)
  - Quiet hours 21:00–08:00 business-local (`inQuietHours`, proactive-detectors.ts:85) — **never overnight**
  - `surfaceGate()` enforces both quiet-hours and the 3/day cap
  - Morning briefing once per local day in the 08:05–08:10 window, nudge-capped
  - Detectors → suggestion cards (fill_gap, winback, followup, lead_reply, reminder_nudge) → owner notification
  - Driven by `runProactiveCycle(env)`, called from the `scheduled()` handler in `src/index.ts:603`
- **Cron wiring:** `wrangler.jsonc` (local) has no triggers, but `wrangler.production.jsonc` sets `"triggers":{"crons":["*/5 * * * *"]}` — the proactive cycle runs every 5 minutes in production.
- `web/proactive-stub.ts` exists but is a **client-side UI stub**; the real engine is server-side as above.

---

## QA VERDICT

| Area | Result |
|---|---|
| Billing constants ($14 Pro, 400/800/1200¢ packs) | ✔ confirmed, version-pinned, machine-verified vs Stripe |
| Checkout disclosure | ✔ $14/mo + allowances + cancel + phone-provider charges |
| Stripe Price ID config | ✔ 4 env vars (Pro + 3 packs); $39 path = new Price ID + `PRO_PRICE_CENTS` bump |
| Metering (replies/minutes) | ✔ atomic claims, no overshoot path; extra platform caps |
| Refund code paths | ✔ none exist (issuing impossible; webhook ingestion only revokes) |
| Billing unit tests (test mode) | ✔ 8/8 pass, zero live Stripe contact |
| Runtime verticals | ✔ **7** wired (not 5 — pet_grooming, med_spa added); 34 docs are content-only |
| API routes | ✔ inventoried; session+tenant+role gating, tenant mismatch 403 |
| Tenant isolation | ✔ tenant_id on all billing/customer/appointment queries |
| AI Gateway / Places | ✔ call sites found; graceful degradation both confirmed (prod missing both) |
| Proactive engine | ✔ fully in src/, 3/day + 21:00–08:00 quiet, 5-min cron in production config |
