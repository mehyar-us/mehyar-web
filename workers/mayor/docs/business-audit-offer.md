# Mehyar US business audit offer

Public path: `https://mayor.mehyar.us/business-audit`. Link to it from the main `mehyar.us` site and the Mayor workspace. Price: **$330 USD, one-time**, separate from Mayor subscriptions and third-party services.

## Buyer deliverables

One business and its primary website receive a comprehensive report covering:

1. Website and customer journey: captured content, mobile viewport signals, navigation links, service clarity, trust signals, inquiry/contact paths, and the steps toward becoming a customer. Rendered layout, speed, accessibility conformance, and live form submissions are not measured by the static evidence collector.
2. Services and booking: service selection, availability presentation, booking flow, confirmation details, cancellation information, and identifiable customer friction.
3. Customer retention: supplied follow-up practices, reminders, repeat-service opportunities, and communication gaps.
4. Local visibility: public business facts, location/service pages, and supplied listing/review links. Do not imply access to private analytics, search ranking tools, or a connected Google Business Profile.
5. Daily operations: described inquiry handling, callbacks, scheduling handoffs, recurring administration, and opportunities to simplify work. Mark conclusions based on owner statements as such.
6. Priorities and a 30/60/90-day plan: specific actions, likely impact, estimated effort, and a check for success linked to the buyer’s goals.

The completed deliverable should contain an executive readout, evidence index, all six chapter statuses, annotated evidence where available, identified strengths and issues, explicit limitations, a prioritized action table, and the staged plan. For each finding record the observation, source/URL or supplied material, review date, rationale, recommended action, estimated effort/likely impact, and a practical validation step. Distinguish direct observation, owner-supplied statements, inference, and inaccessible/unverified areas. A report must not manufacture weaknesses or imply measurement that was not performed.

Implementation, ongoing monitoring, account changes, outreach, advertising spend, paid third-party services, and specialist legal/financial/security assessments are separate. There is no promised turnaround or guaranteed revenue improvement in the current offer.

## Intake and checkout

Required: contact name, email, business name, primary public website, business goals, and explicit acceptance of the visible scope/terms. Optional: notes and up to five authorized supporting links. File upload storage is not implemented; the form must not imply that a selected file has been uploaded. Do not request passwords or sensitive customer records.

The page checks `GET /api/business-audit/offer` and verifies $330 USD one-time before enabling checkout. Disabled, test, and live availability must remain distinct. Checkout is created only after an explicit valid form submission using `POST /api/business-audit/checkout`, a UUID `Idempotency-Key`, and the supported intake body. Test mode labels the button and notice as a test. Only the verified Stripe checkout URL may receive a redirect.

After checkout, `/business-audit?receipt=TOKEN` supplies a private capability for order status. The page stores the token in session storage, removes it from the visible URL, and queries `GET /api/business-audit/status` with a Bearer header and no-referrer policy. Payment and fulfillment states remain separate. The page never infers payment from a successful redirect or labels a test payment as a live purchase. Tokens and raw intake must not enter analytics, logs, public URLs, or public report pages.

## Automatic generation, review, and delivery

The Mayor's server workflow collects supported public static website evidence and owner-supplied context, generates a structured report, and submits it to a separate automated review. Exact source quotes and report references are validated. Missing access, internal workflows, private analytics, rendered-browser behavior, and unmeasured business outcomes must remain explicit unknowns. There is no required human review step in this offer.

Live checkout is gated by configured Stripe billing and `MAYOR_AUDIT_FULFILLMENT_READY=true`, which means the autonomous engine and authorized delivery path are ready. A successful payment only queues work. Generation records `in_review`; a failed or rejected report records an attention state instead of pretending the deliverable exists. `report_ready` is set only after a reviewed, approved report has been saved. Payment and fulfillment audit trails remain separate.

The buyer opens `/business-audit/report#receipt=TOKEN` from their private receipt. The frontend stores and removes that fragment, uses a Bearer header for `GET /api/business-audit/status` and `GET /api/business-audit/report`, checks the saved order and review, and renders every model/source string as plain text. No private intake or token appears in the report export. Test purchases remain explicitly labeled as tests.

The report includes an evidence-based summary, true coverage and priority counts, estimated impact/effort matrix, 30/60/90-day roadmap, comprehensive findings with citation annotations, measurement plans with unknown baselines, captured HTML observations, collection limitations, unresolved questions, and automatic review provenance. Matrix placement and priorities are judgments, not measured performance scores. The buyer can print/save the report as PDF through their browser or download its structured report data.

Public wording describes the actual automatic workflow and completed scope, without fake testimonials, sample findings, invented reports, instant fulfillment claims, or a delivery deadline. Report-outline content is labeled as structure, not as an audit already performed. Support and purchase/cancellation/refund commitments must reflect the operator's configured service terms; the frontend must not invent them.
