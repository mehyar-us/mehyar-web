# mehyar-mayor API surface — recovered from the deployed bundle (2026-10-06)

Bundle: esbuild output, 6 MB. Route strings below are verbatim from the
bundle; handlers/behavior need the real source to confirm.

## API routes (`/api/*`)

- `GET /api/health`
- `GET /api/reference`
- `GET /api/phone-guide`
- `/api/businesses` — business management
- Auth (`/api/auth/*`): `get-session`, `sign-in/social`, `sign-out`,
  `link-social`, `start/zoho`, `callback/zoho`, `callback/telnyx`,
  `grants`, `grants/attach`, `grants/revoke`, `capabilities`
- Billing: `POST /api/billing/webhook` (own Stripe account — separate
  from the mehyar-web shared checkout)
- Business audit: `/api/business-audit/checkout|offer|report|status`
- Voice/phone: `/api/voice/session`, `/api/phone/*`
  (Telnyx OAuth + phone scopes present; Durable Objects `MAYOR_PHONE`,
  `MAYOR_VOICE` bound — real-time call state)

## App routes (frontend served from worker ASSETS)

`/`, `/chat`, `/business-audit`, `/offer`, `/checkout`, `/account-info`,
`/change-email`, `/change-password`, `/delete-user`, `/forget-password`,
`/get-access-token`, `/get-session`, `/link-social`, `/list-accounts`,
`/list-sessions`, `/authorize`, `/error`, `/mcp`, `/ok`, `/read`

## Notes

- Auth: Better Auth with Google + Microsoft social login, Zoho OAuth.
- Voice stack: Telnyx (OAuth, phone scopes), voice agent pipeline with
  audio format config, number routing, call verification. The voice
  scaffolding from the Oct 4–5 deploys is real but its wiring status
  (working vs stub) needs the source to verify.
- The worker has its OWN Stripe billing (`MAYOR_STRIPE_*`), distinct
  from mehyar-web's shared `/api/pay` checkout. Unify or document why
  they differ before touching either.
