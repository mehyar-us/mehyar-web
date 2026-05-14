# MehyarSoft Government Opportunity Engine

Status: product/implementation brief
Owner: MehyarSoft admin cockpit
Audience: owner-only admin users and implementation agents
Public language: use “opportunity intelligence”, “proposal helper”, “fit score”, and “drafting assist”. Avoid public-facing hype.

## 1. Vision

Build a daily owner-only government-opportunity finder for MehyarSoft. The engine watches public U.S. spending and procurement signals, ranks the best-fit opportunities for MehyarSoft services, places them in the admin cockpit, and helps the owner prepare compliant application/proposal material quickly.

This is a new revenue lane inside the admin cockpit:

discover → qualify → draft → owner review → submit-ready package → follow up → learn from outcomes

The product is not a public bidding bot and does not submit proposals automatically. It is a controlled owner workflow for finding legitimate work and preparing better responses faster.

## 2. Source scope and non-negotiable distinction

Use two source families for two different jobs.

### USAspending.gov — award/spending intelligence

Use USAspending.gov to understand the market:

- What agencies bought before
- Which offices buy software, automation, data, CRM, website, cloud, help desk, and operations support
- Award values and date patterns
- Incumbent vendors and vendor concentration
- NAICS/product-service-code patterns
- Recurring program names and office-level buying behavior

USAspending.gov records are not necessarily open opportunities. They produce intelligence, agency watchlist entries, competitor/incumbent context, and “watch this buying office” signals.

### SAM.gov Contract Opportunities — active apply/bid opportunities

Use SAM.gov Contract Opportunities for records that can become live pursuit work:

- Solicitation
- Sources sought
- Request for information (RFI)
- Combined synopsis/solicitation
- Presolicitation
- Special notice
- Award notice only when useful for intelligence

SAM.gov records drive active opportunity cards, deadlines, application workspaces, requirement extraction, and owner next actions.

### Product rule

Every record must label its source role:

- `market_signal` — intelligence only, usually from USAspending.gov
- `active_opportunity` — open pursuit candidate, usually from SAM.gov
- `agency_watch_signal` — useful office/category buying pattern
- `award_history_lead` — past award useful for positioning, not directly bid-able

The admin must never imply a USAspending award record is an open bid unless a matching active SAM.gov opportunity exists.

## 3. Business goals

1. Create a daily stream of realistic government revenue opportunities for MehyarSoft.
2. Reduce owner time spent searching government portals manually.
3. Build institutional knowledge about agencies that buy MehyarSoft-type services.
4. Preserve compliance, source attribution, and owner approval before any external action.
5. Start with a manual-first MVP that helps win small, simple, fit-aligned opportunities before scaling.

## 4. Target opportunity categories

Prioritize U.S. public-sector opportunities matching MehyarSoft’s strengths:

- Custom software development
- Web application development
- Website modernization
- Cloud migration / Cloudflare-style web/API systems
- CRM implementation and workflow automation
- Admin dashboards and internal tools
- Data cleanup, reporting, and business-intelligence dashboards
- API integrations and lightweight middleware
- Records/intake/case-management systems
- Email/contact center workflow improvement
- Help desk modernization
- AI-assisted operations, described externally as “automation”, “intelligent workflow”, “smart intake”, “document support”, or “decision support”
- Small-business set-asides, micro-purchase, simplified acquisition, and subcontract-friendly opportunities

Down-rank or exclude:

- Large defense prime work requiring heavy certifications or cleared personnel
- Hardware-only buys
- Construction, facilities, physical equipment, vehicles, janitorial, landscaping
- Medical/clinical service delivery outside scope
- Opportunities requiring certifications MehyarSoft does not currently hold
- Opportunities needing bonds, facility clearances, specialized insurance, or named key personnel not available
- Very short deadlines unless the task is simple, RFI-style, or a lightweight quote
- Anything requiring invented past performance, false eligibility, or unverifiable claims

## 5. Owner admin information architecture

Private admin navigation should add a “Gov Ops” section:

- `/admin/gov` — Gov Opportunity Home / Daily Digest
- `/admin/gov/inbox` — Daily Opportunity Inbox
- `/admin/gov/opportunities/:id` — Opportunity Detail
- `/admin/gov/applications/:id` — Application Workspace
- `/admin/gov/agencies` — Agency Watchlist
- `/admin/gov/capabilities` — Capability Library
- `/admin/gov/settings` — Source settings, search terms, compliance gates
- `/admin/gov/audit` — Gov workflow audit trail

