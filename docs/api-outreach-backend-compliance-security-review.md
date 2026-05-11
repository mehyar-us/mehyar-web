# Compliance and Security Review: MehyarSoft API / Outreach Backend

Task: t_c748d224
Repo reviewed: /home/mehya/work/mehyar-web
Review date: 2026-05-11

## 1. Reality Check

Verdict: CONDITIONAL GO for the static website and manual one-to-one replies only. NO-GO for production outreach backend, admin dashboard, automated email sequences, SMS, voice, bulk uploads, or campaign sending until the gates below are implemented and verified.

Current repository state is mostly frontend/static. The only Express backend had no business API routes, no admin routes, and no send capability. That reduces immediate blast radius, but the production risk is that future intake/outreach work could be added without hard admin auth, suppression checks, consent classification, no-send gates, and audit logging.

Fixes applied in this review:
- Added `server/security.ts` with API security headers, x-powered-by disablement, no-store for `/api/*`, allowed-origin handling for API preflight, and response-log redaction helpers.
- Updated `server/index.ts` to use smaller body limits and redact captured API JSON from logs before printing.
- Added `GET /api/health` in `server/routes.ts` and documented that outreach/campaign send endpoints are intentionally absent until gates exist.
- Added `shared/outreachCompliance.ts` as a typed no-send gate evaluator for future backend/admin implementation.

## 2. Hires / Owners

- Boss / Founder: approves production send posture, first outreach vertical, physical mailing address for commercial email footer, and any high-risk prospect record.
- ComplyOps: owns suppression rules, unsubscribe/STOP handling, complaints, bounces, consent classification, campaign approval checklist, risk tiers, and sender readiness score.
- Backend / Cloudflare owner: owns D1/KV schema, Pages Functions, Turnstile verification, admin auth/session boundary, CORS/origin policy, audit log durability, and API tests.
- Frontend owner: owns consent-safe forms, no fake success states, privacy/terms links near intake, and no secrets/PII in client bundle.
- Counsel: required before automated SMS/voice, regulated vertical campaigns, purchased-list use, or reusable consent flows at scale.

## 3. Current Blockers

P0 before production outreach backend:
1. Admin boundary not implemented. No owner-only dashboard or server-side admin session exists.
2. Durable suppression store not implemented in production. D1/KV schema exists only as design documentation.
3. Unsubscribe/STOP ingestion not implemented. Reply/manual handling exists only as policy.
4. Audit log not implemented for send decisions, suppression checks, admin actions, consent events, bounces, complaints, or exports.
5. CORS/origin policy now has a basic Express guard, but Cloudflare Pages Functions still need exact production/preview configuration.
6. No bounce/complaint processor exists for an email provider.
7. No physical mailing address decision exists for scaled commercial email footer.
8. No counsel-approved TCPA consent flow exists; automated cold SMS/voice remains blocked.

## 4. Workstream Status

### Admin auth boundary
Status: NO-GO for admin production. No public admin route exists, which is good, but future admin work must be server-side protected. Client-side-only admin screens, static hidden routes, localStorage auth, or committed plaintext passwords are prohibited.

Required production controls:
- Password/session or SSO enforced server-side.
- `ADMIN_PASSWORD_HASH` and `SESSION_SECRET` only as secrets.
- HttpOnly/Secure/SameSite cookies.
- CSRF protection or same-site POST constraints for admin mutations.
- Audit event for login success/failure, status changes, suppression changes, exports, and manual approvals.

### Secrets / plaintext exposure
Status: PARTIAL PASS. Review found environment variable names in docs/config, but no secret values were printed into this report. Continue using variable names only.

Required production controls:
- No API keys, tokens, mailbox credentials, database URLs, admin passwords, or raw customer data in frontend code, logs, tickets, screenshots, docs, or commits.
- GitHub/Cloudflare secrets only: `CLOUDFLARE_API_TOKEN`, `TURNSTILE_SECRET_KEY`, `ADMIN_PASSWORD_HASH`, `SESSION_SECRET`, `HMAC_SECRET`, optional `RESEND_API_KEY`.
- Public frontend variables only with `VITE_*`, and only when truly public.

### CORS / API surface
Status: FIXED FOR EXPRESS BASELINE; still must be re-applied in Cloudflare implementation.

Applied baseline:
- `/api/*` preflight uses explicit allowed origins from `ALLOWED_ORIGINS` or default `https://mehyar.us,https://www.mehyar.us`.
- API responses receive `Cache-Control: no-store`.
- Security headers are set globally.

Remaining requirement:
- Pages Functions must duplicate this origin policy and reject untrusted write origins.

### Consent classification
Status: DESIGN ONLY, not production.

Required consent classes:
- `unknown`: no marketing or SMS eligibility.
- `service_request`: can respond to the specific inbound request only.
- `marketing_opt_in`: can receive marketing email if suppression/audit gates pass.
- `sms_opt_in`: required before SMS automation.
- `revoked`, `stop`, `opt_out`, `complaint`, `legal`, `invalid`: blocked.

