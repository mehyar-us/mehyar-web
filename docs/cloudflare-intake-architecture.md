# MehyarSoft Cloudflare-native intake architecture

Status: design artifact for `t_f289f749`
Owner: DevOps / Infrastructure
Live site today: `https://mehyar.us`
Repo: `mehyar-us/mehyar-web`
Contact inbox: `mrswelim@gmail.com`

## 1. Goal

Replace the current `mailto:` contact flow with a low-cost Cloudflare-native intake stack that:

- accepts contact forms, audit requests, newsletter/signup interest, and future lead magnets;
- blocks commodity spam with Turnstile, validation, rate limiting, and honeypots;
- stores consent-safe lead records and audit logs;
- sends lead notifications/routing to `mrswelim@gmail.com` without exposing that mailbox in frontend code;
- supports an owner-only admin dashboard in a later task;
- deploys through GitHub Actions with secrets stored only in Cloudflare/GitHub, never in the repo.

## 2. Recommended lowest-cost stack

Use Cloudflare Pages for the React/Vite frontend and Cloudflare Pages Functions for `/api/*` endpoints. Pages Functions run on Workers, so this gives the project a single Cloudflare application while keeping the existing static site model.

Free-tier path:

- Cloudflare Pages: static frontend hosting and preview deployments.
- Pages Functions / Workers: `/api/intake`, `/api/health`, future admin API.
- Cloudflare Turnstile: bot prevention on all public forms.
- Cloudflare D1: canonical lead/contact database.
- Cloudflare KV: lightweight rate-limit counters, nonce/idempotency cache, suppression flags.
- Cloudflare Email Routing: free inbound aliases like `contact@mehyar.us` -> `mrswelim@gmail.com`.
- Cloudflare Workers Send Email binding if enabled on the account; otherwise Resend free tier as the only non-Cloudflare fallback for outbound form notifications.
- Cloudflare Web Analytics: page analytics without client PII harvesting.

Expected monthly infrastructure cost for v1: `$0` on normal MehyarSoft lead volume. The only likely non-zero future item is outbound email if notification volume exceeds the free provider quota.

## 3. High-level flow

```text
Visitor
  -> https://mehyar.us contact/signup/audit form
  -> Turnstile widget returns token
  -> POST /api/intake
      1. CORS/origin check for mehyar.us + Cloudflare preview domains
      2. Validate JSON body and required consent fields
      3. Verify Turnstile token server-side
      4. Apply KV rate limits by IP hash + email hash + form type
      5. Normalize and classify lead
      6. Insert lead into D1
      7. Append audit event into D1
      8. Send notification to mrswelim@gmail.com
      9. Return generic success response with lead_id
  -> Owner reviews leads in future protected admin dashboard
```

No raw secrets or mailbox credentials are shipped to the browser. Frontend only receives public values such as the Turnstile site key and API path.

## 4. Cloudflare resources

### Pages project

Suggested project name: `mehyar-web`

Build settings:

- Framework preset: Vite
- Build command: `npm ci && npm run build:client`
- Build output directory: `dist/public`
- Production branch: `main`
- Custom domain: `mehyar.us`
- Node version: `18` or `20`

### Functions / Worker endpoints

Implement as Pages Functions:

```text
functions/api/health.ts        GET    public health check
functions/api/intake.ts        POST   public form intake
functions/api/admin/*.ts       future owner-only admin endpoints
```

Recommended response contract for `POST /api/intake`:

```json
{
  "ok": true,
  "lead_id": "uuid-or-ulid",
  "message": "Thanks — your request was received."
}
```

Return the same safe message for most validation/rate-limit failures to avoid giving spammers precision. Log detailed reasons server-side only.

### D1 database

Suggested database name: `mehyar_leads_prod`
Binding name: `LEADS_DB`

Minimum v1 schema:

```sql
CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  source TEXT NOT NULL DEFAULT 'website',
  form_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  name TEXT,
  email TEXT NOT NULL,
  phone TEXT,
  company TEXT,
  website TEXT,
  service_interest TEXT,
  budget_range TEXT,
  timeline TEXT,
  message TEXT,
  consent_contact INTEGER NOT NULL DEFAULT 0,
  consent_marketing INTEGER NOT NULL DEFAULT 0,
  ip_hash TEXT,
  user_agent_hash TEXT,
  referrer TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  turnstile_passed INTEGER NOT NULL DEFAULT 0,
  notification_status TEXT NOT NULL DEFAULT 'pending',
  notification_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email);
CREATE INDEX IF NOT EXISTS idx_leads_form_type ON leads(form_type);

CREATE TABLE IF NOT EXISTS lead_events (
  id TEXT PRIMARY KEY,
  lead_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'system',
  metadata_json TEXT,
  FOREIGN KEY (lead_id) REFERENCES leads(id)
);

CREATE TABLE IF NOT EXISTS suppression_list (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  type TEXT NOT NULL,
  value_hash TEXT NOT NULL,
  reason TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'system'
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_suppression_type_value ON suppression_list(type, value_hash);
```

PII policy: store submitted lead details that are needed for business follow-up, but hash IP/user-agent for abuse controls. Do not store full IP addresses unless there is a documented legal/compliance reason.

### KV namespace

Suggested namespace name: `mehyar_intake_kv_prod`
Binding name: `INTAKE_KV`

Use cases:

- `ratelimit:ip:<sha256>` counters, TTL 10-60 minutes;
- `ratelimit:email:<sha256>` counters, TTL 24 hours;
- `idempotency:<request_hash>` to avoid duplicate form resubmits, TTL 24 hours;
- `suppression:email:<sha256>` fast lookup cache, TTL 24 hours.

### Turnstile

Widget name: `mehyar-web-contact`

Frontend public env:

- `VITE_TURNSTILE_SITE_KEY` — public, safe for frontend.

Worker secret:

- `TURNSTILE_SECRET_KEY` — secret, never committed.

Server verification endpoint:

```text
POST https://challenges.cloudflare.com/turnstile/v0/siteverify
```

Validation inputs:

- `secret`: `TURNSTILE_SECRET_KEY`
- `response`: token submitted by browser
- `remoteip`: optional; only pass Cloudflare client IP if policy allows, never store it raw.

### Email routing and notification

Two-part email plan:

1. Inbound/routing, free and Cloudflare-native:
   - Enable Cloudflare Email Routing for `mehyar.us`.
   - Add destination address `mrswelim@gmail.com` and complete destination verification.
   - Create aliases:
     - `contact@mehyar.us` -> `mrswelim@gmail.com`
     - `leads@mehyar.us` -> `mrswelim@gmail.com`
     - `audit@mehyar.us` -> `mrswelim@gmail.com`
   - Use these aliases in website copy if a direct email fallback is needed.

2. Form notification from Worker:
   - Preferred: Cloudflare Workers Send Email binding, if available on the account.
   - Binding name: `NOTIFY_EMAIL`.
   - Destination: `mrswelim@gmail.com`.
   - From/reply-to: use a domain alias such as `leads@mehyar.us`; set visitor email as `Reply-To`, not as `From`.
   - If Send Email binding is unavailable, use Resend free tier as fallback with secret `RESEND_API_KEY` and verified domain `mehyar.us`.

Notification body must avoid raw secret values and should include:

- lead id;
- form type;
- name/company/email/phone if submitted;
- service interest;
- short message preview;
- source/referrer/UTM;
- admin review URL once admin dashboard exists.

## 5. Required secrets and variables

### Existing project-local credential names

The local project env already exposes these names; use values without printing them:

- `MEHYARSOFT_CLOUDFLARE_ACCOUNT_ID`
- `MEHYARSOFT_CLOUDFLARE_API_KEY`
- `MEHYARSOFT_CLOUDFLARE_EMAIL`
- `MEHYARSOFT_GITHUB_TOKEN` / `MEHYARSOFT_GH_TOKEN`
- `MEHYARSOFT_SITE_DOMAIN`
- `MEHYARSOFT_CONTACT_EMAIL`

### GitHub Actions repository secrets

