# Government Opportunity Engine Compliance Review

Task: t_35554de8
Scope reviewed: `docs/gov-opportunity-engine.md`, `docs/mehyarsoft-api-contract.md`, `client/src/App.tsx`, `client/src/pages/Admin.tsx`, `client/src/lib/mehyarsoft-api.ts`, `functions/_scheduled.js`, `functions/api/_shared/govOpportunities.js`, `functions/api/admin/gov-opportunities/*`, `shared/govDraftingAssist.ts`, `migrations/0004_gov_opportunities.sql`, `migrations/0004_gov_opportunity_drafting.sql`, and targeted local tests.
Verdict: LOCAL CONDITIONAL PASS ON CORE GUARDRAILS; NO-GO FOR PRODUCTION ACCEPTANCE UNTIL ROUTE CONTRACT, SCHEMA, LIVE DEPLOYMENT, AND RECORD-COUNT BLOCKERS ARE CLOSED.

## 1. Reality Check

The government opportunity engine is no longer only a brief: local scaffolding now exists for daily ingest, USAspending/SAM normalization, scoring, D1 tables, admin UI panels, protected Pages Function endpoints, and an owner-review-only drafting helper. The core compliance intent is correct: USAspending is treated as award-history/market intelligence, SAM.gov is treated as the active solicitation source, admin JSON uses bearer auth and `cache-control: no-store`, errors are sanitized, SAM configuration remains server-side through environment variable names, and draft generation is explicitly owner-review-only with `autoSubmitAllowed: false`.

Production acceptance is still NO-GO. The frontend is wired to `/v1/admin/government/...` while the local Pages Functions expose `/api/admin/gov-opportunities...`, workspace/draft API endpoints are not implemented end-to-end, production government routes still need live verification, duplicate `0004` migrations are order-dependent, and the required “20 relevant stored records” proof is not available. Do not submit, externally send, or treat the feature as revenue-operational until these are resolved.

## 2. Hires / Owners

- Product owner: Boss / MehyarSoft admin cockpit; owns final pursue/no-bid decisions and any external submission.
- Compliance owner: ComplyOps; owns source distinction, no-submit gates, source timestamps, privacy, and proposal-claim boundaries.
- Backend/DevOps owner: owns canonical API path, Cloudflare deployment, D1 migrations, scheduler, admin auth, no-store, and audit logging.
- Proposal owner: Boss must confirm exact eligibility, registrations, certifications, pricing, staffing, references, and past performance before any response language is used externally.
- Counsel/government contracting advisor: recommended before first live bid involving set-asides, representations/certifications, FAR clauses, subcontracting, or eligibility claims.

## 3. Current Blockers

1. API contract mismatch: frontend calls `/v1/admin/government/opportunities`, `/workspace`, `/drafts`, and PATCH update routes; local Pages Functions provide `/api/admin/gov-opportunities`, `/ingest`, and POST `/:id/status`.
2. Workspace/drafting assist is not end-to-end: `shared/govDraftingAssist.ts` passes local guardrail tests, but there is no matching admin API route confirmed for workspace retrieval or draft generation/persistence.
3. Duplicate migration number/schema conflict: `migrations/0004_gov_opportunities.sql` and `migrations/0004_gov_opportunity_drafting.sql` both define overlapping tables with different column shapes. Remote schema outcome is order-dependent.
4. Source timestamp enforcement is incomplete in the ingest schema: draft helper types require `sourceRetrievedAt`, but `gov_opportunities` ingest rows currently store `posted_date`/`response_deadline` and `raw_json`; they do not require normalized `source_retrieved_at` / `source_last_modified_at` on the primary opportunity row.
5. Local list endpoint ignores frontend `q` search even though the UI sends it.
6. No live proof of deployed government admin route/API, applied D1 migrations, scheduled run, or at least 20 relevant stored records.
7. Status set includes `submitted`; acceptable only as a manual owner-entered status after external submission, but it must not imply the system submitted anything.

## 4. Workstream Status

