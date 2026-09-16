# Business Agent development AI Gateway

Created `mehyar-business-agent-dev` on September 16, 2026 as an additive development resource. The existing `mehyar-us` gateway was inspected and not modified. No application Worker was deployed and no release flag or Stripe configuration changed.

The [settings read-back](evidence/dev-gateway-1789594422315.json) confirms:

- Authentication required.
- Request logging disabled and cache TTL zero.
- Fixed limit of ten requests per sixty seconds.
- One configured request attempt; Workers AI postpaid mode.

Creation succeeded, but the initial follow-up inventory read returned HTTP 500. A subsequent read-only run found the gateway with all intended settings. The creation call was not repeated. The saved read-back correctly reports `created: false` for that later verification invocation.

## Live Gateway evidence

The synthetic calibration and mailbox scripts now support `--gateway`, selecting only this named development gateway. Calls send `cf-aig-gateway-id`, `cf-aig-skip-cache: true`, `cf-aig-collect-log: false`, and `cf-aig-max-attempts: 1`.

- [Four calibration requests](evidence/text-calibration-1789594451835.json) returned HTTP 200 with valid usage, including the 11,968-local/12,025-provider credit boundary.
- [Two section requests and one aggregation](evidence/mailbox-model-1789594465117.json) passed the application's exact evidence and coverage validation. The summary retained the Monday preference and did not claim a confirmed booking. Its prose again omitted the attachment caveat; structured omission warnings remain present.
- Responses had no `cf-aig-*` confirmation headers. A [negative control](evidence/gateway-negative-control-2026-09-16.json) used the same valid short request and a nonexistent gateway ID. Cloudflare returned HTTP 400/code 2001, asking for Gateway configuration, with no usage receipt. This supports that the valid routing header was honored; success alone would not have established that.
- A subsequent [log query](evidence/dev-gateway-log-check-2026-09-16.json) returned zero stored records. This is an observation at that time, not a claim about all provider-level retention or future settings.

Provider input counts exceeded local Harmony counts by 57 in every valid request, matching direct REST observations. These tests still do not validate the deployed Worker binding, tenant authorization, customer credit approval, retry recovery or production performance. They do not approve a universal 57-token correction across arbitrary prompts/models. Larger-job billing and production release remain disabled.

## Reproduction

From `workers/business-agent`:

```powershell
# Read-only settings verification (does not create a missing gateway):
node scripts/provision-dev-gateway.mjs
# Explicit creation only when absent; never updates existing resources:
node scripts/provision-dev-gateway.mjs --create
# Synthetic inference through the development Gateway:
node scripts/calibrate-text.mjs --live --gateway
node scripts/probe-mailbox-model.mjs --live --gateway
```

Respect the ten-request development limit; do not blindly retry failures. Credentials remain environment-only and are not recorded. The scripts never update or delete any gateway. An existing resource with unexpected settings fails verification rather than being overwritten.

References: [Gateway creation API](https://developers.cloudflare.com/api/resources/ai_gateway/methods/create/), [REST routing and per-request controls](https://developers.cloudflare.com/ai-gateway/usage/rest-api/).
