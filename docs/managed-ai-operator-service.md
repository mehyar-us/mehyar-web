# Managed AI Business Operator Service

This document defines the private delivery model behind the public OpenClaw and Hermes Agent offers. It is an internal operating guide, not sales-page copy.

## Product boundary

MehyarSoft sells a configured, monitored business operator—not unlimited autonomous labor. Each installation has named users, approved channels, explicit tool permissions, documented workflows, spending and message limits, human approval gates, an audit trail, backups, and an escalation path.

OpenClaw is the default mobile command and channel-routing layer. Hermes Agent is the default durable-memory, scheduled research, reporting, and reusable-skill layer. A combined setup uses each for the job it handles best.

## Architecture

The persistent agent runtime does not run inside a Cloudflare Worker. OpenClaw and Hermes require a long-running, isolated process with controlled access to tools and local state. Use one isolated container or small VPS per customer, or deploy to infrastructure owned by the customer.

Cloudflare is the control plane:

- Worker API: authenticated tenant configuration, webhook intake, policy checks, approval requests, and operator actions.
- D1: tenant metadata, workflow versions, approval records, redacted audit events, plan limits, and billing state.
- Queues: durable work dispatch, retries, and backpressure between webhooks and the runtime.
- Durable Objects: optional per-tenant coordination, locks, and live approval state.
- R2: encrypted or access-controlled reports, exports, backups, and generated artifacts.
- Turnstile and rate limits: protect public setup, approval, and support endpoints.
- Access and service tokens: restrict staff and runtime-to-control-plane access.

The runtime plane keeps customer credentials in a platform secret store, not D1 or prompts. Each customer receives its own OS user/container, encrypted volume, network policy, channel allowlist, agent allowlist, backup schedule, patch window, and emergency stop procedure.

## Required safety controls

1. Pair or allowlist every human and messaging channel.
2. Require approval for sending campaigns, publishing, payments, account changes, destructive actions, and access to sensitive records.
3. Use least-privilege OAuth scopes and dedicated service accounts.
4. Redact secrets and sensitive customer content from logs.
5. Put explicit daily and monthly limits on model usage, messages, voice minutes, and external APIs.
6. Keep medical, legal, financial, employment, and regulated judgments with qualified humans.
7. Test revocation, backup restore, tool failure, duplicate webhook, and provider outage paths before launch.
8. Provide a visible emergency stop and a documented offboarding/export process.

## Commercial model

Public prices include configuration, the listed workflow count, monitoring, maintenance, and support. They do not include unlimited model usage, SMS, voice minutes, third-party subscriptions, paid data, or infrastructure outside the written allowance.

Target gross margin after normal usage should be 65% to 75%. Track per tenant:

- runtime hosting and backups;
- model and tool calls;
- SMS, voice, email, and channel fees;
- monitoring and log storage;
- monthly maintenance labor;
- incident and support labor.

Bill setup separately because discovery, permissions, integration, workflow design, testing, and staff training are front-loaded. Annual plans discount two months of management, not the setup. Customer-owned installations carry a higher fixed price because support remains included for twelve months while MehyarSoft does not control the infrastructure.

Set written plan allowances before sale. A reasonable starting allowance is three workflows and one hour of monthly improvement for OpenClaw, five skills/workflows and two hours for Hermes, and eight workflows with three hours for the combined team. Overage or material scope changes require approval and a change order.

## Launch checklist

- Signed scope, data map, authorized users, channels, and approval matrix
- Customer-owned accounts for important third-party services
- Isolated runtime and encrypted backup verified
- Test data used before production credentials
- Happy path, denial path, duplicate path, outage path, and emergency stop tested
- Usage limits and cost alerts enabled
- Staff training and plain-language operator guide delivered
- Support owner, response target, maintenance window, and offboarding procedure recorded