- USAspending vs SAM.gov source usage: PASS / LOCAL. Brief and normalizers separate USAspending `award_history_signal` from SAM.gov `active_solicitation` / `sources_sought`. Risk remains if UI labels high-scoring USAspending rows as “apply candidates”; it currently counts fit score/activity, not source type.
- Attribution and source timestamps: PARTIAL. Draft helper requires citations with source URLs and retrieval timestamps. Ingest rows include source URL and raw source payload, but normalized retrieved-at/last-modified fields are not mandatory in the main opportunity table.
- Admin auth: LOCAL PASS. Gov Pages Functions call `verifyAdminRequest`; missing/invalid bearer token returns a generic admin unavailable response. Existing admin API auth patterns were also previously verified.
- No-store headers: LOCAL PASS for gov JSON helpers. `responseHeaders()` returns `cache-control: no-store`; targeted tests passed.
- Secret leakage: PASS in reviewed files. SAM key is referenced only as `SAM_API_KEY`; logs contain summary counts and safe error names, not secret values.
- PII leakage: PASS/PARTIAL. Gov source records are public-procurement-oriented, and no private PII enrichment path was found. Raw source payload storage can include public contact names/emails from source records, so data minimization/redaction rules should be added before broad retention/digesting.
- No auto-submit: PASS. No external submission connector found; draft helper hard-codes owner review and false auto-submit; UI copy says owner submits manually.
- Proposal claim boundaries: LOCAL PASS. Draft helper blocks invented claims by making certifications, eligibility, past performance, pricing, and similar items owner-confirmation-required. The missing piece is persistence/API enforcement around generated drafts.
- Audit trail: PARTIAL. Ingest/upsert/status events are written locally; draft audit exists in the helper output. End-to-end draft/status audit is not yet complete.

## 5. Risks

- High: The route contract mismatch means the admin UI will not talk to the local gov Pages Functions as currently written.
- High: Duplicate migrations could create a production D1 schema that omits required fields/check constraints depending on application order.
- High: USAspending market signals could be misread as open solicitations unless candidate counts/actions filter source role.
- High: Generated proposal copy must never imply certifications, set-aside eligibility, agency experience, cleared staffing, bonding/insurance, pricing, or past performance unless Boss has approved evidence.
- Medium: Raw source payloads may contain public contact details; store only what is necessary and avoid enriching with non-public PII.
- Medium: Static admin shells are routed publicly; keep sensitive data exclusively behind authenticated no-store JSON and consider explicit static no-store where supported.
- Medium: Daily digests/notifications should not include sensitive notes, internal scoring logic, or draft content until protected delivery is proven.

## 6. Decisions Needed

1. Pick canonical backend path: implement `/v1/admin/government/...` on `api.mehyar.us`, or rewire frontend to `/api/admin/gov-opportunities...` and add all missing endpoints there.
2. Consolidate the two `0004` migrations or add a new explicit migration that produces one final schema with source timestamps and draft check constraints.
3. Decide whether USAspending rows can ever appear in “apply candidates”; recommendation: only SAM.gov active/source-sought rows should count as apply candidates.
4. Confirm approved MehyarSoft government-facing facts: registrations, UEI/SAM status, NAICS, certifications, set-aside eligibility, insurance/bonding, past performance, staffing, and pricing policy.
5. Confirm owner approval event shape: actor, timestamp, opportunity ID, source citation/version/hash, draft ID/hash, approval note, and external destination.

## 7. Next 48 Hours

1. Fix route contract mismatch and implement missing workspace/draft/status endpoints under the chosen canonical path.
2. Consolidate D1 migrations; require `source_url`, `source_retrieved_at`, source record ID, source system, source role, published/modified/close dates where available, and draft `owner_review_only=1` / `auto_submit_allowed=0` checks.
3. Update scoring/UI so “apply candidates” excludes USAspending-only award-history signals unless matched to an active SAM.gov opportunity.
4. Add acceptance tests for unauthenticated denial, `no-store`, q/status/source/min-score filters, required source timestamps, SAM-vs-USAspending role enforcement, no auto-submit, owner-confirmation-required claims, and draft audit persistence.
5. Deploy to staging/production, apply migrations, run scheduled/manual ingest using only environment variable names for credentials/config, then verify at least 20 relevant stored records through protected API or sanitized D1 count.

## Verification Run

- `npm run test:gov-opportunities`: PASS. Covered USAspending/SAM normalization, scoring, dedupe upsert, admin auth, no-store, SAM-key fallback, and ingest audit.
- `npm run test:gov-drafts`: PASS. Covered owner-review-only drafting guardrails and no-auto-submit validation.
- `npm run check`: PASS.
- `npm run build`: PASS. Vite build completed and route shells copied.
- Incorrect script attempt noted: `npm run test:gov-drafting-assist` does not exist; correct script is `npm run test:gov-drafts`.