### Suppression / unsubscribe / STOP
Status: NO-GO for automated outreach.

Production requirements:
- Suppress on email, phone, domain, business, and person where appropriate.
- Hash normalized identifiers; store raw values only where operationally required and never in logs.
- Email opt-out phrases include unsubscribe/remove/stop/no thanks/equivalents.
- SMS STOP terms include STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT.
- Complaint immediately suppresses the address and pauses the segment/source for review.
- Hard bounce suppresses as invalid; repeated soft bounces suppress after conservative retries.

### Campaign approval checklist
No campaign or sequence can run until every item passes:
- [ ] Truthful objective and offer.
- [ ] Lawful/public/warm source; no purchased consumer list.
- [ ] Source URL and source type present.
- [ ] Channel eligibility present for intended channel.
- [ ] Suppression check passes at all applicable levels.
- [ ] Risk tier is low/medium or high has named manual approval.
- [ ] Sender identity is accurate.
- [ ] Subject line is non-deceptive.
- [ ] Footer has business identity, reply path, opt-out language, and physical address decision where required.
- [ ] Opt-out/STOP workflow is operational before follow-up.
- [ ] Bounce/complaint handling is monitored.
- [ ] Copy avoids fake familiarity, fake proof, unverifiable metrics, regulated claims, and sensitive-data asks.
- [ ] Audit log writes before and after each send.
- [ ] Daily limits and pause rules are enforced.

### Risk tiers
Low:
- Warm referral, inbound lead, existing relationship, or public business contact with clear operational reason.

Medium:
- Cold public business email from website/directory with source URL, role ambiguity, or local-service prospect.

High:
- Healthcare, dental, medspa, finance, legal, insurance, personal emails, scraped ambiguity, prior complaint, missing source URL, or sensitive-data context. Requires manual approval or no outreach.

Prohibited without counsel:
- Automated cold SMS/calls, purchased consumer data, PHI/patient details, medical outcome claims, deceptive urgency, implied prior relationship, fake social proof.

### Sender readiness scoring
Current estimated score after this review: 45/100.

- 10/20 domain/email identity: visible identity exists; production sender strategy still pending.
- 0/15 suppression table active: not implemented in production.
- 0/15 opt-out capture: not operational beyond manual policy.
- 5/15 audit log: design exists; no durable implementation.
- 10/10 prospect required fields: documented.
- 10/10 copy compliance: public copy is much safer than initial baseline, but final live acceptance still pending.
- 0/10 bounce/complaint monitoring: not implemented.
- 10/5 volume limits/pause rules: documented manual-only posture.

Decision bands:
- 0-59: NO SEND.
- 60-79: Manual-only limited send with owner review.
- 80-89: Controlled manual sequence only.
- 90-100: Small automation pilot eligible; still no SMS/voice without explicit consent and counsel-approved path.

## 5. Risks

High:
- Domain/reputation damage if automated outreach starts before suppression, complaint, bounce, and audit controls exist.
- TCPA exposure if missed-call/SMS demos become automated cold texts or calls.
- Regulated-vertical risk if healthcare/dental/medspa messaging solicits patient details or implies medical outcomes.
- Admin compromise risk if future dashboard is added with client-side auth or plaintext secrets.

Medium:
- Reply-based opt-out can drift without a durable queue/table and owner SLA.
- Cloudflare Pages Functions implementation could accidentally diverge from Express baseline CORS/logging controls.
- Mailto-only lead capture still loses attribution and audit evidence.

Low:
- Static site with no send routes is low immediate operational risk.
- Manual founder-led outreach is acceptable if logged and capped.

## 6. Decisions Needed

1. Approve production posture: keep all outreach manual-only until readiness score reaches at least 60/100.
2. Choose physical mailing address strategy for commercial email footer before scale.
3. Choose first outreach vertical; recommendation remains lower-risk restaurants/local services before healthcare/dental/medspa.
4. Choose Cloudflare D1/KV implementation owner for suppression, consent, and audit tables.
5. Decide whether contact form should stay mailto-only for v1 or move immediately to Cloudflare intake with Turnstile and D1.

## 7. Next 48 Hours

1. Backend: implement Cloudflare Pages Functions `/api/health` and `/api/intake` with Turnstile, D1 insert, KV rate limit, audit events, and no raw body logging.
2. Backend: create D1 migrations for `leads`, `suppression_entries`, `consent_events`, `outreach_events`, `source_records`, and `audit_log`.
3. ComplyOps: seed test suppressions and verify `shared/outreachCompliance.ts` blocks suppressed, STOP, high-risk-unapproved, missing-source, misleading-subject, and audit-unavailable cases.
4. Frontend: add explicit service-request consent checkbox before submitting any form to `/api/intake`.
5. Ops: configure monitored reply inbox and manual opt-out SLA before second-touch outreach.
6. Sender: do not enable SMS/voice automation or bulk email tooling during this window.
