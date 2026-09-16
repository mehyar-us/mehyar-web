import { HttpError } from "../http";
import type { Env } from "../env";

/** Pin this on the NEW webhook destination too; never upgrade the account/legacy destinations. */
export const STRIPE_API_VERSION = "2026-08-26.dahlia";
// Verified against https://docs.stripe.com/api/versioning on 2026-09-16.
export const AGENT_BILLING_DOMAIN = "business_agent";
export const WEBHOOK_DESTINATION_NAME = "Mehyar Business Agent - Subscriptions";
export interface BillingEnv extends Env {
  AGENT_STRIPE_SECRET_KEY?: string;
  AGENT_STRIPE_WEBHOOK_SECRET?: string;
  AGENT_STRIPE_ACCOUNT_ID?: string;
  AGENT_STRIPE_PRICE_MAP?: string;
  AGENT_STRIPE_PORTAL_CONFIGURATION?: string;
}
export type StripeObject = Record<string, any>;
export interface StripeEvent { id: string; type: string; created: number; livemode: boolean; api_version?: string; account?: string; data: { object: StripeObject }; }
export type StripeTransport = (input: string, init?: RequestInit) => Promise<Response>;

export function assertNoLegacyMetadata(value: unknown): void {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (key === "payment_id" || key === "report_id") throw new HttpError(400, "legacy_metadata_forbidden", "Legacy payment identifiers are not accepted.");
    assertNoLegacyMetadata(child);
  }
}
export function agentMetadata(tenantId: string, orderId?: string): Record<string, string> {
  return { mehyar_billing_domain: AGENT_BILLING_DOMAIN, mehyar_agent_tenant_id: tenantId, ...(orderId ? { mehyar_agent_order_id: orderId } : {}) };
}
export function objectId(value: unknown): string | undefined {
  return typeof value === "string" ? value : value && typeof value === "object" && typeof (value as StripeObject).id === "string" ? (value as StripeObject).id : undefined;
}

export class StripeClient {
  constructor(private readonly secret: string, private readonly transport: StripeTransport = fetch) {}
  async request(path: string, method: "GET" | "POST" = "GET", parameters?: URLSearchParams, idempotencyKey?: string): Promise<StripeObject> {
    if (!/^\/v1\/[a-zA-Z0-9_/?=&%.[\]-]+$/.test(path) || path.includes("..")) throw new Error("invalid_stripe_path");
    if (method === "POST" && (!idempotencyKey || !idempotencyKey.startsWith("mayor-ai:"))) throw new Error("stripe_idempotency_required");
    const headers: Record<string, string> = { Authorization: `Bearer ${this.secret}`, "Stripe-Version": STRIPE_API_VERSION };
    if (parameters && method === "POST") headers["Content-Type"] = "application/x-www-form-urlencoded";
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    const response = await this.transport(`https://api.stripe.com${path}`, { method, headers, ...(method === "POST" ? { body: parameters?.toString() ?? "" } : {}), signal: AbortSignal.timeout(15000), redirect: "error" });
    let body: StripeObject;
    try { body = await response.json() as StripeObject; } catch { throw new HttpError(503, "stripe_unavailable", "Billing is temporarily unavailable."); }
    if (!response.ok) throw new HttpError(response.status === 429 || response.status >= 500 ? 503 : 502, "stripe_request_failed", "The billing request could not be completed. Please retry with the same request key.");
    return body;
  }
}

export function encodeParameters(data: Record<string, unknown>): URLSearchParams {
  assertNoLegacyMetadata(data);
  const params = new URLSearchParams();
  function append(prefix: string, value: unknown) {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) value.forEach((entry, index) => append(`${prefix}[${index}]`, entry));
    else if (typeof value === "object") for (const [key, child] of Object.entries(value)) append(`${prefix}[${key}]`, child);
    else params.append(prefix, String(value));
  }
  for (const [key, value] of Object.entries(data)) append(key, value);
  return params;
}

export async function readRawBody(request: Request, maxBytes = 524288): Promise<Uint8Array> {
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "missing_body", "An event body is required.");
  const chunks: Uint8Array[] = []; let length = 0;
  for (;;) {
    const part = await reader.read(); if (part.done) break;
    length += part.value.byteLength;
    if (length > maxBytes) { await reader.cancel(); throw new HttpError(413, "event_too_large", "Event body exceeds the accepted size."); }
    chunks.push(part.value);
  }
  const result = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

/** Verify exact bytes; accept any current v1 during secret rotation, never parse/re-encode first. */
export async function verifyStripeSignature(raw: Uint8Array, header: string | null, secret: string, nowSeconds = Math.floor(Date.now() / 1000), toleranceSeconds = 300): Promise<void> {
  if (!header || header.length > 8192 || !secret) throw new HttpError(400, "invalid_signature", "Invalid billing event signature.");
  const parts = header.split(",").map((part) => part.trim().split("="));
  const times = parts.filter(([key]) => key === "t").map(([, value]) => value);
  const signatures = parts.filter(([key, value]) => key === "v1" && /^[0-9a-f]{64}$/i.test(value ?? "")).map(([, value]) => value);
  if (times.length !== 1 || !/^\d+$/.test(times[0] ?? "") || !signatures.length || signatures.length > 16) throw new HttpError(400, "invalid_signature", "Invalid billing event signature.");
  const timestamp = Number(times[0]);
  if (!Number.isSafeInteger(timestamp) || Math.abs(nowSeconds - timestamp) > toleranceSeconds) throw new HttpError(400, "expired_signature", "Billing event signature is outside the accepted window.");
  const prefix = new TextEncoder().encode(`${times[0]}.`);
  const signed = new Uint8Array(prefix.length + raw.length); signed.set(prefix); signed.set(raw, prefix.length);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  let valid = false;
  for (const signature of signatures) {
    const bytes = Uint8Array.from(signature.match(/.{2}/g)!, (hex) => parseInt(hex, 16));
    if (await crypto.subtle.verify("HMAC", key, bytes, signed)) valid = true;
  }
  if (!valid) throw new HttpError(400, "invalid_signature", "Invalid billing event signature.");
}

export function parseStripeEvent(raw: Uint8Array): StripeEvent {
  let event: StripeEvent;
  try { event = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(raw)); } catch { throw new HttpError(400, "invalid_event", "Invalid billing event."); }
  if (!event || !/^evt_[A-Za-z0-9_]+$/.test(event.id ?? "") || typeof event.type !== "string" || !Number.isSafeInteger(event.created) || typeof event.livemode !== "boolean" || !event.data?.object || typeof event.data.object.id !== "string") throw new HttpError(400, "invalid_event", "Invalid billing event.");
  return event;
}
