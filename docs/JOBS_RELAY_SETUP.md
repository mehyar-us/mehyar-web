# Mayor Jobs tab — jobs-relay setup

The **💼 Jobs** tab in the admin dashboard (`/admin/jobs` on dashboard.mehyar.us)
talks to mehyar.jobs through a same-origin relay:

```
browser → https://dashboard.mehyar.us/api/jobs-relay/admin/email/gate
          → (Pages Function) https://jobs.mehyar.us/api/admin/email/gate
```

The browser never calls `jobs.mehyar.us` or `api.smtp2go.com` directly — those
calls would be CORS-blocked on the jobs side, and provider keys must never live
in browser code. The dashboard admin `Bearer` token is forwarded verbatim by
`functions/api/jobs-relay/[[path]].js` and verified server-side on mehyar.jobs.

## One-time auth setup (required before the tab shows data)

mehyar-jobs verifies the forwarded admin token with `env.MESC_JWT_SECRET`
(fallback `ADMIN_JWT_SECRET`), expecting the same 2-part HMAC token that
mehyar-web's `/api/admin/auth/login` issues — signed with mehyar-web's
`ADMIN_SESSION_SECRET`.

**So the secret on the mehyar-jobs Pages project must equal mehyar-web's
`ADMIN_SESSION_SECRET`.**

Cloudflare dashboard:
1. Open the **mehyar-web** Pages project → Settings → Variables and secrets → find `ADMIN_SESSION_SECRET`, copy its value.
2. Open the **mehyar-jobs** Pages project → Settings → Variables and secrets → add a secret named `MESC_JWT_SECRET` with that same value (secret type, not plain text).
3. Save — secret changes take effect on the next deployment (or immediately for Pages secrets, redeploy to be safe).

CLI alternative (same effect):

```bash
# from the mehyar-web checkout — copy the secret value, then:
echo -n '<ADMIN_SESSION_SECRET value>' | wrangler pages secret put MESC_JWT_SECRET --project-name=mehyar-jobs
```

Until the secrets match, every jobs-relay call returns **401** and the tab shows
an auth error — that is the intended failure mode, not a bug.

## How to test

Get a dashboard admin token, then hit the relay:

```bash
TOKEN=$(curl -s -X POST https://dashboard.mehyar.us/api/admin/auth/login \
  -H 'content-type: application/json' \
  -d '{"username":"<owner-username>","password":"<owner-password>"}' | jq -r .token)

curl -s -H "authorization: Bearer $TOKEN" \
  https://dashboard.mehyar.us/api/jobs-relay/admin/email/gate | head -c 500
```

Expected: `{"ok":true,"gate":{...},"levels":[...]}`.
A 401 means the secrets don't match yet (see above). A 502 means
jobs.mehyar.us is unreachable.

## Endpoints behind the tab

| Relay path                              | jobs.mehyar.us upstream                          |
|-----------------------------------------|--------------------------------------------------|
| `GET  /api/jobs-relay/admin/email/gate` | `GET  /api/admin/email/gate`                     |
| `POST /api/jobs-relay/admin/email/wire-up` | `POST /api/admin/email/wire-up`               |
| `GET  /api/jobs-relay/admin/email/campaign-report?date=YYYY-MM-DD` | `GET /api/admin/email/campaign-report?...` |
| `GET  /api/jobs-relay/admin/email/product-stats` | `GET  /api/admin/email/product-stats`         |
| `GET  /api/jobs-relay/admin/email/brain-plan?date=YYYY-MM-DD` | `GET  /api/admin/email/brain-plan?...` |

## Deployment note

The relay is a Pages Function in this repo (`functions/api/jobs-relay/`), so it
ships with the normal push-to-main → Cloudflare Pages deploy. `git push` from
this sandbox is blocked (read-only credential) — Mayor pushes from his machine.

## Guardrails (standing)

- The wire-up endpoint **arms** the daily sender; it **never sends email** and
  **never flips EMAIL_LIVE**. The tab copy states this next to the button.
- `EMAIL_LIVE` stays Mayor's explicit manual action — no automation path touches it.
