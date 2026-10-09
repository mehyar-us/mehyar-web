# Assessment Call → Audit Tab — Handoff Contract

**From:** brain/closer crew (branch `feat/assessment-call`, worktree
`~/workspace/worktrees/mehyar-web-assessment`)
**To:** audit-tab crew (branch `feat/audit-tab`)
**Purpose:** the post-call flow. After the free assessment call, the caller gets
a personal email with a tokenized, expiring link. The link opens the Audit My
Business form **pre-filled** from the conversation. They add details + upload
the walkthrough video → your existing audit engine takes over.

We do not share a branch, so this document is the contract. Field names and
endpoint shapes below are frozen — implement against them.

## What the brain crew provides (live on our branch)

### 1. Prefill API — `GET /api/assessment/prefill?token=act_…`

Returns prefill data for the audit form. Does **not** consume the token (safe
for page render + refresh).

```jsonc
// 200 { ok: true, payload: {...} }
// 410 { ok: false, error: "invalid_token" | "token_used" | "token_expired" }
{
  "ok": true,
  "payload": {
    "source": "assessment_call",
    "session_id": "…",
    "business_name": "Acme Plumbing",
    "url": "https://acmeplumbing.com",
    "category": "plumber",
    "contact_name": "",
    "findings": [
      { "id": "no_https", "title": "Site not on HTTPS", "severity": "high",
        "observation": "Your site loads over plain HTTP…" }
    ],
    "findings_summary": "Site not on HTTPS (high); No meta description (medium)",
    "call_minutes": 23,
    "outcome": "followup"
  }
}
```

### 2. Token consume — `POST /api/assessment/prefill` `{ "token": "act_…" }`

Call this when the caller **submits** your intake form with a prefill token.
Marks the token used (single-use); returns the same payload. If it returns
`410 token_used`, the form was already submitted — don't double-create the
audit row.

### 3. Token format

- Opaque: `act_` + 64 hex chars. Unguessable; only the SHA-256 is stored server-side.
- **TTL: 7 days**, enforced server-side on redeem (`token_expired` after that).
  The email states "good for 7 days" — real expiry, not marketing.
- One active token per session; minted at call end (and at booking, via the
  `bookAudit` action).

### 4. Landing URL the email links to

`https://mehyar.us/audit?prefill=<token>` (see `AUDIT_PREFILL_URL` in
`functions/api/_shared/assessmentPersona.js`).

## What the audit-tab crew implements (~20 lines in `Audit.tsx`)

On page load, if `?prefill=` is present:

1. `GET /api/assessment/prefill?token=<prefill>` → payload (handle 410 by
   showing the normal empty form with a "link expired" notice — never crash).
2. Pre-fill your intake fields from the payload — suggested mapping:

| Prefill payload field | Your intake field |
|---|---|
| `payload.business_name` | business name input |
| `payload.url` | site URL input |
| `payload.contact_name` | name input (if you have one) |
| `payload.findings_summary` | show as "What we found on your call" panel (read-only) |
| `payload.findings[]` | optional: render as checklist chips |

3. The caller still enters **email** themselves on your form (we never pass the
   raw email — hash-only convention), adds extra details, uploads the
   walkthrough video.
4. On successful intake submit: `POST /api/assessment/prefill { token }` to
   consume the token, then your normal flow (`/api/audit/business/intake` →
   `/api/audit/business/upload` → $330 checkout → audit engine).

## Where the data lands (no changes needed on your side)

- **Form + video:** your existing `audit_business_reports` table and
  `/api/audit/business/intake` + `/api/audit/business/upload` routes remain the
  system of record. The prefill only fills the form — submission goes through
  your endpoints unchanged.
