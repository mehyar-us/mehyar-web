# MehyarSoft Government Opportunity Engine — Final Acceptance QA

Run timestamp: 2026-05-14T01:08:15Z
Scope: daily ingest results, relevance scoring, dedupe, admin filters/status notes, detail workspace, drafting-assist guardrails, protected API behavior, and live production smoke tests.

## Executive verdict

NO-GO for final acceptance.

Local work-in-progress now contains a government opportunity module, tests, migrations, and admin UI scaffolding, but the feature does not meet final acceptance yet. Production is still missing the government opportunity route/API, the local frontend API contract does not match the local Pages Function routes, and no live production record count can be verified. The “at least 20 relevant stored records” criterion is not satisfied.

## What passed

### Local static/type/build checks

- `npm run check`: PASS.
- `npm run build`: PASS.
- `node scripts/test-gov-opportunities.mjs`: PASS.
  - Covered mocked USAspending normalization, SAM normalization, fit scoring, dedupe upsert, admin auth, no-store headers, SAM-key fallback, ingest audit.
- `node scripts/test-gov-drafting-assist.mjs`: PASS.
  - Covered owner-review-only drafting guardrails and no-auto-submit behavior.

### Live public/source smoke

- `https://mehyar.us/`: PASS, 200 HTML.
- `https://mehyar.us/admin`: PASS, 200 HTML owner-only admin login shell.
- `https://mehyar.us/admin/newsletter`: PASS, 200 HTML newsletter admin shell.
- `https://mehyar.us/api/health`: PASS, 200 JSON `{ ok: true, service: "mehyar-web-intake", environment: "production" }`.
- USAspending public API sample query: PASS, 200 JSON with award result.

### Protected API behavior

- `https://mehyar.us/api/admin/metrics` without auth: PASS, 401 JSON.
- `https://api.mehyar.us/v1/admin/metrics` without auth: PASS, 401 JSON `admin_auth_required`.
- `https://api.mehyar.us/v1/admin/dashboard` without auth: PASS, 401 JSON `admin_auth_required`.
- `https://api.mehyar.us/v1/admin/login` with invalid credentials: PASS, 403 JSON `invalid_credentials`.
- Browser smoke on `https://mehyar.us/admin`: PASS, login shell loaded and console had no JS errors.

## Acceptance blockers / failures

### 1. Production Government Opportunity Engine is not live

- `https://mehyar.us/admin/government`: FAIL, production still renders SPA 404: “This MehyarSoft route does not exist.”
- `https://api.mehyar.us/v1/admin/government/opportunities`: FAIL, production returns 404 JSON `not_found`.
- `https://mehyar.us/api/admin/government/opportunities`: FAIL, production returns 404/fallback.

Result: live production smoke cannot pass.

### 2. Local frontend and local API routes do not currently match

Local frontend calls:

- `GET /v1/admin/government/opportunities`
- `GET /v1/admin/government/opportunities/:id/workspace`
- `PATCH /v1/admin/government/opportunities/:id`

Local Pages Functions provide:

- `GET /api/admin/gov-opportunities`
- `GET/POST /api/admin/gov-opportunities/ingest`
- `POST /api/admin/gov-opportunities/:id/status`

Result: even after deployment, the admin UI will call `api.mehyar.us` `/v1/admin/government/...` endpoints unless the backend implements those routes or the frontend is rewired to the Pages Function routes. Status notes and workspace calls are not contract-compatible today.

### 3. Detail workspace / draft-assist API is incomplete

- Drafting assist exists as shared TypeScript logic and tests.
- There is no live/admin API route found for `GET /workspace` or generating/persisting a government application draft.
- UI contains a detail workspace panel, but the client calls an endpoint that does not exist in local Pages Functions and is 404 in production.

Result: drafting assist guardrails pass locally as a library, but the acceptance flow “owner opens a record and generates a draft response outline/checklist” is not end-to-end testable.

### 4. D1 migration set needs cleanup before remote apply

