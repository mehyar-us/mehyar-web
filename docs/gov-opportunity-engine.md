# MehyarSoft Government Opportunity Engine

Status: product/implementation brief
Owner: MehyarSoft admin cockpit
Public language: use “opportunity intelligence”, “proposal helper”, “fit score”, and “drafting assist”. Avoid public-facing hype.

## Vision

Give MehyarSoft a daily government-opportunity finder that watches U.S. public spending and procurement signals, ranks the best-fit opportunities for MehyarSoft services, lists them in the owner admin, and helps the owner prepare compliant application/proposal material quickly.

This becomes a revenue lane inside the admin cockpit: discover → qualify → draft → submit-ready package → follow up.

## Important source distinction

- USAspending.gov is best for market intelligence: what agencies bought, who won awards, contract values, categories, incumbent vendors, and buying patterns.
- SAM.gov Contract Opportunities is the primary source for open solicitations that can actually be applied/bid to.

Use both:

1. USAspending.gov: learn where money is flowing and which agencies buy software, automation, data, websites, CRM, cloud, cybersecurity, and operations support.
2. SAM.gov: find active open opportunities and deadlines.
3. Admin cockpit: rank, explain, track, and help prepare responses.

## Target opportunity categories

Prioritize USA opportunities matching MehyarSoft’s strengths:

- Custom software development
- Cloud migration / Cloudflare-style web/API systems
- CRM, workflow automation, and admin dashboards
- Data cleanup, reporting, and business-intelligence dashboards
- Website modernization for local/regional agencies
- Email/contact center workflow improvement
- AI-assisted operations, described externally as “automation”, “intelligent workflow”, “smart intake”, “document support”, or “decision support”
- Small-business set-asides, micro-purchase, simplified acquisition, and subcontract-friendly opportunities

Avoid or down-rank:

- Huge defense primes requiring heavy certifications
- Hardware-only buys
- Construction, facilities, physical equipment
- Medical/clinical services outside scope
- Opportunities needing certifications MehyarSoft does not yet have
- Very short deadlines unless simple/RFI-style

## Admin cockpit features

### 1. Daily Opportunity Inbox

Private admin list with:

- Title
- Agency
- Source: USAspending, SAM.gov, or both
- Opportunity type: market signal, active solicitation, RFI, sources sought, award-history lead
- Deadline / close date
- Estimated value when available
- Fit score: 0–100
- Confidence level
- Why it fits MehyarSoft
- Why it may not fit
- Required registrations/certifications
- Next best action
- Status: new, reviewing, draft needed, submitted, follow-up, not fit, archived

### 2. Smart Fit Score

Score each record using:

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

### 3. Daily Digest

Every morning, show:

- Top 5 active opportunities
- Top 5 agency spending signals
- Urgent deadlines
- “Apply today” candidates
- “Watch this agency” candidates

Optional Telegram/email summary later, but admin listing comes first.

### 4. Application Workspace

For each active opportunity:

- Save source documents and links
- Extract requirements/checklist
- Build a compliance matrix
- Generate first-draft capability statement language
- Generate question list for the contracting officer
- Generate response outline
- Generate pricing/thought process notes for owner review
- Track submission checklist

Important: the assistant drafts; owner reviews and submits. No automatic public submission without explicit owner approval.

### 5. MehyarSoft Capability Library

Reusable private blocks:

- Company summary
- NAICS codes to pursue
- Core service descriptions
- Case-study snippets
- Past-performance style examples
- Differentiators
- Security/privacy statements
- Small-business positioning
- Resume/owner bio snippets without exposing unnecessary personal info

### 6. Agency Watchlist

Track agencies that repeatedly buy relevant services:

- Department/office
- Spend category
- Recent award winners
- Typical contract values
- Relevant keywords
- Contacts/source links where public
- Next monitoring action

## Data model sketch

Tables or equivalent durable storage:

- gov_opportunity_sources
- gov_opportunities
- gov_opportunity_scores
- gov_opportunity_events
- gov_opportunity_documents
- gov_application_workspaces
- gov_capability_blocks
- gov_agency_watchlist

Keep admin data private. Do not publish raw internal scoring, notes, drafts, or personal information.

## Daily ingest workflow

1. Run daily scheduled search.
2. Pull USAspending award/spend signals for relevant keywords/categories.
3. Pull SAM.gov active opportunities for matching service terms.
4. Normalize records.
5. Deduplicate by source ID, title, agency, and date.
6. Score fit.
7. Store in admin database.
8. Mark urgent items.
9. Surface top items in admin.
10. Produce a short owner digest.

## Search keyword seed list

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

## Safety/compliance guardrails

- Never auto-submit proposals.
- Never invent eligibility, certifications, past performance, staffing, or pricing.
- Clearly separate extracted source requirements from drafted response language.
- Store source URLs and timestamps for every recommendation.
- Keep owner-only drafts behind admin auth.
- Use no-store headers for admin endpoints.
- Redact secrets and tokens from logs.
- Preserve audit trail of generated drafts and owner edits.

## MVP acceptance criteria

- A daily scheduled run can fetch and store at least 20 relevant records from public sources.
- Admin shows a government opportunities page with sorting/filtering.
- Each record has fit score, reason, deadline, and next action.
- Owner can mark status and add notes.
- Owner can open a record and generate a draft response outline/checklist.
- System avoids auto-submission and keeps all data owner-only.
- Live production smoke test confirms the page and API are protected.