- **Call-side CRM:** our `assessment_sessions` / `assessment_findings` /
  `assessment_prefill_tokens` tables (migration `0040_assessment_call_leads.sql`,
  `LEADS_DB`). If you want to join a paid audit back to its call, match
  `audit_business_reports.email_hash` ↔ `assessment_sessions.email_hash`
  (both are `SHA-256("assessment-call|" + lower(email))` — wait, **they differ**:
  yours is `SHA-256("audit-business|" + lower(email))`, ours is
  `SHA-256("assessment-call|" + lower(email))`. Join on `business_url` +
  created-date proximity instead, or ask us and we'll add a shared join key.)
- **Findings reuse:** our `assessment_findings` rows carry `{ finding_id,
  severity, severity_source, needs_review, title, observation, evidence }` —
  measured facts your report builder may cite. `needs_review = 1` means the
  decision model was low-confidence on that severity — treat as provisional.

## Unsubscribe

Our post-call email carries a one-click unsubscribe:
`GET /api/assessment/unsubscribe?token=<prefill-token>` → sets
`marketing_opt_out = 1` on the session. Your marketing sends to these callers
(if any) must check that flag — or simply don't market to assessment callers;
the contract only requires the link to work.

## D7a — Upload limits: ENFORCED server-side (finalized numbers)

Mayor finalized the funnel upload limits (his proposal, adopted verbatim):

| Kind | Max files | Max each | Extra rule |
|---|---|---|---|
| Photos | 10 | 10 MB | `image/*` mime |
| Videos | 3 | 500 MB | `video/*` mime, ≤ 5 min each, duration MUST be measured |
| **Batch total** | — | **1 GB** | across the whole upload batch |

**Integration contract (audit-tab crew — your `functions/api/audit/business/upload.js`):**

1. Copy `functions/api/_shared/uploadLimits.js` from our branch (pure, no I/O,
   fully tested — `uploadLimits.test.js`, 15 assertions).
2. At the TOP of your upload handler, BEFORE writing anything to R2:
   ```js
   import { enforceUploadLimits } from "../_shared/uploadLimits.js";
   const check = enforceUploadLimits(files.map(f => ({
     name: f.name, sizeBytes: f.size, mimeType: f.type,
     kind: f.type.startsWith("video/") ? "video" : "photo",
     durationSec: f.durationSec, // measured server-side via your parseMp4Duration
   })));
   if (!check.ok) return json({ ok: false, error: check.error, detail: check.detail }, 413);
   ```
3. **Video duration must be measured server-side** (your `parseMp4Duration` on
   the MP4 head) — `duration_unmeasured` rejects videos you can't measure.
   Client-reported durations are hints, not truth.
4. Surface `limitsDescription()` in your upload UI copy so callers know the
   caps before they pick files.

These are enforced with HTTP 413, not suggested in helper text. A file over
any cap is rejected, not truncated.

## D7b / R1 — Post-payment follow-up booking: WITH MAYOR HIMSELF (request/confirm)

After the $330 checkout clears, the buyer books a **personal deep-dive call
with Mayor himself** (AI mayor → human Mayor funnel continuity). This is a
**request/confirmation flow on his real calendar — manual approve, never an
auto-call** (his personal time; "human-in-the-loop" was his phrase). The old
WebRTC `booking_url` concept is WITHDRAWN.

**Buyer flow (your funnel pages):**
1. After payment: show the slot picker — `GET /api/assessment/booking-availability?days=14`
   → `{ slots: [{ start, end }], timezone: "America/New_York", slot_minutes: 45 }`
   (Tue/Thu 10:00–16:00 ET, minus active holds, 24h min notice).
2. Buyer picks a slot → `POST /api/assessment/book-followup`
   `{ audit_id, access_token, slot_start }`
   → verifies payment (402 `not_paid` if unpaid — calls are NEVER issued unpaid)
   → creates the request (`status: "requested"`, slot held) → emails Mayor a
   one-click approve/decline link.
   → `{ ok, booking_id, status: "requested", slot_start, slot_end, timezone,
        message: "Request sent — Mayor personally confirms your deep-dive call within 24 hours." }`
   Buyer-facing copy: **requested, not booked** — Mayor personally confirms.
3. Poll `GET /api/assessment/booking-status?booking_id=…` → `{ booking: { status } }`
   (`requested` → `confirmed` | `declined` | `expired`). On `declined`/`expired`,
   send them back to the slot picker.
4. On `confirmed`: show the booking + note that the calendar invite follows.

**Buyer notifications are YOUR send** (we store `email_hash` only — never raw
buyer email). Set `BOOKING_NOTIFY_URL` on our side to your webhook; we POST:
```json
{ "event": "booking.requested|confirmed|declined|expired",
  "booking_id": "...", "audit_id": "...", "email_hash": "sha256(...)",
  "business_name": "...", "slot_start": "...", "slot_end": "...",
  "timezone": "America/New_York",
  "calendar_template_url": "https://calendar.google.com/calendar/render?..." }
```
Match `email_hash` to your buyer record and send:
- `requested`: "Request received — Mayor personally confirms within 24 hours."
- `confirmed`: "Confirmed for <date> ET — your personal deep-dive call with Mayor." (+ the calendar template link)
- `declined`/`expired`: "That time didn't work — pick another: <your booking page>."

**Mayor's side (ours):** approve/decline links (`?token=abt_…`, hashed at rest,
48h TTL) → confirmed flips status + hands him a Google Calendar template link
(one click onto his calendar — no server-side Google Calendar API exists in
this runtime; `createCalendarEvent()` is the upgrade seam).

**Your Stripe fulfill webhook** calls `POST /api/assessment/book-followup` only
from the paid path. Idempotent per audit (`reused: true` on repeat).
503 `audit_engine_not_ready` = your migration hasn't applied — retry after
deploy.

## Ship-checklist for YOUR pages (Mayor, standing — definition of done)

Every new surface (prefill page, funnel pages, booking pages) must carry the
tracking stack before ship:

1. **Google tag** — reuse `client/src/components/GoogleAnalytics.tsx`
   (page_view fires automatically on wouter route change). Fire explicit funnel
   milestones via `trackPublicAnalyticsEvent` (names agreed — see
   `docs/assessment-call-contract.md`): `email_captured`, `payment_started`,
   `payment_completed`, `booking_requested`, `booking_confirmed`.
2. **Meta pixel + GTM — GAP, flagged not invented.** Grep-verified 2026-10-09:
   neither exists anywhere in `client/index.html` or `client/src`, and
   `PrivacyPolicy.tsx` discloses their absence. Don't add them silently — that's
   a business + privacy-policy decision.
3. **SEO** — register every new route in `client/src/components/SeoManager.tsx`
   with title/description/OG tags.
4. **Verify** with `MEHYAR_PUBLIC_ANALYTICS_DRY_RUN=true` before ship —
   tags-firing is part of the ship gate.

## Test hooks

- Mint a test token: `POST /api/assessment/start` → drive `/api/assessment/turn`
  to email capture → `POST /api/assessment/end` returns `prefill_token` in the
  response (also emailed). Use it against your local `?prefill=` handling.
- Expired-token path: redeem returns `410 token_expired` — your page must
  degrade to the empty form, never a blank screen.

## Open questions for the audit crew

1. Confirm the `?prefill=` param name works with your router (or propose an
   alternative — we'll update `AUDIT_PREFILL_URL` + the email template).
2. The email-hash join-key mismatch above — do you want a shared join key
   (e.g. we write `assessment_session_id` into your intake when the token is
   consumed)? One-line change on our `POST /api/assessment/prefill` consume
   path if you say yes.
