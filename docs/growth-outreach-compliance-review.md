# MehyarSoft Growth / Outreach Compliance Review

Task: t_faad576a
Source plan reviewed: /home/mehya/.hermes/kanban/boards/mehyarsoft-llc/workspaces/t_12ac3e2f/mehyarsoft-growth-systems-plan.md
Repo reviewed: /home/mehya/work/mehyar-web @ cf63a97

## 1. Reality Check

GO for manual prospect research and founder-led social posting.
CONDITIONAL GO for very low-volume manual email only after each send is logged and opt-outs/suppressions are recorded before any repeat touch.
NO-GO for automated outbound email, bulk campaigns, cold SMS, automated calls, paid ads, or regulated-vertical claim-heavy copy until the control gates below are implemented and verified.

The parent growth plan is directionally safe because it repeatedly says manual-first, no blasting, no cold automated SMS/calls, source URL required, suppression required, and no PHI/medical claims. The required edit is to make those controls operational and non-optional before any outreach scale.

## 2. Hires / Owners

- Boss / Founder: approves offer, physical mailing address decision, first vertical, and any high-risk prospect before contact.
- ComplyOps: owns send gates, suppression policy, consent classifications, opt-out/STOP handling, regulated-vertical review, and campaign approval checklist.
- DevOps / Backend: owns Cloudflare intake, D1/KV schema, audit logs, Turnstile, admin auth, and suppression enforcement.
- LeadFS / CRM: owns prospect fields, channel eligibility, lead status, sequence state, and dashboard evidence.
- Counsel: required before automated SMS/calls, regulated healthcare/financial claims, purchased-list use, or any consent flow that will be reused at scale.

## 3. Current Blockers

P0 blockers before any scaled outbound:
1. No production suppression enforcement exists yet; current site is mailto-first.
2. No durable opt-out workflow exists for repeat outreach.
3. No audit log exists for send decision, sender, source URL, channel eligibility, or suppression check.
4. No approved commercial email footer decision exists for physical mailing address.
5. No counsel-approved SMS/voice consent path exists; cold automated text/call is blocked.
6. Public site still has reputation-risk/fake-template content per QA artifact; acquisition traffic should wait until fake/unverifiable proof is removed.

## 4. Workstream Status

### Go / No-Go Checklist

Allowed now:
- Manual prospect research from public business sources.
- Recording source URL, observed pain signal, vertical, city/state, public contact channel, and risk tier.
- Founder-led LinkedIn/content posts that do not shame businesses and do not make unverifiable claims.
- Warm referral conversations.

Conditional manual email gate:
- Max 5-10 first-touch emails/day.
- Public business contact basis only; no purchased consumer lists.
- Every prospect has source_url, source_type, pain_signal, channel_eligibility, risk_tier, and suppression_status before send.
- Email includes accurate identity: MehyarSoft LLC / Mehyar Swelim.
- Subject accurately matches the observed business issue.
- Includes simple opt-out language on every touch, not only touch 1.
- Opt-out replies are recorded immediately and block future contact.
- No follow-up is sent if suppression status is opt_out, complaint, legal, invalid, bounced, or unknown-high-risk.
- High-risk verticals/records require manual approval before send.

Blocked until implemented:
- Automated outbound email sequences.
- Any bulk upload/send feature.
- Automated cold SMS or voice calls.
- Retargeting or paid ads without intake, privacy language, consent capture, and attribution.
- Healthcare/medspa/dental copy that implies medical outcomes, HIPAA handling, patient acquisition results, or clinical claims.
- Use of raw PII in logs, screenshots, tickets, public docs, or frontend bundles.

### Required Suppression Data Model Edits

Add or align D1 tables so they support both inbound leads and outbound prospects:

