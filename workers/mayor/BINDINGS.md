# mehyar-mayor live bindings — verified via Cloudflare API 2026-10-06

## Bindings (from worker settings)

| Type | Name | Notes |
|---|---|---|
| d1 | `AGENT_DB` | → `mehyar-mayor` (701b5ade-…) |
| ai | `AI` | Workers AI |
| assets | `ASSETS` | Frontend |
| durable_object_namespace | `MAYOR_PHONE` | Call state (class TBD) |
| durable_object_namespace | `MAYOR_VOICE` | Voice session state (class TBD) |
| send_email | `MAYOR_EMAIL` | From `team@mehyar.us` |
| plain_text | `APP_ORIGIN` | https://mayor.mehyar.us |
| plain_text | `ENVIRONMENT` | production |
| plain_text | `MAYOR_EMAIL_FROM` | team@mehyar.us |
| plain_text | `GOOGLE_ENABLED_CAPABILITIES` | — |
| plain_text | `MICROSOFT_ENABLED_CAPABILITIES` | — |
| secret_text | `BETTER_AUTH_SECRET` | — |
| secret_text | `GOOGLE_CLIENT_ID/SECRET` | — |
| secret_text | `MICROSOFT_CLIENT_ID/SECRET` | — |
| secret_text | `TELNYX_CLIENT_ID` (+ secret per bundle) | — |
| secret_text | `MAYOR_STRIPE_*` | Own Stripe acct: secret, webhook secret, account id, price ids (plan, audit, credit S/M/L), portal config, mode |
| secret_text | `MAYOR_AUDIT_STATUS_SECRET`, `MAYOR_AUDIT_FULFILLMENT_READY` | — |

## Related D1 databases (same account)

- `mehyar-mayor` — 701b5ade-45a6-491a-889d-42d79f6f59a0 (2026-09-22) ← AGENT_DB
- `mayor-audit-db-e9ab8fbf4db9` — 020e48a8-… (2026-10-05)
- `mayor-audit-paid-db-c78fc3c78fec` — adf30aa5-… (2026-10-05)

## DNS

`mayor.mehyar.us` → AAAA `100::`, proxied (Worker route).
