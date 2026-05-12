# MehyarSoft Owner-Only Admin Dashboard Plan

Status: implementation plan / auth boundary
Target owner email/login: `mrswelim@gmail.com`
Public site: `https://mehyar.us`
Current deploy mode: static GitHub Pages build from `dist/public`

## 1. Objective

Build a private admin-only command dashboard for MehyarSoft lead generation and conversion operations without exposing credentials, lead data, analytics data, or internal event logs in the frontend bundle or Git history.

The dashboard should report:

- Leads
- Source channels
- Outreach activity
- Conversion funnel
- Analytics
- Site events

## 2. Non-negotiable security boundary

The existing public React bundle must never contain:

- The owner password or password hash
- Session signing secrets
- API tokens
- Lead records or raw PII
- Internal outreach or analytics event logs
- Admin-only route data embedded as static JSON

All admin reads/writes must cross a server-side boundary that verifies an authenticated owner session before returning data.

## 3. Recommended architecture

Because the current production site is static GitHub Pages, the admin system should be Cloudflare-native and separated from the public bundle:

- Public site: GitHub Pages remains the marketing frontend for `mehyar.us` until/unless moved later.
- Admin/API boundary: Cloudflare Worker at a protected route or subdomain, e.g. `https://admin.mehyar.us` or `https://mehyar.us/admin-api/*` if DNS/proxying supports it.
- Storage:
  - Cloudflare D1 for structured leads, outreach, conversion stages, site events, and rollups.
  - Cloudflare KV only for short-lived session records or rate-limit counters when needed.
  - Cloudflare Analytics/Web Analytics for anonymous traffic metrics, with optional internal event mirror into D1.
- Secrets:
  - `MEHYARSOFT_ADMIN_USERNAME` / `MEHYARSOFT_ADMIN_EMAIL` = `mrswelim@gmail.com`
  - `MEHYARSOFT_ADMIN_PASSWORD_HASH`
  - `MEHYARSOFT_SESSION_SECRET`
  - `MEHYARSOFT_TURNSTILE_SECRET_KEY`
  - `MEHYARSOFT_ADMIN_ALLOWED_IPS` optional allowlist
  - `MEHYARSOFT_D1_DATABASE_ID` / Worker binding config

## 4. Password handling

Use only a password hash secret; never store the password value in Git, frontend code, docs committed to the repo, or static assets.

Implementation rule:

1. Generate an Argon2id hash locally from the owner-provided password.
2. Store the resulting hash as `MEHYARSOFT_ADMIN_PASSWORD_HASH` in Cloudflare Worker secrets, not in `.env` committed files.
3. Compare login attempts server-side in the Worker using a constant-time verification path.
4. If any raw password has appeared in durable docs, tickets, logs, or Git, treat it as burned and rotate before production use.

Example command shape only; do not commit output:

```bash
# Use a local one-off script or password manager to produce an Argon2id hash.
# Store only the hash in Cloudflare secrets.
wrangler secret put MEHYARSOFT_ADMIN_PASSWORD_HASH
wrangler secret put MEHYARSOFT_SESSION_SECRET
```

## 5. Auth flow

Minimum v1 owner auth:

1. `GET /admin` serves the admin login shell only; it contains no private data.
2. `POST /admin-api/login`
   - Validate username/email against `MEHYARSOFT_ADMIN_USERNAME` / `MEHYARSOFT_ADMIN_EMAIL`; production owner login is `mrswelim@gmail.com`.
   - Verify password against `MEHYARSOFT_ADMIN_PASSWORD_HASH`.
   - Rate-limit by IP and username.
   - On success, issue an HttpOnly, Secure, SameSite=Strict session cookie.
3. `GET /admin-api/session`
   - Returns authenticated session data only after session verification; owner subject is `mrswelim@gmail.com`.
4. `POST /admin-api/logout`
   - Invalidates the session record and clears the cookie.
5. Every dashboard endpoint must call `requireAdminSession()` before reading D1.

Session cookie requirements:

- HttpOnly
- Secure
- SameSite=Strict
- Short idle expiry, e.g. 2 hours
- Absolute expiry, e.g. 12 hours
- Signed session id or opaque random id stored server-side