No public navbar links. All pages require owner auth through the existing admin boundary. All responses must use no-store cache headers.

## 6. Screen-by-screen workflows

### 6.1 Gov Opportunity Home / Daily Digest

Purpose: give the owner a fast morning decision surface.

Primary modules:

- Today’s top 5 active SAM.gov opportunities
- Today’s top 5 USAspending market signals
- Urgent deadlines in the next 3/7/14 days
- “Apply today” candidates
- “Watch this agency” candidates
- New records since last run
- Records needing owner decision
- Pipeline counts by status

Required fields per digest item:

- Title
- Agency / office
- Source role
- Deadline or signal date
- Fit score
- Confidence
- Next best action
- One-sentence reason

Primary actions:

- Open record
- Mark reviewing
- Create application workspace
- Add agency to watchlist
- Mark not fit
- Snooze

Empty state:

- “No government records matched today. Review search terms or open Agency Watchlist.”
- Show last successful ingest timestamp and next scheduled run.

Error state:

- If source fetch fails, show which source failed, last successful run timestamp, and “Retry ingest” action.
- Do not expose API tokens, raw request headers, or stack traces.

### 6.2 Daily Opportunity Inbox

Purpose: sortable work queue for all new and active records.

Table columns:

- Checkbox / bulk select
- Fit score
- Status
- Source role
- Source: USAspending.gov, SAM.gov, or both
- Title
- Agency / office
- Opportunity type
- Deadline / close date
- Estimated value or historical award value
- Set-aside
- NAICS / PSC when available
- Confidence
- Next best action
- Last updated

Filters:

- Status
- Source role
- Source
- Fit score range
- Deadline window
- Agency
- Opportunity type
- Set-aside
- NAICS / PSC
- Keyword
- Exclude archived / not fit

Statuses:

- `new`
- `reviewing`
- `qualified`
- `draft_needed`
- `questions_needed`
- `ready_for_owner_review`
- `submitted`
- `follow_up`
- `won`
- `lost`
- `not_fit`
- `snoozed`
- `archived`

Primary actions:

- Open detail
- Set status
- Add note
- Assign next action date
- Create application workspace
- Add agency watchlist entry
- Archive / not fit with reason

Empty state:

- First-run: “No records yet. Run ingest to fetch public opportunities.”
- Filtered: “No records match these filters. Clear filters or lower fit threshold.”

Error state:

- Failed table load returns a safe error banner and retry action.
- Per-row parsing failures should not break the inbox; show `needs_review` parse status.

### 6.3 Opportunity Detail

Purpose: one trustworthy record view with source facts, scoring explanation, and decision controls.

Sections:

1. Header
   - Title
   - Agency / office
   - Source role
   - Source links
   - Status
   - Deadline
   - Fit score
   - Next best action

2. Source facts
   - Source system
   - Source ID
   - Posted date
   - Close date
   - Opportunity type
   - Set-aside
   - NAICS / PSC
   - Place of performance when available
   - Estimated value or award value when available
   - Contact info only if public in source
   - Source fetched timestamp

3. Fit score breakdown
   - Service match
   - Deadline distance
   - Budget/value range
   - Set-aside suitability
   - Agency match
   - Complexity
   - Compliance burden
   - Past buying pattern
   - Incumbent/vendor concentration
   - Proposal effort estimate

4. Fit explanation
   - Why it fits MehyarSoft
   - Why it may not fit
   - Missing information
   - Required registrations/certifications
   - Risks

5. Owner decision panel
   - Qualify
   - Not fit
   - Create draft workspace
   - Add to agency watchlist
   - Add owner note
   - Set next action date

6. Audit timeline
   - Ingested
   - Scored
   - Status changes
   - Draft generations
   - Owner edits
   - Submission/follow-up notes

Critical rule:

Extracted source requirements must be visually separated from AI-drafted language. The UI should label source text as “Source Extract” and generated content as “Draft — Owner Must Review”.

### 6.4 Application Workspace

Purpose: turn a qualified SAM.gov opportunity into a submit-ready package under owner control.

Workspace sections:

- Source document links and uploaded/downloaded docs metadata
- Requirements checklist
- Compliance matrix
- Questions for contracting officer
- Response outline
- Capability statement draft
- Relevant capability library blocks
- Pricing/thought-process notes for owner review
- Submission checklist
- Follow-up plan
- Owner notes

Required workspace fields:

- Opportunity ID
- Workspace status
- Owner decision status
- Requirements extracted at timestamp
- Compliance matrix JSON/text
- Draft outline
- Draft capability statement language
- Open questions
- Submission deadline
- Submission method notes
- Final owner approval flag

Workspace statuses:

- `created`
- `requirements_extracted`
- `drafting`
- `owner_review`
- `ready_to_submit`
- `submitted`
- `follow_up`
- `closed`

Actions:

- Extract requirements
- Generate checklist
- Generate response outline
- Pull capability blocks
- Generate questions list
- Mark owner reviewed
- Record manual submission
- Record follow-up date

Guardrail:

The system may draft, organize, and checklist. It must not auto-submit to SAM.gov, email contracting officers, or represent eligibility without explicit owner action outside the tool.

### 6.5 Agency Watchlist

Purpose: build a private intelligence map of agencies likely to buy MehyarSoft services.

List fields:

- Agency / department
- Sub-office
- Buyer category
- Relevant keywords
- NAICS / PSC patterns
- Total relevant historical spend
- Recent award winners
- Typical contract values
- Last signal date
- Watch priority
- Next monitoring action
- Notes

Actions:

- Add from opportunity
- Add manually
- View related awards
- View active opportunities
- Update priority
- Snooze / archive agency

Watch priorities:

- `hot`
- `active`
- `monitor`
- `low`
- `archived`

Empty state:

- “No agencies watched yet. Add agencies from top spending signals or active opportunities.”

### 6.6 Capability Library

Purpose: store reusable private proposal blocks so drafts are faster and more consistent.

Block types:

- Company summary
- Core service description
- NAICS pursuit note
- Differentiator
- Case-study snippet
- Past-performance style example
- Security/privacy statement
- Small-business positioning
- Owner bio/resume snippet
- Tool/process description
- Standard question response

Required block fields:

- Block title
- Block type
- Tags
- Approved text
- Owner approval status
- Last reviewed date
- Source/notes
- Do-not-use flag

Statuses:

- `draft`
- `owner_approved`
- `needs_update`
- `do_not_use`

Guardrails:

- Do not invent past performance.
- Do not claim certifications or registrations unless verified by owner.
- Avoid unnecessary personal information.
- Keep private blocks behind admin auth only.

### 6.7 Gov Settings

Purpose: owner/admin configuration without code edits.

Settings groups:

- Search keywords
- NAICS codes
- PSC codes
- Agencies to prioritize
- Agencies to exclude
- Minimum fit score shown by default
- Deadline windows
- Set-aside preferences
- Source enabled/disabled flags
- Digest schedule
- Compliance reminders

Sensitive config:

- Source API keys, if any, must be stored only as Worker secrets/environment variables and never returned to the frontend.
- Admin UI may show whether a secret is configured, not the value.

### 6.8 Gov Audit

Purpose: prove control before scale.

Audit events:

- Ingest run started/completed/failed
- Record created/updated
- Score generated/changed
- Status changed
- Note added/edited/deleted
- Workspace created
- Requirements extracted
- Draft generated
- Capability block inserted
- Owner approval marked
- Submission recorded manually
- Source fetch error

Audit fields:

- Event ID
- Timestamp
- Admin user
- Action
- Entity type
- Entity ID
- Safe metadata JSON

Never log secrets, raw source credentials, full browser headers, raw private drafts in error logs, or unnecessary personal data.

## 7. Fit scoring v1

Score each record from 0–100. Show both total score and explanation.

Recommended weights:

- Service match: 25
- Opportunity type / pursuit practicality: 15
- Deadline distance: 10
- Budget/value fit: 10
- Set-aside/small-business suitability: 10
- Agency fit / buying history: 10
- Complexity: 8
- Compliance burden: 7
- Proposal effort estimate: 5

Positive signals:

- Software/web/CRM/data/workflow/admin-dashboard terms
- Small business or simplified acquisition pathway
- Deadline at least 7–14 days away
- Clear requirements and low ambiguity
- Agency has bought similar services before
- Low certification burden
- RFI/sources-sought that can position MehyarSoft early

Negative signals:

- No clear match to service categories
- Heavy compliance/certification needs
- Very large scope for a prime contractor
- Hardware/construction/service categories outside scope
- Deadline too close
- Required past performance unavailable
- Vague requirements with high proposal effort

Confidence levels:

- `high` — source facts complete and score explainable
- `medium` — useful match but missing value, docs, or requirements
- `low` — weak/messy source parse or uncertain fit