Two `0004_*.sql` migrations now exist:

- `migrations/0004_gov_opportunities.sql`
- `migrations/0004_gov_opportunity_drafting.sql`

They both create some overlapping tables (`gov_opportunities`, `gov_opportunity_documents`, `gov_capability_blocks`, `gov_opportunity_events`) with different column shapes. Because the second uses `CREATE TABLE IF NOT EXISTS`, it will not add changed columns to already-created tables. This makes final remote schema state order-dependent and risky.

Result: acceptance should not proceed until migrations are consolidated or incremented with explicit ALTERs.

### 5. 20 relevant stored records not verified

- No production endpoint exists to list stored government records.
- No remote D1 query was executed here.
- Local mocked tests prove the upsert/scoring path at unit level only; they do not prove a live daily ingest populated at least 20 relevant records.

Result: required record-count acceptance remains FAIL / unverified.

## Acceptance matrix

| Requirement | Status | QA finding |
|---|---:|---|
| Daily scheduled run fetches public-source records | PARTIAL / NOT LIVE | Local ingest function exists and mocked tests pass; no production scheduler/live route verified. |
| At least 20 relevant stored records | FAIL | No production list endpoint or D1 record count verified. |
| USAspending/SAM.gov source distinction | PARTIAL PASS | Spec and local normalizers separate USAspending award signals from SAM active opportunities. |
| Normalize records | LOCAL PASS | Mocked tests passed. |
| Dedupe by source/title/agency/date/source ID | LOCAL PARTIAL | Mocked dedupe upsert passed; exact dedupe key is source/source_id/title/agency, not full date. |
| Relevance/fit scoring | LOCAL PASS | Mocked scoring passed. |
| Admin government opportunities page | FAIL LIVE / LOCAL PARTIAL | Local route exists; production route does not. |
| Sorting/filtering | PARTIAL | Local API supports status/source/min_score; frontend has search UI, but local backend does not implement `q` search. |
| Status update and owner notes | CONTRACT FAIL | UI uses PATCH `/v1/admin/government/opportunities/:id`; Pages Function provides POST `/api/admin/gov-opportunities/:id/status`. |
| Detail workspace | FAIL | UI panel exists; no matching endpoint confirmed. |
| Draft response outline/checklist | LOCAL LIBRARY PASS / END-TO-END FAIL | Shared draft generator tests pass; no connected admin endpoint/live flow. |
| Guardrail: no auto-submission | LOCAL PASS | Draft generator enforces ownerReviewOnly true and autoSubmitAllowed false. |
| Owner-only/protected API behavior | PARTIAL PASS | Existing admin APIs and local gov helper auth test pass; production government route missing. |
| Live production smoke | FAIL | Government route/API 404 in production. |

## Required remediation before acceptance

1. Decide canonical backend path: either implement `/v1/admin/government/...` on `api.mehyar.us` or update the frontend to call deployed Pages Functions under `/api/admin/gov-opportunities...`.
2. Add missing API endpoints for list, digest, detail/workspace, status+notes, ingest trigger/scheduler, and draft generation/persistence under the canonical path.
3. Consolidate duplicate `0004` migrations or add a new migration that explicitly creates/alters the final intended schema without order-dependent `CREATE TABLE IF NOT EXISTS` conflicts.
4. Deploy the admin route and API to production.
5. Apply D1 migrations remotely.
6. Run live ingest using environment variable names only for credentials/config (`SAM_API_KEY`, `GOV_INGEST_LIMIT`, `GOV_OPPORTUNITY_KEYWORDS`, etc.).
7. Verify at least 20 relevant stored records through protected production API or sanitized D1 count.
8. Re-run browser and curl production smoke tests on the live government admin page, list filters, status notes, detail workspace, draft-assist guardrails, and no-store/401 behavior.

## Final QA decision

Final acceptance cannot pass today. Local module scaffolding is materially closer than a pure brief, but production is not live, API contracts are mismatched, migrations need cleanup, and the required 20 relevant stored records are unverified.
