# Mayor AI implementation progress

Source of truth: [complete goal](../plans/2026-09-16-mehyar-business-agent-goal.md) and [protected payment contracts](../plans/2026-09-16-product-payment-contracts.md).

Started 2026-09-16 on `codex/mayor-ai-platform`, based on `50e0c27990e9e27d5f487da8befc02b08d45ff4d`. The full A–Z objective remains unchanged and **in progress**. This ledger records partial implementation, not a reduced definition of completion.

## Current implementation

- Separate Worker package, local D1 migrations, per-business Cloudflare Agent/Durable Object, private R2 binding and standalone customer PWA. No existing deployment configuration or product code changed.
- Better Auth/D1 Google and Microsoft entrypoints with selected capability scopes, PKCE/nonce, signed identity checks, actual granted scopes, encrypted token custody, refresh preservation, explicit business attachment and local disconnect.
- Tenant directory, current role checks, private conversation records, owner-managed business memory, activity, durable pause and trial text reservations. Durable provider-attempt limits bound failed and interrupted model calls separately from delivered customer credits. The model path requires explicit configuration; paid execution and external tool execution are not yet enabled.
- Three plan definitions ($349/$549/$899), 28 add-on definitions, 25 meters, 81 automation definitions, ten industry packs, and 18 protected product mappings. These definitions do not mean the executors or subscriptions are live.
- Separate new-agent billing implements setup/activation checkout, portal sessions, period-end cancellation, signed webhook ingestion, event and tenant leases, current-object reconciliation, renewals, payment-failure grace, and refund/dispute facts. Matching paid setup and plan-specific evidence gate activation. These paths pass isolated tests; commerce remains disabled until live evidence and configuration are established.
- Direct Google and Microsoft calendar/mail adapters implement bounded requests, recipient validation, scheduling conflict tokens, provider idempotency where supported, and change-subscription API calls. They are not yet connected to a policy broker, token-refresh service or synchronization scheduler, and cannot execute customer automations.
- Durable action reviews now implement owner-only versioned policies, immutable typed reply/appointment proposals, explicit recipient/resource allowlists, actual scope checks, expiry, pause, current author/requester membership, UTC-day approval reservations and decision history. Policy changes invalidate old reviews. The Approvals screen reads and decides real review records. Staff can only view their own proposals and cannot approve. No external action is dispatched yet; automatic mode remains queued, and approval is explicitly distinguished from delivery or booking.
- Customer app implements signup selection, workspace creation/switching, conversation UI, memory, permissions, connections, usage/pricing display, pause, setup/activation checkout, billing portal, period-end cancellation and order history. Checkout buttons honor exact-plan readiness; return URLs never confirm payment. Unimplemented dashboard areas show honest unavailable/empty states. No customer data is fabricated at runtime.
- Git protection check covers 503 existing files, including payment routes/helpers, old migrations, old client, existing Workers, dependencies and deployment configuration. Synthetic agent events pass through the actual old webhook functions with no database/fulfillment effects.

## Evidence and limitations

Latest combined service verification: **104 tests passed across nine files** in local workerd, covering tenant isolation, signed OAuth fixtures, actual unchanged legacy handlers, catalogs, connector adapters, billing, model-call reservations and durable action reviews. TypeScript, the 503-file protection guard and independent Worker dry-run bundle passed. This includes regressions for different Stripe events arriving concurrently, setup-plan mismatch, refund ownership conflicts, revoked memberships, cross-business agent binding, failed model attempts, concurrent review limits, immutable action hashes, policy revision/expiry, author demotion and Google/Microsoft calendar scopes. The signed OAuth fixture now traverses policy creation, proposal, approval and history through the actual Worker API and proves wrong-origin decisions fail. Local `/api/health`, `/api/session`, `/api/auth/capabilities` and `/api/catalog` return 200/no-store; unauthenticated `/api/tenants` returns 401.

Frontend TypeScript/production build and **24 Chromium browser tests passed**, including accessibility checks on sign-in, conversation, billing and approvals. Authenticated browser tests use explicit network fixtures. Approval tests cover the exact reviewed hash, escaped untrusted content, paused rejection, staff/viewer restrictions, workspace switching and mobile layout. Actual unauthenticated desktop/mobile captures use the running local Worker without interception; both providers correctly report unconfigured. The foundation production PWA shell was verified to reload offline with seven public assets cached and no API/auth/query/private data. These prove layout, contract behavior and shell caching, not live OAuth, mobile installation, payments or automation. Fixture screenshots are explicitly distinguished from the actual local page.

No production deployment, provider registration, price publication, purchase, email send, calendar change, phone provisioning, or legacy webhook replay has occurred. Live OAuth approval, actual scopes/accounts, scoped Cloudflare deployment access, Stripe account/price configuration, customer consent, cost telemetry and pilot evidence remain to be established. No authentication bypass exists in production code to substitute for that work.

## Full-scope traceability

