import { z } from "zod";
import type { Actor } from "../env";
import { HttpError, json, readJson, requestKey, requireOrigin } from "../http";
import { BILLING_ROLES, requireMembership, requireTenant } from "../permissions";
import { processBillingEvent } from "./events";
import { billingStatus, cancelAtPeriodEnd, createCheckout, portalSession } from "./service";
import { parseStripeEvent, readRawBody, verifyStripeSignature, type BillingEnv, type StripeClient } from "./stripe";

export { AGENT_BILLING_DOMAIN, STRIPE_API_VERSION, WEBHOOK_DESTINATION_NAME, agentMetadata, assertNoLegacyMetadata } from "./stripe";
export type { BillingEnv } from "./stripe";
export { BILLING_EVENT_TYPES, processBillingEvent } from "./events";
export { enforceExpiredBillingGrace, billingReadiness } from "./service";

const checkoutSchema = z.object({ stage: z.enum(["setup", "activation"]), planId: z.enum(["business", "growth", "operations"]), interval: z.enum(["monthly", "annual"]) }).strict();
/** Authenticated routes use ?tenantId=; the root supplies the verified session actor and this rechecks membership. */
export async function handleBillingRequest(request: Request, env: BillingEnv, actor?: Actor, injectedClient?: StripeClient): Promise<Response> {
  const url = new URL(request.url); const path = url.pathname;
  if (path === "/api/agent-billing/webhook") {
    if (request.method !== "POST") throw new HttpError(405, "method_not_allowed", "Use POST for billing events.");
    if (!env.AGENT_STRIPE_WEBHOOK_SECRET) throw new HttpError(503, "webhook_not_configured", "The new billing destination is not configured.");
    const raw = await readRawBody(request);
    await verifyStripeSignature(raw, request.headers.get("stripe-signature"), env.AGENT_STRIPE_WEBHOOK_SECRET);
    return json(await processBillingEvent(env, parseStripeEvent(raw), injectedClient));
  }
  if (!actor) throw new HttpError(401, "sign_in_required", "Sign in to manage billing.");
  if (!["GET", "HEAD"].includes(request.method)) requireOrigin(request, env.APP_ORIGIN);
  if (url.searchParams.get("tenantId") !== actor.tenantId) throw new HttpError(403, "billing_tenant_mismatch", "Select the correct workspace.");
  await requireMembership(env, actor, BILLING_ROLES); await requireTenant(env, actor);
  if (path === "/api/agent-billing/status" && request.method === "GET") return json(await billingStatus(env, actor));
  if (path === "/api/agent-billing/checkout" && request.method === "POST") return json(await createCheckout(env, actor, checkoutSchema.parse(await readJson(request)), requestKey(request), injectedClient));
  if (path === "/api/agent-billing/portal" && request.method === "POST") { z.object({}).strict().parse(await readJson(request)); return json(await portalSession(env, actor, requestKey(request), injectedClient)); }
  if (path === "/api/agent-billing/cancel" && request.method === "POST") { z.object({}).strict().parse(await readJson(request)); return json(await cancelAtPeriodEnd(env, actor, requestKey(request), injectedClient)); }
  throw new HttpError(404, "billing_route_not_found", "This billing action is not available.");
}
