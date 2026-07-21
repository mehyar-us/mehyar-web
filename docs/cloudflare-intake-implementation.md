# MehyarSoft Cloudflare intake implementation notes

Status: implementation artifact for `t_358804fe`

## Shipped locally

- `functions/api/health.js` exposes `GET /api/health` with the documented JSON health contract.
- `functions/api/intake.js` exposes `POST /api/intake` with:
  - origin allowlist;
  - JSON validation and string caps;
  - required `consent_contact`;
  - separate optional marketing consent;
  - honeypot handling;
  - server-side Turnstile verification;
  - HMAC hashes for IP, email, user-agent, and duplicate fingerprints;
  - KV-backed IP/email/duplicate rate limits;
  - D1 `leads`, `lead_events`, and `suppression_list` integration;
  - Cloudflare Send Email binding support with Resend fallback;
  - audit events without raw request bodies;
  - generic safe browser messages.
- `migrations/0001_cloudflare_intake.sql` contains the D1 baseline schema.
- `wrangler.toml` defines Pages output, required variable names, and binding names. Replace placeholder D1/KV ids in Cloudflare before production deploy.
- `.github/workflows/deploy-cloudflare-pages.yml` builds, checks, runs intake unit tests, and deploys Pages + Functions with GitHub secrets.
- Contact UI now submits to `/api/intake`, requires consent, loads Turnstile from `VITE_TURNSTILE_SITE_KEY`, and keeps `info@mehyar.us` as fallback.

## Required Cloudflare production setup before live acceptance

1. Create D1 database `mehyar_leads_prod` and replace `database_id` in `wrangler.toml`.
2. Apply `migrations/0001_cloudflare_intake.sql` remotely.
3. Create KV namespace `mehyar_intake_kv_prod` and replace `id` in `wrangler.toml`.
4. Create Turnstile widget `mehyar-web-contact` and configure:
   - public Pages variable: `VITE_TURNSTILE_SITE_KEY`
   - Pages secret: `TURNSTILE_SECRET_KEY`
5. Configure Pages variables/secrets:
   - `CONTACT_TO_EMAIL`
   - `CONTACT_FROM_EMAIL`
   - `ALLOWED_ORIGINS`
   - `ENVIRONMENT`
   - `HMAC_SECRET`
   - optional fallback `RESEND_API_KEY`
6. Enable Workers Send Email binding `NOTIFY_EMAIL` if available, or configure Resend fallback.
7. Add GitHub Actions secrets:
   - `CLOUDFLARE_ACCOUNT_ID`
   - `CLOUDFLARE_API_TOKEN`
8. Deploy Cloudflare Pages from `main` and point `mehyar.us` to the Pages project after smoke tests pass.

## Verification commands

```bash
npm run check
npm run test:intake
CUSTOM_DOMAIN=true NODE_ENV=production npm run build:client
```

Live acceptance after Cloudflare resources exist:

```bash
curl -fsS https://mehyar.us/api/health
# Submit one non-sensitive test lead through the browser form with Turnstile.
# Verify D1 has the lead and lead_events rows.
# Verify notification arrives or records a non-secret not_configured/failed status for fallback remediation.
```

## Security notes

- Do not log request bodies or form values in Cloudflare console.
- Do not commit real D1 ids, KV ids, Turnstile secrets, API tokens, or email API keys if the repository is public.
- Frontend may only receive `VITE_TURNSTILE_SITE_KEY`, which is public by design.