| Goal section | Implemented evidence so far | Required work still open |
| --- | --- | --- |
| A Product | Separate business/product/end-customer concepts; new PWA brand | Real customer workflows and public release |
| B Architecture | Separate Worker/app, D1, SDK Agent, private R2 binding | Separate identity/connector/job service boundaries as needed; Queues, Workflows, Vectorize, gateway deployment; advanced executor |
| C Lifecycle | Idempotent workspace records, membership, distinct agent, durable pause | Resumable provisioning workflow, activation/suspension/offboarding, number lifecycle |
| D Combined signup | Google/Microsoft code and signed local fixtures, explicit scope/grant selection | Real consumer/work/admin consent matrix; production approval; recovery/MFA/invitations/multiple accounts |
| E Website research | Website intake and public URL-shape validation | Bounded safe crawler/metadata/evidence extraction, editable brief, recommendations, ownership verification |
| F PWA | Responsive app shell, connected initial routes, browser tests | Streaming, uploads, push, real mobile installation, all remaining functional screens and recovery |
| G Roles/authority | Current membership checks, private conversations, owner memory controls; durable policies, scoped action reviews, reservations and decision history with connected approval UI | Resource-level staff assignments, owner policy editor, model proposals, execution-time broker and paid budgets, temporary support UX, live queued revocation |
| H Connectors/secrets | Encrypted tenant-bound provider grants; browser token endpoints blocked | Key rotation, credentials broker, full registry, additional providers, live revoke/reconnect |
| I Synchronization | Isolated inbox/outbox schema | Authenticated subscriptions/watch renewal, history/delta recovery, queues, dead letters, scheduling locks/DST/compensation |
| J Automations | 81 versioned definitions with permissions, modes, receipts, meters and prerequisites | Actual executors for every in-scope template, suppression and recovery suites |
| K Industries | Ten defined packs and tests; three pilot packs selected | Configured real workflows and pilots; regulated eligibility gates |
| L Portfolio | 18 read-only product mappings; existing payment report | Read-only status adapters, verified account claims, internal operating tenant, unresolved satellite interfaces |
| M Fulfillment | New private-storage and outbox boundaries | Resumable generation/QA/artifact/delivery engine; recovery evidence |
| N Plans | Typed immutable prices/allowances, annual-floor tests | Measured economics, verified Stripe prices, paid plan activation |
| O Add-ons | Typed scope/meter/pricing/readiness catalog | Each executor, meter, customer purchasing/cancellation and live release evidence |
| P Economics | Price inputs and margin gates specified | Versioned measured cost model, supplier quotes, stress/expected-use validation |
| Q Legacy offers | Existing catalog and dependencies protected | Read-only reconciliation of active agreements/prices; optional new website scopes |
| R Billing | Separate checkout/portal/cancellation service; signed event processing, tenant leases, setup-plan gates, renewal/grace/refund/dispute fixtures and legacy coexistence tests | Scheduled reconciliation, add-on purchasing, plan changes, notice delivery, full live isolated Stripe matrix, price/admin readiness |
| S Channels | Channel requirements and catalog | WhatsApp onboarding, Twilio calls/transfer/SMS, compliant social publishing, live evidence |
| T Operations/data | Authorization, no-store API, minimized errors, encrypted credentials | Full retention/deletion/export, backups/restores, key rotation, incident/monitoring runbooks |
| U Tests | 104 runtime tests, 24 browser tests and static checks | Entire provider/security/recovery/performance matrix, real mobile and live accounts |
| V Milestones | Baseline and initial identity/tenancy/app work | All remaining gates; no milestone is treated as whole-goal completion |
| W Dependencies | Disabled readiness flags expose missing configuration | Actual account/app/provider approvals, costs, ownership and production access evidence |
| X Deliverables | Runnable separate source, local tests, catalog, CI checks, docs | Remaining implementation, operator/customer guides, runbooks, complete evidence index |
| Y Evidence | Explicit fixtures vs live distinctions | Current provider-console/live SKU reconciliation, usage/margin measurements |
| Z Complete | Not achieved | All goal requirements plus 14 consecutive pilot days across at least three consenting businesses |

## Next integration work

1. Complete the remaining billing reconciliation, add-on, plan-change and notice workflows; retain the existing payment boundary and require live evidence before enabling commerce.
2. Extend the implemented policy/review layer with execution-time authorization, paid entitlements, provider token refresh, resource ownership validation, atomic dispatch leases and receipt/reconciliation handling. Revalidate budgets at dispatch, not just approval. Connect Google/Microsoft adapters through this broker, then implement synchronization and automatic workflows.
3. Implement evidence-backed website research and business confirmation; add durable provisioning/research jobs.
4. Complete scheduling, automation executors, remaining app screens, communications, fulfillment and all remaining A–Z deliverables.
5. Configure new staging resources and provider test accounts, perform real provider/cost/security tests, then the required pilot and release gates.

External prerequisites are tracked, but they do not block independent implementation work. The goal must remain active until every requirement has direct current-state evidence.
