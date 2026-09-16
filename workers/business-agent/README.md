# Mayor AI business-agent service

This is the separate Cloudflare service for the implementation goal in `docs/plans/2026-09-16-mehyar-business-agent-goal.md`. The complete product goal remains in progress. This service does not import legacy payment/fulfillment code, bind `LEADS_DB`, or deploy over the marketing Pages application.

## Local development

Use Node 24. From this directory:

```powershell
npm ci
npm run db:local
npm run dev
```

Run `npm ci` and `npm run dev` in `apps/business-agent` as well. Open **http://127.0.0.1:5174**; that app proxies `/api` to the local Worker on port 8788. Use this canonical origin, not a mixture of `localhost` and `127.0.0.1`, because session cookies, OAuth callbacks and mutation origin checks must agree.

The committed Wrangler configuration is local-only: a placeholder D1 ID, separate resource names, no public routes, no AI binding, and commerce disabled. Local migrations operate only on the local `AGENT_DB`. Do not apply these migrations to an existing product database. A build runs `wrangler deploy --dry-run`, which does not deploy.

For actual provider signup, supply configuration in ignored `.dev.vars` or the relevant deployment's secret store:

| Name | Meaning |
| --- | --- |
| `BETTER_AUTH_SECRET` | At least 32 random characters; never a fixture key |
| `TOKEN_ENCRYPTION_KEY` | Base64 encoding of a cryptographically random 32-byte AES key |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Mehyar-owned OAuth application; callback `/api/auth/callback/google` on the configured app origin |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` | Mehyar-owned application; callback `/api/auth/callback/microsoft` |
| `GOOGLE_ENABLED_CAPABILITIES` | Explicit comma-separated approved/implemented selections; empty means identity-only |
| `MICROSOFT_ENABLED_CAPABILITIES` | Same rule for Microsoft |

Do not enable mail/calendar capability flags simply because an OAuth client exists. Verification, supported scopes, live connector tests and operating policies are separate release requirements. The source-owned secret variable names are never secret values. No credentials belong in the browser bundle or committed configuration.

## Separate Stripe integration

Keep every existing Stripe checkout, webhook registration, signing secret and product billing flow unchanged. The new destination is shared by all business-agent tenants and named **Mehyar Business Agent - Subscriptions**. Its endpoint is `/api/agent-billing/webhook`. It can use the existing Stripe account after the configured account identity is verified. No destination has been registered by this implementation.

The new service reads `AGENT_STRIPE_SECRET_KEY`, `AGENT_STRIPE_WEBHOOK_SECRET`, `AGENT_STRIPE_ACCOUNT_ID`, `AGENT_STRIPE_PRICE_MAP` and `AGENT_STRIPE_PORTAL_CONFIGURATION`. Store secret values in the new service's secret store. Price mappings contain separate setup, monthly and annual price IDs for each catalog plan. Neither configuring these values nor setting `COMMERCE_ENABLED=true` bypasses the verified, expiring readiness evidence required in the new database.

The authenticated endpoints `/api/agent-billing/status`, `/checkout`, `/portal` and `/cancel` require `tenantId` and current owner/billing membership. Mutation requests require the exact app origin and an `X-Idempotency-Key`. New metadata is namespaced; legacy `payment_id` and `report_id` are prohibited. Checkout completion alone does not grant recurring access. Setup payment, accepted scope, matching plan, subscription payment and activation evidence are separate checks.

Billing tests use signed synthetic events and mocked Stripe responses. Reconciliation scheduling, add-on sales, plan changes and notice delivery remain open. Do not treat fixture results as permission to enable production commerce.

## Runtime boundaries

- Better Auth owns identity in prefixed tables in the new database. Its token-returning browser routes are blocked. Account linking requires an authenticated explicit flow, not matching email addresses.
- API authorization resolves current tenant membership on every call. Business-agent RPC checks it again, including revocation and membership expiry. Direct SDK WebSocket/agent routes are not exposed.
- `BusinessAgent` is a separate SQLite-backed Cloudflare Agent for each business. Conversation records are scoped to the current user; shared business memory is explicit. Owner pause persists across requests.
- Normalized D1 tenant tables hold directory/membership/knowledge/activity records. Encrypted OAuth grants are authenticated against user, tenant, provider and provider account IDs.
- New Stripe billing is a separately named shared destination. It never attaches legacy `payment_id` or `report_id` metadata, forwards old events, or invokes old fulfillment.
- Catalog definitions, automation templates and provider authorization are not evidence that external automations are running. Unavailable capabilities remain unavailable and unbilled.

## Server credential renewal and calendar reads

`src/connectors/credentials.ts` is server-only. It checks business membership, the grant owner's current role, provider binding and actual scopes before decrypting or renewing an account. Google and Microsoft use fixed HTTPS token endpoints, bounded responses and no redirects. Rotated tokens are re-encrypted; compare-and-swap writes prevent an in-flight refresh from restoring revoked access or overwriting newer consent. The new `0005` migration stores per-grant refresh leases only in `AGENT_DB`.

An ambiguous refresh or crashed lease requires reconnecting rather than blindly rotating again. `invalid_grant` also marks reconnect required. Subsequent consent cannot recover that rejected token from the identity account's fallback. A missing refresh-response scope retains only the prior verified scope set; an explicit response may narrow but cannot expand it. No refresh token is returned to ordinary connector code, and no credential-returning HTTP or Agent RPC exists.

`GET /api/tenants/:tenantId/connections/:grantId/calendars?provider=google|microsoft` uses this module for an owner/manager's read-only account picker. It requires enabled calendar capabilities, current grants and scopes, and an unpaused agent. It follows provider pagination server-side and rechecks access and pause before and after every page. The directory is bounded to ten pages and 1,000 unique calendars; repeated cursors or exhausted bounds set `incomplete`. Duplicate resource permissions are merged conservatively. Provider cursors never reach the browser. The execution path uses the same directory and requires completeness before booking. The Approvals screen now lets an owner select a writable calendar and create an appointment policy with an explicit attendee allowlist, review mode, expiry and daily limit. Owners can list policies, edit names/recipient allowlists/UTC expiry/review mode/daily action limits/escalation, and disable or re-enable valid policies using optimistic versions. Disabling remains available while paused and after expiry; it cancels pending approvals but cannot recall a dispatched provider request. Changing existing resources, friendly account labels and large-directory continuation remain unfinished. This route cannot create or modify an appointment.

The gated action dispatcher now adds current paid entitlement, saved policy, execution-day reservations, provider resource checks and durable receipts. Credential renewal alone does not authorize effects. General staff resource assignments, reconciliation and the full scheduling engine remain unfinished. Current tests use fixtures; provider-console and live account evidence remain outstanding.

Protocol references reviewed September 16, 2026: [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server#offline), [Microsoft token renewal](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow#refresh-the-access-token), [OAuth refresh semantics](https://www.rfc-editor.org/rfc/rfc6749#section-6).

## Action review API

The business Durable Object now stores versioned owner policies, immutable mail-reply/calendar-create proposals, approval reservations and append-only decision records. All routes below are under `/api/tenants/:tenantId`; the public Worker derives the actor from the verified session and every RPC rechecks current membership and business ownership.

| Route | Behavior |
| --- | --- |
| `GET /action-policies` | Owners/managers read saved policy configurations |
| `POST /action-policies` | Owner-only create/update, UUID ID and expected version; stale writes fail |
| `GET /actions` | Owners/managers read reviews; staff read only their own proposals |
| `POST /actions` | Typed proposal plus `X-Idempotency-Key`; exact saved resources/recipients and actual provider grants required |
| `GET /actions/:id` | Authorized action detail with decision history |
| `POST /actions/:id/decision` | Owner/manager approve/reject the exact `actionHash`; current policy, requester, grant, pause and limits rechecked |
| `POST /actions/:id/execute` | Owner/manager dispatch an approved reply or appointment after paid-access, readiness, policy and connection checks; replay a persisted receipt without sending twice |

Policy changes cancel pending approvals; expiry and rejection release review reservations. Approval reserves one operation against that policy's UTC-day action limit. This is **not** a customer charge. Dispatch revalidates the execution-day budget, current paid entitlement, actor/requester/approver, policy, scope, resource ownership and provider readiness. Google/Microsoft mail adapters validate the original message and recipient. Calendar creation verifies writable calendar membership and current availability; local overlapping executions reserve the resource before those checks. Provider changes outside Mehyar still require reconciliation and full scheduling recovery.

The app's Approvals screen uses the review and execution endpoints, shows provider receipts, and distinguishes email acceptance from delivery. Policy editing/proposal creation currently have API contracts; the owner policy editor, model proposal tool, automatic workflow executor and reconciliation lifecycle remain unfinished. Saved `automatic` mode currently queues a review and does not execute. Preview-only policies cannot be elevated by an approval click. Automatic mail policies require an exact owner-authored template until a separately bounded template system is implemented.

`EXTERNAL_ACTIONS_ENABLED=false` is explicit in local configuration. Enabling this flag alone is insufficient: execution requires a current paid subscription, unexpired catalog release evidence, tenant activation/policy evidence, and `provider_approval` plus `live_acceptance` gates under `connector:google.mail.reply`, `connector:microsoft.mail.reply`, `connector:google.calendar.create`, or `connector:microsoft.calendar.create`. These are new-platform readiness records, not changes to any Stripe webhook.

Executions have durable claims and exact-effect deduplication. A completed action replays its receipt; a failure before dispatch returns to pending review and requires new approval. A dispatched failure or object restart becomes uncertain and cannot be automatically resent. There is currently no operator reconciliation/unlock endpoint: implement provider-state verification before adding one. Existing exact-effect deduplication must be extended with trustworthy workflow occurrence IDs for intentional recurring follow-ups. Additional paid channels need supplier-cost reservations before implementation; these direct mail/calendar operations reserve action units, not text credits.

## Verification commands

```powershell
npm run verify
```

This checks the immutable legacy boundary, TypeScript, local workerd tests, and an independent deployment bundle. Test credentials, signed provider tokens and API responses are synthetic fixtures; they are not evidence of real Google/Microsoft/Stripe approvals or live purchases. The tests use local D1 and Durable Objects, not the production resources.

`scripts/legacy-baseline.json` records 503 protected Git blobs from commit `50e0c27990e9e27d5f487da8befc02b08d45ff4d`. The guard applies Git's line-ending normalization so checks work on Windows and Linux. It rejects changes/deletions and new source inside the protected legacy directories. Ignored pre-existing caches are excluded. Do not regenerate this baseline to make an unauthorized legacy change pass.

The separate GitHub Actions workflow runs checks only. It has no production deployment step or production credentials. Deployment of this new service requires a reviewed separate configuration, new resource IDs, scoped deployment access, provider readiness evidence and the release gates in the goal. Existing workflows/configuration remain unchanged.

See `docs/implementation/mayor-ai-progress.md` for the full-scope progress ledger and remaining work.

## Paid conversation allowances

Paid chat uses catalog text-credit limits after current subscription access, matching plan, release readiness and tenant activation checks. Annual plans receive monthly allowances. Usage windows use the first verified subscription anchor, clamp short months without moving later anniversaries, and do not refill on billing-date edits. The source for anchor semantics is [Stripe billing-cycle documentation](https://docs.stripe.com/billing/subscriptions/billing-cycle). Migration 0006 adds usage_anchor only to the new agent subscription table; existing Stripe routes and schemas remain protected.

Delivered generations consume one included credit; running turns reserve it. Provider attempts have a separate 120% ceiling retained after failures and restarts. Failed retries move into the current usage period; completed requests replay without another inference or credit. Paid access is rechecked before provider dispatch and again before delivery. Expiry, disputes or tenant suspension during inference withhold the reply and release the customer reservation while retaining the provider attempt. Usage reporting remains available with a zero allowance when access cannot be verified. Missing or future anchors fail closed pending reconciliation. Purchased credit packs, measured supplier-cost accounting, plan-change reconciliation and live usage proofs remain unfinished. AI remains disabled locally and no live inference or charge was performed by this change.

The authenticated GET /api/tenants/:tenantId/usage route reports the agent's current durable usage with no-store responses. Billing displays completed, reserved and available text credits and the next local-time reset, without rendering internal period/subscription IDs. Its refresh action re-reads the server; offline, malformed and failed reads do not retain stale totals as current usage.

## Website evidence extraction foundation

The research/extract module parses already-fetched HTML using [Cloudflare HTMLRewriter](https://developers.cloudflare.com/workers/runtime-apis/html-rewriter/). It never fetches links, executes scripts, expands remote JSON-LD contexts, or writes approved memory. Metadata, headings, recognized structured business types, contact routes and structured offers become unverified page claims with source URL, retrieval time, selector and extraction confidence. Confidence describes extraction, not business truth or authority. Revenue, private inventory, consent and autonomous permissions are not inferred.

Input is bounded to 1 MiB, 100 claims, 100 public URL candidates, 20 structured-data blocks, 64 KiB per block and bounded graph traversal. Oversized claims are omitted and restrictions/truncation/malformed data are explicit warnings. Public URL-shape checks are not DNS/redirect or robots enforcement. This parser is not connected to a public crawl endpoint yet. Safe fetching, robots handling, sitemap/depth scheduling, rendered pages, comprehensive schema/entity normalization, durable jobs, evidence persistence, confirmation UI and recommendations remain unfinished.

## Crawl provider adapter (not activated)

The internal research/cloudflare-crawl adapter implements bounded submission, single-record result pagination and cancellation requests against the fixed Cloudflare account API. It allows at most 1,000 pages and depth five, requests static HTML for reference/AI input, disables external-link and subdomain discovery, limits each response to 2 MiB and each successful page to 1 MiB, and uses a 15-second request deadline. Submission failures with an unknown outcome are never automatically retried. Cancellation acknowledges a request, not confirmed termination. Provider credentials never become crawl-site headers.

Record and reported final URLs must match the approved source origin; malformed URLs and incomplete successful records are rejected. These checks occur after retrieval and do not establish safe network access. [Cloudflare session guardrails](https://developers.cloudflare.com/browser-run/features/guardrails/) are unavailable to Quick Actions. Before enabling the [crawl endpoint](https://developers.cloudflare.com/browser-run/quick-actions/crawl-endpoint/), require verified private-address, DNS and redirect protection or use an independently enforced fetching path. Do not assume discovery options prevent unsafe network requests.

There is no public route, provider binding or live crawl activation yet. Durable orchestration must authorize the tenant, reserve the trial/plan page allowance, persist dispatch before submission, handle ambiguous outcomes without duplicate crawls, enforce job deadlines, reconcile cancellation and ingest permitted evidence. Provider fixtures prove adapter behavior only; robots/network behavior and billing require live acceptance evidence.

The per-business Durable Object now initializes a private research job ledger. Its synchronous transactions reserve page allowances by server-supplied period and preserve immutable request-key inputs. Dispatch must first transition a reservation to submitting; interrupted submissions recover as uncertain and retain their allowance. Pending cancellation also retains allowance until verified provider settlement supplies the successful page count. Only unsubmitted cancellation/expiry releases pages immediately. Deadlines are bounded to one hour; expiry marks known provider jobs for cancellation and unknown submissions uncertain. Startup performs recovery, but periodic deadline alarms and provider cancellation/reconciliation are not wired yet. This ledger is an internal primitive: authenticated reservation/dispatch APIs, trustworthy plan/trial period derivation, supplier-cost limits, provider-driven evidence ingestion and uncertain-job operator recovery remain required before activation.

The ledger also stores extracted evidence privately by job and normalized final page URL. Ingestion accepts only successful bounded HTML for the matching provider job and approved origin, then rechecks job state after asynchronous extraction. A content hash makes concurrent/repeated identical deliveries idempotent; changed content at the same URL conflicts rather than replacing the first source snapshot. Raw HTML is not retained. Stored evidence remains unverified and untrusted for instructions, never promoted into business memory. Reads return at most 20 pages within one job, and settlement cannot undercount already stored successful pages. The provider polling path must still establish permitted fetching, complete result traversal and verified counts; this storage primitive does not prove network safety or live crawl completion. Customer review/confirmation, retention and deletion remain unfinished.

The internal ResearchRunner connects the ledger to the provider adapter behind a required authorization callback. Submission is claimed durably before the POST and uncertain submissions cannot retry. A verified late receipt after cancellation/uncertainty records the provider ID with cancellation requested. Polling imports only terminal snapshots, one record per invocation, with durable monotonic cursor checkpoints and bounded traversal. It rejects looping cursors and changing terminal outcomes, rechecks authorization after provider reads, and settles distinct stored successful pages only after traversal completes. Cancellation requests retain reservations until a terminal snapshot is consumed. No scheduler or public API invokes this runner yet; its callback must be bound to real tenant/entitlement/network readiness checks. Withdrawal needs its own current-ownership authorization so loss of paid access never prevents stopping a job. Live provider semantics, cost measurement, alarms and unknown-job operator reconciliation remain unverified or unfinished.

Authenticated research reads are available at GET /api/tenants/:tenantId/research and GET /api/tenants/:tenantId/research/:jobId, with bounded offset pagination and no-store responses. Current owners/managers can inspect progress and evidence even while paused. Other roles, revoked memberships and cross-workspace job/object substitutions are rejected at the Agent boundary as well as the HTTP route. Public summaries expose website, status, deadline, page allowance, stored evidence count and used/reserved pages; provider job identifiers, request keys and billing periods remain internal. These reads do not create jobs, enable crawling, confirm facts or grant execution authority. The owner/manager Business Knowledge screen now presents these reads with source links, retrieval times and explicitly unverified claims. Fact confirmation and research initiation remain unfinished.