Required for Cloudflare Pages deployment:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN` — least-privilege token with Cloudflare Pages edit/deploy permissions, D1/KV read as needed for migrations.

Required only if GitHub Actions runs D1 migrations:

- `CLOUDFLARE_DATABASE_ID` or the D1 database id in `wrangler.toml`.

Do not use the legacy global API key in CI if a scoped API token can be created.

### Cloudflare Pages environment variables

Production variables:

- `CONTACT_TO_EMAIL` = `mrswelim@gmail.com`
- `CONTACT_FROM_EMAIL` = `leads@mehyar.us`
- `ALLOWED_ORIGINS` = `https://mehyar.us,https://www.mehyar.us`
- `ENVIRONMENT` = `production`
- `VITE_TURNSTILE_SITE_KEY` = public Turnstile site key

Preview variables:

- `ALLOWED_ORIGINS` should include Cloudflare Pages preview host patterns or exact preview URLs.
- `ENVIRONMENT` = `preview`
- a separate Turnstile site key may be used if desired.

### Cloudflare Pages / Worker secrets

- `TURNSTILE_SECRET_KEY`
- `ADMIN_PASSWORD_HASH` — for future admin dashboard only; never commit the plaintext password.
- `SESSION_SECRET` — for future admin sessions.
- `RESEND_API_KEY` — fallback only if Cloudflare Send Email binding is unavailable.
- `HMAC_SECRET` — optional but recommended for hashing emails/IPs consistently without exposing raw values.

### Cloudflare bindings

`wrangler.toml` / Pages Functions binding names:

```toml
name = "mehyar-web"
compatibility_date = "2026-05-11"
pages_build_output_dir = "dist/public"

[[d1_databases]]
binding = "LEADS_DB"
database_name = "mehyar_leads_prod"
database_id = "<cloudflare-d1-database-id>"

[[kv_namespaces]]
binding = "INTAKE_KV"
id = "<cloudflare-kv-namespace-id>"

# Enable only if Cloudflare account supports Workers Send Email binding.
# [[send_email]]
# name = "NOTIFY_EMAIL"
# destination_address = "mrswelim@gmail.com"
```

## 6. API design details

### Intake payload

Allow a single endpoint with `form_type` so the frontend can reuse it across contact, audit, newsletter, and lead magnets:

```ts
type IntakePayload = {
  form_type: "contact" | "audit" | "newsletter" | "phone_help";
  name?: string;
  email: string;
  phone?: string;
  company?: string;
  website?: string;
  service_interest?: string;
  budget_range?: string;
  timeline?: string;
  message?: string;
  consent_contact: boolean;
  consent_marketing?: boolean;
  turnstile_token: string;
  hp_field?: string; // hidden honeypot; must be empty
  utm?: {
    source?: string;
    medium?: string;
    campaign?: string;
  };
};
```

Validation rules:

- reject if honeypot is filled;
- reject if Turnstile fails;
- reject if `email` is missing/invalid;
- reject if `consent_contact` is not true;
- cap strings: name 120 chars, email 254, company 160, website 300, message 3,000;
- only allow known `form_type` values;
- normalize email lowercase/trim;
- strip control characters from text fields.

### Rate limits

Initial limits for small-business lead capture:

- Per IP hash: 5 submissions / 10 minutes.
- Per email hash: 3 submissions / 24 hours.
- Per request fingerprint: 1 accepted duplicate / 24 hours.

Store only hashes in KV. Return generic `202`/success-like response when suppressing obvious spam if the D1 insert is not needed; otherwise return `429` only for clear browser UX.

### Logging and audit

Audit events to write:

- `intake_received`
- `turnstile_failed`
- `rate_limited`
- `lead_created`
- `notification_sent`
- `notification_failed`
- future: `admin_login`, `status_changed`, `export_created`

Do not log full request bodies to Cloudflare console. Console logs should include only lead id, event type, form type, and non-sensitive status.

## 7. Frontend integration plan

Current state:

- `client/src/components/contact-section.tsx` opens a prefilled `mailto:`.
- `client/src/pages/Contact.tsx` only links to `info@mehyar.us`.

