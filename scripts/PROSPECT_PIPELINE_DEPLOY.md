# Prospect pipeline — deploy + token setup

Everything in this PR is **local-verified** (`npm run test:prospects`), but pushing migration `0006` and deploying Pages requires a **scoped Cloudflare API Token** with D1 Edit + Pages Edit + KV Edit permissions. The existing `CLOUDFLARE_API_TOKEN` env in Hermes is actually the legacy Global API Key (37 chars), and Cloudflare rotated D1 to require scoped tokens in 2024.

## One-shot token (5 minutes)

1. Visit https://dash.cloudflare.com/profile/api-tokens
2. **Create Token** → **Edit Cloudflare Pages** template:
   - Permissions: `Account / Cloudflare Pages: Edit`, `Account / D1: Edit`, `Account / Workers KV Storage: Edit`
   - Account Resources: include your account (`621600637337cc1c9ecb7095508bc732`)
   - Zone Resources: include `mehyar.us` zone
3. Copy the 40-char token to your shell:
   ```bash
   # wipe the bad global-key alias and set the real scoped token
   unset CLOUDFLARE_API_TOKEN CLOUDFLARE_API_KEY
   export CLOUDFLARE_API_TOKEN='the-40-char-scoped-token-you-just-created'
   ```
4. Run:
   ```bash
   cd mehyar-web
   npx wrangler d1 migrations apply mehyar_leads_prod --remote      # apply 0006
   npm run deploy:pages:local                                       # upload Pages Functions + UI
   ```
5. Confirm `https://mehyar.us/api/health` returns `{ok:true,environment:"production"}` — it already does ✅

## Secrets to set in Cloudflare Pages project

Once token access works, set these (do **not** commit to wrangler.toml):

```
LEADS_DB binding          → already in wrangler.toml (D1)
INTAKE_KV binding         → already in wrangler.toml (KV)
HMAC_SECRET               → wrangler secret put HMAC_SECRET
TURNSTILE_SECRET_KEY      → wrangler secret put TURNSTILE_SECRET_KEY
RESEND_API_KEY            → wrangler secret put RESEND_API_KEY
LLM_API_KEY               → wrangler secret put LLM_API_KEY         # gpt-4o-mini default
LLM_MODEL                 → wrangler secret put LLM_MODEL=gpt-4o-mini (or env var ok)
LLM_BASE_URL              → wrangler secret put LLM_BASE_URL=https://api.openai.com/v1/chat/completions
CONTACT_FROM_EMAIL        → already in wrangler.toml (leads@mehyar.us)
CONTACT_TO_EMAIL          → already in wrangler.toml
CONTACT_REPLY_TO          → wrangler secret put CONTACT_REPLY_TO=info@mehyar.us
PROSPECT_TEST_BCC         → wrangler secret put PROSPECT_TEST_BCC=mrswelim@gmail.com
```

## How to drive the pipeline

1. POST `https://mehyar.us/api/prospects/seed` with `{ "sources": ["csv"], "items": [{business_name,website,vertical,city,email}] }`
2. POST `https://mehyar.us/api/prospects/scan` with `{ "prospect_id": "<id>" }` for each (or loop)
3. POST `https://mehyar.us/api/prospects/draft` with `{ "prospect_id": "<id>" }`
4. Visit `https://mehyar.us/admin/prospects` and click **Approve & Send** (toggle "Test mode" on for the first batch)
5. Watch for replies at `info@mehyar.us`, paste them into prospect_replies via the admin endpoint

## Daily-loop cron (after manual warm-up of 5→10→25)

Once 200+ emails have been delivered without complaints:

- Create a Cloudflare Cron Trigger on the Pages project that calls `/api/prospects/seed` (mode `ny_dos`) at 7am ET, then `/api/prospects/scan` in a queue loop until 25 drafts are queued, then `/api/prospects/send` approves the next 25 and dispatches. (Each call is one D1 row update, but bulk scheduling belongs in a `daily-outreach-runner.js` CF Cron Trigger — the next PR.)

## Warm-up schedule (Resend's guidance baked into send.js)

- Week 1: ≤ 5/day, test-only (to `mrswelim@gmail.com`)
- Week 2: ≤ 10/day, BCC visible to founder
- Week 3: ≤ 25/day, real recipients
- Week 4: ≤ 50/day — current cap in `GOV_INGEST_LIMIT` config (rename later)

## Quick sanity — `npm run test:prospects`

Verifies scanner + drafter against real public sites (5 NYC service businesses) and prints the leak signals + draft subject lines to stdout. Doesn't touch Cloudflare.