## 8. Data model sketch

Use Cloudflare D1 or equivalent durable server-side storage. Table names are implementation guidance, not a public contract.

### `gov_opportunity_sources`

- `id`
- `source_name` — `usaspending` or `sam_gov`
- `source_role`
- `base_url`
- `enabled`
- `last_success_at`
- `last_error_at`
- `last_error_code`
- `created_at`
- `updated_at`

### `gov_ingest_runs`

- `id`
- `started_at`
- `completed_at`
- `status`
- `source_name`
- `query_json`
- `records_seen`
- `records_created`
- `records_updated`
- `records_failed`
- `safe_error_summary`

### `gov_opportunities`

- `id`
- `source_name`
- `source_role`
- `source_id`
- `source_url`
- `title`
- `agency_name`
- `office_name`
- `opportunity_type`
- `posted_date`
- `close_date`
- `award_date`
- `estimated_value_cents`
- `historical_award_value_cents`
- `set_aside`
- `naics_codes_json`
- `psc_codes_json`
- `place_of_performance`
- `status`
- `parse_status`
- `fetched_at`
- `created_at`
- `updated_at`

### `gov_opportunity_scores`

- `id`
- `opportunity_id`
- `score_total`
- `confidence`
- `score_breakdown_json`
- `why_fit`
- `why_not_fit`
- `missing_info`
- `next_best_action`
- `scored_at`

### `gov_opportunity_events`

- `id`
- `opportunity_id`
- `event_type`
- `admin_user`
- `safe_metadata_json`
- `created_at`

### `gov_opportunity_documents`

- `id`
- `opportunity_id`
- `source_url`
- `document_title`
- `document_type`
- `storage_ref`
- `sha256`
- `fetched_at`

### `gov_application_workspaces`

- `id`
- `opportunity_id`
- `status`
- `requirements_extract`
- `compliance_matrix_json`
- `questions_json`
- `response_outline`
- `capability_statement_draft`
- `pricing_notes`
- `submission_checklist_json`
- `owner_approved_at`
- `submitted_at`
- `follow_up_at`
- `created_at`
- `updated_at`

### `gov_capability_blocks`

- `id`
- `title`
- `block_type`
- `tags_json`
- `approved_text`
- `approval_status`
- `last_reviewed_at`
- `source_notes`
- `do_not_use`
- `created_at`
- `updated_at`

### `gov_agency_watchlist`

- `id`
- `agency_name`
- `office_name`
- `priority`
- `keywords_json`
- `naics_codes_json`
- `psc_codes_json`
- `recent_award_winners_json`
- `typical_value_low_cents`
- `typical_value_high_cents`
- `last_signal_at`
- `next_monitoring_action`
- `notes`
- `created_at`
- `updated_at`

## 9. Daily ingest workflow

1. Scheduled job starts once per day.
2. Fetch USAspending.gov award/spending signals for approved keywords, NAICS, PSC, and watched agencies.
3. Fetch SAM.gov Contract Opportunities for active matching service terms and configured deadline windows.
4. Normalize source records into the internal model.
5. Deduplicate by source name/source ID first, then by title + agency + posted/award date.
6. Classify source role.
7. Score fit and confidence.
8. Store/update opportunity rows.
9. Create or update agency watchlist signals.
10. Mark urgent items by deadline.
11. Create safe audit events.
12. Surface top items in admin.
13. Produce an owner-only daily digest.

Failure behavior:

- A USAspending failure should not block SAM.gov ingest.
- A SAM.gov failure should not block USAspending ingest.
- Partial results are allowed but must be marked partial.
- The digest must show source health and last successful run.

## 10. Search seed list

Keywords:

- software development
- web application development
- website modernization
- workflow automation
- CRM implementation
- customer relationship management
- data dashboard
- business intelligence
- reporting dashboard
- cloud migration
- API integration
- process automation
- records management system
- intake system
- case management system
- email automation
- help desk modernization
- small business technology support
- administrative dashboard
- digital services
- data modernization
- application modernization
- low code automation
- document automation
- intelligent workflow

Initial pursuit tags:

- `software`
- `web_modernization`
- `crm`
- `workflow_automation`
- `data_dashboard`
- `cloud_api`
- `records_intake`
- `help_desk`
- `rfi_positioning`
- `small_business`

## 11. Admin API contract v1

All endpoints require owner auth and no-store headers.

Read endpoints:

- `GET /admin-api/gov/summary?range=7d|30d|90d`
- `GET /admin-api/gov/opportunities?status=&sourceRole=&source=&fitMin=&deadline=&agency=&type=&q=&limit=&cursor=`
- `GET /admin-api/gov/opportunities/:id`
- `GET /admin-api/gov/opportunities/:id/events`
- `GET /admin-api/gov/applications/:id`
- `GET /admin-api/gov/agencies?priority=&q=&limit=&cursor=`
- `GET /admin-api/gov/capabilities?type=&status=&q=&limit=&cursor=`
- `GET /admin-api/gov/audit?range=&entityType=&entityId=&limit=&cursor=`
- `GET /admin-api/gov/ingest-runs?source=&status=&limit=&cursor=`

Write endpoints:

- `POST /admin-api/gov/ingest-runs` — manual retry/run, owner-only
- `PATCH /admin-api/gov/opportunities/:id/status`
- `POST /admin-api/gov/opportunities/:id/notes`
- `POST /admin-api/gov/opportunities/:id/application-workspace`
- `PATCH /admin-api/gov/applications/:id`
- `POST /admin-api/gov/applications/:id/extract-requirements`
- `POST /admin-api/gov/applications/:id/generate-outline`
- `POST /admin-api/gov/applications/:id/mark-owner-reviewed`
- `POST /admin-api/gov/applications/:id/record-submission`
- `POST /admin-api/gov/agencies`
- `PATCH /admin-api/gov/agencies/:id`
- `POST /admin-api/gov/capabilities`
- `PATCH /admin-api/gov/capabilities/:id`

Headers:

```http
Cache-Control: no-store
Pragma: no-cache
```

Frontend must not receive secrets or source API tokens. It may receive source health booleans and safe timestamps.

## 12. Compliance and safety guardrails

- Never auto-submit proposals.
- Never email contracting officers automatically.
- Never invent eligibility, registrations, certifications, past performance, staffing, or pricing.
- Clearly separate source-extracted requirements from drafted response language.
- Store source URLs and fetched timestamps for every recommendation.
- Keep owner-only drafts behind admin auth.
- Use no-store headers for admin endpoints.
- Redact secrets and tokens from logs.
- Preserve audit trail of generated drafts and owner edits.
- Require owner approval before marking any application `ready_to_submit`.
- Record manual submission as an owner action; do not imply the system submitted it.
- Treat external contact info as public-source reference only; do not build mass outreach.
- Use environment variable names only in docs and tickets.

### Drafting-assist implementation contract

The private drafting workflow is owner-review only. For each active opportunity, generate and persist:

- Requirements checklist with citation(s) per row.
- Compliance matrix mapping source requirement → response location → evidence needed → owner-confirmation flag.
- Questions for the contracting officer, especially around submission format, past-performance acceptability, eligibility/registration timing, incumbent dependencies, and phased delivery.
- Response outline with cited sections for executive summary, technical approach, management plan, and compliance attachments.
- MehyarSoft capability statement blocks only from approved capability-library entries.
- Owner-confirmation items for certifications/eligibility, past performance, and pricing whenever facts are missing or solicitation language requires verification.
- Risk flags and audit metadata: draft id, opportunity id, generated timestamp, actor, guardrail version, source URLs, and retrieval timestamps.

D1 storage lives in migration `0004_gov_opportunity_drafting.sql`:

- `gov_opportunities`
- `gov_opportunity_documents`
- `gov_capability_blocks`
- `gov_application_drafts`
- `gov_opportunity_events`

Reusable generation logic lives in `shared/govDraftingAssist.ts`; validation must keep `ownerReviewOnly = true`, `autoSubmitAllowed = false`, active guardrails, checklist citations, compliance citations, and audit citations.

Control before scale: source attribution, segmentation, audit logs, and compliance gates before any campaign-like workflow.

## 13. MVP build phases

### Phase 0 — admin boundary and source config

- Confirm existing admin auth boundary protects all Gov Ops pages and APIs.
- Add source config records and source health display.
- Store any source credentials as Worker secrets/environment variables only.

Acceptance:

- Unauthenticated Gov Ops API returns 401.
- Authenticated owner can load empty Gov Ops home.
- Frontend bundle contains no secrets.
- Source health panel shows configured/not-configured without exposing values.

### Phase 1 — ingest and storage

- Implement daily scheduled ingest for USAspending.gov market signals.
- Implement daily scheduled ingest for SAM.gov active opportunities.
- Normalize, deduplicate, and store records.
- Store ingest run health.