Optional hardening:

- Cloudflare Access in front of `/admin` as an outer gate.
- IP allowlist via `MEHYARSOFT_ADMIN_ALLOWED_IPS`.
- Turnstile on login after failed attempt threshold.
- Login event audit trail in D1 without storing password attempts.

## 6. Data model v1

D1 tables:

```sql
CREATE TABLE leads (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  name TEXT,
  email TEXT,
  phone TEXT,
  company TEXT,
  message TEXT,
  source_channel TEXT NOT NULL DEFAULT 'website',
  consent_status TEXT NOT NULL DEFAULT 'unknown',
  status TEXT NOT NULL DEFAULT 'new',
  owner_notes TEXT
);

CREATE TABLE outreach_events (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  lead_id TEXT,
  channel TEXT NOT NULL,
  direction TEXT NOT NULL,
  subject TEXT,
  outcome TEXT,
  campaign_id TEXT,
  FOREIGN KEY (lead_id) REFERENCES leads(id)
);

CREATE TABLE conversion_events (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  lead_id TEXT,
  from_stage TEXT,
  to_stage TEXT NOT NULL,
  amount_cents INTEGER,
  notes TEXT,
  FOREIGN KEY (lead_id) REFERENCES leads(id)
);

CREATE TABLE site_events (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  event_name TEXT NOT NULL,
  path TEXT,
  source_channel TEXT,
  anonymous_visitor_id TEXT,
  lead_id TEXT,
  metadata_json TEXT,
  FOREIGN KEY (lead_id) REFERENCES leads(id)
);

CREATE TABLE admin_audit_events (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  admin_user TEXT NOT NULL,
  action TEXT NOT NULL,
  ip_hash TEXT,
  user_agent_hash TEXT,
  metadata_json TEXT
);
```

PII rule: keep raw PII only in `leads`; use IDs or aggregate counts elsewhere when possible.

## 7. Admin API endpoints

Auth/session:

- `POST /admin-api/login`
- `POST /admin-api/logout`
- `GET /admin-api/session`

Dashboard:

- `GET /admin-api/metrics/summary?range=7d|30d|90d`
  - lead count
  - new leads
  - qualified leads
  - outreach count
  - conversion count
  - estimated pipeline value
- `GET /admin-api/metrics/sources?range=...`
  - channel-level lead and conversion counts
- `GET /admin-api/metrics/funnel?range=...`
  - new → contacted → qualified → proposal → won/lost
- `GET /admin-api/leads?status=&source=&limit=&cursor=`
- `GET /admin-api/leads/:id`
- `PATCH /admin-api/leads/:id`
- `GET /admin-api/site-events?range=&event=&limit=&cursor=`
- `GET /admin-api/outreach?range=&leadId=&limit=&cursor=`
- `GET /admin-api/audit?range=&limit=&cursor=`

All endpoints must return no-store cache headers:

```http
Cache-Control: no-store
Pragma: no-cache
```

## 8. Frontend dashboard pages

Recommended private React routes, served only after the Worker gate:

- `/admin/login`
- `/admin`
  - KPI cards: leads, contacted, qualified, won, pipeline value
  - 7/30/90 day range selector
- `/admin/leads`
  - searchable lead table
  - status/source filters
- `/admin/leads/:id`
  - lead profile, notes, conversion history, outreach history
- `/admin/sources`
  - source channel performance
- `/admin/outreach`
  - outreach timeline and outcome counts
- `/admin/events`
  - site event stream
- `/admin/audit`
  - owner login/action audit

The public navbar should not link to `/admin`. The route may exist, but obscurity is not security; auth is enforced server-side.

## 9. Lead capture integration

When the public contact/intake form is upgraded, it should submit to a Worker endpoint:

- `POST /api/leads`
  - Turnstile verification
  - input validation with Zod-compatible schema
  - consent checkbox captured explicitly
  - source channel attribution from UTM/referrer where available
  - insert into D1
  - notify `mrswelim@gmail.com` through approved email path
  - write `site_events` row for `lead_submitted`