Required frontend changes in implementation task:

1. Add Turnstile component to contact/signup forms.
2. Replace `mailto:` submit with `fetch('/api/intake', { method: 'POST', ... })`.
3. Show success/error states without exposing backend details.
4. Keep an email fallback link to `contact@mehyar.us` for visitors who prefer direct mail.
5. Add explicit consent checkbox: `I agree that MehyarSoft LLC may contact me about this request.`
6. Optional marketing consent must be separate and unchecked by default.

## 8. GitHub Actions deployment

Replace or add a Cloudflare Pages deployment workflow after the project is ready to move from GitHub Pages:

```yaml
name: Deploy to Cloudflare Pages

on:
  push:
    branches: [ main ]
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run check
      - run: npm run build:client
      - name: Deploy to Cloudflare Pages
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: pages deploy dist/public --project-name=mehyar-web --branch=main
```

D1 migrations can be run manually first to reduce CI blast radius:

```bash
npx wrangler d1 migrations apply mehyar_leads_prod --remote
```

Only automate migrations after schema stabilizes.

## 9. Security and compliance controls

- No secrets in frontend code; only `VITE_*` public values.
- No plaintext admin password in repo; store only `ADMIN_PASSWORD_HASH` as a secret.
- Use Turnstile on every public write endpoint.
- Require consent before follow-up.
- Keep marketing consent separate from service-request consent.
- Hash IP/user-agent for abuse prevention.
- Maintain `suppression_list` before any outbound campaign system exists.
- Add export/delete process before collecting large volumes of leads.
- Use least-privilege Cloudflare API token for CI/CD.
- Do not send mass outbound campaigns from this intake worker.

## 10. Rollout sequence

1. Create Cloudflare Pages project connected to the GitHub repo.
2. Add custom domain `mehyar.us` and verify DNS.
3. Create Turnstile widget and set `VITE_TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY`.
4. Create D1 database `mehyar_leads_prod`; apply schema.
5. Create KV namespace `mehyar_intake_kv_prod`.
6. Configure Email Routing aliases to `mrswelim@gmail.com`.
7. Enable Send Email binding or configure Resend fallback.
8. Add Pages Functions endpoints and frontend form integration.
9. Deploy preview; test with non-sensitive test lead.
10. Promote production; live-test `https://mehyar.us/api/health` and form submission.
11. Verify notification reaches `mrswelim@gmail.com`.
12. Confirm D1 lead row and audit events exist.
13. Keep GitHub Pages workflow disabled or documented as rollback during cutover.

## 11. Health checks and rollback

Health endpoint response:

```json
{
  "ok": true,
  "service": "mehyar-web-intake",
  "environment": "production"
}
```

Smoke tests:

- `GET https://mehyar.us/api/health` returns `200`.
- Valid Turnstile-backed test submission returns `ok: true`.
- Invalid/missing Turnstile token is rejected.
- D1 contains the test lead.
- Notification arrives in `mrswelim@gmail.com`.
- No secret names or values appear in the built JS bundle except public `VITE_TURNSTILE_SITE_KEY`.

Rollback:

- Keep the current GitHub Pages deployment workflow until Cloudflare Pages is proven.
- DNS rollback: point `mehyar.us` back to GitHub Pages if Cloudflare Pages fails.
- Application rollback: use Cloudflare Pages deployment rollback to previous successful deployment.
- Contact fallback: keep direct `contact@mehyar.us` mail link visible while form intake matures.

## 12. Implementation acceptance criteria

The intake build is complete when:

- Cloudflare Pages deploys the React site and Functions from `main`.
- `/api/health` passes on production.
- `/api/intake` stores a validated lead in D1.
- Turnstile is enforced server-side.
- KV rate limits are active.
- Notification/routing reaches `mrswelim@gmail.com`.
- Email aliases for `contact@`, `leads@`, and `audit@` route to `mrswelim@gmail.com`.
- CI/CD uses GitHub secrets and no secret values are committed.
- Compliance gates exist: consent, suppression table, audit events, no mass-send behavior.
