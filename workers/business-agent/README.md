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

`GET /api/tenants/:tenantId/connections/:grantId/calendars?provider=google|microsoft` uses this module for an owner/manager's read-only account picker. It requires enabled calendar capabilities, current grants and scopes, and an unpaused agent. It rechecks access before returning results. Responses contain normalized calendar choices and an explicit `incomplete` flag if more provider pages exist. Frontend calendar selection and pagination are still pending. This route cannot create or modify an appointment.

The action dispatcher must still add current paid entitlement, saved policy, assigned resources, execution-time usage reservation, provider receipts and reconciliation. Credential renewal alone does not authorize those effects. Current renewal tests use fixtures; provider-console and live account evidence remain outstanding.

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

Policy changes cancel pending approvals; expiry and rejection release review reservations. Approval reserves one operation against that policy's UTC-day action limit. This is **not** completed usage or a customer charge. A future dispatch must revalidate the execution-day budget, current paid entitlement, actor, policy, scope, resource ownership and provider readiness before committing an external effect. Existing provider adapters perform final API-level resource checks but are not yet wired to dispatch.

The app's Approvals screen uses these real review endpoints. Policy editing/proposal creation currently have API contracts; the owner policy editor, model proposal tool, token-refresh broker, automatic workflow executor and dispatch/receipt lifecycle remain unfinished. Saved `automatic` mode currently queues a review and does not execute. Review responses explicitly return `executionAvailable: false`. No send/book endpoint is exposed. Preview-only policies cannot be elevated by an approval click. Automatic mail policies require an exact owner-authored template until a separately bounded template system is implemented.

## Verification commands

```powershell
npm run verify
```

This checks the immutable legacy boundary, TypeScript, local workerd tests, and an independent deployment bundle. Test credentials, signed provider tokens and API responses are synthetic fixtures; they are not evidence of real Google/Microsoft/Stripe approvals or live purchases. The tests use local D1 and Durable Objects, not the production resources.

`scripts/legacy-baseline.json` records 503 protected Git blobs from commit `50e0c27990e9e27d5f487da8befc02b08d45ff4d`. The guard applies Git's line-ending normalization so checks work on Windows and Linux. It rejects changes/deletions and new source inside the protected legacy directories. Ignored pre-existing caches are excluded. Do not regenerate this baseline to make an unauthorized legacy change pass.

The separate GitHub Actions workflow runs checks only. It has no production deployment step or production credentials. Deployment of this new service requires a reviewed separate configuration, new resource IDs, scoped deployment access, provider readiness evidence and the release gates in the goal. Existing workflows/configuration remain unchanged.

See `docs/implementation/mayor-ai-progress.md` for the full-scope progress ledger and remaining work.
