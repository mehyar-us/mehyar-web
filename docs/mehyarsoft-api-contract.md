# MehyarSoft Web API Contract

This repo stays Cloudflare-native by default: the browser calls same-origin Cloudflare Pages Functions unless `VITE_MEHYARSOFT_API_BASE_URL` is set to an external public API origin such as `https://api.mehyar.us`.

No frontend secrets are required or allowed. Server-only values live in Cloudflare Pages environment variables/secrets.

## Frontend environment

- `VITE_MEHYARSOFT_API_BASE_URL`: optional public API origin. Empty means same-origin Pages Functions.
- `VITE_TURNSTILE_SITE_KEY`: public Cloudflare Turnstile site key for intake forms.

## Cloudflare function secrets / bindings

- `LEADS_DB`: D1 binding for leads, lead events, and suppression list.
- `INTAKE_KV`: optional KV binding for rate limits and suppression cache.
- `TURNSTILE_SECRET_KEY`: validates public intake form submissions.
- `HMAC_SECRET`: hashes email/IP/user-agent values before D1/KV use.
- `ADMIN_SESSION_SECRET`: signs admin dashboard bearer sessions.
- `MEHYARSOFT_ADMIN_USERNAME`: owner admin login username.
- `MEHYARSOFT_ADMIN_EMAIL`: optional owner admin login email fallback.
- `MEHYARSOFT_ADMIN_PASSWORD`: owner admin login password.
- `ALLOWED_ORIGINS`: comma-separated browser origins allowed by CORS.

## Endpoints used by mehyar-web

### Lead intake / audit / booking request

`POST /api/intake`

Used by the contact form for:

- `form_type: contact` — general lead intake.
- `form_type: audit` — audit request.
- `form_type: booking` — booking setup/request call.

Payload fields:

- `form_type`: `contact | audit | booking | newsletter | phone_help`
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

Used by `/#/unsubscribe`.

Payload fields:

- `email`: string, required
- `reason`: string, optional
- `source`: string, required by frontend for attribution

Behavior:

- HMAC-hashes the email before storing.
- Inserts into `suppression_list` with `INSERT OR IGNORE`.
- Caches `suppression:email:{hash}` in KV when `INTAKE_KV` is bound.

### Admin login

`POST /api/admin/auth/login`

Used by `/#/admin`.

Payload fields:

- `username` or `email`: string
- `password`: string

Expected response:

- `token`: signed short-lived bearer token
- `expiresAt`: ISO timestamp

### Admin metrics

`GET /api/admin/metrics`

Headers:

- `Authorization: Bearer <admin-session-token>`

Expected response:

- `leads`: number
- `contactRequests`: number
- `auditRequests`: number
- `bookingRequests`: number
- `newsletterRequests`: number
- `suppressions`: number
- `updatedAt`: ISO timestamp

## Alignment notes for mehyar-api

If `mehyar-api` becomes the public origin at `https://api.mehyar.us`, it should either mirror these `/api/...` routes or provide a compatibility Worker that maps:

- `/api/intake` to the canonical lead/audit/booking intake handler.
- `/api/suppressions/unsubscribe` to suppression insert.
- `/api/admin/auth/login` and `/api/admin/metrics` to owner-only admin endpoints.

The frontend can switch origins by setting `VITE_MEHYARSOFT_API_BASE_URL`; no code changes should be required.