- prospects: id, business_name, vertical, website_url, public_contact_email_hash, public_phone_hash, city_state, source_url, source_type, owner_or_manager_name, pain_signal, risk_tier, channel_eligibility_json, suppression_status, manual_approval_status, last_contacted_at, next_follow_up_at, sequence_state, notes, created_at, updated_at.
- suppression_entries: id, type(email/phone/domain/business/person), value_hash, raw_value_encrypted_optional, reason(opt_out/bounce/complaint/manual/legal/invalid/stop), channel, source_event_id, created_by, created_at, expires_at_nullable.
- consent_events: id, subject_type(lead/prospect), subject_id, channel, consent_status(unknown/service_request/marketing_opt_in/sms_opt_in/revoked), source, consent_text_version, source_url_or_form_url, created_at.
- outreach_events: id, prospect_id_or_lead_id, channel, direction, template_or_touch, subject, body_hash_or_copy_version, sender_identity, source_url, compliance_state, suppression_checked_at, decision(approved/blocked/sent), block_reason, actor, created_at.
- source_records: id, entity_type, entity_id, source_url, source_type, captured_at, terms_notes_optional.
- audit_log: id, actor, action, entity_type, entity_id, metadata_json_no_raw_pii, created_at.

Minimum matching rules:
- Normalize and hash email, phone, domain, business, and person identifiers.
- Block on any matching suppression at the most conservative applicable level.
- Store raw values only where operationally necessary and never in logs.

### Campaign Approval Checklist

Before any campaign or sequence is approved:
- [ ] Objective and offer are clear and truthful.
- [ ] Prospect source is lawful/public or warm; no purchased consumer list.
- [ ] Each record has source_url and source_type.
- [ ] Each record has channel_eligibility for the proposed channel.
- [ ] Suppression check passes at email/phone/domain/business/person levels.
- [ ] Risk tier is low or medium; high requires named manual approval.
- [ ] Sender identity is accurate.
- [ ] Subject line is non-deceptive.
- [ ] Footer includes business identity, working reply path, opt-out language, and physical address decision once commercial email scales.
- [ ] Opt-out handling SLA is prompt and operational before follow-up.
- [ ] Bounce/complaint capture is configured or manually monitored.
- [ ] Copy avoids fake familiarity, fake testimonials, fake case studies, unverifiable metrics, medical claims, and sensitive-data asks.
- [ ] Audit log writes before and after each send.
- [ ] Daily limits are set and enforced.

### Risk Tiers

Low:
- Warm referral, existing business relationship, inbound lead, or public business contact with clear operational reason.
- Non-regulated local services/restaurants/salons with no sensitive-data request.

Medium:
- Cold public business email from Google Maps/directory/website.
- Professional services, multi-location businesses, or ambiguous role/contact ownership.
- Requires stronger personalization and no automation in week 1.

High:
- Healthcare, dental, medspa, finance, legal, insurance, or any record involving sensitive client/customer data.
- Personal email not clearly used for business.
- Any complaint/spam warning, prior opt-out, bounced address, scraped source ambiguity, or missing source URL.
- Requires manual approval or no outreach.

Prohibited unless counsel approves:
- Automated cold SMS/calls.
- Purchased consumer data.
- PHI/patient details or medical outcome claims.
- Deceptive urgency, implied prior relationship, or fake social proof.

### Sender Readiness Score

Use a 100-point readiness gate:
- 20 pts: domain/email identity configured with accurate from/reply-to and monitored inbox.
- 15 pts: suppression table active and tested with seeded suppressed records.
- 15 pts: opt-out capture works and blocks future contact.
- 15 pts: audit log captures decision, actor, source URL, channel, and compliance state.
- 10 pts: prospect records require source URL, source type, channel eligibility, and risk tier.
- 10 pts: copy approved for truthful identity, accurate subject, no fake proof, no regulated claims.
- 10 pts: bounce/complaint monitoring exists.
- 5 pts: sending volume limits and pause rules documented.

