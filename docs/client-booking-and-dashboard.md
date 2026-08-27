# Client booking and owner dashboard

## Objective

Give clients a real mobile-first booking calendar backed by Zoho Calendar, persist every website request in Cloudflare D1, notify `info@mehyar.us`, and give the owner one authenticated workspace at `dashboard.mehyar.us`.

## Operating assumptions

- Work days are Monday-Friday, 9:00 AM-5:00 PM in `America/New_York`.
- Calls last 30 minutes with a 15-minute collision buffer.
- Clients must book at least 24 hours ahead and no more than 30 days ahead.
- `info@mehyar.us` is the owner mailbox and Zoho identity.
- The existing `mehyar500` owner credential remains the human login. Pages and the API Worker use a separate random service-to-service secret.

## Architecture

1. `/api/calendar/availability` calls the admin-gated Calendar endpoint on `api.mehyar.us`.
2. The Worker refreshes the Zoho token from KV and reads free/busy directly from Zoho Calendar.
3. `/api/calendar/book` validates origin, required consent, Turnstile, email, and requested time.
4. The request and pending appointment are written to the production `LEADS_DB` D1 database before any provider call.
5. The Worker rechecks free/busy, creates the Zoho event, and stores the booking ID in KV for idempotency.
6. Pages records the Zoho identifiers and sends owner/client confirmation through Cloudflare Email Service.
7. `/admin/clients` reads submissions, appointments, and owner replies from D1. Replies require an explicit owner click and are sent from `info@mehyar.us`.

## Data model

- Existing `leads` and `lead_events` remain the canonical intake and audit tables.
- `appointments` stores booking status, client contact fields, selected service, start/end, Zoho identifiers, and email delivery state.
- `client_replies` stores the explicit owner reply, send status, and provider outcome.

No Zoho access token, refresh token, Cloudflare API key, admin password, or service token is returned to browser code or stored in D1.

## API surface

- `GET /api/calendar/availability?days=21`
- `POST /api/calendar/book`
- `GET /api/admin/client-ops`
- `POST /api/admin/client-ops/reply`
- `GET /api/admin/client-ops/zoho?action=status|connect`

Worker-only, admin-gated endpoints:

- `GET /v1/admin/calendar/status`
- `GET /v1/admin/calendar/availability`
- `POST /v1/admin/calendar/book`
- `POST /v1/admin/client-ops/reply`

## Security and privacy

- Turnstile and consent are required before a public booking can be created.
- Requested times are never trusted; the Worker validates work hours and checks Zoho again immediately before creation.
- Booking IDs are idempotent for 90 days.
- Owner dashboard routes require the existing signed admin session.
- The Pages-to-Worker bridge uses a distinct 256-bit secret and does not impersonate the owner login.
- Dashboard replies can only target the email attached to an existing D1 lead.
- Reply sends require `confirm_send: true`, are logged, and do not expose provider credentials.

## Deployment and rollout

1. Apply `migrations/0021_client_booking_and_replies.sql` to `mehyar_leads_prod`.
2. Deploy `workers/mehyarsoft-api` so existing Worker secrets and KV tokens remain in place.
3. Deploy the Pages project.
4. Attach `dashboard.mehyar.us` to the Pages project and proxy its CNAME through Cloudflare.
5. Complete the one-time Zoho OAuth consent for the Calendar scopes listed in the Worker source.
6. Verify live free/busy, create one controlled appointment, confirm D1 rows, and confirm both emails were accepted.

## Test boundaries

- TypeScript, production build, JS syntax, intake form suite, D1 migration, auth rejection, invalid Turnstile rejection, Cloudflare Email Service queue acceptance, Worker health, and responsive UI are automated checks.
- Zoho Calendar authorization and live availability are production-observed. A complete booking should only be claimed after a controlled appointment is observed in Zoho and D1.