Do not send raw secrets to the client. Use only public Turnstile site key in frontend.

## 10. Compliance and outreach guardrails

Before any campaign/outreach features are added:

- Add suppression list storage.
- Add opt-out capture and enforcement.
- Preserve source/consent metadata for every lead.
- Require audit log for status changes and owner actions.
- Do not build mass sending into dashboard v1; show metrics and manual workflow first.

Control before scale.

## 11. Build phases

### Phase 0 — secret hygiene

- Remove any raw password references from committed/planned artifacts.
- Rotate owner password if it appeared in a durable place.
- Generate and store `MEHYARSOFT_ADMIN_PASSWORD_HASH` as a Worker secret.
- Store `MEHYARSOFT_SESSION_SECRET` as a Worker secret.

Acceptance:

- `git grep` finds no password value or hash.
- Frontend bundle contains no admin secret env values.

### Phase 1 — Cloudflare Worker + D1 skeleton

- Add Worker project or `/worker` package.
- Create D1 database and migrations.
- Implement `/healthz` endpoint.
- Implement no-store headers for admin APIs.

Acceptance:

- Worker deploys.
- `/healthz` returns 200.
- D1 migration applies cleanly.

### Phase 2 — owner login boundary

- Implement login/session/logout.
- Add rate limiting.
- Add audit events for login success/failure and logout.
- Add protected endpoint test fixture.

Acceptance:

- Unauthenticated admin API returns 401.
- Authenticated owner session can access protected endpoint.
- Cookie is HttpOnly/Secure/SameSite=Strict.

### Phase 3 — metrics APIs

- Implement summary, sources, funnel, site events, outreach, and lead list endpoints.
- Seed local/dev D1 with fake non-PII test data only.

Acceptance:

- Metrics endpoints return typed JSON.
- No private data returned without auth.
- Empty production DB displays zero-state cleanly.

### Phase 4 — dashboard UI

- Build private admin UI using existing React/shadcn/Recharts stack.
- Add login page and protected dashboard shell.
- Add KPI cards, charts, lead table, and event stream.

Acceptance:

- Dashboard works in local dev against Worker APIs.
- Public site navigation and SEO pages remain unchanged.
- Admin shell never embeds private data in static HTML.

### Phase 5 — deploy + smoke tests

- Deploy Worker with secrets.
- Deploy public site.
- Run live smoke tests:
  - public site loads
  - admin unauthenticated returns 401/redirect
  - login succeeds only with owner credential
  - dashboard metrics load after auth
  - logout invalidates session

Acceptance:

- No secret exposure in GitHub Actions logs.
- No admin data in public bundle.
- Acceptance reviewer can verify auth protection.

## 12. Verification checklist

Security:

- [ ] No password or hash committed
- [ ] No session secret committed
- [ ] No admin API response without `requireAdminSession()`
- [ ] Cookies are HttpOnly/Secure/SameSite=Strict
- [ ] Admin API cache headers are `no-store`
- [ ] Failed login rate limiting exists
- [ ] Audit events exist for admin auth/actions

Data:

- [ ] Leads table stores consent/source metadata
- [ ] Outreach metrics distinguish manual vs automated actions
- [ ] Conversion events preserve funnel stage history
- [ ] Site events avoid unnecessary raw PII

Operations:

- [ ] Cloudflare Worker secrets configured
- [ ] D1 migrations documented
- [ ] Local dev uses fake test data only
- [ ] Live smoke test documented
- [ ] Rollback path documented

## 13. Rollback plan

- Keep public marketing site deploy independent from Worker admin deploy.
- If admin Worker fails, disable/rollback Worker route without touching public GitHub Pages site.
- Retain previous D1 migration backup/export before schema changes.
- Rotate `MEHYARSOFT_SESSION_SECRET` to invalidate sessions if auth bug is suspected.

## 14. Owner decisions needed before implementation

1. Host admin at `admin.mehyar.us` or under `mehyar.us/admin`?
2. Use Cloudflare Access as an outer gate in addition to password login?
3. Allow only owner IPs for admin login, or keep password-only with rate limiting?
4. Should v1 only display metrics, or also allow editing lead status/notes?