Score decision:
- 0-59: NO SEND.
- 60-79: Manual-only limited send with owner review.
- 80-89: Controlled manual sequence only.
- 90-100: Eligible for small automation pilot, still no SMS/voice without counsel-approved consent.

Current estimated score: 35/100. Reason: plan is compliant on paper, but suppression enforcement, opt-out workflow, audit logging, physical address decision, and production intake are not yet implemented.

### No-Send Gates

Block send when any of these are true:
- suppression match exists for email, phone, domain, business, or person.
- source_url is missing.
- channel_eligibility does not include the intended channel.
- consent status is revoked, STOP, opt_out, complaint, legal, invalid, or unknown for SMS/voice.
- high-risk record lacks manual approval.
- physical address/commercial footer decision is missing for scaled commercial email.
- copy lacks opt-out language.
- subject line overstates or misleads.
- record asks for PHI, patient details, medical symptoms, financial account data, or other sensitive data.
- prior touch is too recent or sequence completed.
- audit log cannot write.
- daily cap would be exceeded.

### Unsubscribe / STOP Handling Requirements

Email:
- Accept reply-based opt-out immediately: “no thanks,” “unsubscribe,” “remove,” “stop,” or equivalent.
- Record suppression reason=opt_out, channel=email, and source_event_id.
- Block future contact across matching email and, when appropriate, business/domain/person.
- Include opt-out language on every touch.
- For scale, add one-click unsubscribe or a simple web opt-out before automation.

SMS/voice:
- Do not send automated cold texts or place automated cold calls without counsel-approved explicit consent.
- If SMS is later enabled for inbound/opt-in leads, STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, and QUIT must immediately suppress the phone number.
- START/UNSTOP only restores eligibility if policy/counsel allows and consent evidence is retained.
- Maintain message copy/version, consent event, timestamp, and source of consent.

Complaints/bounces:
- Any spam complaint: suppress email and business/domain if appropriate; pause the segment and review source/copy.
- Hard bounce: suppress address as invalid.
- Soft bounces: retry conservatively; suppress after repeated failures.
- Any complaint in week 1 pauses that vertical and sending source until reviewed.

## 5. Risks

High:
- Reputation/domain damage if the plan is treated as permission for automated outbound before gates exist.
- TCPA exposure if missed-call/SMS demo becomes real automated cold texting.
- Regulated vertical risk if clinics/dental/medspa copy solicits patient facts or implies medical outcome improvement.
- Deceptive-social-proof risk remains on current public site until fake/unverifiable template content is removed.

Medium:
- Reply-based opt-out can fail if manual process drifts; needs dashboard/sheet enforcement immediately.
- Physical mailing address decision may delay compliant commercial email scale.
- Google Maps/directory source terms and role ambiguity need conservative treatment.

Low:
- Manual warm outreach and educational posts are acceptable if truthful and logged.

## 6. Decisions Needed

1. Physical mailing address for commercial email footer when campaigns scale.
2. First low-risk vertical: recommendation is restaurants/local services before dental/medspa.
3. Whether to require owner approval for every healthcare/finance/legal record in the first 50; recommendation: yes.
4. Whether to remove or rewrite all fake/unverifiable public-site proof before any ads or cold traffic; recommendation: yes, required.
5. Email provider and domain strategy for any future automation; recommendation: manual monitored inbox first, dedicated sending domain later, never blast from primary brand domain without warmup and gates.

## 7. Next 48 Hours

1. Add a temporary CRM/sheet or D1-backed tracker with required fields: source_url, source_type, channel_eligibility, risk_tier, suppression_status, manual_approval_status, last_contacted_at, opt_out_at.
2. Create seeded suppression test records and verify they block manual send approval.
3. Add a manual send approval checklist to the owner workflow before first 5-10 emails.
4. Make opt-out capture operational before touch 2 can happen.
5. Remove or rewrite fake testimonials/case studies/team/history before driving acquisition traffic.
6. Keep SMS/voice in demo/draft-only mode; no automated outbound text/call.