Acceptance:

- A daily/manual run can fetch and store at least 20 relevant public records across enabled sources in a test window.
- USAspending records are labeled as market intelligence unless matched to an active opportunity.
- SAM.gov active records include deadline/close date when available.
- Source failures are isolated and visible in source health.

### Phase 2 — inbox and scoring

- Add Gov Opportunity Home.
- Add Daily Opportunity Inbox.
- Add fit scoring and score breakdown.
- Add filters and status changes.

Acceptance:

- Owner can sort/filter by score, deadline, source role, agency, type, status, and keyword.
- Every visible record has score, confidence, source role, reason, deadline/signal date, and next action.
- Owner can mark reviewing, qualified, not fit, snoozed, or archived.
- Status changes write audit events.

### Phase 3 — detail and agency watchlist

- Add Opportunity Detail page.
- Add Agency Watchlist.
- Connect USAspending signals to agency watchlist candidates.

Acceptance:

- Detail page shows source facts, source links, score breakdown, why/why-not, missing info, and audit timeline.
- Owner can add an agency/office to watchlist from a record.
- Watchlist shows relevant spend patterns and active opportunities for watched agencies.

### Phase 4 — application workspace and capability library

- Add Application Workspace for qualified SAM.gov records.
- Add Capability Library CRUD.
- Generate requirement checklist, compliance matrix, questions, and response outline.

Acceptance:

- Owner can create a workspace from an active SAM.gov opportunity.
- Workspace separates source extracts from generated drafts.
- Owner can insert approved capability blocks into a draft.
- Owner can mark reviewed and record manual submission.
- No automatic submission or external messaging exists.

## 14. MVP acceptance criteria

The MVP is accepted only when all of the following are true:

1. Daily/manual ingest can fetch and store at least 20 relevant public records across USAspending.gov and SAM.gov in a test run.
2. Records clearly distinguish `market_signal`, `active_opportunity`, `agency_watch_signal`, and `award_history_lead`.
3. Admin shows a protected Gov Opportunity Home and Daily Opportunity Inbox.
4. Inbox supports sorting/filtering by score, source role, source, deadline, agency, type, status, and keyword.
5. Each record has fit score, confidence, source URL, source timestamp, reason, deadline/signal date, and next best action.
6. Owner can change status, add notes, snooze/archive, and create an application workspace.
7. Opportunity Detail shows source facts, score breakdown, why fit, why not fit, missing info, and audit timeline.
8. Agency Watchlist can be populated from USAspending signals and SAM.gov records.
9. Capability Library supports owner-approved reusable blocks and do-not-use flags.
10. Application Workspace can produce checklist, compliance matrix, questions, and response outline for an active SAM.gov record.
11. Generated drafts are visibly labeled as drafts requiring owner review.
12. System never auto-submits proposals, never emails contracting officers automatically, and never fabricates eligibility/certification/past performance/pricing.
13. All Gov Ops endpoints require owner auth and return no-store cache headers.
14. Audit events exist for ingest, score generation, status changes, draft generation, owner review, and manual submission recording.
15. Live production smoke test confirms unauthenticated access is blocked and authenticated owner access works.

## 15. Out of scope for MVP

- Automatic proposal submission
- Automatic external email/contact to agencies
- Paid third-party procurement databases
- Team/multi-user roles beyond owner admin
- Automated subcontractor outreach
- Certification management beyond checklist/reminders
- Full contract lifecycle management after award
- Public opportunity pages
- Mass campaign features

## 16. First useful seed records for manual validation

Create at least these internal seed/config records before implementation testing:

### Source records

1. `usaspending_market_intelligence`
   - Source name: USAspending.gov
   - Role: market intelligence
   - Purpose: identify agency spend, incumbents, value ranges, buying patterns

2. `sam_contract_opportunities`
   - Source name: SAM.gov Contract Opportunities
   - Role: active opportunities
   - Purpose: identify open pursuit candidates, deadlines, and source documents

### Capability blocks

1. Company summary — draft, needs owner approval
2. Website modernization service — draft, needs owner approval
3. Workflow automation / CRM service — draft, needs owner approval
4. Data dashboard service — draft, needs owner approval
5. Security/privacy posture — draft, needs owner approval

### Watchlist seeds

Start with agencies/offices discovered by the first ingest that have repeat signals for software, web modernization, workflow, CRM, data dashboard, or help desk modernization. Do not hardcode assumptions; seed from public-source records with stored source URLs.
