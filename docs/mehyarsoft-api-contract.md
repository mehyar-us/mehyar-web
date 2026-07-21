# MehyarSoft Web API Contract

This repo stays Cloudflare-native by default. Public browser calls use same-origin Cloudflare Pages Functions unless `VITE_MEHYARSOFT_API_BASE_URL` is set to another public API origin. Owner-admin calls use `VITE_MEHYARSOFT_ADMIN_API_BASE_URL` when set, otherwise `https://api.mehyar.us`.

No frontend secrets are required or allowed. Server-only values live in Cloudflare Pages/Workers environment variables or secrets.

## Frontend environment

- `VITE_MEHYARSOFT_API_BASE_URL`: optional public API origin. Empty means same-origin Pages Functions for public intake/suppression routes.
- `VITE_MEHYARSOFT_ADMIN_API_BASE_URL`: optional owner-admin API origin. Default is `https://api.mehyar.us`. This must be a public HTTPS origin only; never include credentials, bearer tokens, query secrets, or private network URLs.
- `VITE_TURNSTILE_SITE_KEY`: public Cloudflare Turnstile site key for intake forms.

## Cloudflare function secrets / bindings

- `LEADS_DB`: D1 binding for leads, lead events, and suppression list.
- `INTAKE_KV`: optional KV binding for rate limits and suppression cache.
- `TURNSTILE_SECRET_KEY`: validates public intake form submissions.
- `HMAC_SECRET`: hashes email/IP/user-agent values before D1/KV use.
- `ADMIN_SESSION_SECRET`: signs admin dashboard bearer sessions.
- `MEHYARSOFT_ADMIN_USERNAME`: owner admin login identifier; production value is `mrswelim@gmail.com`.
- `MEHYARSOFT_ADMIN_EMAIL`: owner admin login email fallback; production value is `mrswelim@gmail.com`.
- `MEHYARSOFT_ADMIN_PASSWORD`: owner admin login password.
- `ALLOWED_ORIGINS`: comma-separated browser origins allowed by CORS.

## Endpoints used by mehyar-web

### Lead intake / audit / booking request

`POST /api/intake`

Used by the contact form for:

- `form_type: contact` — general lead intake.
- `form_type: audit` — audit request.
- `form_type: booking` — booking setup/request call.
- `form_type: micro_offer` — $330 rescue offer.
- `form_type: newsletter` — newsletter signup.
- `form_type: phone_help` — local phone/electronics lead-gen request.

Payload fields:

- `form_type`: `contact | audit | booking | micro_offer | newsletter | phone_help`
- `name`: string, optional
- `email`: string, required
- `phone`: string, optional
- `company`: string, optional
- `website`: string, optional
- `service_interest`: string, optional
- `budget_range`: string, optional
- `timeline`: string, optional
- `message`: string, optional but required by the current contact UI
- `consent_contact`: boolean, required true
- `consent_marketing`: boolean, optional
- `turnstile_token`: string, required
- `hp_field`: honeypot, should be blank
- `utm`: `{ source, medium, campaign }`, optional

Expected response:

- `ok`: boolean
- `lead_id`: string when accepted
- `message`: safe user-facing string

### Suppression / unsubscribe

`POST /api/suppressions/unsubscribe`

Used by `/unsubscribe`.

Payload fields:

- `email`: string, required
- `reason`: string, optional
- `source`: string, required by frontend for attribution

Behavior:

- HMAC-hashes the email before storing.
- Inserts into `suppression_list` with `INSERT OR IGNORE`.
- Caches `suppression:email:{hash}` in KV when `INTAKE_KV` is bound.

### Admin login

`POST /v1/admin/login`

Used by `/admin` and `/admin/email`. The browser sends the username/password only to the server-side admin API; no credential is stored in the bundle.

Payload fields:

- `username` or `email`: string
- `password`: string

Expected response:

- `token`: signed short-lived bearer token
- `expires_in_seconds`: number, optional

### Admin metrics

`GET /v1/admin/metrics`

Headers:

- `Authorization: Bearer {admin_session_token}`

Expected response may be direct counts or backend rollup fields that normalize to:

- `leads`: number
- `contactRequests`: number
- `auditRequests`: number
- `bookingRequests`: number
- `microOfferRequests`: number
- `newsletterRequests`: number
- `suppressions`: number
- `updatedAt`: ISO timestamp

### Rich owner dashboard snapshot

`GET /v1/admin/dashboard?range=30d`

Headers:

- `Authorization: Bearer {admin_session_token}`

Frontend behavior:

- Optional in v1. If missing or 404, `/admin` still renders the protected shell using `/v1/admin/metrics` and clear pending-API empty states.
- Must return no private data without a valid admin bearer token.
- Must use `Cache-Control: no-store`.

Expected top-level response can be direct or wrapped as `{ dashboard: ... }` / `{ snapshot: ... }` and should include these normalized shapes when available:

