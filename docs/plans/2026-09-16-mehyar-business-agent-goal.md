**Mehyar Business Agent "Mayor AI" — complete implementation goal and commercial specification**

Planning date: September 16, 2026. Status: proposed implementation specification; no implementation, provider enrollment, price publication, or production activation has been performed by creating this document.

**Controlling constraint: protect existing Stripe flows.** The user explicitly states the current checkout and Stripe webhook work correctly and all other products depend on them. Do not modify, refactor, replace, reroute, redeploy over, or change configuration for existing checkout/webhook endpoints, signing secrets, subscribed Stripe events, shared payment/fulfillment helpers, existing SKUs, success URLs, token semantics, payment-status responses, or dependent database contracts. This constraint overrides any broader migration language below. Research and regression-test those contracts read-only. Build the new business-agent subscriptions using separately named endpoints, a separately registered Stripe webhook with its own signing secret and event scope, new subscription SKU IDs, and new agent-billing tables. Existing functions must not import the new code. No migration of the old payment or fulfillment path is authorized by this goal.

**Copyable goal**

Build and launch Mehyar Business Agent using this entire specification as the implementation contract. Each subscribing business must receive its own persistent agent, private workspace, business memory, tool connections, schedules, permissions, activity history, and usage budget. Sell outcomes such as answering customers, managing appointments, following up, and delivering work. Start subscriptions at $349/month. Provide conversational website onboarding and a combined Google signup-and-connect journey with selectable permissions. Use Cloudflare-native infrastructure for the core system, official provider APIs for communications, and isolated OpenClaw execution only where a defined advanced capability requires it. Implement the new commercial catalog, all explicitly in-scope automations, additive new-platform migrations, tests, operations, and staged release gates below. Preserve existing purchases, agreements, and the entire existing Stripe checkout/webhook flow unchanged. Cross-reference dependent product repositories before integrating with existing read interfaces. Do not declare completion based on mock screens or simulated integrations: produce live provider test evidence, tenant-isolation evidence, billing reconciliation, recovery drills, and pilot results. External approvals that remain unresolved must stay explicit blockers for the affected capability, never be represented as completed features.

**A. Product and boundaries**

The product is a managed digital business operator. An owner enters a website, connects selected accounts, confirms what the agent learned, and begins working through a mobile-friendly conversation. The agent operates between conversations within owner-approved rules. It remembers preferences, reports completed work, and brings exceptions back to the owner.

There are three distinct identities: the business buying an agent; a product/brand operated by that business; and an end customer buying from or contacting that business. Never merge these concepts or share their data simply because email addresses match. A user may belong to several business workspaces and must explicitly switch context.

Represent MehyarSoft's 18 catalog products as internal workspaces or separately scoped brands under an explicitly authorized organization. Activate capabilities only where working product interfaces and permissions have been verified; placeholder or empty repositories remain explicitly unready. Consumer purchases remain separate from managed-agent subscriptions. A $5 or $29 purchase does not buy a $349/month agent, and a lifetime dashboard purchase must not silently become a subscription.

Public branding uses Mehyar Business Agent and role names. OpenClaw, Hermes, model names, Cloudflare resources, and OAuth implementation details belong in internal operations. Provider consent, processor disclosures, and data-use explanations remain accurate and visible when needed. Do not promise guaranteed revenue, unmeasured time savings, or universal autonomous operation.

**B. Architecture decision**

Use React/TypeScript for the customer PWA, preserving the existing public React/Vite site. Place the authenticated application at `app.mehyar.us`; retain `mehyar.us` for discovery, audit, pricing, and purchase. Add dedicated Workers services for identity, tenant APIs, agents, connectors, and asynchronous execution; do not turn the existing Pages request handlers into a long-running scheduler.

Use Cloudflare Agents SDK with a dedicated business Agent/Durable Object identity per tenant. Use separate conversation objects where needed for concurrency. Each business gets a durable agent with its own state; sharing deployed application code does not mean sharing conversations or credentials. This is logical and storage isolation enforced by the application, not a claim that every subscription receives a dedicated physical server.

Use D1 for identity, tenant directory, catalog, billing, and indexed operational records; normalized tenant-scoped tables rather than a new table per business. Use Durable Objects for serialized business coordination, resource booking locks, approvals, and usage reservations. Use R2 for private documents, generated deliverables, and exports; Vectorize for tenant-filtered retrieval; Workflows for resumable multi-step tasks; Queues for webhook intake and work dispatch. Maintain a tenant directory that permits later database sharding without changing business IDs. Large tenants can move to dedicated databases after measured capacity thresholds.

Use AI Gateway by environment and workload, with server-assigned tenant metadata and application-enforced budgets. Do not create one gateway per customer: the currently documented default limit is 10/free or 20/paid gateways per account. Gateway configuration is not the tenant authorization boundary. Disable cross-tenant caching of private prompts and minimize stored model payloads. Build critical routing, cost limits, and authorization in the application so beta gateway features are optional enhancements. [Cloudflare architecture](https://developers.cloudflare.com/reference-architecture/diagrams/ai/enterprise-ai-agent-workspace/), [gateway limits](https://developers.cloudflare.com/ai-gateway/reference/limits/).

Use Better Auth on Workers with its supported D1 integration, organization membership, Google/Microsoft OAuth, email recovery, and MFA/passkeys where supported by the pinned version. Implement a first milestone proving combined Google authorization, D1 persistence, and encrypted server-side token custody before building the rest of onboarding. Do not invent custom cryptography or store provider credentials in browser sessions. [Better Auth D1 support](https://better-auth.com/blog/1-5), [Google provider](https://better-auth.com/docs/authentication/google).

Use direct Google and Microsoft adapters for core email/calendar, direct Meta WhatsApp Cloud API, Twilio Programmable Voice plus ConversationRelay, and separate Stripe Checkout/Billing/Customer Portal paths for the new subscriptions. Use Resend for new platform transactional notices; existing product email paths remain untouched. Connected business correspondence uses the owner's authorized mailbox, not a spoofed sender. A common connector interface permits additional adapters without replacing the core.

OpenClaw is an optional executor for approved browser/shell tasks, not the core identity, billing, memory, or authorization system. When sold, allocate one isolated tenant cell on durable Linux VM/container infrastructure, pinned image, separate encrypted state, private ingress, controlled egress, limited tools, and short-lived tool-broker capabilities. Never place unrelated customers in one OpenClaw gateway. Do not assume Cloudflare Containers local disk preserves OpenClaw state: local disk is currently ephemeral. No Hermes dependency in the initial architecture. [OpenClaw tenancy](https://docs.openclaw.ai/gateway/multi-tenant-hosting), [Cloudflare container lifecycle](https://developers.cloudflare.com/containers/concepts/architecture/).

**C. Dedicated-agent provisioning and lifecycle**

Create tenant, membership, agent ID, agent name, plan entitlements, knowledge scope, credential references, and initial workflow configuration through a resumable provisioning workflow. Each step has an idempotency key and a compensating/recovery action. Provisioning must survive duplicate callbacks or payment webhooks without creating duplicate tenants, agents, or phone numbers.

Use explicit states: draft, researching, awaiting-owner-confirmation, awaiting-connections, trial, ready-for-activation, active, degraded, paused, past-due, offboarding, deleted. Connected-account and workflow states are separate from subscription status. Owners can name their agent and edit its voice/tone, hours, escalation contacts, allowed actions, and memory. Agent roles share approved business knowledge but preserve conversation/person permissions.

Suspension stops new business effects while keeping necessary receipts, support access, and export available. Offboarding revokes integrations, releases/transfers numbers as agreed, stops schedules, exports eligible data, and applies the retention policy. Deleting an organization cannot accidentally delete another organization owned by the same person.

**D. Signup with Google and automatic connections**

Present a single signup journey: business website and goal, then a Google option with capability checkboxes, then provider authorization, then automatic agent setup. Make identity-only signup available. The button may say “Continue with Google & connect selected tools” outside Google's required branding element.

Checkboxes describe outcomes rather than raw scopes:

| Selection | Initial capability | Boundary |
| --- | --- | --- |
| Read business email | Detect inquiries, summarize threads, draft answers in Mehyar | Reading does not authorize sending, deletion, or mailbox changes |
| Send business email | Send drafts or policy-approved responses | Separate owner automation policy still controls recipients and purpose |
| Check calendar availability | Read selected calendars and busy times | Owner selects which calendars after authorization |
| Manage appointments | Create/update/cancel permitted events | Business hours, resources, customer verification, and rescheduling rules apply |
| Use Drive documents I select | Import owner-selected business documents | Explain read-only Drive permission accurately; server-side file selection limits what enters agent knowledge |

Offer only implemented, approved capabilities. Additional Google services appear as they become supported, with their own explanation. Do not ask for every Google permission preemptively, silently preselect unrelated access, or treat a Google login token as Gmail authorization. WhatsApp, Microsoft, and phone-number setup require their own provider flows and are not activated by Google consent.

Build one authorization-code journey requesting OIDC identity plus the explicitly selected, allowed API scopes. Use a server-side allowlist, state, PKCE where supported, nonce/ID-token checks, exact callback validation, offline access, and incremental authorization. Store the requested capability selection in expiring server-side onboarding state. Validate subject/issuer/audience and associate the grant with the correct verified user and intended tenant. Never rely on email alone to link accounts.

After callback, establish the session, finish tenant provisioning, record actual granted scopes, securely retain a refresh token when supplied, select usable calendars, create watches, and show individual connection results. Preserve an existing valid refresh token when a later callback omits it. If offline access is unavailable, show “reconnect required for background operation.” Partial consent must still permit signup and the granted features. Changing permissions later must not require another account or erase existing grants. Provider consent can have multiple screens; promise one coherent setup journey, not guaranteed one click. [Google server authorization](https://developers.google.com/identity/protocols/oauth2/web-server), [granular consent](https://developers.google.com/identity/protocols/oauth2/resources/granular-permissions).

A new subscriber may link an existing product purchase only after verifying ownership. Invitation acceptance, account recovery, multiple business memberships, switching Google accounts, and connecting a different work mailbox must all be supported and tested.

Drive implementation decision: keep provider tokens server-side. The optional Drive checkbox uses reviewed read-only scopes and a server-mediated file browser/search; explain that the provider grant is broader than the particular files subsequently selected. Fetch document content for agent ingestion only after selection and persist that allowlist. Never hand a combined Gmail/Calendar/Drive token to a browser-based picker. If the broader read-only Drive scope is not approved, disable this checkbox and offer uploads; a future native Google Picker requires a separate narrow credential design and approval, not a silent security exception.

**E. Professional website research and onboarding conversation**

Normalize and validate the URL; block local/private/link-local addresses, metadata endpoints, unsafe redirects, and oversized responses. Respect crawl permissions, bound pages/depth/time, and handle malicious page instructions as untrusted content. Fetch sitemap, structured data, metadata, homepage, about, contact, services, pricing, policies, booking links, relevant locations, and FAQs. Render JavaScript when needed using Browser Run. A failed crawl offers manual input or document upload rather than invented facts. [Browser Run crawl](https://developers.cloudflare.com/browser-run/quick-actions/crawl-endpoint/).

Extract business name, category, services, prices, currency, hours, locations, service area, contact routes, booking systems, public policies, brand language, and existing customer tools. Every inferred fact has a source URL, timestamp, and confidence. Distinguish direct evidence from estimates; a website cannot establish actual revenue, customer consent, private stock levels, or internal operating rules.

Show an editable business brief and three prioritized automation recommendations, with prerequisites, expected workflow improvement, included plan/add-on, and examples. Ask only unresolved questions: who owns requests, service duration, staff/resources, cancellation rules, escalation destination, tone, and permitted autonomy. Confirm the business identity before installing a widget, publishing changes, or activating communications. Use a DNS/file/CMS verification method or a documented equivalent proof.

Trial: seven days, no card required, one provisional agent, one site crawl up to 20 pages, 50 standard AI credits, and two workflow previews. Allow real connector authorization and read-only/draft demonstrations. External autonomous sends and paid telephone provisioning begin only after policy activation and a paid plan; the demo can show exactly what would be sent. After trial, pause execution and retain/export trial data for 30 days before scheduled deletion, subject to lawful records obligations.

**F. PWA and everyday experience**

Provide signup/login, conversational onboarding, chat, Today, activity, approvals, customers/leads, calendar, automations, knowledge, connections, team, billing/usage, and settings. The default screen shows the conversation plus what was completed, what is running, and what needs attention. Render actionable cards for proposed replies, appointments, documents, and approvals with clear status.

Support streaming, interrupted-session recovery, file upload, mobile installation, accessible controls, timezone-aware dates, and useful empty/error states. Use plain language: “Appointment confirmed” requires a provider receipt; “Request received” is distinct from a confirmed booking. Provide a persistent pause button and human handoff.

Service workers cache the application shell, not credentials or sensitive inbox bodies. Offline mode permits viewing explicitly cached non-sensitive information and composing local drafts; external actions require reconnection and current authorization. Server-side jobs continue with the app closed. Push is opt-in, with redacted previews and email/in-app alternatives. Test real Android and iOS Home Screen behavior. [WebKit push behavior](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).

**G. Roles, knowledge, and authorized autonomy**

Human roles: owner, manager, staff, billing manager, viewer, and time-limited audited Mehyar support. Staff access can be restricted to assigned customers, calendars, and conversations. Support access requires a visible reason, expiry, and audit record. Revocation must apply to queued actions and active sockets, not just future logins.

Agent roles: receptionist, scheduling coordinator, customer support, follow-up assistant, sales coordinator, content assistant, and operations reporter. These are capability presets of the business's agent, not unbounded agents that can grant themselves permissions.

Support three modes per workflow: preview/draft; approve each action; automatic within a saved policy. A policy defines trigger, allowed resources and recipients, templates, time window, maximum frequency, spending limits, escalation rules, and expiry. Store who authorized it and which version. Low-risk FAQs and selected scheduling can run automatically after activation. Publishing, campaigns, refunds, purchases, destructive changes, unusual cancellations, and high-risk judgments require the configured approval or escalation. Never allow the LLM to alter its own authority.

Separate approved business facts, owner preferences, customer-specific records, source material, and transient model context. Memory is viewable, editable, correctable, exportable, and deletable. An email or document may supply facts but cannot authorize tools. No training of shared models on customer communications without a separately valid basis and explicit product decision.

**H. Connector and secret architecture**

The connector broker exposes typed operations such as listAvailability, createAppointment, readThread, sendReply, and sendTemplate. Validate tenant, actor, granted scopes, business policy, destination, object ownership, cost reservation, and input schema before each external action. The LLM receives results and credential handles, never raw secrets.

Store credential ciphertext with tenant/account binding, key version, expiry, and granted scopes. Use authenticated encryption with managed key material in Worker secrets or a suitable secret service; isolate secret access from general data APIs. Disable any authentication-library endpoint that exposes provider access/refresh tokens to the browser. Verify encryption and rotation rather than assuming library defaults. Cloudflare account-level deployment secrets use scoped API tokens; replace inherited global-key patterns in new services. No secrets injected into ordinary committed configuration or logs.

A connector registry records account types, scopes, supported reads/writes, webhook support, approval status, fee basis, health, last successful sync, known limitations, and reconnect path. States include not-connected, authorizing, partially-connected, healthy, limited, expired, revoked, awaiting-admin, and provider-outage.

Core launch connectors: Google Gmail/Calendar/selected Drive files; Microsoft Outlook mail/calendar; Meta WhatsApp business messaging; Twilio voice/SMS; Mehyar website widget/forms; Stripe for new agent subscriptions and read-only visibility into existing owned-product billing. Google sign-in cannot activate Microsoft or Meta. Brand-specific transactional email domains need verification.

Expansion adapters: HubSpot, selected Google Sheets/Docs, Microsoft OneDrive, Google Business Profile reviews, supported Instagram/TikTok publishing, and approved CMS updates. Implement and test each before sale; no generic “connect anything” promise. QuickBooks/Xero, POS, practice systems, MLS, booking marketplaces, and job-management systems require separately scoped adapters and permission review. Until integrated, offer a clearly labeled request/handoff workflow rather than fake real-time access.

**I. Continuous synchronization and scheduling**

Gmail notifications arrive through authenticated Google Pub/Sub; persist mailbox history cursors and renew watches daily. Google requires renewal at least every seven days. Calendar watches expire separately; renew each selected calendar and periodically reconcile missed changes. Microsoft Graph subscriptions need renewal, lifecycle handling, and delta recovery. Never depend on a browser tab being open. [Gmail push](https://developers.google.com/workspace/gmail/api/guides/push), [Calendar push](https://developers.google.com/workspace/calendar/api/guides/push), [Graph lifecycle](https://learn.microsoft.com/en-us/graph/change-notifications-lifecycle-events).

Validate and durably acknowledge incoming events, deduplicate them, then process through queues. Maintain inbox/outbox records, attempt counts, retry delays, dead letters, correlation IDs, and provider receipts. Queues deliver at least once: design for duplicates. Where external writes time out ambiguously, reconcile provider state before retrying. Do not claim universal exactly-once execution. [Queue guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/).

Scheduling includes business/customer timezones, daylight saving, working hours, holidays, duration, staff, rooms/chairs/vehicles, buffers, travel windows, notice periods, holds, deposits where integrated, and cancellation rules. Serialize our own conflicting attempts per resource, recheck provider availability before commit, and detect changes made outside Mehyar. Use conditional provider updates when available. Rescheduling preserves the old appointment until the replacement succeeds or executes a documented compensation. Confirm customer identity before exposing or modifying an existing appointment.

**J. Full automation catalog**

Each automation needs a versioned definition: trigger, inputs, evidence source, permissions, eligibility, action sequence, limits, owner approval, output receipt, meter, retries, cancellation, escalation, and test fixtures. The following are required templates, activated only when their data/connector prerequisites are satisfied.

| Group | Required templates | Commercial availability |
| --- | --- | --- |
| Business setup | URL research; business brief; missing-information interview; connector setup; first workflow preview; onboarding recovery | All subscriptions |
| Front desk | Approved FAQs; intent classification; contact capture; staff assignment; human handoff; after-hours message-taking | All subscriptions |
| Email | Relevant-inquiry detection; thread summaries; response drafts; policy-approved replies; attachments intake; unanswered-inquiry follow-up | All, within selected workflows |
| Appointments | Availability; booking; confirmation; reminders; rescheduling; cancellation; no-show follow-up; waitlist offer | All; advanced waitlist/resource rules from Growth |
| Sales | Qualification; quote draft; proposal draft; estimate follow-up; booking handoff; opted-in lead nurture | Basic in Business; multi-step nurture in Growth |
| Support | Order lookup; delivery-status explanation; retry/re-delivery; complaint routing; refund request; review response draft | All with verified order source |
| Retention | Rebooking; renewal reminder; dormant-customer win-back; satisfaction request; opt-out suppression | Growth; contact consent required |
| Content | Business content calendar; captions; emails; blog/FAQ drafts; approved asset generation; publication queue | Growth; creative generation and publishing allowances below |
| Documents | Intake checklist; selected-file retrieval; form extraction; missing-document reminder; report/PDF generation | Growth; sensitive workflows separately reviewed |
| Owner operations | Morning brief; urgent exception alert; weekly results; workflow health; cost report; knowledge refresh suggestions | All; multiple recurring research briefs in Operations |
| Product operations | Existing order/status monitoring and support drafts; new-agent deliverable generation/QA/delivery; new subscription renewal/dunning | Existing products read-only; execution only in separate new-service flows |
| Voice and WhatsApp | Customer-service conversations; lead intake; scheduling; handoff; permitted reminders/callbacks | Voice allowance all plans; WhatsApp Business optional/included as below |

Automations must suppress self-replies, auto-responder loops, duplicates, opted-out recipients, stale appointments, and already-resolved cases. Marketing messages are separate from transactional messages. Begin with approved inbound service and consented follow-up; cold outbound campaigns are outside launch scope.

**K. Ten industry packs**

Industry packs reuse the same agent and connectors. They customize the intake, facts, workflows, and guardrails; they do not fork the codebase or create unrelated subscription products.

| Industry | Initial workflows | Extra prerequisites and limits |
| --- | --- | --- |
| Barbers/salons | Service/staff intake, chair availability, booking, reminder, reschedule, rebooking, waitlist | Confirm service durations, chair/staff ownership, deposits and no-show rules |
| Home services | Missed-call intake, location/service-area check, photos, job qualification, estimate booking, estimate follow-up | Dispatch and technician status only through an integrated job system; urgent hazards escalate |
| Professional services | Consultation requests, qualification, document checklist, proposal follow-up, owner briefing | Confidentiality/conflict rules; no autonomous legal, tax, financial, or professional judgment |
| Auto services | Vehicle/concern intake, appointment request, estimate approval routing, service updates, reminders | Mechanics authorize diagnosis, repair scope, safety advice, and prices; shop-system integration required for live status |
| Real estate | Listing inquiry, property-specific answers, agent assignment, showing schedule, nurture | Authorized listing/CRM feed; no invented availability or discriminatory qualification |
| Restaurants/cafés | Menu/hours answers, reservation request, catering qualification, private-event follow-up | Confirmed table inventory or order submission requires reservation/POS integration; do not infer allergen safety |
| Spa/fitness | Service/class intake, trainer/room availability, confirmations, waitlist, renewal and rebooking | Membership and class-capacity source must be integrated before automated commitment |
| Pet care | Pet/service intake, booking, preparation messages, pickup and rebooking reminders | Capacity and vaccination records only when permitted; veterinary questions escalate |
| Retail | Product questions, pickup requests, order support, opt-in product-drop reminders | Live stock, purchase, or fulfillment promises require an inventory/order adapter |
| Clinics/dentists | Public information and staff-directed appointment-request design | Public FAQ-only by default; patient-data workflows require a separate documented privacy/security/vendor assessment and appropriate contracts before activation; no clinical judgments |

All ten packs get template tests. Live external pilots start with barber/salon, home services, and professional services. Clinics and regulated-data workflows have explicit additional release gates rather than an unsupported blanket compliance claim.

**L. All 18 owned products: commercial and automation mapping**

“Existing” below means observed local marketing copy or accessible public pages on September 16, 2026, not a verified active Stripe catalog. “Proposed” is a new recommendation, never a statement of the current charge. Reconcile active checkout products before changing anything.

| Product | Existing price evidence / proposed decision | Agent-enabled operation |
| --- | --- | --- |
| Rizza | Existing public Free: 20 replies/month; Pro $9.99/month or $3/week. Preserve existing contracts; do not add hidden limits to marketed unlimited access | Private suggestion generation, account support, entitlement checks. Never automatically impersonate the user or send dating messages. Remove factual personality-from-photo claims from new agent features |
| AiMech | Existing public Free; DIY $4.99/month or source-listed $47.88/year; Mechanic $14.99/month or $143.88/year. Preserve independent Base44 billing | Vehicle intake, informational assistance, maintenance reminders, support. Qualified mechanic handoff for safety-critical issues |
| BabyPeek | Existing $5 one-time portrait unlock | Consent-aware upload, preview, payment, generation, private delivery, deletion |
| RoastMe | Existing source lists $5/card. A $12/three-card pack is only a future proposal, not an authorized legacy catalog change | Moderation, playful card generation, delivery, optional user-directed sharing |
| Crayon Kid | Reviewed remote source is a coming-soon page with no checkout; propose $9 per 12-page personalized PDF only as future scope, subject to image-cost gate | Parent-led intake, line-art checks, name placement, print-ready assembly, private delivery; not a verified existing runtime |
| mehyar.jobs | No billing implementation found in reviewed repo; free weekly digest and $19/month daily matching are future commercial proposals, not existing prices | Source refresh, deduplication, freshness checks, explained fit, digests, user-approved application assistance; no autonomous mass applications |
| Stuff Pretty Good | Existing public free shopping guide; Home Office PDF $9, Gift-Proof PDF $7 | Approved-catalog checks, editorial drafts, affiliate disclosure, guide fulfillment, subscriber preferences |
| Designful | Existing source catalog: five individual products $49 each, three-job bundle $99, Studio Pass $149. Preserve exact existing entitlements and prices; live billing still needs read-only reconciliation | Agent observes existing brief/order/delivery status and drafts support. New work continues through existing purchase/generation interfaces, never a replacement payment hook |
| HustleKit | Existing $27 one-time | Three-track intake, sample, personalized playbook, delivery, optional progress reminders; no income guarantees |
| Sprint30 | Existing $37 one-time; first three days preview | Enrollment, timezone-aware daily missions, progress, pause/resume, unsubscribe, missed-delivery recovery |
| BizBuilder | Existing $17 one-time | Idea interview, plan/landing copy/five-email sequence, QA, export. Deployment and actual email sending require separate authorization/service |
| CreditFix Kit | Existing $47 one-time | Educational templates and plan, document completeness, reminders. No credit-bureau connection, automated dispute filing, or promised score improvement |
| PrepGuide | Existing $37 one-time | Household intake, deterministic quantities, sourced preparedness guidance, PDF, optional review reminder |
| TrueSketch | Existing $37 one-time | Entertainment artwork/reading, private gallery, delivery, deletion; no factual prediction claims |
| TikTok Growth System | Existing $27 one-time, five-hook teaser | Durable plan/hooks/bio generation and export. Publishing is a separate approved connected capability |
| PLR Vault | Existing $9.95 one-time | Licensed pack entitlement, versioned downloads, license delivery and support; verify asset rights |
| FreelancerOS | Existing $29 one-time, marketed “yours forever” | Preserve purchased dashboard/templates; offer optional $349+ business agent for connected follow-up, scheduling and operations |
| PromptPack Pro | Existing $19 one-time, five-prompt teaser | Profession intake, durable generation, check 50 prompts and 10 swipe files, private PDF delivery |

Local evidence: [Apps catalog](C:/Users/mehya/mehyar-web/client/src/pages/Apps.tsx). Public price evidence: [Rizza](https://rizza.app/), [AiMech](https://aimech.app/), [Stuff Pretty Good](https://stuffprettygood.com/). Missing satellite repositories, APIs, or live billing access are named dependencies. The new platform can expose separate adapters and read existing verified product status; it must not modify legacy central fulfillment or claim to have modified an inaccessible satellite application. All existing and suggested consumer price changes are research recommendations only and are outside this implementation goal's authorization to mutate the legacy catalog. Product-operation descriptions in this table are a capability map; they do not authorize replacing existing executors or triggering legacy business effects.

Also include MehyarSoft's own business as the first internal operating tenant: free audit, $5 report, $199 deep audit request, $330 technical audit request, service qualification, proposals, scheduling, follow-up, and paid onboarding. Preserve existing delivery terms until reconciled. Do not treat an invoice request as a completed payment.

**M. New fulfillment engine and protected legacy integration**

For new agent-owned deliverables, build an engine: verified new-service payment/entitlement -> generation workflow -> output validation -> private R2 artifact -> delivery outbox -> provider receipt -> customer status. Payment status, entitlement status, generation status, and delivery status are different fields. Existing product purchases continue through their existing payment and fulfillment paths unchanged.

Document browser-driven PromptPack generation, long request/waitUntil chains, TikTok dispatch/recovery, and Sprint30's external scheduler as future reliability opportunities; do not replace them under this goal. For existing products, first integrate monitoring and owner-visible support through established read-only APIs or authorized scoped reporting views. Do not add a second sender, scheduler, generator, webhook listener that executes fulfillment, or any automatic repair job to the legacy path. Any later migration needs a separately authorized plan covering every dependent repository, staging proof, a single active executor, and rollback. Preserve original order/access-token behavior.

Review files currently under public digital paths before promising access control. New agent deliverables use private R2 with short-lived signed downloads or authenticated access. Do not move existing product files or change existing customer links in this goal; document any legacy access-control findings separately for the owner.

Build non-mutating contract fixtures for each known SKU and its checkout, status, token, and fulfillment dependency. Do not replay production webhooks or make test purchases without explicit test-account authorization. For the new engine, test duplicate payment events, paid-but-unfulfilled work, generation/email failure, retry, refund, and expired links. New-engine backfills operate only on new-platform tables. Existing product purchases need not force account creation; purchase claiming uses established verification and does not rewrite historical payments.

**N. Subscription pricing: dedicated agent for every business**

All proposed prices are USD before tax. These new packages use the existing $349/$549/$899 anchors. Setup includes configured standard workflows, connection assistance, business knowledge review, activation testing, and handover. Every package includes the dedicated agent, owner PWA, private memory, audit trail, pause controls, monitored execution, maintenance, and standard support.

| Entitlement | Business Agent | Growth Agent | Operations Agent |
| --- | ---: | ---: | ---: |
| Monthly subscription | $349 | $549 | $899 |
| One-time setup | $1,500 | $2,500 | $4,500 |
| Annual subscription, paid upfront | $3,769.20 | $5,929.20 | $9,709.20 |
| Business agents | 1 | 1 | 1 |
| Included operating locations | 1 | 1 | 2 |
| Team seats | 3 | 5 | 10 |
| Connected accounts | 4 | 8 | 15 |
| Active configured workflows | 5 | 12 | 25 |
| Standard text AI credits/month | 2,000 | 5,000 | 10,000 |
| US inbound AI voice minutes/month | 100 | 300 | 750 |
| US local phone numbers | 1 | 1 | 2 |
| Website widget / primary site | Included | Included | Included |
| Initial/refresh crawl page allowance per month | 100 | 300 | 1,000 |
| Private artifact/document storage | 2 GB | 5 GB | 10 GB |
| Platform transactional emails/month | 1,000 | 3,000 | 10,000 |
| WhatsApp business channel management | Optional $49/month | One number included | Two numbers included |
| Advanced nurture/waitlist/document templates | Add-on | Included | Included |
| Managed workflow improvement time/month | 30 minutes | 45 minutes | 60 minutes |
| Support first-response target in published business hours | 2 business days | 1 business day | 4 business hours |

Included workflow count limits enabled configurations, not every individual execution. A connected Google account with Gmail and Calendar enabled counts as one connected account; two Google accounts count as two. Voice media and model costs are covered by voice minutes and are not also deducted as text AI credits. Third-party software subscriptions, advertising, external messaging charges, specialty integrations, and new creative deliverables are not silently bundled.

New annual pricing discounts subscription fees by 10%; Business therefore remains $314.10/month equivalent, above the user's $300/month floor. It does not discount setup, overages, provider pass-through, or human project work. Legacy ten-month annual agreements remain unchanged. Monthly included usage resets monthly even when billed annually; unused recurring allowances do not roll over. Honor existing agreements and purchases. Do not stack an old OpenClaw/Hermes retainer on the new plan for the same service. Existing customer-hosted offers are legacy custom scopes, not new self-service checkout items. A plan that includes voice cannot activate billing until its number/routing is ready, unless the owner explicitly accepts a separately priced, clearly described alternative scope.

**O. Feature/add-on prices and metering**

Prices below are proposed catalog entries, subject to the cost gates in P. No functionality may enter checkout without a scope, entitlement, meter, cancellation behavior, and readiness state. Bundled features show “included,” not a second charge.

| Item | Proposed price | Included scope / charging rule |
| --- | ---: | --- |
| Extra text AI credits | $25 / 1,000 | Prepaid; expire after 12 months, disclosed before purchase |
| Additional US AI voice | $0.35/minute | Actual connected seconds aggregated by billing period; exclude failed connection time |
| Voice expansion pack | $99/month | 300 additional US minutes; unused allowance expires monthly; lower unit rate than overage |
| Additional US local number | $10/month | Number management; specialty/international numbers quoted before purchase |
| WhatsApp management on Business | $49/month + $149 setup | One business number; provider messaging fees additional |
| Additional WhatsApp number on any plan | $29/month + $149 setup | Per-number setup/health; provider messaging fees additional |
| WhatsApp delivery | Actual Meta charge + 20% | Versioned market/category rate; estimate before campaign approval; no charge for an actually free provider event |
| SMS/MMS transport | Actual provider/carrier cost + 20% | Show segments, destination, carrier/registration charges; no unlimited messaging promise |
| SMS registration assistance | $99 once | Applicable provider registration fees separately shown; no promise of instant approval |
| Additional team seat | $15/month | Same tenant and permissions |
| Additional standard connected account | $15/month | Beyond plan allowance; provider subscription remains customer-owned |
| Extra five active workflows | $49/month | Existing templates, not custom engineering |
| Custom workflow configuration | $299 once/workflow | Up to two hours using supported connectors; extra work $150/hour with estimate |
| Additional location | $149/month + $499 setup | Same business and agent, separate location rules; independent business buys its own plan |
| Another independent business/brand agent | Full chosen plan | Separate data and subscription; no automatic cross-brand sharing |
| Advanced nurture/documents pack on Business | $99/month + $299 setup | Templates otherwise in Growth; uses existing usage allowance |
| Social publishing management | $99/month + $199 setup | Two supported profiles, 30 approved scheduled posts/month; content production extra |
| Content production pack | $149/month | 12 approved text/static-image posts, one revision each, up to three source assets per post; no video production |
| Short video production | $199 / four clips | Up to 30 seconds each, supplied or licensed source assets, one revision; custom filming excluded |
| Five additional GB storage | $10/month | Enforced tenant capacity and retention controls |
| Additional 100 crawl pages | $5 | Successful permitted pages; technical retries not billed twice |
| Extra 1,000 platform emails | $5 | Transactional/consented purpose; connected Gmail/Outlook correspondence uses AI/workflow allowance instead |
| Additional managed support/improvement | $150/hour | Approved work estimate; not a charge for fixing platform defects |
| Standard external adapter project | $1,500 setup + $99/month | One documented API, up to five named operations, agreed monitoring; eligibility/discovery first |
| Advanced isolated execution | $199/month + $750 setup | One tenant OpenClaw cell, up to ten active execution hours/month; additional $15/hour; defined tools only |
| Enterprise SSO | From $199/month + $500 setup | One identity provider, vendor costs and exact scope quoted; no billing until ready |
| Complex/regulated integration | $750 discovery, credited to accepted project | Deliver data map, vendor eligibility, fixed scope and quote; unsupported work is not sold as an enabled add-on |

A standard text credit funds one completed model generation within 12,000 input and 2,000 output tokens on the approved standard route. Larger work reserves a displayed multiple, calculated as the greater of ceiling(input/12,000) and ceiling(output/2,000), minimum one. Multi-step tasks show estimated total credits before execution; owner-approved recurring budgets can authorize them. More expensive routes require a published multiplier derived from supplier cost and an owner-approved cap. Retrieval-only operations and deterministic tools do not consume text credits. Failures, internal retries, and duplicate processing do not double-bill the customer; reserve, settle, and release usage explicitly.

Image/video/audio production has its own SKU or voice allowance; do not bury expensive generation inside a text credit. Publishing management does not buy paid reach, creative production, or platform approval. Advanced execution pricing is activated only after measured hosting/support costs pass the same margin gate.

Warn at 70%, 90%, and 100% of allowances. Default behavior at the limit is to pause optional paid actions, explain the reason, and route customer inquiries to the human fallback. Automatic top-up is opt-in with a monthly dollar ceiling. No hidden negative wallet or surprise overage invoice.

**P. Unit economics and pricing validation**

Supplier facts checked September 16, 2026: Workers Paid has a $5/account monthly minimum, not $5 per customer. Workers AI currently lists gpt-oss-120b at $0.35/million input tokens and $0.75/million output tokens. One maximum-size standard credit above therefore has approximately $0.0057 model cost before supporting services. [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [model price](https://developers.cloudflare.com/workers-ai/models/gpt-oss-120b/).

Twilio lists US local inbound voice $0.0085/minute, a local number $1.15/month, and ConversationRelay an additional $0.07/minute. Consequently 1,000 inbound minutes plus one number is approximately $79.65 before models, taxes, recording, transfer legs, and support. Budget $0.10/minute as an initial modeling assumption, then replace it with measured costs. It is not a supplier quote or guaranteed ceiling. [Twilio US voice](https://www.twilio.com/en-us/voice/pricing/us), [ConversationRelay pricing](https://static0.twilio.com/en-us/products/conversational-ai/pricing).

Meta message fees depend on recipient market/category and can change. Browser Run, Workflows, Queues, D1, R2, Vectorize, email, backup, monitoring, OAuth assessments, and support all need explicit cost lines; an inexpensive model does not make the whole service nearly free. Standard US Stripe card pricing is currently 2.9% + $0.30; Billing pay-as-you-go adds 0.7% of Billing volume. Actual merchant terms and taxes may differ. [Meta pricing](https://whatsappbusiness.com/products/platform-pricing/), [Stripe payments](https://stripe.com/pricing), [Stripe Billing](https://stripe.com/billing/pricing).

Build a versioned cost model with low, expected, and included-allowance stress cases. Formula: gross margin = (net subscription/add-on revenue minus attributable model, infrastructure, communication, payment, fulfillment, support, and refund costs) / net revenue. Keep acquisition and development overhead visible separately; do not call gross margin net profit. Treat setup revenue separately from recurring margin. The core subscription/value-add margin targets do not apply to disclosed provider pass-through: cost plus 20% creates only 16.7% gross margin before processing costs. Report pass-through and blended contribution separately, without hiding it in software margin. Prefer direct customer provider billing when practical and supported.

Proposed monthly direct-cost budgets are $85/$145/$250 for Business/Growth/Operations, including provision for ordinary support and payment charges. These are planning targets, not observed costs. At annual effective revenue of $314.10/$494.10/$809.10 per month, these imply roughly 72.9%/70.7%/69.1% gross margin if achieved. Validate caps and annual discounts together. Release gate: at least 65% modeled core recurring gross margin at included allowances and 70% at expected use; revise allowances or retail prices before public sale if measurements fail. A failed margin test cannot be solved by silently throttling a sold promise.

Before launch obtain actual quotes for Gmail verification/security assessment, any regulated-data work, insurance/legal review where required, and advanced-hosting costs. Record one-time launch funding and monthly fixed overhead separately. Price every one-time product against generation, delivery, support, payment fees, and redo/refund cost; the proposed $5/$9 products must pass their own margin test.

**Q. Reconcile existing industry and framework offers**

The existing website markets the following setup/monthly combinations. Preserve evidence and customer obligations; do not treat them as the new agent pricing.

| Industry | Website/app | Text/follow-up | Front desk/social |
| --- | --- | --- | --- |
| Barber/salon | $495 + $25/mo | $995 + $149/mo | $2,495 + $399/mo |
| Clinics | $1,500 + $79/mo | $2,500 + $249/mo | $6,500 + $699/mo |
| Real estate | $750 + $39/mo | $1,500 + $149/mo | $4,500 + $499/mo |
| Restaurants | $650 + $29/mo | $1,250 + $149/mo | $3,500 + $499/mo |
| Spa/fitness | $650 + $39/mo | $1,350 + $169/mo | $3,995 + $499/mo |
| Home services | $750 + $79/mo | $1,750 + $199/mo | $5,500 + $599/mo |
| Professional | $1,250 + $49/mo | $2,500 + $199/mo | $5,500 + $599/mo |
| Auto | $750 + $39/mo | $1,750 + $179/mo | $5,500 + $599/mo |
| Pet care | $650 + $39/mo | $1,350 + $149/mo | $3,995 + $499/mo |
| Retail | $750 + $39/mo | $1,500 + $169/mo | $4,500 + $499/mo |

Source: `client/src/data/industry-offers.ts`; older demo documents contain conflicting prices and must not override current catalog evidence. Existing named-agent offers in `client/src/data/agent-services.ts` are $1,500+$349/mo, $2,500+$549/mo, and $4,500+$899/mo. The proposed new plans retain those anchors while changing the promise and entitlement definitions.

For new buyers, present one business-agent subscription plus optional website build. A new template website can use the existing industry Level 1 setup amount above, with up to five pages, approved customer content, one revision round, and one supported booking/request integration. Ongoing standard hosting is included in the active agent subscription, so do not charge a duplicate maintenance fee. If someone buys only a website, retain a separately defined website-maintenance product; do not describe it as a dedicated AI agent. Custom ecommerce, regulated forms, migrations, and specialist booking integrations are separately scoped. Existing website-only clients can opt into an agent; no forced migration or automatic repricing.

**R. Billing, entitlements, and customer money**

Stripe clarification: the owner's latest correction concerns Stripe and its webhook, not WhatsApp or OpenGraph. Prefer reuse where the current contract already supports the purchase. The existing general `POST /api/pay/webhook` is already shared across products and stays unchanged, including its current name and registration. Reviewed source handles `checkout.session.completed`; `POST /api/pay/checkout` hardcodes `mode=payment`. These endpoints do not implement subscription renewals, invoice failures, or cancellation entitlements. Adding recurring prices alone cannot make the unchanged handler support that lifecycle. Consequently, a single unchanged existing endpoint cannot satisfy the new monthly-agent requirements. [Current checkout](C:/Users/mehya/mehyar-web/functions/api/pay/checkout.js:209), [current webhook](C:/Users/mehya/mehyar-web/functions/api/pay/webhook.js:255), [Stripe subscription events](https://docs.stripe.com/billing/subscriptions/webhooks).

Use the existing Mehyar Stripe account for the new agent products if account ownership and configuration are confirmed; a separate Stripe account is not required by this design. Register exactly one new shared destination named **Mehyar Business Agent - Subscriptions** for all new business-agent customers, not one per tenant or plan. It handles the new platform's setup payment and subscription lifecycle. Keep the general product webhook, legacy audit webhook, and independent Rizza/AiMech destinations as they are. The customer sees one Mehyar billing experience; the operator sees clearly named destinations with separate responsibilities. Do not insert a forwarding proxy or change an existing route to claim that it is unchanged.

Create a single versioned catalog for new business-agent products: SKU, product/brand, price, currency, billing cadence, setup fee, entitlements, usage unit, allowance, overage price, tax behavior, readiness, grandfather version, refund terms, and effective date. Render new pricing, onboarding quotes, checkout, invoices, and enforcement from it. Maintain a read-only mapping to the legacy product catalog; do not rewrite legacy prices or checkout code.

Use a separate service origin or route namespace, for example `app.mehyar.us/api/agent-billing/checkout` and `/api/agent-billing/webhook`, with a new Stripe endpoint registration and a distinct signing secret. Subscribe only to required events and reject/ignore unrelated product metadata without modifying existing webhooks. Namespace customer-to-tenant mappings and all idempotency keys. Do not remove, rename, rotate, or reconfigure any existing Stripe endpoint, secret, product, price, or callback. Take source/configuration baselines and prove existing checkout/webhook files are byte-for-byte unchanged in the final diff. Protect these paths with CI and deployment boundaries.

Same-account event coexistence is a required test: Stripe event-type subscriptions do not by themselves isolate products. Existing destinations may also receive new Checkout events. New Stripe objects must use namespaced metadata such as `mehyar_agent_order_id`, `mehyar_agent_tenant_id`, and `mehyar_billing_domain=business_agent`; never attach legacy `payment_id` or `report_id` keys to new-platform objects. The new handler must verify ownership against server-created customer/subscription/order mappings and allowed new prices, not trust metadata alone. Acknowledge valid unrelated events without effects. In isolated fixtures, pass new setup, subscription, renewal, failure, cancellation, refund, and unrelated-product events through copies of the unchanged legacy handlers and prove zero legacy ledger writes, fulfillment, or emails. The legacy audit handler calls its ledger mirror beyond the checkout-specific branch, making metadata separation essential. Also prove the new handler cannot change legacy entitlements. Do not test this by replaying events into production.

New agent setup uses a separate one-time payment checkout. After setup acceptance and readiness, use a separate subscription activation checkout so recurring billing starts at activation, not when setup was purchased. The UI shows both stages and their terms. A future saved-method/off-session approach requires an explicit mandate and separate testing; it is not assumed here. Unavailable add-ons do not enter checkout or incur recurring charges. The order summary lists activation dependencies, deliverables, renewal/cancellation, and usage examples.

Implement upgrade proration, downgrade at period end, annual renewal notices, cancellation at period end, failed-payment notices, seven-day grace followed by paused execution, recovery on payment, refunds/credits, and disputes. A cancellation does not immediately erase paid-through access or entitled downloads. Access uses verified webhooks and entitlement records, never only the success URL. Meter actual settled effects, preserve receipts, and reconcile with Stripe daily.

Mehyar charges for its software and owned products. Local businesses collecting their own customers' money keep their merchant accounts. Do not route third-party merchant revenue through Mehyar's ordinary Stripe account. Supporting deposits/refunds for other merchants requires a separately reviewed Stripe Connect or supported merchant integration and explicit authority; until then generate an approved payment-link/request handoff. Rizza and AiMech retain their independent Base44/Deno Stripe customers, prices, subscriptions, webhooks, and entitlement entities; do not merge or repoint them to the central flow or new agent-billing service.

**S. WhatsApp, voice, social publishing, and human fallback**

WhatsApp serves the subscribing business's customers for FAQs, support, bookings, and permitted follow-up. Use Embedded Signup and customer-owned business assets. Existing WhatsApp Business App number coexistence is separately eligibility-tested; personal-account session scraping is not a substitute. Enforce opt-ins, opt-outs, approved templates, current customer-service windows, receipts, and human takeover. General owner commands remain in the PWA because current WhatsApp terms restrict general-purpose AI distribution, with regional exceptions. Validate the actual business use case before activation. [WhatsApp terms](https://www.whatsapp.com/legal/business-solution-terms/), [messaging policy](https://whatsappbusiness.com/policy/).

Voice launches as inbound receptionist with the same typed booking and support tools as chat. Support forwarding or a provisioned number, interruption, silence, difficult names, clarification, human transfer, voicemail fallback, and call spending/time limits. Confirm names, dates, and consequential changes before committing. Recording is off by default; enable only with applicable notice/consent and a retention setting. Start outbound with requested callbacks and consented reminders after testing; no general cold-call promise. State support hours honestly; automated failure detection does not equal 24/7 staffed support.

For social posting, require supported business/creator accounts, approved app scopes, preview, rights/brand checks, destination selection, and provider-compliant consent. TikTok unaudited clients are restricted to private posts, and direct posting needs approval; scheduled posting must respect the current required user experience. If public posting is not approved, provide export and mark posting unavailable rather than claiming it is live. [TikTok direct post](https://developers.tiktok.com/docs/en/content-posting-api-get-started), [sharing guidelines](https://developers.tiktok.com/docs/en/content-sharing-guidelines).

**T. Data protection, retention, and operations**

Enforce tenant authorization across every API, socket, queue message, database relation, search result, artifact, cache, and external tool call. D1 tenant IDs are not a substitute for authorization. Use composite constraints and scoped repository functions; prevent unscoped reads. Restrict widget access to verified domains but do not treat Origin alone as user authentication. Rate-limit public endpoints and protect form/crawl abuse.

Default retention proposal: source uploads 30 days after successful extraction unless saved; call recordings off, or 30 days when enabled; minimized conversation content 90 days; owner-approved durable business facts until removed; redacted action audit records 12 months; backups 30 days. Purchased deliverables follow their promised access term, including grandfathered lifetime entitlements. Financial/contract records use a separately confirmed required schedule. Customer deletion removes active data and search vectors and applies backup expiry; document any records retained for legitimate obligations. Validate that “delete memory” affects summaries, indexes, and cached copies.

Daily backups/export snapshots, point-in-time recovery where supported, and a tested restoration procedure are mandatory. Initial operational recovery targets: control data RPO no greater than one hour and RTO no greater than four hours, measured in a drill before any contractual SLA. Track gaps rather than promising unproven uptime. Use scoped deployment tokens and isolated development/staging/production accounts or resources. Audit privileged changes, rotate keys, scan dependencies, and maintain incident and customer-notice runbooks.

**U. Testing matrix and measurable acceptance**

Use current Cloudflare Workers test tooling, integration tests against the actual runtime, browser end-to-end tests, controlled provider accounts, and consenting live pilots. Pin working versions and record test commands/results. Distinguish fixtures from real provider evidence. [Cloudflare testing](https://developers.cloudflare.com/workers/testing/).

Required suites:

1. Combined signup: identity-only, every checkbox combination, partial/denied consent, missing refresh token, changed account, duplicate callback, wrong tenant/session, existing user, invitation, added scopes, revoked scopes, and workspace switching. Granted capability always matches the UI and broker.
2. Isolation: at least two independent businesses, every role, object-ID substitution, search filters, uploaded files, WebSockets, queue spoofing, cached responses, exports, support access, and billing. Zero unauthorized access in the defined suite.
3. Mail/calendar: Google consumer/Workspace and Microsoft personal/work accounts; admin denial; token refresh races; watch expiry; missed events; invalid cursors; disconnect; employee removal; self-reply loops; attachment and webpage prompt injection.
4. Scheduling: concurrent requests for the same resource, external edits, DST transitions, timezone mismatch, recurrence, holidays, cancellations during reminders, and mid-reschedule failure. Zero duplicate platform-created bookings in concurrency/replay tests; externally created conflicts are detected and surfaced.
5. Durable work: duplicate/out-of-order events, worker termination, object eviction, delayed queues, provider 429/5xx, ambiguous sends, partial fulfillment, retry exhaustion, dead-letter recovery, and app closure during generation.
6. WhatsApp: real signup, eligible coexistence separately, inbound message, template, expired window, delivery failure, opt-out, human takeover, number disconnect, and wrong-business asset injection.
7. Voice: real phone calls, noise/accent variation, interruption, silence, wrong dates/names, transfer success/failure, hangup during booking, exhausted allowance, and provider outage.
8. Billing: each new recurring plan, setup, annual prices, every add-on, prorations, taxes configuration, limits, opt-in top-ups, duplicates, failed payment, downgrade, cancellation, and refund in isolated new-platform test resources. Cover every accessible owned-product SKU through read-only contract checks and isolated fixtures; do not make legacy test purchases or replay legacy production webhooks. Prove same-account new events cause no legacy effects and legacy events cause no new entitlements. No duplicate charges or consumption on internal retries.
9. Product UX: mobile/desktop, real iOS/Android PWA installation, push allow/deny/revoke, screen reader, keyboard, offline/reconnect, logout cache clearing, expired sessions, readable errors, and approved action receipts.
10. Security and operations: malicious site/email instructions, SSRF, unsafe uploads, token/log leakage, permission changes during execution, key rotation, backup restore, tenant export/deletion, pause, and rollback.

Initial measured targets, not marketing guarantees: 95% signup/connect completion in controlled eligible-account tests; 90% grounded FAQ accuracy on an owner-reviewed corpus; 95% successful supported workflow scenarios; zero unauthorized tool actions or cross-tenant exposure in the fixed safety suite; p95 visible chat acknowledgement under two seconds, first useful response under eight seconds; p95 event intake-to-queue under five seconds excluding provider delivery delay. Measure voice turn latency and set a launch target of p95 under two seconds from end of utterance to response start under the defined test network. Failing a target triggers repair or a clearly approved scope/target revision, never a fabricated pass.

End-to-end proof: two unrelated pilot businesses onboard via different providers, connect permitted tools, obtain distinct dedicated agents, receive an inquiry with the app closed, answer or draft within policy, book and reschedule, receive a summary, see accurate usage, disconnect a provider, and pause all new actions. Repeat a payment/notification event and prove it does not duplicate fulfillment or customer communication.

**V. Implementation milestones and release gates**

1. Baseline and design: inventory local/satellite services, active billing SKUs, migrations, secrets patterns, existing clients, provider accounts, and deployments. Produce architecture decisions, schema, capability catalog, dependency register, threat model, and cost model. Start external app-review preparation immediately.
2. Identity and dedicated tenancy: Better Auth/D1 spike, combined Google flow, roles, dedicated agent provisioning, encrypted token custody, tenant isolation tests, and separate staging environment. Gate: two tenants cannot access one another, including through credentials.
3. Website onboarding and owner PWA: crawl, evidence-backed brief, conversation, memory editing, recommended workflows, trial, settings, team, activity, approvals, usage, and pause. Gate: complete mobile onboarding with manual fallback.
4. Durable execution and internal products: workflow engine, queues, outbox, scheduling, model routing, cost reservations, and separate new-service adapters. Exercise new agent deliverables and copied synthetic Designful/PromptPack/Sprint30 scenarios in staging; integrate existing product status read-only. Gate: recovery after forced failure with no duplicate effects and no modification or second executor in legacy fulfillment.
5. Production connectors: Gmail, Calendar, selected Drive, Outlook, and recurring synchronization. Gate: approved scopes and real connect/revoke/reconnect tests. Build other independent pieces while provider review runs.
6. Business automation and commerce: core templates, ten packs, website widget, scheduling, separate agent subscription catalog/endpoints/webhook, customer portal, metering, verified purchase-claim flow, and accessible read-only product adapters. Gate: each new sold SKU agrees across public copy, checkout, entitlements, and billing; every existing product's payment contract remains unchanged.
7. Communication channels: WhatsApp business onboarding, inbound voice, SMS, human transfer, and permitted callbacks. Gate: real provider tests and lawful/authorized activation for the selected pilot region.
8. Content and advanced adapters: selected Docs/Sheets/CRM/reviews/publishing integrations, paid creative packs, and optional isolated OpenClaw execution. Each has a separate go-live gate. Unapproved provider APIs remain visibly unavailable and unbilled.
9. Pilot and release: operate internal tenants, then at least three consenting external pilot businesses across the initial packs for 14 consecutive days; inspect success, missed work, escalations, costs, and support load. Fix critical failures, repeat affected tests, confirm margin and recovery gates, then release in controlled cohorts with rollback.

These are dependency gates, not an invented calendar or guarantee of provider review speed. Every in-scope capability has an owner, acceptance test, prerequisite, and status in the implementation backlog. A milestone being complete does not mean the whole goal is complete. No public launch while critical isolation, unauthorized-action, billing, or data-loss defects remain.

**W. External dependency register**

Mehyar owns developer applications and provider relationships; customers authorize their own business assets. Before public availability record: Cloudflare account/bindings and limits; Google production OAuth brand/domain verification, requested scopes and any required independent assessment; Google Pub/Sub; Microsoft app registration/publisher and admin-consent handling; Meta business/app review, Embedded Signup and number eligibility; Twilio numbers and regional messaging registration; verified sender domains; Stripe product/tax configuration; model provider terms; and access to each satellite codebase/API being observed or integrated read-only.

Record status, evidence, responsible person, next action, cost quote, fallback, and affected features. The implementation can prepare registrations and review demonstrations, but owner identity verification and provider approvals cannot be invented. Recheck current documentation before provider submission. Gmail restricted access can require verification and an independent security assessment; budget from an actual quote. [Google restricted-scope requirements](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification).

**X. Deliverables**

Deliver runnable new-platform code and additive migrations; separate deployment configuration; new versioned catalog and price sheets; ten industry packs; 18-product dependency mapping and accessible read-only adapters; dedicated-agent lifecycle; combined Google onboarding; connector registry; typed tools; workflow templates; PWA; support/admin console; customer/operator guides; test fixtures and real-provider evidence; billing/margin model; dashboards and alerts; backup/restore and incident runbooks; rollout/rollback plan; and a traceability matrix linking every requirement in this document to code, tests, readiness, and any external dependency. Include an immutable-path check and cross-repository payment contract report proving the protected legacy flow was not changed.

This is a repository implementation project, not a collection of mockups. New database migrations use new tables/namespaces and must not change legacy payment-table semantics. New agent Workers deploy separately; do not deploy over the existing payment handlers. Use isolated branches/worktrees and normal code review. Track changes to this specification with reasons. Do not create overlapping customer subscriptions, publish proposed prices, or enable outward-facing automation as an accidental side effect of a test.

**Y. Evidence posture and known limitations**

Known: local repository currently contains 18 product catalog entries, ten industry offers, named-agent service pricing, central checkout/fulfillment, one-owner admin/calendar paths, and existing AI/email helpers. Public Rizza/AiMech/Stuff Pretty Good pages supplied additional price evidence. A read-only review of 19 related repositories (including the two SPG repos) found 11 central-payment integrations, two independent Base44 billing integrations, and six repositories with incomplete or no payment source in reviewed surfaces. Details and evidence are in [the payment compatibility report](C:/Users/mehya/mehyar-web/docs/plans/2026-09-16-product-payment-contracts.md). Current source code is not proof of live provider approval, active Stripe prices, working satellite applications, customer demand, or measured gross margin.

Chosen: Cloudflare-native dedicated agents; Better Auth/D1 identity; direct core connectors; PWA owner control; Twilio voice; preserved consumer purchases; $349/$549/$899 plans; scoped optional OpenClaw cells. Proposed: new add-on prices, allowances, previously unverified consumer prices, retention defaults, performance targets, and cost budgets. Missing: active billing reconciliation, provider-console readiness, satellite access, real customer usage, supplier quotes for assessments, and pilot telemetry. Each missing item is assigned a verification gate above rather than left as an implicit assumption.

Muse and Base44 are experience references, not dependencies. Meta's current Muse announcement describes persistent assistance, controlled service access, memory, and an action history. Base44 distinguishes shared connections from per-user connections. Mehyar's implementation must make business isolation and authorized outcomes explicit. [Meta Muse](https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/), [Base44 connectors](https://docs.base44.com/Integrations/Connectors).

**Z. Definition of complete**

The goal is complete only when the customer can buy the correctly priced plan, sign up through the combined Google journey or supported alternative, receive a distinct persistent business agent, onboard a website with verifiable facts, activate authorized connections, run and inspect the included automations while offline, manage customer conversations and appointments, receive reliable deliverables, see correct usage/billing, control memory/permissions, pause operations, and export/offboard safely. The defined quality, isolation, recovery, cost, provider-approval, and pilot gates must have evidence. Capabilities still awaiting a provider or inaccessible satellite are explicitly incomplete; do not rename them “done” because the interface exists.

The handover identifies exactly what is live, tested, unavailable, and pending, with links to evidence and a remaining-work list. Do not claim that every conceivable business action has been automated. Complete the defined product scope and make future capability additions follow the same catalog, permission, pricing, and release process.