- `recent_leads` or `leads`: array of lead summaries with `id`, `created_at`, `name`, `email`, `phone`, `company`/`business_name`, `website`, `request_type`/`form_type`, `selected_offer`, `offer_code`, `offer_tier`, `status`, `conversion_stage`, `estimated_value_cents` or dollar `value_estimate`, `first_330_status`, `monthly_retainer_target_cents`, `follow_up_due_at`/`next_follow_up_at`, `source_channel`, `utm_source`, `utm_medium`, `utm_campaign`, `intake_quality`/`quality_score`, `consent_status`, `compliance_flags`, `suppression_status`, `last_touch_at`, `next_step`.
- `revenue` / `revenue_summary` / `revenue_engine`: owner revenue-engine rollup with `pipeline_value_cents`, `open_offer_value_cents`, `first_330_collected_cents`, optional `first_330_target_cents` (defaults to 33000), `monthly_recurring_cents`, optional `monthly_recurring_target_cents` (defaults to 900000), `due_follow_ups`, and `won_leads`.
- `sources` or `source_attribution`: array with `source`, `leads`/`count`, optional `qualified`, `converted`, `pipeline_cents`.
- `funnel` / `request_funnel` / `conversion_funnel`: array with `stage`, `count`, optional `conversion_rate`. Stages should preserve the commercial pipeline (`new`, `reviewed`, `contacted`, `qualified`, `proposal_sent`, `won`, `lost`) when available.
- `outreach_drafts` / `reply_queue`: array with `id`, `lead_id`, `thread_id`, `recipient`, `subject`, `status`, `risk_flags`, `updated_at`. These populate the AI draft queue only; manual approval/send remains mandatory.
- `campaigns` / `campaign_registry`: array with `id`, `name`, `status`, `channel`, `audience`, `drafts_pending`, `compliance_status`, `updated_at`.
- `compliance_gates`: array with `key`, `label`, `status` (`pass | attention | blocked | unknown`), `detail`.
- `audit_log` / `recent_audit`: array with `id`, `created_at`, `actor_type`, `event_type`, `entity_type`, `entity_id`, `metadata`.
- `conversion_trend`: array with `date`, `leads`, optional `qualified`, `converted`.
- `zoho_status` or `sync`: `last_success_at`, `last_status`, `last_error_code`, `last_error_message`, `next_expected_sync_at`.
- `suppressions`: number or `suppression_list`: array.
- `export_url`: optional admin-only URL for CSV/export download.

### Admin email command center

The frontend uses the live admin API for info@mehyar.us email operations:

- `GET /v1/admin/email/threads?limit=25`
- `GET /v1/admin/email/threads/:threadId`
- `POST /v1/admin/mail/sync`
- `POST /v1/admin/email/threads/:threadId/drafts/ai`
- `PATCH /v1/admin/email/drafts/:draftId`
- `POST /v1/admin/email/drafts/:draftId/approve`
- `POST /v1/admin/email/drafts/:draftId/send` with `confirm_manual_send: true`

Manual approval is mandatory before every send. The UI must not expose bulk or autonomous email sending.

### Admin government opportunity drafting assist

The frontend/admin API contract for private opportunity response prep is:

- `GET /v1/admin/government/opportunities?limit=50&status=&source=&min_score=&q=` — owner-only opportunity inbox.
- `GET /v1/admin/government/opportunities/:opportunityId/workspace` — requirements checklist, response outline, capability blocks, and contracting-officer questions for one opportunity.
- `POST /v1/admin/government/opportunities/:opportunityId/drafts` — generate an owner-review draft package. Payload must include or default to `owner_review_only: true` and `auto_submit_allowed: false`.
- `PATCH /v1/admin/government/drafts/:draftId` — update owner notes/status while preserving `owner_review_only: true` and `auto_submit_allowed: false`.
- `PATCH /v1/admin/government/opportunities/:opportunityId` — update owner status/notes.

Draft responses must include:

- `requirements_checklist`
- `compliance_matrix`
- `contracting_officer_questions`
- `response_outline`
- `capability_blocks`
- `owner_confirmation_items`
- `risk_flags`
- `source_citations` with source URLs and retrieval timestamps
- `audit` metadata with draft id, opportunity id, generated timestamp, actor, and guardrail version

Hard rules: never auto-submit; never invent certifications, eligibility, past performance, staffing, or pricing; and never return private draft data without a valid admin bearer token. Admin responses must use `Cache-Control: no-store`.

## Alignment notes for mehyar-api

If `mehyar-api` becomes the public origin at `https://api.mehyar.us`, it should either mirror the public `/api/...` routes or provide a compatibility Worker that maps:

- `/api/intake` to the canonical lead/audit/booking intake handler.
- `/api/suppressions/unsubscribe` to suppression insert.

The admin API should keep `/v1/admin/...` as the owner-only contract for login, metrics, dashboard rollups, and email command-center workflows. The frontend can switch origins by setting `VITE_MEHYARSOFT_API_BASE_URL` and `VITE_MEHYARSOFT_ADMIN_API_BASE_URL`; no secrets should ever be sent through Vite env values.
