var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.ts
var CAPABILITIES = [
  { id: 1, key: "lead_intake", method: "POST", path: "/v1/leads", purpose: "Capture contact forms, audits, source, consent, and UTM metadata.", surface: "public" },
  { id: 2, key: "ai_lead_triage", method: "POST", path: "/v1/ai/triage", purpose: "Score urgency, budget fit, service fit, and next-best-action.", surface: "internal" },
  { id: 3, key: "business_audit", method: "POST", path: "/v1/audit/business", purpose: "Generate structured small-business tech audit and store report metadata.", surface: "public" },
  { id: 4, key: "website_analyzer", method: "POST", path: "/v1/audit/website", purpose: "Find website CTA, trust, performance, SEO, and conversion gaps.", surface: "public" },
  { id: 5, key: "missed_call_webhook", method: "POST", path: "/v1/webhooks/missed-call", purpose: "Receive future call/SMS events and trigger follow-up.", surface: "public" },
  { id: 6, key: "email_notification", method: "POST", path: "/v1/notify/email", purpose: "Queue/log owner notifications to mrswelim@gmail.com.", surface: "internal" },
  { id: 7, key: "booking_request", method: "POST", path: "/v1/booking/request", purpose: "Collect booking intent and generate owner-ready summary.", surface: "public" },
  { id: 8, key: "admin_auth", method: "POST", path: "/v1/admin/login", purpose: "Owner-only auth boundary; secrets remain in Cloudflare/Hermes.", surface: "admin" },
  { id: 9, key: "admin_metrics", method: "GET", path: "/v1/admin/metrics", purpose: "Leads, sources, offers, conversion states, outreach volume, errors.", surface: "admin" },
  { id: 10, key: "crm_timeline", method: "POST", path: "/v1/crm/timeline", purpose: "Append notes, statuses, follow-ups, and agent actions.", surface: "admin" },
  { id: 11, key: "campaign_registry", method: "POST", path: "/v1/outreach/campaigns", purpose: "Store campaigns, templates, segments, compliance status.", surface: "admin" },
  { id: 12, key: "suppression_api", method: "POST", path: "/v1/compliance/suppressions", purpose: "Global suppression list for email/SMS/outreach safety.", surface: "public" },
  { id: 13, key: "ai_email_draft", method: "POST", path: "/v1/ai/email-draft", purpose: "Generate human-reviewed prospect-specific emails.", surface: "admin" },
  { id: 14, key: "social_content", method: "POST", path: "/v1/ai/social-draft", purpose: "Generate social drafts tied to offers/founder story.", surface: "admin" },
  { id: 15, key: "prospect_import", method: "POST", path: "/v1/prospects/import", purpose: "Ingest manual/CSV prospects with dedupe and source tracking.", surface: "admin" },
  { id: 16, key: "copy_risk_checker", method: "POST", path: "/v1/ai/copy-risk-check", purpose: "Flag unverifiable claims, spam language, compliance risk.", surface: "admin" },
  { id: 17, key: "proposal_generator", method: "POST", path: "/v1/ai/proposal", purpose: "Create service package, price band, and scope draft; store generated report metadata.", surface: "admin" },
  { id: 18, key: "retainer_health", method: "GET", path: "/v1/retainers/health", purpose: "Track active clients, recurring tasks, SLA risk, renewal reminders.", surface: "admin" },
  { id: 19, key: "job_processor", method: "POST", path: "/v1/jobs", purpose: "Async jobs for audits, summaries, outreach prep, reports.", surface: "internal" },
  { id: 20, key: "system_audit_log", method: "GET", path: "/v1/system/audit-log", purpose: "Status, version, bindings, errors, admin-safe audit trail.", surface: "admin" },
  { id: 21, key: "zoho_mail_oauth_start", method: "GET", path: "/v1/integrations/zoho/oauth/start", purpose: "Generate owner-only Zoho Mail browser authorization URL with least-privilege scopes.", surface: "admin" },
  { id: 22, key: "zoho_mail_oauth_callback", method: "GET", path: "/v1/integrations/zoho/oauth/callback", purpose: "Exchange Zoho authorization code and store refresh token in KV.", surface: "public" },
  { id: 23, key: "zoho_mail_status", method: "GET", path: "/v1/mail/zoho/status", purpose: "Verify contact@mehyar.us Zoho Mail token/account connectivity without exposing secrets.", surface: "admin" },
  { id: 24, key: "zoho_mail_read", method: "GET", path: "/v1/mail/zoho/messages", purpose: "Read a small, admin-only page of contact@mehyar.us messages.", surface: "admin" },
  { id: 25, key: "zoho_mail_send_disabled", method: "POST", path: "/v1/mail/zoho/send", purpose: "Disabled direct-send route; use approved draft send with confirmation, suppression, daily cap, and audit trail.", surface: "admin" },
  { id: 26, key: "admin_mail_inbox", method: "GET", path: "/v1/admin/mail/inbox", purpose: "List sanitized synced contact@ inbox messages matched to leads.", surface: "admin" },
  { id: 27, key: "admin_mail_detail", method: "GET", path: "/v1/admin/mail/messages/:id", purpose: "Read one sanitized synced message/thread for owner review.", surface: "admin" },
  { id: 28, key: "admin_mail_sync", method: "POST", path: "/v1/admin/mail/sync", purpose: "Manually trigger Zoho inbox sync; scheduled jobs never send mail.", surface: "admin" },
  { id: 29, key: "admin_mail_ai_reply_draft", method: "POST", path: "/v1/admin/mail/messages/:id/draft", purpose: "Generate AI reply draft for admin edit/approval only.", surface: "admin" },
  { id: 30, key: "admin_mail_reply_send", method: "POST", path: "/v1/admin/mail/messages/:id/reply", purpose: "Send one explicit admin-approved reply through Zoho with audit trail.", surface: "admin" },
  { id: 31, key: "admin_email_threads", method: "GET", path: "/v1/admin/email/threads", purpose: "UI-compatible admin email thread list using backend KV-session auth.", surface: "admin" },
  { id: 32, key: "admin_email_thread_detail", method: "GET", path: "/v1/admin/email/threads/:id", purpose: "UI-compatible message/thread detail with suppression status and audit tail.", surface: "admin" },
  { id: 33, key: "admin_email_ai_draft", method: "POST", path: "/v1/admin/email/threads/:id/drafts/ai", purpose: "UI-compatible AI reply draft creation; draft only, never sends.", surface: "admin" },
  { id: 34, key: "admin_email_draft_update", method: "PATCH", path: "/v1/admin/email/drafts/:id", purpose: "Update human-edited admin reply draft before approval/send.", surface: "admin" },
  { id: 35, key: "admin_email_draft_approve", method: "POST", path: "/v1/admin/email/drafts/:id/approve", purpose: "Record explicit admin draft approval event before manual send.", surface: "admin" },
  { id: 36, key: "admin_email_draft_send", method: "POST", path: "/v1/admin/email/drafts/:id/send", purpose: "Send one approved/manual-confirmed draft with suppression and daily-cap gates.", surface: "admin" },
  { id: 37, key: "admin_owner_notification", method: "POST", path: "/v1/admin/notifications/intake", purpose: "Send internal owner-only intake notifications to mrswelim@gmail.com via Zoho; never sends to prospects.", surface: "admin" },
  { id: 38, key: "newsletter_signup", method: "POST", path: "/v1/newsletter/signup", purpose: "Capture consented newsletter subscribers with source page and interest tags; suppressed emails are honored.", surface: "public" },
  { id: 39, key: "newsletter_unsubscribe", method: "POST", path: "/v1/newsletter/unsubscribe", purpose: "Honor newsletter unsubscribe requests by adding email suppression.", surface: "public" },
  { id: 40, key: "admin_subscribers_export", method: "GET", path: "/v1/admin/subscribers.csv", purpose: "Admin-only CSV export of consented newsletter subscribers with CSV injection safety.", surface: "admin" },
  { id: 63, key: "admin_newsletter_subscribers", method: "GET", path: "/v1/admin/newsletter/subscribers", purpose: "Admin-only newsletter money cockpit subscriber list with suppression status and manual conversion metadata.", surface: "admin" },
  { id: 64, key: "admin_newsletter_promote", method: "POST", path: "/v1/admin/newsletter/subscribers/:id/promote", purpose: "Promote a consented subscriber into an internal prospect/lead stage; no outreach send.", surface: "admin" },
  { id: 65, key: "admin_newsletter_zoho_draft", method: "POST", path: "/v1/admin/newsletter/subscribers/:id/zoho-draft", purpose: "Create a human-review Zoho reply draft for a subscriber; never sends automatically.", surface: "admin" },
  { id: 41, key: "admin_rss_sources_list", method: "GET", path: "/v1/admin/rss/sources", purpose: "List approved RSS/feed sources with lifecycle health and rights notes.", surface: "admin" },
  { id: 42, key: "admin_rss_sources_create", method: "POST", path: "/v1/admin/rss/sources", purpose: "Create feed sources for private analysis/ingest eligibility; no full article republication.", surface: "admin" },
  { id: 43, key: "admin_rss_source_update", method: "PATCH", path: "/v1/admin/rss/sources/:id", purpose: "Update RSS source metadata, active status, priority, and license/rights notes.", surface: "admin" },
  { id: 44, key: "admin_rss_source_test", method: "POST", path: "/v1/admin/rss/sources/:id/test", purpose: "Manually test a feed URL, parse item/image/full-content signals, and update lifecycle status.", surface: "admin" },
  { id: 45, key: "admin_rss_sources_bulk_test", method: "POST", path: "/v1/admin/rss/sources/bulk-test", purpose: "Bulk test RSS sources with bounded limits, deactivate failing feeds, and audit results.", surface: "admin" },
  { id: 46, key: "admin_rss_sources_health", method: "GET", path: "/v1/admin/rss/health", purpose: "Summarize RSS source health, active eligibility, failures, and scheduled check status.", surface: "admin" },
  { id: 47, key: "admin_rss_ingest", method: "POST", path: "/v1/admin/rss/ingest", purpose: "Manually pull active RSS sources into private analysis article metadata with dedupe/scoring.", surface: "admin" },
  { id: 48, key: "admin_rss_articles_list", method: "GET", path: "/v1/admin/rss/articles", purpose: "List private RSS article metadata/scoring candidates; no full article republication.", surface: "admin" },
  { id: 49, key: "admin_rss_article_get", method: "GET", path: "/v1/admin/rss/articles/:id", purpose: "Admin-only raw/excerpt article detail with attribution/license warnings.", surface: "admin" },
  { id: 50, key: "admin_opportunity_scout_today", method: "GET", path: "/v1/admin/opportunity-scout/today", purpose: "Review today's low-cost, no-external-action opportunity ideas.", surface: "admin" },
  { id: 51, key: "admin_opportunity_scout_run", method: "POST", path: "/v1/admin/opportunity-scout/run", purpose: "Manually run Opportunity Scout and store safe opportunity drafts.", surface: "admin" },
  { id: 52, key: "admin_opportunity_scout_settings", method: "GET/PATCH", path: "/v1/admin/opportunity-scout/settings", purpose: "Configure Opportunity Scout with disabled-by-default automation and Kanban gates.", surface: "admin" },
  { id: 53, key: "admin_opportunity_scout_kanban", method: "POST", path: "/v1/admin/opportunity-scout/opportunities/:id/create-kanban", purpose: "Create internal Kanban card only after approval/config gates pass.", surface: "admin" },
  { id: 62, key: "admin_opportunity_execution_loop", method: "GET", path: "/v1/admin/opportunity-scout/opportunities/:id/execution-loop", purpose: "Inspect ROI filters, money math, daily KPIs, approval gates, and draft follow-up cards without external action.", surface: "admin" },
  { id: 54, key: "billing_service_catalog", method: "GET", path: "/v1/billing/services", purpose: "Public MehyarSoft billable service catalog with test/live readiness metadata.", surface: "public" },
  { id: 55, key: "billing_checkout_session", method: "POST", path: "/v1/billing/checkout", purpose: "Create Stripe Checkout Session for a public service or consulting invoice; live charges require explicit owner approval gate.", surface: "public" },
  { id: 56, key: "billing_checkout_status", method: "GET", path: "/v1/billing/sessions/:id", purpose: "Read sanitized Checkout Session/order status for success/cancel pages.", surface: "public" },
  { id: 57, key: "stripe_webhook", method: "POST", path: "/v1/webhooks/stripe", purpose: "Verify Stripe webhook signature and update billing ledger without exposing secrets.", surface: "public" },
  { id: 58, key: "admin_billing_ledger", method: "GET", path: "/v1/admin/billing/ledger", purpose: "Admin ledger of Stripe service orders, fees, net revenue, estimated costs, and profit.", surface: "admin" },
  { id: 70, key: "admin_billing_offer_from_opportunity", method: "POST", path: "/v1/admin/billing/offers/from-opportunity/:id", purpose: "Create an owner-review billable offer from an approved Opportunity Scout idea; no Stripe call until checkout/invoice creation.", surface: "admin" },
  { id: 59, key: "admin_trends_scans", method: "GET", path: "/v1/admin/trends/scans", purpose: "List private trend intelligence scan runs and diagnostics.", surface: "admin" },
  { id: 60, key: "admin_trends_search", method: "POST", path: "/v1/admin/trends/search", purpose: "Manual private trend scan; stores provider evidence without outreach, spend, publishing, or billing.", surface: "admin" },
  { id: 61, key: "admin_trends_sources", method: "GET", path: "/v1/admin/trends/sources", purpose: "Show trend source readiness, provider names, and safety gates without exposing secrets.", surface: "admin" },
  { id: 66, key: "admin_government_workspace", method: "GET", path: "/v1/admin/government/opportunities/:id/workspace", purpose: "Owner-review government opportunity workspace with checklist, notes, drafts, and no auto-submit gates.", surface: "admin" },
  { id: 67, key: "admin_government_drafts", method: "POST/PATCH", path: "/v1/admin/government/opportunities/:id/drafts /v1/admin/government/drafts/:id", purpose: "Create/update owner-review government response drafts; auto-submit disabled.", surface: "admin" },
  { id: 68, key: "admin_analytics_overview", method: "GET", path: "/v1/admin/analytics", purpose: "Admin-only aggregate analytics overview and revenue correlation diagnostics; env names only.", surface: "admin" },
  { id: 69, key: "admin_analytics_diagnostics", method: "GET", path: "/v1/admin/analytics/diagnostics", purpose: "Admin-only analytics diagnostics naming missing env vars without credential values.", surface: "admin" },
  { id: 71, key: "admin_analytics_google_oauth_start", method: "GET", path: "/v1/admin/analytics/google/oauth/start", purpose: "Admin-only Google Analytics readonly OAuth consent URL generation; values stay server-side.", surface: "admin" },
  { id: 72, key: "admin_analytics_google_oauth_callback", method: "GET", path: "/v1/admin/analytics/google/oauth/callback", purpose: "Google OAuth callback exchanges code and stores refresh token in KV without exposing credentials.", surface: "public" }
];
var corsHeaders = {
  "Access-Control-Allow-Origin": "https://mehyar.us",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};
function json(data, init = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: { "content-type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...corsHeaders, ...init.headers || {} }
  });
}
__name(json, "json");
async function readJson(request) {
  if (request.headers.get("content-type")?.includes("application/json")) {
    return await request.json();
  }
  return {};
}
__name(readJson, "readJson");
function id(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}
__name(id, "id");
function now() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
__name(now, "now");
function text(value, fallback = null) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || fallback;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}
__name(text, "text");
function integer(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return fallback;
}
__name(integer, "integer");
function boolInt(value) {
  return value === true || value === 1 || value === "1" || value === "true" ? 1 : 0;
}
__name(boolInt, "boolInt");
function jsonString(value) {
  return JSON.stringify(value ?? {});
}
__name(jsonString, "jsonString");
var STORAGE_REDACTED = "[redacted]";
var MAX_STORED_KEYS = 25;
var SENSITIVE_STORAGE_KEY_PARTS = [
  "email",
  "phone",
  "name",
  "body",
  "message",
  "content",
  "subject",
  "token",
  "secret",
  "password",
  "authorization",
  "cookie",
  "raw"
];
var SAFE_STORAGE_KEYS = /* @__PURE__ */ new Set([
  "account_id",
  "accepted",
  "actor",
  "amount_cents",
  "billing_mode",
  "campaign_id",
  "cap",
  "channels",
  "checkout_session_id",
  "contract",
  "count",
  "currency",
  "draft_id",
  "error",
  "fee_cents",
  "folder_id",
  "gross_cents",
  "inserted",
  "job_id",
  "lead_id",
  "lifecycle_stage",
  "limit",
  "mail_message_id",
  "mode",
  "net_cents",
  "offset",
  "order_id",
  "outbound_id",
  "path",
  "payment_status",
  "profit_cents",
  "provider",
  "promoted_lead_id",
  "reason",
  "report_id",
  "retry_after_seconds",
  "service_id",
  "status",
  "stripe_event_id",
  "surface",
  "type",
  "version",
  "zoho_message_id",
  "workspace_id"
]);
function storageKeySafe(key) {
  const normalized = key.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`).toLowerCase();
  if (SAFE_STORAGE_KEYS.has(normalized)) return true;
  if (normalized.endsWith("_id") || normalized.endsWith("_ids") || normalized.endsWith("_at") || normalized.endsWith("_count") || normalized.endsWith("_keys")) return true;
  return !SENSITIVE_STORAGE_KEY_PARTS.some((part) => normalized.includes(part));
}
__name(storageKeySafe, "storageKeySafe");
function safeStorageValue(value, depth = 0) {
  if (value === null || value === void 0) return value ?? null;
  if (typeof value === "string") return value.length > 120 ? `${value.slice(0, 120)}\u2026` : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return { array_length: value.length };
  if (typeof value === "object") {
    if (depth >= 1) return { object_keys: Object.keys(value).slice(0, MAX_STORED_KEYS) };
    const out = {};
    for (const key of Object.keys(value).slice(0, MAX_STORED_KEYS)) {
      const normalized = key.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`).toLowerCase();
      out[normalized] = storageKeySafe(key) ? safeStorageValue(value[key], depth + 1) : STORAGE_REDACTED;
    }
    return out;
  }
  return String(value);
}
__name(safeStorageValue, "safeStorageValue");
function safeStoragePayload(value) {
  const sanitized = safeStorageValue(value);
  if (sanitized && typeof sanitized === "object" && !Array.isArray(sanitized)) return sanitized;
  return { value: sanitized };
}
__name(safeStoragePayload, "safeStoragePayload");
function safeStorageMetadata(value) {
  const payload = safeStoragePayload(value);
  return { stored: "redacted_bounded", ...payload };
}
__name(safeStorageMetadata, "safeStorageMetadata");
function requestContext(request) {
  return {
    ip_hash: request.headers.get("cf-connecting-ip") ? "present-redacted" : null,
    user_agent: request.headers.get("user-agent") || void 0
  };
}
__name(requestContext, "requestContext");
function clientRateLimitKey(request) {
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  return ip.replace(/[^a-zA-Z0-9:._-]/g, "_").slice(0, 80);
}
__name(clientRateLimitKey, "clientRateLimitKey");
var BILLING_CONTRACT = "mehyarsoft-billing-v1";
var BILLING_SERVICES = [
  { id: "tech-audit-330", name: "$330 Local Business Tech Audit", category: "Audit", description: "A paid diagnostic of website, intake, missed-call, booking, CRM, and follow-up leaks with a prioritized fix plan.", unit_amount_cents: 33e3, estimated_cost_cents: 9e3, currency: "usd", mode: "payment", delivery_window: "3-5 business days", features: ["Intake review", "Website/booking path review", "Revenue-leak map", "Prioritized fixes"], requires_scope_review: false },
  { id: "consulting-hour", name: "Consulting Hour", category: "Consulting", description: "One hour of senior engineering/product systems consulting for architecture, automations, CRM, or integration decisions.", unit_amount_cents: 15e3, estimated_cost_cents: 4500, currency: "usd", mode: "payment", delivery_window: "Scheduled after payment", features: ["60-minute session", "Action notes", "Follow-up summary"], requires_scope_review: false },
  { id: "website-booking-cleanup-deposit", name: "Website + Booking Cleanup Deposit", category: "Conversion", description: "Deposit to start a scoped cleanup of website messaging, CTA path, booking/contact intake, and analytics events.", unit_amount_cents: 75e3, estimated_cost_cents: 25e3, currency: "usd", mode: "payment", delivery_window: "Kickoff in 2 business days", features: ["Scope confirmation", "Mobile-first CTA cleanup", "Booking/contact wiring", "Analytics checklist"], requires_scope_review: true },
  { id: "automation-sprint-deposit", name: "Automation Sprint Deposit", category: "Automation", description: "Deposit to reserve a workflow automation sprint after fit review and owner-approved scope.", unit_amount_cents: 15e4, estimated_cost_cents: 55e3, currency: "usd", mode: "payment", delivery_window: "Kickoff after scope approval", features: ["Workflow discovery", "Implementation plan", "First automations", "Operator handoff"], requires_scope_review: true }
];
function billingMode(env, requested) {
  return text(requested, "test") === "live" ? "live" : "test";
}
__name(billingMode, "billingMode");
function stripeSecretKey(env, mode) {
  return mode === "live" ? env.STRIPE_MEHYARSOFT_SECRET_KEY_LIVE || null : env.STRIPE_MEHYARSOFT_SECRET_KEY_SANDBOX || null;
}
__name(stripeSecretKey, "stripeSecretKey");
function stripePublishableKey(env, mode) {
  return mode === "live" ? env.STRIPE_MEHYARSOFT_PUBLISHABLE_KEY_LIVE || null : env.STRIPE_MEHYARSOFT_PUBLISHABLE_KEY_SANDBOX || null;
}
__name(stripePublishableKey, "stripePublishableKey");
function stripeWebhookSecret(env, mode) {
  return mode === "live" ? env.STRIPE_MEHYARSOFT_WEBHOOK_SECRET_LIVE || null : env.STRIPE_MEHYARSOFT_WEBHOOK_SECRET_SANDBOX || null;
}
__name(stripeWebhookSecret, "stripeWebhookSecret");
function liveBillingAllowed(env, body) {
  const enabled = env.STRIPE_MEHYARSOFT_LIVE_CHARGES_ENABLED === "1" || env.STRIPE_MEHYARSOFT_LIVE_CHARGES_ENABLED === "true";
  const approval = env.STRIPE_MEHYARSOFT_OWNER_APPROVAL_CODE && text(body?.owner_approval_code) === env.STRIPE_MEHYARSOFT_OWNER_APPROVAL_CODE;
  return !!enabled && !!approval;
}
__name(liveBillingAllowed, "liveBillingAllowed");
function billingFeeEstimate(amountCents) {
  return amountCents > 0 ? Math.round(amountCents * 0.029) + 30 : 0;
}
__name(billingFeeEstimate, "billingFeeEstimate");
function billingMarginPercent(grossCents, profitCents) {
  return grossCents > 0 ? Math.round(profitCents / grossCents * 1e3) / 10 : 0;
}
__name(billingMarginPercent, "billingMarginPercent");
function billingMethod(value) {
  const requested = text(value, "checkout_session");
  return requested === "payment_link" || requested === "invoice_draft" ? requested : "checkout_session";
}
__name(billingMethod, "billingMethod");
function publicBillingService(service) {
  const gross = service.unit_amount_cents;
  const estimatedFee = billingFeeEstimate(gross);
  const profit = gross - estimatedFee - service.estimated_cost_cents;
  return { ...service, gross_cents: gross, estimated_fee_cents: estimatedFee, estimated_profit_cents: profit, margin_percent: billingMarginPercent(gross, profit) };
}
__name(publicBillingService, "publicBillingService");
function stripeEnvStatus(env, mode) {
  return {
    mode,
    env_var_names: {
      secret_key: mode === "live" ? "STRIPE_MEHYARSOFT_SECRET_KEY_LIVE" : "STRIPE_MEHYARSOFT_SECRET_KEY_SANDBOX",
      publishable_key: mode === "live" ? "STRIPE_MEHYARSOFT_PUBLISHABLE_KEY_LIVE" : "STRIPE_MEHYARSOFT_PUBLISHABLE_KEY_SANDBOX",
      webhook_secret: mode === "live" ? "STRIPE_MEHYARSOFT_WEBHOOK_SECRET_LIVE" : "STRIPE_MEHYARSOFT_WEBHOOK_SECRET_SANDBOX"
    },
    secret_key_configured: !!stripeSecretKey(env, mode),
    publishable_key_configured: !!stripePublishableKey(env, mode),
    webhook_secret_configured: !!stripeWebhookSecret(env, mode),
    live_charge_gate: mode === "live" ? env.STRIPE_MEHYARSOFT_LIVE_CHARGES_ENABLED === "1" || env.STRIPE_MEHYARSOFT_LIVE_CHARGES_ENABLED === "true" ? "env_enabled_owner_code_required" : "blocked_env_disabled" : "sandbox_only"
  };
}
__name(stripeEnvStatus, "stripeEnvStatus");
async function handleBillingServices(request, env) {
  const mode = billingMode(env, new URL(request.url).searchParams.get("mode"));
  return json({ ok: true, contract: BILLING_CONTRACT, services: BILLING_SERVICES.map(publicBillingService), stripe: stripeEnvStatus(env, mode), supported_billing_methods: ["checkout_session", "payment_link", "invoice_draft"], safety: { live_charges_require_owner_approval: true, no_real_customer_charge_without_owner_approval: true, secret_values_returned: false } });
}
__name(handleBillingServices, "handleBillingServices");
function formEncode(values) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== void 0 && value !== null) params.append(key, String(value));
  }
  return params.toString();
}
__name(formEncode, "formEncode");
async function stripePost(env, mode, path, values) {
  const secret = stripeSecretKey(env, mode);
  if (!secret) return { error: "stripe_secret_key_not_configured", mode };
  const response = await fetch(`https://api.stripe.com${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: formEncode(values)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return { error: "stripe_api_error", status: response.status, code: text(data.error?.code), message: text(data.error?.message) };
  return data;
}
__name(stripePost, "stripePost");
async function createBillingOfferFromOpportunity(request, env, opportunityId) {
  if (!env.DB) return json({ error: "db_binding_required" }, { status: 500 });
  const body = await readJson(request);
  const opportunity = await env.DB.prepare("SELECT id, title, status, suggested_price_cents, estimated_cost_cents, target_customer, monetization_path, metadata_json FROM opportunities WHERE id = ? LIMIT 1").bind(opportunityId).first();
  if (!opportunity) return json({ error: "opportunity_not_found" }, { status: 404 });
  if (text(opportunity.status) !== "approved") return json({ error: "opportunity_not_approved", status: opportunity.status }, { status: 409 });
  const serviceId = text(body.service_id ?? body.serviceId, "automation-sprint-deposit") || "automation-sprint-deposit";
  const baseService = BILLING_SERVICES.find((item) => item.id === serviceId) || BILLING_SERVICES[0];
  const gross = Math.max(100, integer(body.amount_cents ?? opportunity.suggested_price_cents, baseService.unit_amount_cents));
  const estimatedCost = Math.max(0, integer(body.estimated_cost_cents ?? opportunity.estimated_cost_cents, baseService.estimated_cost_cents));
  const estimatedFee = billingFeeEstimate(gross);
  const profit = gross - estimatedFee - estimatedCost;
  const offer = {
    source_opportunity_id: opportunity.id,
    service_id: baseService.id,
    name: text(body.name, `${opportunity.title} - billable offer`),
    description: text(body.description, text(opportunity.monetization_path, baseService.description)),
    unit_amount_cents: gross,
    estimated_cost_cents: estimatedCost,
    estimated_fee_cents: estimatedFee,
    estimated_profit_cents: profit,
    margin_percent: billingMarginPercent(gross, profit),
    currency: "usd",
    supported_billing_methods: ["checkout_session", "payment_link", "invoice_draft"],
    checkout_request: { service_id: baseService.id, amount_cents: gross, estimated_cost_cents: estimatedCost, source_opportunity_id: opportunity.id }
  };
  await logEvent(env, "billing.opportunity_offer_created", { surface: "admin", source_opportunity_id: text(opportunity.id), service_id: baseService.id, gross_cents: gross, profit_cents: profit }, void 0, request);
  return json({ ok: true, contract: BILLING_CONTRACT, offer, safety: { external_stripe_action_performed: false, owner_review_required_before_live_charge: true } });
}
__name(createBillingOfferFromOpportunity, "createBillingOfferFromOpportunity");
async function handleCreateCheckout(request, env) {
  const body = await readJson(request);
  const mode = billingMode(env, body.mode);
  const method = billingMethod(body.billing_method ?? body.billingMethod);
  if (mode === "live" && !liveBillingAllowed(env, body)) return json({ error: "live_charges_blocked", message: "Live Stripe charges require STRIPE_MEHYARSOFT_LIVE_CHARGES_ENABLED plus owner approval code." }, { status: 403 });
  const serviceId = text(body.service_id ?? body.serviceId, "tech-audit-330") || "tech-audit-330";
  const service = BILLING_SERVICES.find((item) => item.id === serviceId);
  if (!service) return json({ error: "service_not_found", services: BILLING_SERVICES.map((item) => item.id) }, { status: 404 });
  const quantity = Math.max(1, Math.min(integer(body.quantity, 1), 20));
  const customerEmail = lowerEmail(body.customer_email ?? body.email);
  if (method === "invoice_draft" && !customerEmail) return json({ error: "customer_email_required_for_invoice_draft" }, { status: 400 });
  const successUrl = text(body.success_url ?? body.successUrl, `${env.PUBLIC_SITE_URL || "https://mehyar.us"}/billing/success?session_id={CHECKOUT_SESSION_ID}`) || `${env.PUBLIC_SITE_URL || "https://mehyar.us"}/billing/success?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = text(body.cancel_url ?? body.cancelUrl, `${env.PUBLIC_SITE_URL || "https://mehyar.us"}/billing/cancel?service=${encodeURIComponent(service.id)}`) || `${env.PUBLIC_SITE_URL || "https://mehyar.us"}/billing/cancel?service=${encodeURIComponent(service.id)}`;
  const orderId = id("ord");
  const gross = Math.max(100, integer(body.amount_cents, service.unit_amount_cents) * quantity);
  const estimatedCost = Math.max(0, integer(body.estimated_cost_cents, service.estimated_cost_cents) * quantity);
  const estimatedFee = billingFeeEstimate(gross);
  const net = gross - estimatedFee;
  const profit = net - estimatedCost;
  const margin = billingMarginPercent(gross, profit);
  const sourceOpportunityId = text(body.source_opportunity_id ?? body.opportunity_id ?? body.opportunityId);
  const customerName = text(body.customer_name ?? body.name);
  const businessName = text(body.business_name ?? body.businessName);
  const ts = now();
  if (env.DB) {
    await env.DB.prepare(`INSERT INTO billing_orders (id, created_at, updated_at, mode, billing_method, source_opportunity_id, service_id, service_name, customer_email, customer_name, business_name, status, payment_status, currency, quantity, amount_cents, estimated_cost_cents, estimated_fee_cents, actual_fee_cents, refunded_cents, net_cents, profit_cents, margin_percent, stripe_checkout_session_id, stripe_payment_intent_id, stripe_customer_id, success_url, cancel_url, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'checkout_pending', 'unpaid', ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?)`).bind(orderId, ts, ts, mode, method, sourceOpportunityId, service.id, service.name, customerEmail, customerName, businessName, service.currency, quantity, gross, estimatedCost, estimatedFee, net, profit, margin, successUrl, cancelUrl, jsonString(safeStorageMetadata({ service_id: service.id, mode, billing_method: method, quantity, source: body.source, source_opportunity_id: sourceOpportunityId, customer_email: customerEmail ? "redacted" : void 0 }))).run();
  }
  const metadata = {
    "metadata[order_id]": orderId,
    "metadata[service_id]": service.id,
    "metadata[billing_mode]": mode,
    "metadata[billing_method]": method,
    "metadata[source_opportunity_id]": sourceOpportunityId
  };
  let stripeObject;
  let responseKey = "checkout";
  if (method === "payment_link") {
    const price = await stripePost(env, mode, "/v1/prices", { currency: service.currency, unit_amount: Math.round(gross / quantity), "product_data[name]": service.name, "product_data[description]": service.description, ...metadata });
    if (price.error) stripeObject = price;
    else {
      stripeObject = await stripePost(env, mode, "/v1/payment_links", { "line_items[0][price]": text(price.id), "line_items[0][quantity]": quantity, "after_completion[type]": "redirect", "after_completion[redirect][url]": successUrl, ...metadata });
      responseKey = "payment_link";
    }
  } else if (method === "invoice_draft") {
    const customer = await stripePost(env, mode, "/v1/customers", { email: customerEmail, name: customerName, "metadata[order_id]": orderId, "metadata[source_opportunity_id]": sourceOpportunityId });
    if (customer.error) stripeObject = customer;
    else {
      const invoiceItem = await stripePost(env, mode, "/v1/invoiceitems", { customer: text(customer.id), currency: service.currency, amount: gross, description: service.name, ...metadata });
      stripeObject = invoiceItem.error ? invoiceItem : await stripePost(env, mode, "/v1/invoices", { customer: text(customer.id), auto_advance: false, collection_method: "send_invoice", days_until_due: 7, ...metadata });
      responseKey = "invoice_draft";
    }
  } else {
    stripeObject = await stripePost(env, mode, "/v1/checkout/sessions", {
      mode: service.mode,
      success_url: successUrl,
      cancel_url: cancelUrl,
      customer_email: customerEmail,
      "line_items[0][quantity]": quantity,
      "line_items[0][price_data][currency]": service.currency,
      "line_items[0][price_data][unit_amount]": Math.round(gross / quantity),
      "line_items[0][price_data][product_data][name]": service.name,
      "line_items[0][price_data][product_data][description]": service.description,
      ...metadata,
      "payment_intent_data[metadata][order_id]": orderId,
      "payment_intent_data[metadata][service_id]": service.id,
      "payment_intent_data[metadata][source_opportunity_id]": sourceOpportunityId
    });
  }
  if (stripeObject.error) {
    if (env.DB) await env.DB.prepare("UPDATE billing_orders SET updated_at = ?, status = 'checkout_failed', metadata_json = ? WHERE id = ?").bind(now(), jsonString(safeStorageMetadata({ error: stripeObject.error, status: stripeObject.status, code: stripeObject.code, billing_method: method })), orderId).run();
    await logEvent(env, "billing.checkout_failed", { surface: "public", order_id: orderId, service_id: service.id, mode, billing_method: method, error: stripeObject.error }, void 0, request);
    return json({ ok: false, order_id: orderId, billing_method: method, ...stripeObject }, { status: stripeObject.error === "stripe_secret_key_not_configured" ? 503 : 502 });
  }
  if (env.DB) await env.DB.prepare("UPDATE billing_orders SET updated_at = ?, status = 'checkout_created', stripe_checkout_session_id = ?, stripe_customer_id = ?, success_url = COALESCE(?, success_url), metadata_json = ? WHERE id = ?").bind(now(), method === "checkout_session" ? text(stripeObject.id) : null, text(stripeObject.customer), text(stripeObject.url ?? stripeObject.hosted_invoice_url), jsonString(safeStorageMetadata({ checkout_session_id: method === "checkout_session" ? stripeObject.id : void 0, payment_link: method === "payment_link" ? stripeObject.id : void 0, invoice_draft: method === "invoice_draft" ? stripeObject.id : void 0, url_present: !!(stripeObject.url || stripeObject.hosted_invoice_url), mode, billing_method: method })), orderId).run();
  await logEvent(env, "billing.checkout_created", { surface: "public", order_id: orderId, service_id: service.id, amount_cents: gross, mode, billing_method: method, checkout_session_id: method === "checkout_session" ? text(stripeObject.id) : null }, void 0, request);
  return json({ ok: true, contract: BILLING_CONTRACT, mode, billing_method: method, order_id: orderId, source_opportunity_id: sourceOpportunityId, service: publicBillingService(service), profit_math: { gross_cents: gross, estimated_fee_cents: estimatedFee, estimated_cost_cents: estimatedCost, net_cents: net, profit_cents: profit, margin_percent: margin }, [responseKey]: { id: text(stripeObject.id), url: text(stripeObject.url ?? stripeObject.hosted_invoice_url), payment_status: text(stripeObject.payment_status ?? stripeObject.status, "unpaid") }, live_charge_blocked_without_owner_approval: mode !== "live" });
}
__name(handleCreateCheckout, "handleCreateCheckout");
async function handleBillingSession(request, env, sessionId) {
  if (!env.DB) return json({ ok: true, mode: "stub", session_id: sessionId });
  const row = await env.DB.prepare("SELECT id, created_at, updated_at, mode, billing_method, source_opportunity_id, service_id, service_name, status, payment_status, currency, quantity, amount_cents, estimated_cost_cents, estimated_fee_cents, actual_fee_cents, refunded_cents, net_cents, profit_cents, margin_percent, stripe_checkout_session_id FROM billing_orders WHERE stripe_checkout_session_id = ? OR id = ? LIMIT 1").bind(sessionId, sessionId).first();
  if (!row) return json({ error: "billing_session_not_found" }, { status: 404 });
  return json({ ok: true, contract: BILLING_CONTRACT, order: row });
}
__name(handleBillingSession, "handleBillingSession");
async function stripeVerifySignature(payload, signatureHeader, secret) {
  if (!secret || !signatureHeader) return false;
  const timestamp = signatureHeader.split(",").find((part) => part.startsWith("t="))?.slice(2);
  const signatures = signatureHeader.split(",").filter((part) => part.startsWith("v1=")).map((part) => part.slice(3));
  if (!timestamp || signatures.length === 0) return false;
  const signedPayload = `${timestamp}.${payload}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedPayload));
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return signatures.includes(hex);
}
__name(stripeVerifySignature, "stripeVerifySignature");
async function handleStripeWebhook(request, env) {
  const payload = await request.text();
  const signature = request.headers.get("stripe-signature");
  const verifiedTest = await stripeVerifySignature(payload, signature, stripeWebhookSecret(env, "test"));
  const verifiedLive = verifiedTest ? false : await stripeVerifySignature(payload, signature, stripeWebhookSecret(env, "live"));
  if (!verifiedTest && !verifiedLive) return json({ error: "invalid_stripe_signature" }, { status: 400 });
  let event;
  try {
    event = JSON.parse(payload);
  } catch {
    return json({ error: "invalid_stripe_payload" }, { status: 400 });
  }
  const livemode = event.livemode === true;
  const mode = livemode ? "live" : "test";
  if (mode === "live" && !verifiedLive || mode === "test" && !verifiedTest && !!stripeWebhookSecret(env, "test")) return json({ error: "invalid_stripe_signature_mode" }, { status: 400 });
  const eventId = text(event.id, id("stripe_evt")) || id("stripe_evt");
  const eventType = text(event.type, "unknown") || "unknown";
  const dataObject = event.data?.object || {};
  const sessionId = text(dataObject.id);
  const paymentStatus = text(dataObject.payment_status ?? dataObject.status);
  const paymentIntent = text(dataObject.payment_intent ?? dataObject.id);
  const metadata = dataObject.metadata || {};
  const orderId = text(metadata.order_id);
  const sourceOpportunityId = text(metadata.source_opportunity_id);
  const gross = integer(dataObject.amount_total ?? dataObject.amount_received ?? dataObject.amount_paid, 0);
  const refunded = integer(dataObject.amount_refunded, 0);
  const actualFee = integer(dataObject.balance_transaction?.fee, 0);
  const feeEstimate = billingFeeEstimate(gross);
  const feeToUse = actualFee > 0 ? actualFee : feeEstimate;
  if (env.DB) {
    await env.DB.prepare("INSERT OR IGNORE INTO billing_events (id, created_at, mode, stripe_event_id, event_type, order_id, checkout_session_id, verified, payload_summary_json) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)").bind(id("bill_evt"), now(), mode, eventId, eventType, orderId, sessionId, jsonString(safeStorageMetadata({ stripe_event_id: eventId, type: eventType, payment_status: paymentStatus, checkout_session_id: sessionId, source_opportunity_id: sourceOpportunityId, refunded_cents: refunded, actual_fee_cents: actualFee }))).run();
    if ((eventType === "checkout.session.completed" || eventType === "payment_intent.succeeded" || eventType === "charge.succeeded" || eventType === "invoice.paid") && (orderId || sessionId)) {
      await env.DB.prepare("UPDATE billing_orders SET updated_at = ?, status = 'paid', payment_status = ?, stripe_payment_intent_id = COALESCE(?, stripe_payment_intent_id), estimated_fee_cents = CASE WHEN estimated_fee_cents > 0 THEN estimated_fee_cents ELSE ? END, actual_fee_cents = CASE WHEN ? > 0 THEN ? ELSE actual_fee_cents END, refunded_cents = ?, net_cents = amount_cents - CASE WHEN ? > 0 THEN ? ELSE ? END - ?, profit_cents = amount_cents - CASE WHEN ? > 0 THEN ? ELSE ? END - ? - estimated_cost_cents, margin_percent = CASE WHEN amount_cents > 0 THEN ROUND(((amount_cents - CASE WHEN ? > 0 THEN ? ELSE ? END - ? - estimated_cost_cents) * 1000.0 / amount_cents)) / 10.0 ELSE 0 END WHERE id = COALESCE(?, id) AND (stripe_checkout_session_id = COALESCE(?, stripe_checkout_session_id) OR id = COALESCE(?, id))").bind(now(), paymentStatus || "paid", paymentIntent, feeEstimate, actualFee, actualFee, refunded, actualFee, actualFee, feeEstimate, refunded, actualFee, actualFee, feeEstimate, refunded, actualFee, actualFee, feeEstimate, refunded, orderId, sessionId, orderId).run();
    }
    if ((eventType === "charge.refunded" || eventType === "refund.created") && (orderId || sessionId)) {
      await env.DB.prepare("UPDATE billing_orders SET updated_at = ?, status = 'refunded', payment_status = 'refunded', refunded_cents = ?, net_cents = amount_cents - COALESCE(NULLIF(actual_fee_cents,0), estimated_fee_cents) - ?, profit_cents = amount_cents - COALESCE(NULLIF(actual_fee_cents,0), estimated_fee_cents) - ? - estimated_cost_cents, margin_percent = CASE WHEN amount_cents > 0 THEN ROUND(((amount_cents - COALESCE(NULLIF(actual_fee_cents,0), estimated_fee_cents) - ? - estimated_cost_cents) * 1000.0 / amount_cents)) / 10.0 ELSE 0 END WHERE id = COALESCE(?, id) OR stripe_checkout_session_id = COALESCE(?, stripe_checkout_session_id)").bind(now(), refunded || gross, refunded || gross, refunded || gross, refunded || gross, orderId, sessionId).run();
    }
  }
  await logEvent(env, "stripe.webhook_verified", { surface: "public", mode, stripe_event_id: eventId, type: eventType, order_id: orderId, checkout_session_id: sessionId, payment_status: paymentStatus, source_opportunity_id: sourceOpportunityId });
  return json({ ok: true, received: true });
}
__name(handleStripeWebhook, "handleStripeWebhook");
async function adminBillingLedger(request, env) {
  if (!env.DB) return json({ ok: true, contract: BILLING_CONTRACT, mode: "stub", orders: [], totals: { gross_cents: 0, net_cents: 0, estimated_cost_cents: 0, profit_cents: 0 } });
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode");
  const where = mode === "live" || mode === "test" ? "WHERE mode = ?" : "";
  const args = where ? [mode] : [];
  const orders = await env.DB.prepare(`SELECT id, created_at, updated_at, mode, billing_method, source_opportunity_id, service_id, service_name, status, payment_status, currency, quantity, amount_cents, estimated_cost_cents, estimated_fee_cents, actual_fee_cents, refunded_cents, net_cents, profit_cents, margin_percent, stripe_checkout_session_id FROM billing_orders ${where} ORDER BY created_at DESC LIMIT 100`).bind(...args).all();
  const totals = await env.DB.prepare(`SELECT COUNT(*) AS orders, COALESCE(SUM(amount_cents),0) AS gross_cents, COALESCE(SUM(estimated_cost_cents),0) AS estimated_cost_cents, COALESCE(SUM(estimated_fee_cents),0) AS estimated_fee_cents, COALESCE(SUM(actual_fee_cents),0) AS actual_fee_cents, COALESCE(SUM(refunded_cents),0) AS refunded_cents, COALESCE(SUM(CASE WHEN actual_fee_cents > 0 THEN actual_fee_cents ELSE estimated_fee_cents END),0) AS fee_cents, COALESCE(SUM(net_cents),0) AS net_cents, COALESCE(SUM(profit_cents),0) AS profit_cents, CASE WHEN COALESCE(SUM(amount_cents),0) > 0 THEN ROUND((COALESCE(SUM(profit_cents),0) * 1000.0 / COALESCE(SUM(amount_cents),0))) / 10.0 ELSE 0 END AS margin_percent FROM billing_orders ${where}`).bind(...args).first();
  const events = await env.DB.prepare("SELECT created_at, mode, event_type, order_id, checkout_session_id, verified FROM billing_events ORDER BY created_at DESC LIMIT 50").all();
  return json({ ok: true, contract: BILLING_CONTRACT, orders: orders.results || [], totals, events: events.results || [], stripe: { test: stripeEnvStatus(env, "test"), live: stripeEnvStatus(env, "live") } });
}
__name(adminBillingLedger, "adminBillingLedger");
async function checkAdminLoginRateLimit(request, env) {
  if (!env.KV) return null;
  const windowSeconds = 10 * 60;
  const maxAttempts = 10;
  const bucket = Math.floor(Date.now() / (windowSeconds * 1e3));
  const key = `admin_login_rl:${clientRateLimitKey(request)}:${bucket}`;
  const current = integer(await env.KV.get(key), 0);
  if (current >= maxAttempts) {
    await logEvent(env, "admin.login_rate_limited", { surface: "admin", ip_hash: "present-redacted" }, void 0, request);
    return json({ error: "rate_limited", retry_after_seconds: windowSeconds }, { status: 429, headers: { "Retry-After": String(windowSeconds) } });
  }
  await env.KV.put(key, String(current + 1), { expirationTtl: windowSeconds });
  return null;
}
__name(checkAdminLoginRateLimit, "checkAdminLoginRateLimit");
async function logEvent(env, type, payload, leadId, request) {
  if (!env.DB) return;
  const ctx = request ? requestContext(request) : { ip_hash: null, user_agent: void 0 };
  await env.DB.prepare("INSERT INTO events (id, created_at, type, lead_id, actor, surface, ip_hash, user_agent, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id("evt"), now(), type, leadId || null, text(payload.actor, "system"), text(payload.surface, "api"), ctx.ip_hash, text(ctx.user_agent), jsonString(safeStoragePayload(payload))).run();
}
__name(logEvent, "logEvent");
async function runAI(env, instruction, input) {
  const prompt = `${instruction}

Return concise JSON-like business output.

Input:
${JSON.stringify(input, null, 2)}`;
  if (!env.AI) {
    return JSON.stringify({ mode: "stub", summary: "AI binding not configured yet. Draft generation requires Cloudflare AI in production." });
  }
  const result = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", { messages: [{ role: "user", content: prompt }] });
  const response = result;
  return response.response || JSON.stringify(result);
}
__name(runAI, "runAI");
var OPPORTUNITY_CONTRACT = "opportunity-scout-admin-v1";
var OPPORTUNITY_ALLOWED_ASSIGNEES = ["productops", "devops", "webdev", "complyops", "leadfs", "dataeng", "arman"];
var GOVERNMENT_SOURCE_KEYS = ["sam_gov", "usaspending"];
var TREND_SOURCE_KEYS = ["google_trends", "public_rss", "sam_gov", "usaspending", "rss_content", "stripe_revenue_feedback", "fallback_seed"];
var OPPORTUNITY_ACTION_CLASSES = ["spend", "publish", "send", "charge", "bid", "domain", "account", "kanban", "draft"];
var ACTION_CLASS_KILL_SWITCHES = {
  spend: { display_name: "Spend / paid media", description: "Ads, tools, contractors, marketplace purchases, or any cash outlay.", mode: "blocked", daily_budget_limit_cents: 0, daily_rate_limit: 0, requires_owner_approval: 1, requires_compliance_review: 1 },
  publish: { display_name: "Publish / public content", description: "Public pages, posts, listings, or launch assets.", mode: "blocked", daily_budget_limit_cents: 0, daily_rate_limit: 0, requires_owner_approval: 1, requires_compliance_review: 1 },
  send: { display_name: "Send / outbound message", description: "Email, SMS, DMs, newsletter, or campaign sends.", mode: "blocked", daily_budget_limit_cents: 0, daily_rate_limit: 0, requires_owner_approval: 1, requires_compliance_review: 1 },
  charge: { display_name: "Charge / billing", description: "Stripe live charges, invoices, refunds, or payment capture.", mode: "blocked", daily_budget_limit_cents: 0, daily_rate_limit: 0, requires_owner_approval: 1, requires_compliance_review: 1 },
  bid: { display_name: "Bid / proposal submit", description: "SAM.gov, procurement portals, marketplace bids, or proposal submissions.", mode: "blocked", daily_budget_limit_cents: 0, daily_rate_limit: 0, requires_owner_approval: 1, requires_compliance_review: 1 },
  domain: { display_name: "Domain / DNS account action", description: "Domain purchase, DNS cutover, or public routing changes.", mode: "blocked", daily_budget_limit_cents: 0, daily_rate_limit: 0, requires_owner_approval: 1, requires_compliance_review: 1 },
  account: { display_name: "External account action", description: "Creating, modifying, authenticating, or connecting external service accounts.", mode: "blocked", daily_budget_limit_cents: 0, daily_rate_limit: 0, requires_owner_approval: 1, requires_compliance_review: 1 },
  kanban: { display_name: "Internal Kanban draft", description: "Internal task/card creation only; no external side effect.", mode: "approval_required", daily_budget_limit_cents: 0, daily_rate_limit: 25, requires_owner_approval: 1, requires_compliance_review: 0 },
  draft: { display_name: "Internal draft generation", description: "Internal drafts and planning artifacts only.", mode: "approved", daily_budget_limit_cents: 0, daily_rate_limit: 100, requires_owner_approval: 0, requires_compliance_review: 0 }
};
var GOVERNMENT_SEARCH_TERMS = ["artificial intelligence", "automation", "website", "cloud", "crm"];
var OPPORTUNITY_SEED_SIGNALS = [
  { source: "fallback_seed", source_id: "seed-ai-receptionist", title: "AI missed-lead rescue for local service businesses", summary: "Local service firms lose revenue when calls and forms are not followed up quickly; a low-cost intake audit and automation sprint is practical with existing Cloudflare/Zoho skills.", category: "local_services_automation", observed_at: now(), raw_metadata: { cost_cents: 0 } },
  { source: "fallback_seed", source_id: "seed-compliance-crm", title: "Compliance-safe CRM cleanup package for owner-led businesses", summary: "Many small businesses have stale contacts and risky outreach habits; sell suppression, segmentation, audit log, and repermission setup without sending messages.", category: "compliance_workflow", observed_at: now(), raw_metadata: { cost_cents: 0 } },
  { source: "fallback_seed", source_id: "seed-cloudflare-rescue", title: "Cloudflare Workers rescue audit for slow or fragile websites", summary: "Small teams need cheaper, faster sites and API edges; package a diagnostic that leads to a paid implementation sprint.", category: "devops_rescue", observed_at: now(), raw_metadata: { cost_cents: 0 } },
  { source: "fallback_seed", source_id: "seed-pdf-leadmagnet", title: "PDF checklist lead magnet for niche service operators", summary: "A no-spend downloadable checklist can validate demand and collect consented leads before building paid automations.", category: "newsletter_lead_magnet", observed_at: now(), raw_metadata: { cost_cents: 0 } }
];
function parseJsonValue(value, fallback) {
  if (typeof value !== "string" || !value.trim()) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
__name(parseJsonValue, "parseJsonValue");
function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 96) || "opportunity";
}
__name(slugify, "slugify");
function localDate(timezone = "America/New_York", date = /* @__PURE__ */ new Date()) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
    const get = /* @__PURE__ */ __name((type) => parts.find((part) => part.type === type)?.value || "01", "get");
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    return date.toISOString().slice(0, 10);
  }
}
__name(localDate, "localDate");
function localMinutes(timezone = "America/New_York", date = /* @__PURE__ */ new Date()) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(date);
    const get = /* @__PURE__ */ __name((type) => integer(parts.find((part) => part.type === type)?.value, 0), "get");
    return get("hour") * 60 + get("minute");
  } catch {
    return date.getUTCHours() * 60 + date.getUTCMinutes();
  }
}
__name(localMinutes, "localMinutes");
function scheduledWindowDue(scheduledLocalTime, timezone = "America/New_York", date = /* @__PURE__ */ new Date()) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(scheduledLocalTime || "09:00");
  const target = match ? Math.max(0, Math.min(23, integer(match[1], 9))) * 60 + Math.max(0, Math.min(59, integer(match[2], 0))) : 9 * 60;
  const current = localMinutes(timezone, date);
  const delta = (current - target + 1440) % 1440;
  return delta < 10;
}
__name(scheduledWindowDue, "scheduledWindowDue");
async function seedOpportunitySettings(env) {
  if (!env.DB) return;
  const ts = now();
  await env.DB.prepare(`INSERT OR IGNORE INTO opportunity_settings (id, created_at, updated_at, enabled, timezone, scheduled_local_time, max_daily_ideas, min_daily_ideas, max_budget_cents, min_score, min_roi_score, min_probability_weighted_value_cents, min_expected_profit_cents, duplicate_window_days, allowed_assignees_json, default_board, kanban_creation_enabled, auto_create_draft_kanban_cards, require_approval_before_kanban, require_compliance_review_for_audience_use, trend_sources_json, assistant_enabled, diagnostics_enabled, roi_filters_json, metadata_json)
    VALUES ('default', ?, ?, 0, 'America/New_York', '09:00', 3, 1, 5000, 65, 60, 25000, 10000, 45, ?, 'mehyarsoft-llc', 0, 0, 1, 1, ?, 1, 1, ?, ?)`).bind(ts, ts, jsonString(OPPORTUNITY_ALLOWED_ASSIGNEES), jsonString(["sam_gov", "usaspending", "fallback_rss", "fallback_seed"]), jsonString({ min_roi_score: 60, min_probability_weighted_value_cents: 25e3, min_expected_profit_cents: 1e4, max_startup_cost_cents: 5e3 }), jsonString({ safety: "no_spend_no_send_no_publish", legacy_audience: "not_eligible_for_use" })).run();
}
__name(seedOpportunitySettings, "seedOpportunitySettings");
async function getOpportunitySettings(env) {
  if (!env.DB) throw new Error("db_binding_required");
  await seedOpportunitySettings(env);
  await seedOpportunityActionGates(env);
  const row = await env.DB.prepare("SELECT * FROM opportunity_settings WHERE id = 'default' LIMIT 1").first();
  if (!row) throw new Error("opportunity_settings_missing");
  return row;
}
__name(getOpportunitySettings, "getOpportunitySettings");
async function auditOpportunity(env, eventType, metadata, runId, opportunityId, planId, request) {
  if (!env.DB) return;
  await env.DB.prepare("INSERT INTO opportunity_audit_events (id, created_at, run_id, opportunity_id, plan_id, event_type, actor, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(id("opp_audit"), now(), runId || null, opportunityId || null, planId || null, eventType, text(metadata.actor, "system"), jsonString(safeStoragePayload(metadata))).run();
  await logEvent(env, `opportunity_scout.${eventType}`, { surface: "admin", ...safeStoragePayload(metadata) }, void 0, request);
}
__name(auditOpportunity, "auditOpportunity");
async function seedOpportunityActionGates(env) {
  if (!env.DB) return;
  const ts = now();
  for (const actionClass of OPPORTUNITY_ACTION_CLASSES) {
    const config = ACTION_CLASS_KILL_SWITCHES[actionClass];
    await env.DB.prepare(`INSERT OR IGNORE INTO opportunity_action_class_gates (id, created_at, updated_at, action_class, display_name, description, mode, kill_switch_enabled, daily_budget_limit_cents, daily_rate_limit, requires_owner_approval, requires_compliance_review, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`).bind(`opp_gate_${actionClass}`, ts, ts, actionClass, config.display_name, config.description, config.mode, config.daily_budget_limit_cents, config.daily_rate_limit, config.requires_owner_approval, config.requires_compliance_review, jsonString({ default: actionClass === "draft" || actionClass === "kanban" ? "internal_only" : `blocked_no_${actionClass}` })).run();
  }
}
__name(seedOpportunityActionGates, "seedOpportunityActionGates");
function normalizeActionClass(value) {
  const actionClass = text(value, "draft");
  return OPPORTUNITY_ACTION_CLASSES.includes(actionClass) ? actionClass : "draft";
}
__name(normalizeActionClass, "normalizeActionClass");
function publicActionGate(row) {
  return {
    action_class: row.action_class,
    display_name: row.display_name,
    description: row.description,
    mode: row.mode,
    kill_switch_enabled: !!row.kill_switch_enabled,
    daily_budget_limit_cents: integer(row.daily_budget_limit_cents, 0),
    daily_rate_limit: integer(row.daily_rate_limit, 0),
    requires_owner_approval: !!row.requires_owner_approval,
    requires_compliance_review: !!row.requires_compliance_review,
    metadata: parseJsonValue(row.metadata_json, {}),
    no_secret_values_returned: true
  };
}
__name(publicActionGate, "publicActionGate");
async function listOpportunityActionGates(env) {
  if (!env.DB) return [];
  await seedOpportunityActionGates(env);
  const rows = await env.DB.prepare("SELECT * FROM opportunity_action_class_gates ORDER BY CASE action_class WHEN 'spend' THEN 1 WHEN 'publish' THEN 2 WHEN 'send' THEN 3 WHEN 'charge' THEN 4 WHEN 'bid' THEN 5 WHEN 'domain' THEN 6 WHEN 'account' THEN 7 WHEN 'kanban' THEN 8 ELSE 9 END").all();
  return rows.results || [];
}
__name(listOpportunityActionGates, "listOpportunityActionGates");
async function getOpportunityActionGate(env, actionClass) {
  await seedOpportunityActionGates(env);
  const row = await env.DB.prepare("SELECT * FROM opportunity_action_class_gates WHERE action_class = ? LIMIT 1").bind(actionClass).first();
  if (row) return row;
  const fallback = ACTION_CLASS_KILL_SWITCHES[actionClass];
  return { id: `opp_gate_${actionClass}`, action_class: actionClass, display_name: fallback.display_name, description: fallback.description, mode: fallback.mode, kill_switch_enabled: 0, daily_budget_limit_cents: fallback.daily_budget_limit_cents, daily_rate_limit: fallback.daily_rate_limit, requires_owner_approval: fallback.requires_owner_approval, requires_compliance_review: fallback.requires_compliance_review, metadata_json: "{}" };
}
__name(getOpportunityActionGate, "getOpportunityActionGate");
async function actionGateUsage(env, actionClass, dayKey) {
  if (!env.DB) return { approved_count_today: 0, approved_amount_cents_today: 0 };
  const row = await env.DB.prepare("SELECT COUNT(*) AS approved_count_today, COALESCE(SUM(amount_cents),0) AS approved_amount_cents_today FROM opportunity_action_gate_events WHERE action_class = ? AND day_key = ? AND decision = 'action_class_approved'").bind(actionClass, dayKey).first();
  return { approved_count_today: integer(row?.approved_count_today, 0), approved_amount_cents_today: integer(row?.approved_amount_cents_today, 0) };
}
__name(actionGateUsage, "actionGateUsage");
async function assessOpportunityActionGate(env, actionClassInput, context = {}) {
  const actionClass = normalizeActionClass(actionClassInput);
  const gate = await getOpportunityActionGate(env, actionClass);
  const dayKey = localDate("UTC");
  const amount = Math.max(0, integer(context.amount_cents ?? context.estimated_cost_cents, 0));
  const usage = await actionGateUsage(env, actionClass, dayKey);
  const base = { action_class: actionClass, mode: gate.mode, amount_cents: amount, day_key: dayKey, usage: { ...usage, daily_rate_limit: integer(gate.daily_rate_limit, 0), daily_budget_limit_cents: integer(gate.daily_budget_limit_cents, 0) }, run_id: text(context.run_id), opportunity_id: text(context.opportunity_id), plan_id: text(context.plan_id), actor: text(context.actor, "system"), no_secret_values_returned: true };
  if (gate.kill_switch_enabled) return { ...base, allowed: false, decision: "action_class_blocked", reason: "kill_switch_active" };
  if (gate.mode === "blocked") return { ...base, allowed: false, decision: "action_class_blocked", reason: "action_class_blocked" };
  if (gate.mode === "approval_required" && context.owner_approved !== true) return { ...base, allowed: false, decision: "action_class_blocked", reason: "owner_approval_required" };
  if (integer(gate.daily_rate_limit, 0) > 0 && usage.approved_count_today >= integer(gate.daily_rate_limit, 0)) return { ...base, allowed: false, decision: "action_class_blocked", reason: "rate_limit_exceeded" };
  if (integer(gate.daily_budget_limit_cents, 0) > 0 && usage.approved_amount_cents_today + amount > integer(gate.daily_budget_limit_cents, 0)) return { ...base, allowed: false, decision: "action_class_blocked", reason: "budget_limit_exceeded" };
  return { ...base, allowed: true, decision: "action_class_approved", reason: "action_class_approved" };
}
__name(assessOpportunityActionGate, "assessOpportunityActionGate");
async function auditOpportunityActionGate(env, gateDecision, metadata = {}, request) {
  if (!env.DB) return;
  await env.DB.prepare("INSERT INTO opportunity_action_gate_events (id, created_at, day_key, action_class, decision, reason, amount_cents, run_id, opportunity_id, plan_id, actor, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id("opp_gate_evt"), now(), gateDecision.day_key, gateDecision.action_class, gateDecision.decision, gateDecision.reason, gateDecision.amount_cents, gateDecision.run_id || null, gateDecision.opportunity_id || null, gateDecision.plan_id || null, gateDecision.actor || "system", jsonString(safeStoragePayload({ ...metadata, usage: gateDecision.usage, no_secret_values_returned: true }))).run();
  await auditOpportunity(env, "action_class_decision", { actor: gateDecision.actor || "system", action_class: gateDecision.action_class, decision: gateDecision.decision, reason: gateDecision.reason, allowed: gateDecision.allowed, amount_cents: gateDecision.amount_cents, no_secret_values_returned: true }, gateDecision.run_id, gateDecision.opportunity_id, gateDecision.plan_id, request);
}
__name(auditOpportunityActionGate, "auditOpportunityActionGate");
async function automationGatesRoute(request, env) {
  if (!env.DB) return json({ error: "db_binding_required" }, { status: 500 });
  if (request.method === "GET") return json({ ok: true, contract: OPPORTUNITY_CONTRACT, gates: (await listOpportunityActionGates(env)).map(publicActionGate), safety: { env_values_returned: false, no_secret_values_returned: true } });
  const body = await readJson(request);
  const patches = Array.isArray(body.gates) ? body.gates : [body];
  const changed = [];
  for (const patch of patches) {
    const actionClass = normalizeActionClass(patch.action_class ?? patch.actionClass);
    const current = await getOpportunityActionGate(env, actionClass);
    const requestedMode = text(patch.mode, current.mode);
    const mode = ["blocked", "approval_required", "approved"].includes(requestedMode) ? requestedMode : current.mode;
    const dailyBudget = Math.max(0, Math.min(1e8, integer(patch.daily_budget_limit_cents, current.daily_budget_limit_cents)));
    const dailyRate = Math.max(0, Math.min(1e4, integer(patch.daily_rate_limit, current.daily_rate_limit)));
    await env.DB.prepare("UPDATE opportunity_action_class_gates SET updated_at = ?, mode = ?, kill_switch_enabled = ?, daily_budget_limit_cents = ?, daily_rate_limit = ?, requires_owner_approval = ?, requires_compliance_review = ?, metadata_json = ? WHERE action_class = ?").bind(now(), mode, patch.kill_switch_enabled === void 0 ? current.kill_switch_enabled : boolInt(patch.kill_switch_enabled), dailyBudget, dailyRate, patch.requires_owner_approval === void 0 ? current.requires_owner_approval : boolInt(patch.requires_owner_approval), patch.requires_compliance_review === void 0 ? current.requires_compliance_review : boolInt(patch.requires_compliance_review), jsonString(safeStoragePayload({ updated_by: text(body.actor, "admin"), note: text(patch.note), no_secret_values_returned: true })), actionClass).run();
    changed.push(actionClass);
  }
  await auditOpportunity(env, "automation_gates_updated", { actor: "admin", changed_action_classes: changed, no_secret_values_returned: true }, void 0, void 0, void 0, request);
  return json({ ok: true, contract: OPPORTUNITY_CONTRACT, changed_action_classes: changed, gates: (await listOpportunityActionGates(env)).map(publicActionGate), safety: { env_values_returned: false, no_secret_values_returned: true } });
}
__name(automationGatesRoute, "automationGatesRoute");
async function automationGateCheckRoute(request, env) {
  if (!env.DB) return json({ error: "db_binding_required" }, { status: 500 });
  const body = await readJson(request);
  const gateDecision = await assessOpportunityActionGate(env, body.action_class ?? body.actionClass, { ...body, actor: text(body.actor, "admin") });
  await auditOpportunityActionGate(env, gateDecision, { dry_run: true, route: "automation_gate_check" }, request);
  if (gateDecision.allowed === false) return json({ error: gateDecision.reason, gate_decision: gateDecision }, { status: 409 });
  if (gateDecision.allowed === true) return json({ ok: true, contract: OPPORTUNITY_CONTRACT, gate_decision: gateDecision, safety: { no_external_side_effects_performed: true, no_secret_values_returned: true } });
  return json({ error: "gate_decision_unknown" }, { status: 500 });
}
__name(automationGateCheckRoute, "automationGateCheckRoute");
async function fetchFallbackRssSignals(env, limit = 8) {
  if (!env.DB) return [];
  try {
    const result = await env.DB.prepare(`SELECT id, title, url, canonical_url, summary, excerpt, category, vertical, published_at, created_at, score FROM rss_articles ORDER BY score DESC, created_at DESC LIMIT ?`).bind(limit).all();
    return (result.results || []).map((row) => ({
      source: "fallback_rss",
      source_id: text(row.id, id("rss_signal")),
      title: text(row.title, "Untitled signal"),
      url: text(row.url ?? row.canonical_url),
      summary: text(row.summary ?? row.excerpt, "RSS metadata signal for private analysis only."),
      category: text(row.category ?? row.vertical, "rss_signal"),
      observed_at: text(row.published_at ?? row.created_at, now()),
      raw_metadata: { score: integer(row.score), note: "private RSS metadata only; no full article republication" }
    }));
  } catch {
    return [];
  }
}
__name(fetchFallbackRssSignals, "fetchFallbackRssSignals");
var SERP_TRENDS_PROVIDER_KEY = "serpapi_google_trends";
var SERP_TRENDS_MONTHLY_QUOTA = 260;
var TREND_CACHE_WINDOW_DAYS = 30;
function serpApiKey(env) {
  return text(env.SERP_API_KEY ?? env.SERPAPI_API_KEY ?? env.SEARCHAPI_API_KEY ?? env.GOOGLE_TRENDS_API_KEY);
}
__name(serpApiKey, "serpApiKey");
function trendQuotaMonth(date = /* @__PURE__ */ new Date()) {
  return date.toISOString().slice(0, 7);
}
__name(trendQuotaMonth, "trendQuotaMonth");
function numericValue(value, fallback = null) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/[^0-9.-]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}
__name(numericValue, "numericValue");
async function serpTrendQuotaState(env) {
  const month = trendQuotaMonth();
  const quota = SERP_TRENDS_MONTHLY_QUOTA;
  if (!env.DB) return { month, used: 0, remaining: quota, quota };
  try {
    const row = await env.DB.prepare("SELECT metadata_json FROM source_ingest_state WHERE source_key = ? LIMIT 1").bind(SERP_TRENDS_PROVIDER_KEY).first();
    const metadata = parseJsonValue(text(row?.metadata_json, "{}"), {});
    const used = text(metadata.month) === month ? Math.max(0, integer(metadata.searches_used, 0)) : 0;
    return { month, used, remaining: Math.max(0, quota - used), quota };
  } catch {
    return { month, used: 0, remaining: quota, quota };
  }
}
__name(serpTrendQuotaState, "serpTrendQuotaState");
async function recordSerpTrendQuotaUse(env, status, searchesUsedThisRun, extra = {}) {
  const current = await serpTrendQuotaState(env);
  const used = Math.min(current.quota, current.used + Math.max(0, integer(searchesUsedThisRun, 0)));
  const quota = { month: current.month, searches_used: used, searches_remaining: Math.max(0, current.quota - used), monthly_quota: current.quota };
  await updateSourceIngestState(env, SERP_TRENDS_PROVIDER_KEY, status, { ...extra, ...quota, count: integer(extra.count, 0), api_key_present: true, provider: SERP_TRENDS_PROVIDER_KEY });
  return quota;
}
__name(recordSerpTrendQuotaUse, "recordSerpTrendQuotaUse");
async function cachedGoogleTrendSignals(env, keyword, region, limit = 10) {
  if (!env.DB) return [];
  try {
    const cutoff = new Date(Date.now() - 1e3 * 60 * 60 * 24 * TREND_CACHE_WINDOW_DAYS).toISOString();
    const rows = await env.DB.prepare(`SELECT source, source_id, title, url, summary, metric_name, metric_value, velocity, confidence, region, raw_evidence_json, created_at FROM trend_scan_results WHERE source = 'google_trends' AND keyword = ? AND region = ? AND created_at >= ? ORDER BY created_at DESC, priority_score DESC LIMIT ?`).bind(keyword, region, cutoff, Math.max(1, Math.min(20, limit))).all();
    return (rows.results || []).map((row) => ({
      source: "google_trends",
      source_id: text(row.source_id, id("serp_cached")),
      title: text(row.title, "Cached Google Trends signal"),
      url: text(row.url),
      summary: text(row.summary, "Cached trend signal from stored history."),
      category: "search_demand",
      observed_at: text(row.created_at, now()),
      metric_name: text(row.metric_name, "cached_trend_strength"),
      metric_value: numericValue(row.metric_value),
      velocity: numericValue(row.velocity),
      confidence: text(row.confidence, "medium"),
      region: text(row.region, region),
      raw_metadata: { cache_hit: true, provider: SERP_TRENDS_PROVIDER_KEY, stored_history_only: true, ...parseJsonValue(text(row.raw_evidence_json, "{}"), {}) }
    }));
  } catch {
    return [];
  }
}
__name(cachedGoogleTrendSignals, "cachedGoogleTrendSignals");
function serpTimelineSignals(payload, keyword, region) {
  const interest = payload.interest_over_time;
  const timeline = Array.isArray(interest?.timeline_data) ? interest?.timeline_data : Array.isArray(payload.timeline_data) ? payload.timeline_data : [];
  const signals = [];
  const latest = timeline.slice(-3);
  latest.forEach((item, index) => {
    const values = Array.isArray(item.values) ? item.values : [];
    const first = values[0] || item;
    const metric = numericValue(first.value ?? first.extracted_value ?? item.value ?? item.extracted_value, null);
    const title = `${keyword} Google Trends interest${text(item.date) ? `: ${text(item.date)}` : ""}`;
    signals.push({
      source: "google_trends",
      source_id: `${SERP_TRENDS_PROVIDER_KEY}-${slugify(keyword)}-${index}-${slugify(text(item.date, now()))}`,
      title,
      url: "https://trends.google.com/trends/",
      summary: `Search demand signal for "${keyword}" in ${region}. Stored for private Opportunity Scout analysis only; no outreach, spend, publishing, or billing action allowed.`,
      category: "search_demand",
      observed_at: text(item.date, now()),
      metric_name: "interest",
      metric_value: metric,
      velocity: null,
      confidence: metric !== null ? "medium" : "low",
      region,
      raw_metadata: { provider: SERP_TRENDS_PROVIDER_KEY, result_type: "interest_over_time", date: text(item.date), no_secret_values: true, private_analysis_only: true }
    });
  });
  return signals;
}
__name(serpTimelineSignals, "serpTimelineSignals");
function serpRelatedSignals(payload, keyword, region, limit = 8) {
  const related = payload.related_queries;
  const queries = Array.isArray(related?.rising) ? related?.rising : Array.isArray(related?.top) ? related?.top : [];
  return queries.slice(0, Math.max(1, Math.min(10, limit))).map((item, index) => {
    const query = text(item.query ?? item.title, keyword);
    const value = numericValue(item.value ?? item.extracted_value, null);
    return { source: "google_trends", source_id: `${SERP_TRENDS_PROVIDER_KEY}-related-${slugify(keyword)}-${index}-${slugify(query)}`, title: `Related search demand: ${query}`, url: "https://trends.google.com/trends/", summary: `Related Google Trends query for "${keyword}" in ${region}: ${query}. Private analysis only.`, category: "search_demand", observed_at: now(), metric_name: "related_query_value", metric_value: value, velocity: null, confidence: "medium", region, raw_metadata: { provider: SERP_TRENDS_PROVIDER_KEY, result_type: "related_queries", no_secret_values: true, private_analysis_only: true } };
  });
}
__name(serpRelatedSignals, "serpRelatedSignals");
async function fetchSerpApiTrendSignals(env, keyword, region, limit = 10) {
  const apiKey = serpApiKey(env);
  if (!apiKey) return { provider: SERP_TRENDS_PROVIDER_KEY, status: "missing_api_key", count: 0, signals: [], api_key_present: false, quota: { monthly_quota: SERP_TRENDS_MONTHLY_QUOTA, env_names_only: ["SERP_API_KEY", "SERPAPI_API_KEY", "SEARCHAPI_API_KEY", "GOOGLE_TRENDS_API_KEY"] } };
  const cached = await cachedGoogleTrendSignals(env, keyword, region, limit);
  if (cached.length) {
    const quota2 = await serpTrendQuotaState(env);
    return { provider: SERP_TRENDS_PROVIDER_KEY, status: "cache_hit", count: cached.length, signals: cached, api_key_present: true, cache_hit: true, quota: { month: quota2.month, searches_used: quota2.used, searches_remaining: quota2.remaining, monthly_quota: quota2.quota } };
  }
  const quota = await serpTrendQuotaState(env);
  if (quota.remaining <= 0) return { provider: SERP_TRENDS_PROVIDER_KEY, status: "quota_exhausted", count: 0, signals: [], api_key_present: true, quota: { month: quota.month, searches_used: quota.used, searches_remaining: 0, monthly_quota: quota.quota } };
  try {
    const url = new URL("https://serpapi.com/search.json");
    url.searchParams.set("engine", "google_trends");
    url.searchParams.set("q", keyword);
    url.searchParams.set("geo", region);
    url.searchParams.set("api_key", apiKey);
    const response = await fetch(url.toString(), { headers: { "accept": "application/json", "user-agent": "MehyarSoftBot/0.1 read-only trends scout" } });
    if (!response.ok) throw new Error(`serpapi_http_${response.status}`);
    const payload = await response.json();
    const signals = [...serpTimelineSignals(payload, keyword, region), ...serpRelatedSignals(payload, keyword, region, limit)].slice(0, Math.max(1, Math.min(20, limit)));
    const updatedQuota = await recordSerpTrendQuotaUse(env, "ok", 1, { count: signals.length, keyword, region, cache_hit: false, private_analysis_only: true });
    return { provider: SERP_TRENDS_PROVIDER_KEY, status: "ok", count: signals.length, signals, api_key_present: true, quota: updatedQuota };
  } catch (error) {
    const updatedQuota = await recordSerpTrendQuotaUse(env, "error", 1, { count: 0, error: error instanceof Error ? error.message.slice(0, 120) : "serpapi_fetch_failed", keyword, region });
    return { provider: SERP_TRENDS_PROVIDER_KEY, status: "error", count: 0, signals: [], error: error instanceof Error ? error.message.slice(0, 120) : "serpapi_fetch_failed", api_key_present: true, quota: updatedQuota };
  }
}
__name(fetchSerpApiTrendSignals, "fetchSerpApiTrendSignals");
function samApiKey(env) {
  return text(env.SAM_GOV_API_KEY ?? env.SAM_API_KEY);
}
__name(samApiKey, "samApiKey");
function formatSamDate(date) {
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${mm}/${dd}/${date.getUTCFullYear()}`;
}
__name(formatSamDate, "formatSamDate");
function normalizeNoticeId(value, fallback) {
  return text(value.noticeId ?? value.notice_id ?? value.solicitationNumber ?? value.solicitation_number ?? value.id, fallback).slice(0, 180);
}
__name(normalizeNoticeId, "normalizeNoticeId");
function nestedText(value, path) {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = current[key];
  }
  return text(current);
}
__name(nestedText, "nestedText");
function firstLinkHref(value) {
  if (!Array.isArray(value)) return null;
  for (const item of value) {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const href = text(item.href ?? item.url);
      if (href) return href;
    }
  }
  return null;
}
__name(firstLinkHref, "firstLinkHref");
async function upsertGovernmentOpportunity(env, row) {
  if (!env.DB) return;
  await env.DB.prepare(`INSERT INTO government_opportunities (id, created_at, updated_at, source_type, notice_id, title, solicitation_number, agency, office, posted_date, response_deadline, naics_code, set_aside, place_of_performance, url, description, score, status, raw_metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(notice_id) DO UPDATE SET updated_at=excluded.updated_at, title=excluded.title, solicitation_number=excluded.solicitation_number, agency=excluded.agency, office=excluded.office, posted_date=excluded.posted_date, response_deadline=excluded.response_deadline, naics_code=excluded.naics_code, set_aside=excluded.set_aside, place_of_performance=excluded.place_of_performance, url=excluded.url, description=excluded.description, score=excluded.score, status=excluded.status, raw_metadata_json=excluded.raw_metadata_json`).bind(id("gov_opp"), now(), now(), text(row.source_type, "sam_gov"), text(row.notice_id), text(row.title, "Untitled government opportunity"), text(row.solicitation_number), text(row.agency), text(row.office), text(row.posted_date), text(row.response_deadline), text(row.naics_code), text(row.set_aside), text(row.place_of_performance), text(row.url), text(row.description), integer(row.score, 50), text(row.status, "active"), jsonString(safeStoragePayload(row.raw_metadata || {}))).run();
}
__name(upsertGovernmentOpportunity, "upsertGovernmentOpportunity");
async function updateSourceIngestState(env, sourceKey, status, metadata) {
  if (!env.DB) return;
  await env.DB.prepare(`INSERT INTO source_ingest_state (id, created_at, updated_at, source_key, last_run_at, last_status, last_count, last_error, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_key) DO UPDATE SET updated_at=excluded.updated_at, last_run_at=excluded.last_run_at, last_status=excluded.last_status, last_count=excluded.last_count, last_error=excluded.last_error, metadata_json=excluded.metadata_json`).bind(id("src_state"), now(), now(), sourceKey, now(), status, integer(metadata.count, 0), text(metadata.error), jsonString(safeStoragePayload(metadata))).run();
}
__name(updateSourceIngestState, "updateSourceIngestState");
function governmentScore(row) {
  const haystack = `${text(row.title, "")} ${text(row.description, "")} ${text(row.agency, "")} ${text(row.naics_code, "")}`.toLowerCase();
  let score = 45;
  if (/\b(ai|artificial intelligence|automation|machine learning|data|cloud|software|website|crm|workflow)\b/.test(haystack)) score += 25;
  if (/\b(small business|set.aside|8\(a\)|hubzone|sdvosb|women-owned)\b/.test(haystack)) score += 12;
  if (/\b(support|maintenance|modernization|implementation|development)\b/.test(haystack)) score += 10;
  return Math.max(0, Math.min(100, score));
}
__name(governmentScore, "governmentScore");
function samOpportunityToSignal(item) {
  const noticeId = normalizeNoticeId(item, id("sam_notice"));
  const title = text(item.title ?? item.name, "Untitled SAM.gov opportunity");
  const agency = text(item.fullParentPathName ?? item.department ?? item.subTier ?? item.agency, "Federal agency");
  const office = text(item.officeName ?? item.office, null);
  const solicitation = text(item.solicitationNumber ?? item.solicitation_number, noticeId);
  const url = text(item.uiLink ?? firstLinkHref(item.links) ?? item.url, `https://sam.gov/opp/${encodeURIComponent(noticeId)}/view`);
  const description = text(item.description ?? item.shortDescription ?? item.type, "SAM.gov opportunity metadata imported read-only for internal analysis.");
  const placeOfPerformance = nestedText(item.placeOfPerformance, ["city", "name"]) || nestedText(item.placeOfPerformance, ["state", "name"]);
  const row = { source_type: "sam_gov", notice_id: noticeId, title, solicitation_number: solicitation, agency, office, posted_date: text(item.postedDate ?? item.posted_date), response_deadline: text(item.responseDeadLine ?? item.responseDeadline ?? item.response_deadline), naics_code: text(item.naicsCode ?? item.naics_code), set_aside: text(item.typeOfSetAsideDescription ?? item.setAside), place_of_performance: placeOfPerformance, url, description, score: governmentScore({ title, description, agency, naics_code: item.naicsCode }), status: "active", raw_metadata: { api: "sam_gov_opportunities_v2", notice_id: noticeId, no_proposal_submission: true } };
  return { source: "sam_gov", source_id: noticeId, title: `${title} (${agency})`, url, summary: `${description} Agency: ${agency || "unknown"}. Read-only SAM.gov opportunity; no proposal submission or external action.`, category: "government_contracting", observed_at: text(item.postedDate ?? item.posted_date, now()), raw_metadata: row };
}
__name(samOpportunityToSignal, "samOpportunityToSignal");
async function fetchSamGovSignals(env, limit = 10) {
  const apiKey = samApiKey(env);
  if (!apiKey) return { provider: "sam_gov", status: "missing_api_key", count: 0, signals: [], api_key_present: false };
  const postedTo = /* @__PURE__ */ new Date();
  const postedFrom = new Date(Date.now() - 1e3 * 60 * 60 * 24 * 30);
  const signals = [];
  try {
    for (const term of GOVERNMENT_SEARCH_TERMS.slice(0, 3)) {
      if (signals.length >= limit) break;
      const url = new URL("https://api.sam.gov/opportunities/v2/search");
      url.searchParams.set("api_key", apiKey);
      url.searchParams.set("limit", String(Math.min(10, limit)));
      url.searchParams.set("postedFrom", formatSamDate(postedFrom));
      url.searchParams.set("postedTo", formatSamDate(postedTo));
      url.searchParams.set("keyword", term);
      const response = await fetch(url.toString(), { headers: { "accept": "application/json", "user-agent": "MehyarSoftBot/0.1 read-only opportunity scout" } });
      if (!response.ok) throw new Error(`sam_http_${response.status}`);
      const payload = await response.json();
      const items = Array.isArray(payload.opportunitiesData) ? payload.opportunitiesData : Array.isArray(payload.data) ? payload.data : [];
      for (const item of items) {
        if (signals.length >= limit) break;
        const signal = samOpportunityToSignal(item);
        if (!signals.some((existing) => existing.source_id === signal.source_id)) signals.push(signal);
      }
    }
    for (const signal of signals) await upsertGovernmentOpportunity(env, signal.raw_metadata || {});
    await updateSourceIngestState(env, "sam_gov", "ok", { count: signals.length, api_key_present: true, no_proposal_submission: true });
    return { provider: "sam_gov", status: "ok", count: signals.length, signals, api_key_present: true };
  } catch (error) {
    const errorCode = error instanceof Error ? error.message.slice(0, 120) : "sam_fetch_failed";
    await updateSourceIngestState(env, "sam_gov", "error", { count: signals.length, error: errorCode, api_key_present: true });
    return { provider: "sam_gov", status: "error", count: signals.length, signals, error: errorCode, api_key_present: true };
  }
}
__name(fetchSamGovSignals, "fetchSamGovSignals");
async function fetchUsaSpendingSignals(env, limit = 5) {
  try {
    const payload = { filters: { time_period: [{ start_date: new Date(Date.now() - 1e3 * 60 * 60 * 24 * 365).toISOString().slice(0, 10), end_date: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10) }], keywords: ["software", "automation", "cloud"], award_type_codes: ["A", "B", "C", "D"] }, fields: ["Award ID", "Recipient Name", "Awarding Agency", "Award Amount", "Start Date", "End Date", "Description"], page: 1, limit: Math.min(10, limit), sort: "Award Amount", order: "desc" };
    const response = await fetch("https://api.usaspending.gov/api/v2/search/spending_by_award/", { method: "POST", headers: { "content-type": "application/json", "accept": "application/json", "user-agent": "MehyarSoftBot/0.1 read-only opportunity scout" }, body: JSON.stringify(payload) });
    if (!response.ok) throw new Error(`usaspending_http_${response.status}`);
    const data = await response.json();
    const rows = Array.isArray(data.results) ? data.results : [];
    const signals = rows.map((row) => {
      const awardId = text(row["Award ID"] ?? row.award_id, id("usa_award"));
      const agency = text(row["Awarding Agency"] ?? row.awarding_agency, "Federal agency");
      const recipient = text(row["Recipient Name"] ?? row.recipient_name, "recipient");
      const amount = integer(row["Award Amount"] ?? row.award_amount, 0);
      return { source: "usaspending", source_id: awardId, title: `USAspending pattern: ${agency} -> ${recipient}`, url: "https://www.usaspending.gov/search", summary: `Historical award intelligence for similar services. Amount cents approx: ${amount * 100}. Use for positioning only; no external action.`, category: "government_spending_intelligence", observed_at: now(), raw_metadata: { source_type: "usaspending", notice_id: `usaspending-${awardId}`, title: `Historical award: ${agency} -> ${recipient}`, agency, description: text(row.Description ?? row.description, "USAspending historical award pattern"), score: 55, status: "intelligence", raw_metadata: { api: "usaspending", award_id: awardId, no_proposal_submission: true } } };
    });
    for (const signal of signals) await upsertGovernmentOpportunity(env, signal.raw_metadata || {});
    await updateSourceIngestState(env, "usaspending", "ok", { count: signals.length, no_api_key_required: true });
    return { provider: "usaspending", status: "ok", count: signals.length, signals };
  } catch (error) {
    const errorCode = error instanceof Error ? error.message.slice(0, 120) : "usaspending_fetch_failed";
    await updateSourceIngestState(env, "usaspending", "error", { count: 0, error: errorCode });
    return { provider: "usaspending", status: "error", count: 0, signals: [], error: errorCode };
  }
}
__name(fetchUsaSpendingSignals, "fetchUsaSpendingSignals");
async function fetchGovernmentSignals(env, requested, limit = 12) {
  const signals = [];
  const providerStatus = [];
  if (requested.includes("sam_gov")) {
    const result = await fetchSamGovSignals(env, limit);
    signals.push(...result.signals);
    providerStatus.push({ provider: result.provider, status: result.status, count: result.count, api_key_present: !!result.api_key_present, error: result.error });
  }
  if (requested.includes("usaspending")) {
    const result = await fetchUsaSpendingSignals(env, Math.max(1, Math.floor(limit / 2)));
    signals.push(...result.signals);
    providerStatus.push({ provider: result.provider, status: result.status, count: result.count, error: result.error });
  }
  return { signals, providerStatus };
}
__name(fetchGovernmentSignals, "fetchGovernmentSignals");
async function fetchOpportunitySignals(env, settings) {
  const requested = parseJsonValue(settings.trend_sources_json, ["sam_gov", "usaspending", "fallback_rss", "fallback_seed"]);
  const signals = [];
  const providerStatus = [];
  const government = await fetchGovernmentSignals(env, requested, 12);
  signals.push(...government.signals);
  providerStatus.push(...government.providerStatus);
  if (requested.includes("fallback_rss")) {
    const rss = await fetchFallbackRssSignals(env);
    signals.push(...rss);
    providerStatus.push({ provider: "fallback_rss", status: "ok", count: rss.length });
  }
  if (requested.includes("fallback_seed") || signals.length < settings.min_daily_ideas) {
    signals.push(...OPPORTUNITY_SEED_SIGNALS.map((signal) => ({ ...signal, observed_at: now() })));
    providerStatus.push({ provider: "fallback_seed", status: "ok", count: OPPORTUNITY_SEED_SIGNALS.length });
  }
  return { signals, source_summary: { providers: providerStatus, configured: requested } };
}
__name(fetchOpportunitySignals, "fetchOpportunitySignals");
function suggestedOpportunityPriceCents(category, sourceMix) {
  const normalized = category.toLowerCase();
  if (normalized.includes("government")) return 25e4;
  if (normalized.includes("devops") || normalized.includes("cloud") || normalized.includes("infra")) return 15e4;
  if (normalized.includes("automation") || normalized.includes("ai") || normalized.includes("software")) return 99e3;
  if (normalized.includes("website") || normalized.includes("landing")) return 75e3;
  if (normalized.includes("book") || normalized.includes("pdf") || normalized.includes("template") || normalized.includes("brochure")) return 2900;
  return sourceMix.includes("sam_gov") ? 15e4 : 33e3;
}
__name(suggestedOpportunityPriceCents, "suggestedOpportunityPriceCents");
function confidenceWeight(confidence) {
  const normalized = confidence.toLowerCase();
  if (normalized === "high") return 1;
  if (normalized === "medium") return 0.7;
  return 0.45;
}
__name(confidenceWeight, "confidenceWeight");
function priorityTier(score) {
  if (score >= 85) return "urgent";
  if (score >= 72) return "high";
  if (score >= 55) return "medium";
  return "low";
}
__name(priorityTier, "priorityTier");
function cleanList(value, fallback = []) {
  if (!Array.isArray(value)) return fallback;
  return value.map((v) => text(v)).filter(Boolean).slice(0, 12);
}
__name(cleanList, "cleanList");
function requiredOfferArray(value, min = 1) {
  const list = cleanList(value);
  return list.length >= min ? list : null;
}
__name(requiredOfferArray, "requiredOfferArray");
function evidenceLooksReal(item) {
  const source = text(item.source);
  const sourceId = text(item.source_id ?? item.sourceId);
  const title = text(item.title);
  if (!source || !sourceId || !title) return false;
  if (["llm", "ai", "made_up", "invented"].includes(source.toLowerCase())) return false;
  return true;
}
__name(evidenceLooksReal, "evidenceLooksReal");
function buildPriceLadder(basePriceCents) {
  return [
    { tier: "starter", label: "Paid diagnostic / downloadable starter", price_cents: Math.max(2900, Math.round(basePriceCents * 0.22)), goal: "first cash and validation" },
    { tier: "core", label: "Done-for-you implementation", price_cents: basePriceCents, goal: "main offer delivery" },
    { tier: "retainer", label: "Monthly support / optimization", price_cents: Math.max(5e4, Math.round(basePriceCents * 0.35)), recurring: "monthly", goal: "profit and retention" }
  ];
}
__name(buildPriceLadder, "buildPriceLadder");
function landingPageDraftFor(signal, title, offer, targetBuyer, exactPain, priceCents, complianceWarnings) {
  return {
    hero: `${offer} for ${targetBuyer}`,
    subhero: `Turn the verified signal "${signal.title}" into a practical MehyarSoft package without spend, spam, or public claims before review.`,
    offer_bullets: [
      `Diagnose the pain: ${exactPain}`,
      "Ship a private MVP/demo or digital asset pack first",
      "Document compliance gates, proof needed, and next money action",
      "Owner approval required before publishing, outreach, billing, or external commitments"
    ],
    proof_needed: ["Source link/signal retained", "Buyer quote or manual validation note", "Before/after screenshot or checklist", "Compliance review note before public use"],
    cta: "Request the private diagnostic",
    pricing: { starting_price_cents: priceCents, display: `$${(priceCents / 100).toFixed(0)} starter diagnostic; implementation quoted after review` },
    faq: [
      { question: "Is this live or public?", answer: "No. It is an internal draft until Boss approves publishing or outreach." },
      { question: "Can this use old audiences?", answer: "No. Legacy audiences require separate compliance approval and are not eligible here." },
      { question: "What happens first?", answer: "Build a private proof asset, then validate with consent-safe channels." }
    ],
    compliance_warnings: complianceWarnings,
    asset_list: ["landing page copy", "one-page PDF/checklist", "implementation SOP", "pricing sheet", "private proof screenshots"]
  };
}
__name(landingPageDraftFor, "landingPageDraftFor");
function digitalAssetPlanFor(category, title) {
  const normalized = category.toLowerCase();
  const core = [
    { type: "pdf", name: `${title} one-page offer brief`, purpose: "lead magnet and sales collateral" },
    { type: "template", name: `${title} intake/audit worksheet`, purpose: "paid diagnostic deliverable" },
    { type: "sop", name: `${title} implementation checklist`, purpose: "repeatable delivery" }
  ];
  if (/book|pdf|template|content|newsletter/.test(normalized)) core.push({ type: "text_pack", name: `${title} copy/content pack`, purpose: "sellable digital download" });
  if (/website|landing|design|art|image/.test(normalized)) core.push({ type: "images", name: `${title} visual asset set`, purpose: "landing/demo proof assets" });
  return { assets: core, rights_note: "Generate original assets or use permissioned sources only; do not reuse third-party article images/full text without permission.", storage: "private draft until owner approval" };
}
__name(digitalAssetPlanFor, "digitalAssetPlanFor");
function kanbanTaskBlueprint(title, targetBuyer) {
  return [
    { title: `Validate demand: ${title}`, assignee_role: "productops", priority: "high", due_offset_days: 1, acceptance_criteria: ["Evidence reviewed", "Buyer/pain validated", "Go/wait/hold/reject recommendation recorded"] },
    { title: `Draft assets: ${title}`, assignee_role: "webdev", priority: "medium", due_offset_days: 2, acceptance_criteria: ["Landing copy drafted", "PDF/template asset outline created", "No public publish performed"] },
    { title: `Compliance gate: ${title}`, assignee_role: "complyops", priority: "high", due_offset_days: 2, acceptance_criteria: ["Claims/proof reviewed", "No-send/no-spend gates confirmed", `${targetBuyer} outreach route approved or blocked`] }
  ];
}
__name(kanbanTaskBlueprint, "kanbanTaskBlueprint");
function statusRecommendation(score, priorityScore, confidence, costCents, maxBudgetCents) {
  if (costCents > maxBudgetCents) return { status_recommendation: "reject", status_reason: "Budget exceeds configured Opportunity Scout cap." };
  if (score >= 75 && priorityScore >= 70 && confidence !== "low") return { status_recommendation: "execute_now", status_reason: "Strong evidence, good capability fit, low budget, and fast path to first cash." };
  if (score >= 60) return { status_recommendation: "wait", status_reason: "Promising but needs one more proof point or buyer validation before execution." };
  return { status_recommendation: "hold", status_reason: "Low confidence or weak fit; preserve as watchlist only." };
}
__name(statusRecommendation, "statusRecommendation");
function parseStrictJsonObject(value) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
__name(parseStrictJsonObject, "parseStrictJsonObject");
function buildOpportunityOfferPrompt(signal, settings) {
  return `You are Opportunity Scout for MehyarSoft. Return ONLY strict JSON matching the opportunity_digital_offer_v2 schema. Never invent evidence; use only the supplied signal in evidence. Budget must be <= ${settings.max_budget_cents} cents. Required keys: title, category, summary, target_buyer, exact_pain, offer, deliverables, budget_cents, tools, time_to_mvp_days, suggested_price_cents, price_ladder, revenue_potential_cents, profit_potential_cents, break_even_units, expected_first_cash_path, landing_page, digital_asset_plan, kanban_tasks, status_recommendation, status_reason, confidence, source_confidence, evidence, compliance_flags, risk_flags. Signal: ${JSON.stringify({ source: signal.source, source_id: signal.source_id, title: signal.title, url: signal.url || null, summary: signal.summary, category: signal.category, observed_at: signal.observed_at })}`;
}
__name(buildOpportunityOfferPrompt, "buildOpportunityOfferPrompt");
async function draftFromAiSignal(env, signal, settings) {
  if (!env.AI) return null;
  const response = await runAI(env, buildOpportunityOfferPrompt(signal, settings), { signal });
  const parsed = parseStrictJsonObject(response);
  return validateScoutDraft(parsed, settings);
}
__name(draftFromAiSignal, "draftFromAiSignal");
function dailyKpisFor(firstCashHours, revenueDays, leadCountTarget) {
  const days = Math.max(1, Math.min(14, integer(revenueDays, 7)));
  return [
    { day: 1, metric: "validated_offer_brief", target: 1, owner: "productops", external_action_allowed: false },
    { day: 1, metric: "private_proof_asset", target: 1, owner: "webdev", external_action_allowed: false },
    { day: 2, metric: "qualified_leads_identified", target: Math.max(3, Math.ceil(leadCountTarget * 0.25)), owner: "leadfs", external_action_allowed: false },
    { day: days, metric: "first_cash_path_reviewed", target: 1, owner: "arman", first_action_hours: Math.max(1, firstCashHours), external_action_allowed: false }
  ];
}
__name(dailyKpisFor, "dailyKpisFor");
function ownerApprovalGatesFor(startupCostCents) {
  return [
    { key: "spend", required_before: "any spend, domain, ad, paid tool, or paid data source", approved: false, threshold_cents: startupCostCents },
    { key: "publish", required_before: "public page, post, claim, downloadable asset, or case study", approved: false },
    { key: "outreach", required_before: "email, SMS, DM, call script execution, campaign, or legacy audience use", approved: false },
    { key: "billing", required_before: "invoice, Stripe checkout, proposal submission, or charge", approved: false },
    { key: "compliance", required_before: "any customer-facing claim or audience activation", approved: false }
  ];
}
__name(ownerApprovalGatesFor, "ownerApprovalGatesFor");
function executionKanbanBlueprint(title, priorityTierValue, dailyKpis, ownerGates) {
  return [
    { title: `ROI gate + evidence review: ${title}`, assignee_role: "productops", priority: priorityTierValue, due_offset_days: 0, acceptance_criteria: ["Revenue math reviewed", "ROI filters pass/fail recorded", "No external action performed"] },
    { title: `Build private proof asset: ${title}`, assignee_role: "webdev", priority: "high", due_offset_days: 1, acceptance_criteria: ["Private landing/demo/PDF draft exists", "Daily KPIs embedded", "No publish action performed"] },
    { title: `Compliance + owner approval gates: ${title}`, assignee_role: "complyops", priority: "high", due_offset_days: 1, acceptance_criteria: ["Owner approval gates reviewed", "Suppression/legacy-audience guardrail documented", "External action remains blocked"] },
    { title: `Lead target plan: ${title}`, assignee_role: "leadfs", priority: "medium", due_offset_days: 2, acceptance_criteria: ["Consent-safe lead-count target drafted", "No outbound sending performed", "First-cash route prepared for owner review"], daily_kpis: dailyKpis, owner_approval_gates: ownerGates }
  ];
}
__name(executionKanbanBlueprint, "executionKanbanBlueprint");
function agentFollowUpCardsFor(title, priorityTierValue) {
  return [
    { title: `Agent follow-up: ROI validation for ${title}`, assignee: "arman", status: "draft", blocked_until_owner_approval: true, external_action_allowed: false },
    { title: `Agent follow-up: proof asset QA for ${title}`, assignee: "productops", status: "draft", blocked_until_owner_approval: true, external_action_allowed: false },
    { title: `Agent follow-up: compliance review for ${title}`, assignee: "complyops", status: "draft", blocked_until_owner_approval: true, external_action_allowed: false, priority: priorityTierValue }
  ];
}
__name(agentFollowUpCardsFor, "agentFollowUpCardsFor");
function calculateOpportunityMoney(draft) {
  const suggestedPrice = suggestedOpportunityPriceCents(draft.category, draft.source_mix || []);
  const confidence = confidenceWeight(draft.confidence);
  const sourceMultiplier = (draft.source_mix || []).includes("sam_gov") ? 1.5 : (draft.source_mix || []).includes("usaspending") ? 1.25 : 1;
  const expectedUnits = Math.max(1, Math.round(confidence * sourceMultiplier * (suggestedPrice >= 1e5 ? 1 : 3)));
  const expectedGrossRevenue = suggestedPrice * expectedUnits;
  const startupCost = Math.max(0, integer(draft.estimated_cost_cents, 0));
  const laborHours = Math.max(1, Math.round(integer(draft.expected_time_to_first_action_hours, 2) / 2 + integer(draft.expected_time_to_revenue_days, 7) * 1.5));
  const grossMargin = Math.max(0, suggestedPrice - startupCost);
  const expectedProfit = Math.max(0, expectedGrossRevenue - startupCost);
  const probabilityWeightedValue = Math.round(expectedProfit * confidence);
  const breakEvenUnits = startupCost === 0 ? 1 : Math.max(1, Math.ceil(startupCost / Math.max(1, suggestedPrice)));
  const leadCountTarget = Math.max(3, Math.ceil(expectedUnits * 10 / Math.max(0.2, confidence)));
  const speedFit = Math.max(0, 100 - Math.min(100, integer(draft.expected_time_to_revenue_days, 14) * 6));
  const revenueFit = Math.min(100, Math.round(expectedGrossRevenue / 25e3));
  const profitFit = Math.min(100, Math.round(expectedProfit / 25e3));
  const roiFit = startupCost === 0 ? 100 : Math.min(100, Math.round(expectedProfit / Math.max(1, startupCost) * 10));
  const priorityScore = Math.max(0, Math.min(100, Math.round(integer(draft.score, 0) * 0.35 + revenueFit * 0.18 + speedFit * 0.12 + profitFit * 0.12 + roiFit * 0.18 + confidence * 100 * 0.05)));
  const tier = priorityTier(priorityScore);
  const title = text(draft.title, "Opportunity");
  const dailyKpis = dailyKpisFor(integer(draft.expected_time_to_first_action_hours, 2), integer(draft.expected_time_to_revenue_days, 7), leadCountTarget);
  const ownerGates = ownerApprovalGatesFor(startupCost);
  return {
    suggested_price_cents: suggestedPrice,
    revenue_potential_cents: expectedGrossRevenue,
    profit_potential_cents: expectedProfit,
    gross_margin_cents: grossMargin,
    break_even_units: breakEvenUnits,
    startup_cost_cents: startupCost,
    labor_hours: laborHours,
    expected_gross_revenue_cents: expectedGrossRevenue,
    expected_profit_cents: expectedProfit,
    probability_weighted_value_cents: probabilityWeightedValue,
    lead_count_target: leadCountTarget,
    priority_score: priorityScore,
    priority_tier: tier,
    daily_kpis: dailyKpis,
    owner_approval_gates: ownerGates,
    kanban_blueprint: executionKanbanBlueprint(title, tier, dailyKpis, ownerGates),
    agent_follow_up_cards: agentFollowUpCardsFor(title, tier),
    revenue_assumptions: {
      model: "first_30_day_probability_weighted_execution_loop",
      suggested_price_cents: suggestedPrice,
      expected_units: expectedUnits,
      expected_gross_revenue_cents: expectedGrossRevenue,
      expected_profit_cents: expectedProfit,
      probability_weighted_value_cents: probabilityWeightedValue,
      startup_cost_cents: startupCost,
      labor_hours: laborHours,
      lead_count_target: leadCountTarget,
      confidence_weight: confidence,
      source_multiplier: sourceMultiplier,
      roi_filters: { min_roi_score_default: 60, min_probability_weighted_value_cents_default: 25e3, min_expected_profit_cents_default: 1e4 },
      no_external_action_allowed: true,
      owner_approval_required_before_billing_or_publishing: true
    }
  };
}
__name(calculateOpportunityMoney, "calculateOpportunityMoney");
function validateScoutDraft(value, settings) {
  if (!value || typeof value !== "object") return null;
  const draft = value;
  const evidence = Array.isArray(draft.evidence) ? draft.evidence.filter((item) => item && typeof item === "object" && !Array.isArray(item) && evidenceLooksReal(item)) : [];
  if (!evidence.length) return null;
  const title = text(draft.title);
  const summary = text(draft.summary);
  const targetBuyer = text(draft.target_buyer ?? draft.target_customer);
  const exactPain = text(draft.exact_pain);
  const offer = text(draft.offer);
  if (!title || !summary || !targetBuyer || !exactPain || !offer) return null;
  const deliverables = requiredOfferArray(draft.deliverables, 1);
  const tools = requiredOfferArray(draft.tools, 1);
  if (!deliverables || !tools) return null;
  const estimated = Math.max(0, integer(draft.budget_cents ?? draft.estimated_cost_cents, 0));
  if (settings && estimated > settings.max_budget_cents) return null;
  const score = Math.max(0, Math.min(100, integer(draft.score, 70)));
  const category = text(draft.category, "service_offer");
  const confidence = text(draft.confidence, "medium");
  const sourceConfidence = text(draft.source_confidence, confidence);
  const sourceMix = Array.isArray(draft.source_mix) && draft.source_mix.length ? draft.source_mix.map((v) => text(v)).filter(Boolean) : [...new Set(evidence.map((item) => text(item.source)).filter(Boolean))];
  const base = {
    title,
    category,
    summary,
    target_customer: targetBuyer,
    target_buyer: targetBuyer,
    exact_pain: exactPain,
    offer,
    deliverables,
    budget_cents: estimated,
    tools,
    time_to_mvp_days: Math.max(1, integer(draft.time_to_mvp_days, 3)),
    monetization_path: text(draft.monetization_path, "$330 diagnostic -> implementation sprint -> retainer"),
    estimated_cost_cents: estimated,
    expected_time_to_first_action_hours: Math.max(1, integer(draft.expected_time_to_first_action_hours, 2)),
    expected_time_to_revenue_days: Math.max(1, integer(draft.expected_time_to_revenue_days, 7)),
    score,
    confidence,
    source_confidence: sourceConfidence,
    score_breakdown: draft.score_breakdown && typeof draft.score_breakdown === "object" ? draft.score_breakdown : {},
    compliance_flags: cleanList(draft.compliance_flags, ["private_analysis_only", "requires_owner_approval", "no_external_action_allowed"]),
    risk_flags: cleanList(draft.risk_flags, ["no_spend", "no_publication", "no_outbound_sending", "legacy_audience_not_eligible_for_use"]),
    evidence,
    source_mix: sourceMix,
    plan: draft.plan && typeof draft.plan === "object" ? draft.plan : {}
  };
  const money = calculateOpportunityMoney(base);
  const priceLadder = Array.isArray(draft.price_ladder) && draft.price_ladder.length ? draft.price_ladder : buildPriceLadder(integer(draft.suggested_price_cents, money.suggested_price_cents));
  const status = statusRecommendation(base.score, money.priority_score, confidence, estimated, settings?.max_budget_cents ?? 5e3);
  const complianceWarnings = cleanList(draft.compliance_warnings, ["No public claims without proof review", "No spend/publish/send/charge without owner approval", "Do not use legacy audiences from this workflow"]);
  return {
    ...base,
    ...money,
    suggested_price_cents: integer(draft.suggested_price_cents, money.suggested_price_cents),
    revenue_potential_cents: integer(draft.revenue_potential_cents, money.revenue_potential_cents),
    profit_potential_cents: integer(draft.profit_potential_cents, money.profit_potential_cents),
    break_even_units: integer(draft.break_even_units, money.break_even_units),
    price_ladder: priceLadder,
    expected_first_cash_path: text(draft.expected_first_cash_path, base.monetization_path),
    landing_page: draft.landing_page && typeof draft.landing_page === "object" ? draft.landing_page : landingPageDraftFor({ source: evidence[0].source, source_id: evidence[0].source_id, title: evidence[0].title, summary, category, observed_at: text(evidence[0].observed_at, now()), url: text(evidence[0].url) }, title, offer, targetBuyer, exactPain, integer(draft.suggested_price_cents, money.suggested_price_cents), complianceWarnings),
    digital_asset_plan: draft.digital_asset_plan && typeof draft.digital_asset_plan === "object" ? draft.digital_asset_plan : digitalAssetPlanFor(category, title),
    kanban_tasks: Array.isArray(draft.kanban_tasks) && draft.kanban_tasks.length ? draft.kanban_tasks : kanbanTaskBlueprint(title, targetBuyer),
    compliance_warnings: complianceWarnings,
    status_recommendation: text(draft.status_recommendation, status.status_recommendation),
    status_reason: text(draft.status_reason, status.status_reason),
    plan: base.plan
  };
}
__name(validateScoutDraft, "validateScoutDraft");
function draftFromSignal(signal, settings) {
  const cost = Math.min(settings.max_budget_cents, integer(signal.raw_metadata?.cost_cents, 0));
  const riskFlags = ["no_spend", "no_publication", "no_outbound_sending", "legacy_audience_not_eligible_for_use"];
  const title = signal.title.length > 84 ? `${signal.title.slice(0, 81)}...` : signal.title;
  const category = signal.category || "service_offer";
  const scoreBreakdown = { cost_fit: 20, speed_to_revenue: 18, capability_fit: 20, trend_strength: signal.source === "sam_gov" ? 22 : signal.source === "usaspending" ? 18 : signal.source === "fallback_rss" ? 15 : 10, compliance_safety: 15 };
  const score = Object.values(scoreBreakdown).reduce((sum, val) => sum + val, 0);
  const steps = [
    "Write a one-page offer brief with target customer, pain, promise, and safety boundaries.",
    "Create a private landing/demo outline using existing MehyarSoft infrastructure only.",
    "Validate with owner-reviewed, consent-safe channels; do not send email/SMS or publish without approval.",
    "Prepare implementation checklist and pricing ladder for Boss review."
  ];
  const confidence = signal.source === "sam_gov" ? "high" : signal.source === "usaspending" || signal.source === "fallback_rss" ? "medium" : "low";
  const sourceMix = [signal.source];
  const money = calculateOpportunityMoney({ title, category, estimated_cost_cents: cost, expected_time_to_first_action_hours: 2, expected_time_to_revenue_days: 7, score, confidence, source_mix: sourceMix });
  const targetBuyer = category.includes("local") ? "Local service business owners with missed leads or manual operations" : category.includes("government") ? "Small contractors and consultants pursuing agency-adjacent software/compliance work" : "Owner-led SMBs that need fast, compliant systems help";
  const exactPain = category.includes("government") ? "They see demand in public procurement data but lack a packaged, compliant, low-risk offer and proof assets." : "They are losing revenue to manual follow-up, unclear offers, weak landing pages, or disconnected systems.";
  const offer = category.includes("government") ? "Government-demand offer readiness sprint" : category.includes("pdf") || category.includes("template") ? "Digital checklist/template lead-magnet package" : "MehyarSoft fast revenue systems sprint";
  const deliverables = ["one-page offer brief", "private landing-page draft", "PDF/template starter asset", "implementation checklist", "compliance gate checklist"];
  const tools = ["Cloudflare Workers/Pages", "D1/KV/R2 as needed", "MehyarSoft admin dashboard", "manual owner review"];
  const priceLadder = buildPriceLadder(money.suggested_price_cents);
  const landingPage = landingPageDraftFor(signal, `${title} package`, offer, targetBuyer, exactPain, money.suggested_price_cents, ["No public claims without proof review", "No spend/publish/send/charge without owner approval", "Do not use legacy audiences from this workflow"]);
  const digitalAssetPlan = digitalAssetPlanFor(category, `${title} package`);
  const kanbanTasks = kanbanTaskBlueprint(`${title} package`, targetBuyer);
  const rec = statusRecommendation(score, money.priority_score, confidence, cost, settings.max_budget_cents);
  const plan = {
    objective: `Validate and package: ${title}`,
    steps,
    target_buyer: targetBuyer,
    exact_pain: exactPain,
    offer,
    deliverables,
    tools,
    time_to_mvp_days: 3,
    price_ladder: priceLadder,
    expected_first_cash_path: "$330 starter diagnostic or digital asset pre-sell -> implementation sprint -> support retainer",
    landing_page: landingPage,
    digital_asset_plan: digitalAssetPlan,
    kanban_tasks: kanbanTasks,
    status_recommendation: rec.status_recommendation,
    status_reason: rec.status_reason,
    kanban_title: `Opportunity Scout: validate ${title}`,
    kanban_body: `Owner-approved Opportunity Scout execution plan.

Buyer: ${targetBuyer}
Pain: ${exactPain}
Offer: ${offer}

Summary: ${signal.summary}

Money: suggested price $${(money.suggested_price_cents / 100).toFixed(0)}, 30-day revenue potential $${(money.revenue_potential_cents / 100).toFixed(0)}, profit potential $${(money.profit_potential_cents / 100).toFixed(0)}, breakeven ${money.break_even_units} unit(s), priority ${money.priority_score}/100 (${money.priority_tier}).

Safety: no spend, no domains, no ads, no publishing, no email/SMS/public posting without explicit human approval. Legacy audiences are compliance-sensitive and not eligible for sending.`,
    recommended_assignee: "productops",
    recommended_assignee_reason: "Product ops should validate demand, offer shape, and compliance gates before engineering.",
    acceptance_criteria: ["Verified evidence remains attached", "Offer brief and landing draft created", "Budget remains $0-$50", "Compliance/no-outbound gates documented", "Boss can decide execute/wait/hold/reject next step"],
    required_gates: ["owner_approval", "cost_cap", "no_external_action", "legacy_audience_guardrail"]
  };
  return {
    title: `${title} package`,
    category,
    summary: `Package this signal into a low-cost MehyarSoft offer: ${signal.summary}`.slice(0, 1200),
    target_customer: targetBuyer,
    target_buyer: targetBuyer,
    exact_pain: exactPain,
    offer,
    deliverables,
    budget_cents: cost,
    tools,
    time_to_mvp_days: 3,
    monetization_path: "$330 paid audit -> $1.5k-$5k implementation sprint -> monthly support retainer",
    estimated_cost_cents: cost,
    expected_time_to_first_action_hours: 2,
    expected_time_to_revenue_days: 7,
    score,
    confidence,
    source_confidence: confidence,
    ...money,
    price_ladder: priceLadder,
    expected_first_cash_path: "$330 starter diagnostic or digital asset pre-sell -> implementation sprint -> support retainer",
    landing_page: landingPage,
    digital_asset_plan: digitalAssetPlan,
    kanban_tasks: kanbanTasks,
    compliance_warnings: ["No public claims without proof review", "No spend/publish/send/charge without owner approval", "Do not use legacy audiences from this workflow"],
    status_recommendation: rec.status_recommendation,
    status_reason: rec.status_reason,
    score_breakdown: { ...scoreBreakdown, revenue_potential: money.revenue_potential_cents, priority_score: money.priority_score },
    compliance_flags: ["private_analysis_only", "requires_owner_approval", "no_external_action_allowed"],
    risk_flags: riskFlags,
    evidence: [{ source: signal.source, source_id: signal.source_id, title: signal.title, url: signal.url || null, observed_at: signal.observed_at, source_confidence: confidence, metric_name: signal.metric_name || null, metric_value: signal.metric_value ?? null, velocity: signal.velocity ?? null, note: "Trend signal only; validate before public claims." }],
    source_mix: sourceMix,
    plan
  };
}
__name(draftFromSignal, "draftFromSignal");
function dedupeFingerprint(draft) {
  return slugify(`${draft.category}-${draft.title}-${draft.target_buyer}-${draft.offer}`.replace(/\b(package|sprint|service|offer|for|the|and|a|an)\b/gi, " ")).slice(0, 120);
}
__name(dedupeFingerprint, "dedupeFingerprint");
function tokenSet(value) {
  return new Set(slugify(value).split("-").filter((part) => part.length >= 4));
}
__name(tokenSet, "tokenSet");
function tokenSimilarity(a, b) {
  const aa = tokenSet(a);
  const bb = tokenSet(b);
  if (!aa.size || !bb.size) return 0;
  let intersection = 0;
  for (const token of aa) if (bb.has(token)) intersection += 1;
  return intersection / Math.max(aa.size, bb.size);
}
__name(tokenSimilarity, "tokenSimilarity");
async function findSimilarOpportunity(env, draft) {
  const exact = await env.DB.prepare("SELECT id FROM opportunities WHERE dedupe_key = ? LIMIT 1").bind(dedupeFingerprint(draft)).first();
  if (exact) return exact.id;
  const rows = await env.DB.prepare("SELECT id, title, target_customer, metadata_json FROM opportunities WHERE category = ? ORDER BY created_at DESC LIMIT 75").bind(draft.category).all();
  const draftFingerprint = `${draft.title} ${draft.target_buyer} ${draft.offer}`;
  for (const row of rows.results || []) {
    const meta = parseJsonValue(text(row.metadata_json, "{}"), {});
    const rowFingerprint = `${text(row.title, "")} ${text(row.target_customer, "")} ${text(meta.offer, "")}`;
    if (tokenSimilarity(draftFingerprint, rowFingerprint) >= 0.72) return text(row.id);
  }
  return null;
}
__name(findSimilarOpportunity, "findSimilarOpportunity");
async function runOpportunityScout(env, triggerType, request) {
  if (!env.DB) return { ok: false, error: "db_binding_required" };
  const settings = await getOpportunitySettings(env);
  const dateLocal = localDate(settings.timezone);
  const runId = id("opp_run");
  const ts = now();
  if (triggerType === "scheduled" && !scheduledWindowDue(settings.scheduled_local_time, settings.timezone)) {
    return { ok: true, status: "skipped_time_window", scheduled_local_time: settings.scheduled_local_time, timezone: settings.timezone };
  }
  if (triggerType === "scheduled" && !settings.enabled) {
    await env.DB.prepare("INSERT INTO opportunity_runs (id, created_at, started_at, finished_at, run_date_local, timezone, trigger_type, status, settings_snapshot_json, diagnostics_json) VALUES (?, ?, ?, ?, ?, ?, ?, 'disabled', ?, ?)").bind(runId, ts, ts, ts, dateLocal, settings.timezone, triggerType, jsonString(settings), jsonString({ reason: "settings_enabled_false" })).run().catch(() => void 0);
    return { ok: true, status: "disabled", run_id: runId };
  }
  if (triggerType === "scheduled") {
    const existing = await env.DB.prepare("SELECT id FROM opportunity_runs WHERE run_date_local = ? AND trigger_type = 'scheduled' LIMIT 1").bind(dateLocal).first();
    if (existing) return { ok: true, status: "skipped_duplicate", existing_run_id: existing.id };
  }
  await env.DB.prepare("INSERT INTO opportunity_runs (id, created_at, started_at, run_date_local, timezone, trigger_type, status, settings_snapshot_json) VALUES (?, ?, ?, ?, ?, ?, 'running', ?)").bind(runId, ts, ts, dateLocal, settings.timezone, triggerType, jsonString(settings)).run();
  let created = 0, duplicates = 0, blocked = 0, signalsFetched = 0;
  try {
    const { signals, source_summary } = await fetchOpportunitySignals(env, settings);
    signalsFetched = signals.length;
    for (const signal of signals) {
      if (created >= Math.max(1, Math.min(3, settings.max_daily_ideas))) break;
      const aiDraft = await draftFromAiSignal(env, signal, settings).catch(() => null);
      const draft = aiDraft || validateScoutDraft(draftFromSignal(signal, settings), settings);
      if (!draft) {
        blocked += 1;
        continue;
      }
      if (draft.estimated_cost_cents > settings.max_budget_cents || draft.score < settings.min_score || draft.priority_score < settings.min_roi_score || draft.probability_weighted_value_cents < settings.min_probability_weighted_value_cents || draft.expected_profit_cents < settings.min_expected_profit_cents) {
        blocked += 1;
        continue;
      }
      const dedupeKey = dedupeFingerprint(draft);
      const existingId = await findSimilarOpportunity(env, draft);
      if (existingId) {
        duplicates += 1;
        continue;
      }
      const oppId = id("opp");
      const planId = id("opp_plan");
      await env.DB.prepare(`INSERT INTO opportunities (id, run_id, created_at, updated_at, title, slug, dedupe_key, status, category, source_mix_json, evidence_json, summary, target_customer, monetization_path, estimated_cost_cents, startup_cost_cents, labor_hours, expected_time_to_first_action_hours, expected_time_to_revenue_days, score, confidence, suggested_price_cents, revenue_potential_cents, profit_potential_cents, gross_margin_cents, break_even_units, priority_score, priority_tier, revenue_assumptions_json, expected_gross_revenue_cents, expected_profit_cents, probability_weighted_value_cents, lead_count_target, daily_kpis_json, owner_approval_gates_json, kanban_blueprint_json, agent_follow_up_cards_json, score_breakdown_json, compliance_flags_json, risk_flags_json, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(oppId, runId, now(), now(), draft.title, slugify(draft.title), dedupeKey, draft.category, jsonString(draft.source_mix), jsonString(draft.evidence), draft.summary, draft.target_customer, draft.monetization_path, draft.estimated_cost_cents, draft.startup_cost_cents, draft.labor_hours, draft.expected_time_to_first_action_hours, draft.expected_time_to_revenue_days, draft.score, draft.confidence, draft.suggested_price_cents, draft.revenue_potential_cents, draft.profit_potential_cents, draft.gross_margin_cents, draft.break_even_units, draft.priority_score, draft.priority_tier, jsonString(draft.revenue_assumptions), draft.expected_gross_revenue_cents, draft.expected_profit_cents, draft.probability_weighted_value_cents, draft.lead_count_target, jsonString(draft.daily_kpis), jsonString(draft.owner_approval_gates), jsonString(draft.kanban_blueprint), jsonString(draft.agent_follow_up_cards), jsonString(draft.score_breakdown), jsonString(draft.compliance_flags), jsonString(draft.risk_flags), jsonString({ trigger_type: triggerType, source_id: signal.source_id, source_type: signal.source, target_buyer: draft.target_buyer, exact_pain: draft.exact_pain, offer: draft.offer, deliverables: draft.deliverables, budget_cents: draft.budget_cents, tools: draft.tools, time_to_mvp_days: draft.time_to_mvp_days, price_ladder: draft.price_ladder, expected_first_cash_path: draft.expected_first_cash_path, lead_count_target: draft.lead_count_target, daily_kpis: draft.daily_kpis, owner_approval_gates: draft.owner_approval_gates, kanban_blueprint: draft.kanban_blueprint, agent_follow_up_cards: draft.agent_follow_up_cards, landing_page: draft.landing_page, digital_asset_plan: draft.digital_asset_plan, kanban_tasks: draft.kanban_tasks, status_recommendation: draft.status_recommendation, status_reason: draft.status_reason, source_confidence: draft.source_confidence })).run();
      await env.DB.prepare(`INSERT INTO opportunity_plans (id, opportunity_id, created_at, updated_at, objective, plan_json, kanban_title, kanban_body, recommended_assignee, recommended_assignee_reason, acceptance_criteria_json, required_gates_json, estimated_cost_cents, revenue_snapshot_json, execution_economics_json, daily_kpis_json, owner_approval_gates_json, kanban_blueprint_json, agent_follow_up_cards_json, priority_score, priority_tier, external_action_allowed, requires_owner_approval, requires_compliance_review, ai_output_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, 0, ?)`).bind(planId, oppId, now(), now(), text(draft.plan.objective, draft.title), jsonString({ ...draft.plan, money: draft.revenue_assumptions, execution_economics: { startup_cost_cents: draft.startup_cost_cents, labor_hours: draft.labor_hours, expected_gross_revenue_cents: draft.expected_gross_revenue_cents, expected_profit_cents: draft.expected_profit_cents, probability_weighted_value_cents: draft.probability_weighted_value_cents, lead_count_target: draft.lead_count_target } }), text(draft.plan.kanban_title, draft.title), text(draft.plan.kanban_body, draft.summary), text(draft.plan.recommended_assignee, "productops"), text(draft.plan.recommended_assignee_reason), jsonString(draft.plan.acceptance_criteria || []), jsonString(draft.plan.required_gates || []), draft.estimated_cost_cents, jsonString({ suggested_price_cents: draft.suggested_price_cents, revenue_potential_cents: draft.revenue_potential_cents, profit_potential_cents: draft.profit_potential_cents, gross_margin_cents: draft.gross_margin_cents, break_even_units: draft.break_even_units, expected_gross_revenue_cents: draft.expected_gross_revenue_cents, expected_profit_cents: draft.expected_profit_cents, probability_weighted_value_cents: draft.probability_weighted_value_cents, assumptions: draft.revenue_assumptions }), jsonString({ startup_cost_cents: draft.startup_cost_cents, labor_hours: draft.labor_hours, expected_first_cash_path: draft.expected_first_cash_path, lead_count_target: draft.lead_count_target, roi_filters_passed: true }), jsonString(draft.daily_kpis), jsonString(draft.owner_approval_gates), jsonString(draft.kanban_blueprint), jsonString(draft.agent_follow_up_cards), draft.priority_score, draft.priority_tier, jsonString({ provider: aiDraft ? "workers_ai_validated" : "fallback_validated", schema: "opportunity_digital_offer_v2", target_buyer: draft.target_buyer, exact_pain: draft.exact_pain, offer: draft.offer, landing_page: draft.landing_page, digital_asset_plan: draft.digital_asset_plan, kanban_tasks: draft.kanban_tasks, kanban_blueprint: draft.kanban_blueprint, agent_follow_up_cards: draft.agent_follow_up_cards, status_recommendation: draft.status_recommendation, status_reason: draft.status_reason })).run();
      await auditOpportunity(env, "opportunity_created", { opportunity_id: oppId, score: draft.score, priority_score: draft.priority_score, priority_tier: draft.priority_tier, revenue_potential_cents: draft.revenue_potential_cents, profit_potential_cents: draft.profit_potential_cents, cost_cents: draft.estimated_cost_cents, startup_cost_cents: draft.startup_cost_cents, expected_profit_cents: draft.expected_profit_cents, probability_weighted_value_cents: draft.probability_weighted_value_cents, lead_count_target: draft.lead_count_target, status_recommendation: draft.status_recommendation, source_confidence: draft.source_confidence }, runId, oppId, planId, request);
      created += 1;
    }
    const status = created > 0 ? "success" : "partial";
    await env.DB.prepare("UPDATE opportunity_runs SET finished_at = ?, status = ?, source_summary_json = ?, signals_fetched = ?, opportunities_created = ?, duplicates_skipped = ?, blocked_count = ?, diagnostics_json = ? WHERE id = ?").bind(now(), status, jsonString(source_summary), signalsFetched, created, duplicates, blocked, jsonString({ budget_cap_cents: settings.max_budget_cents, min_roi_score: settings.min_roi_score, min_probability_weighted_value_cents: settings.min_probability_weighted_value_cents, min_expected_profit_cents: settings.min_expected_profit_cents, safety: "no_external_action" }), runId).run();
    return { ok: true, contract: OPPORTUNITY_CONTRACT, run_id: runId, status, signals_fetched: signalsFetched, opportunities_created: created, duplicates_skipped: duplicates, blocked_count: blocked };
  } catch (error) {
    await env.DB.prepare("UPDATE opportunity_runs SET finished_at = ?, status = 'failed', error_code = ?, error_message = ? WHERE id = ?").bind(now(), "run_failed", error instanceof Error ? error.message.slice(0, 500) : "unknown", runId).run();
    return { ok: false, contract: OPPORTUNITY_CONTRACT, run_id: runId, error: "run_failed" };
  }
}
__name(runOpportunityScout, "runOpportunityScout");
async function listOpportunityRows(env, dateLocal) {
  if (!env.DB) return [];
  const rows = dateLocal ? await env.DB.prepare(`SELECT o.*, p.id AS plan_id, p.objective, p.plan_json, p.kanban_title, p.kanban_body, p.recommended_assignee, p.acceptance_criteria_json, p.required_gates_json, p.revenue_snapshot_json AS plan_revenue_snapshot_json, p.execution_economics_json AS plan_execution_economics_json, p.daily_kpis_json AS plan_daily_kpis_json, p.owner_approval_gates_json AS plan_owner_approval_gates_json, p.kanban_blueprint_json AS plan_kanban_blueprint_json, p.agent_follow_up_cards_json AS plan_agent_follow_up_cards_json, p.priority_score AS plan_priority_score, p.priority_tier AS plan_priority_tier FROM opportunities o LEFT JOIN opportunity_plans p ON p.opportunity_id = o.id WHERE o.run_id IN (SELECT id FROM opportunity_runs WHERE run_date_local = ?) ORDER BY o.priority_score DESC, o.revenue_potential_cents DESC, o.score DESC, o.created_at DESC`).bind(dateLocal).all() : await env.DB.prepare(`SELECT o.*, p.id AS plan_id, p.objective, p.plan_json, p.kanban_title, p.kanban_body, p.recommended_assignee, p.acceptance_criteria_json, p.required_gates_json, p.revenue_snapshot_json AS plan_revenue_snapshot_json, p.execution_economics_json AS plan_execution_economics_json, p.daily_kpis_json AS plan_daily_kpis_json, p.owner_approval_gates_json AS plan_owner_approval_gates_json, p.kanban_blueprint_json AS plan_kanban_blueprint_json, p.agent_follow_up_cards_json AS plan_agent_follow_up_cards_json, p.priority_score AS plan_priority_score, p.priority_tier AS plan_priority_tier FROM opportunities o LEFT JOIN opportunity_plans p ON p.opportunity_id = o.id ORDER BY o.priority_score DESC, o.revenue_potential_cents DESC, o.created_at DESC LIMIT 50`).all();
  return (rows.results || []).map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    category: row.category,
    summary: row.summary,
    target_customer: row.target_customer,
    monetization_path: row.monetization_path,
    estimated_cost_cents: row.estimated_cost_cents,
    score: row.score,
    confidence: row.confidence,
    evidence: parseJsonValue(row.evidence_json, []),
    source_mix: parseJsonValue(row.source_mix_json, []),
    suggested_price_cents: integer(row.suggested_price_cents, 0),
    revenue_potential_cents: integer(row.revenue_potential_cents, 0),
    profit_potential_cents: integer(row.profit_potential_cents, 0),
    gross_margin_cents: integer(row.gross_margin_cents, 0),
    break_even_units: integer(row.break_even_units, 0),
    startup_cost_cents: integer(row.startup_cost_cents ?? row.estimated_cost_cents, 0),
    labor_hours: Number(row.labor_hours || 0),
    expected_gross_revenue_cents: integer(row.expected_gross_revenue_cents ?? row.revenue_potential_cents, 0),
    expected_profit_cents: integer(row.expected_profit_cents ?? row.profit_potential_cents, 0),
    probability_weighted_value_cents: integer(row.probability_weighted_value_cents, 0),
    lead_count_target: integer(row.lead_count_target, 0),
    daily_kpis: parseJsonValue(row.daily_kpis_json, []),
    owner_approval_gates: parseJsonValue(row.owner_approval_gates_json, []),
    kanban_blueprint: parseJsonValue(row.kanban_blueprint_json, []),
    agent_follow_up_cards: parseJsonValue(row.agent_follow_up_cards_json, []),
    priority_score: integer(row.priority_score, integer(row.score, 0)),
    priority_tier: text(row.priority_tier, priorityTier(integer(row.priority_score, integer(row.score, 0)))),
    revenue_assumptions: parseJsonValue(row.revenue_assumptions_json, {}),
    score_breakdown: parseJsonValue(row.score_breakdown_json, {}),
    compliance_flags: parseJsonValue(row.compliance_flags_json, []),
    risk_flags: parseJsonValue(row.risk_flags_json, []),
    owner_notes: row.owner_notes,
    rejected_reason: row.rejected_reason,
    kanban_task_id: row.kanban_task_id,
    plan: row.plan_id ? { id: row.plan_id, objective: row.objective, ...parseJsonValue(row.plan_json, {}), kanban_title: row.kanban_title, kanban_body: row.kanban_body, recommended_assignee: row.recommended_assignee, acceptance_criteria: parseJsonValue(row.acceptance_criteria_json, []), required_gates: parseJsonValue(row.required_gates_json, []), revenue_snapshot: parseJsonValue(row.plan_revenue_snapshot_json, {}), execution_economics: parseJsonValue(row.plan_execution_economics_json, {}), daily_kpis: parseJsonValue(row.plan_daily_kpis_json, []), owner_approval_gates: parseJsonValue(row.plan_owner_approval_gates_json, []), kanban_blueprint: parseJsonValue(row.plan_kanban_blueprint_json, []), agent_follow_up_cards: parseJsonValue(row.plan_agent_follow_up_cards_json, []), priority_score: integer(row.plan_priority_score, integer(row.priority_score, 0)), priority_tier: text(row.plan_priority_tier, text(row.priority_tier, "low")) } : null,
    created_at: row.created_at,
    updated_at: row.updated_at
  }));
}
__name(listOpportunityRows, "listOpportunityRows");
async function opportunityToday(request, env) {
  if (!env.DB) return json({ error: "db_binding_required" }, { status: 500 });
  const settings = await getOpportunitySettings(env);
  const url = new URL(request.url);
  const today = text(url.searchParams.get("date"), localDate(settings.timezone));
  const latest = await env.DB.prepare("SELECT * FROM opportunity_runs WHERE run_date_local = ? ORDER BY started_at DESC LIMIT 1").bind(today).first();
  const opportunities = await listOpportunityRows(env, today);
  return json({ ok: true, contract: OPPORTUNITY_CONTRACT, today, settings: publicOpportunitySettings(settings), latest_run: latest || null, opportunities, gates: opportunityGates(settings) });
}
__name(opportunityToday, "opportunityToday");
function publicOpportunitySettings(settings) {
  return { enabled: !!settings.enabled, scheduled_local_time: settings.scheduled_local_time, timezone: settings.timezone, max_daily_ideas: settings.max_daily_ideas, min_daily_ideas: settings.min_daily_ideas, max_budget_cents: settings.max_budget_cents, min_score: settings.min_score, min_roi_score: settings.min_roi_score, min_probability_weighted_value_cents: settings.min_probability_weighted_value_cents, min_expected_profit_cents: settings.min_expected_profit_cents, duplicate_window_days: settings.duplicate_window_days, allowed_assignees: parseJsonValue(settings.allowed_assignees_json, OPPORTUNITY_ALLOWED_ASSIGNEES), default_board: settings.default_board, kanban_creation_enabled: !!settings.kanban_creation_enabled, auto_create_draft_kanban_cards: !!settings.auto_create_draft_kanban_cards, require_approval_before_kanban: !!settings.require_approval_before_kanban, require_compliance_review_for_audience_use: !!settings.require_compliance_review_for_audience_use, trend_sources: parseJsonValue(settings.trend_sources_json, ["sam_gov", "usaspending", "fallback_rss", "fallback_seed"]), assistant_enabled: !!settings.assistant_enabled, diagnostics_enabled: !!settings.diagnostics_enabled, roi_filters: parseJsonValue(settings.roi_filters_json, { min_roi_score: settings.min_roi_score, min_probability_weighted_value_cents: settings.min_probability_weighted_value_cents, min_expected_profit_cents: settings.min_expected_profit_cents, max_startup_cost_cents: settings.max_budget_cents }) };
}
__name(publicOpportunitySettings, "publicOpportunitySettings");
function opportunityGates(settings) {
  return [
    { key: "cost_cap", status: "pass", detail: `Ideas above $${(settings.max_budget_cents / 100).toFixed(0)} are blocked.` },
    { key: "roi filters", status: "pass", detail: `ROI requires score >= ${settings.min_roi_score}, probability-weighted value >= $${(settings.min_probability_weighted_value_cents / 100).toFixed(0)}, and expected profit >= $${(settings.min_expected_profit_cents / 100).toFixed(0)}.` },
    { key: "approval_before_kanban", status: settings.require_approval_before_kanban ? "pass" : "warn", detail: "Kanban creation requires an approved opportunity by default." },
    { key: "kanban_creation", status: settings.kanban_creation_enabled ? "configured" : "blocked", detail: "Kanban card creation is disabled until settings enable it." },
    { key: "legacy_audience", status: "blocked", detail: "Historical email/SMS audiences are compliance-sensitive and not eligible for sending in this feature." },
    { key: "external_actions", status: "blocked", detail: "No spend, domains, ads, publishing, email, SMS, DMs, or public posts." }
  ];
}
__name(opportunityGates, "opportunityGates");
async function opportunityRuns(request, env) {
  if (!env.DB) return json({ error: "db_binding_required" }, { status: 500 });
  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(100, integer(url.searchParams.get("limit"), 25)));
  const result = await env.DB.prepare("SELECT * FROM opportunity_runs ORDER BY started_at DESC LIMIT ?").bind(limit).all();
  return json({ ok: true, contract: OPPORTUNITY_CONTRACT, runs: result.results || [] });
}
__name(opportunityRuns, "opportunityRuns");
async function opportunitySettingsRoute(request, env) {
  if (!env.DB) return json({ error: "db_binding_required" }, { status: 500 });
  const settings = await getOpportunitySettings(env);
  if (request.method === "GET") return json({ ok: true, contract: OPPORTUNITY_CONTRACT, settings: publicOpportunitySettings(settings), gates: opportunityGates(settings) });
  const body = await readJson(request);
  const allowedAssignees = parseJsonValue(settings.allowed_assignees_json, OPPORTUNITY_ALLOWED_ASSIGNEES);
  const patchValues = {
    enabled: body.enabled === void 0 ? settings.enabled : boolInt(body.enabled),
    max_daily_ideas: Math.max(1, Math.min(3, integer(body.max_daily_ideas ?? body.daily_idea_count, settings.max_daily_ideas))),
    min_daily_ideas: Math.max(1, Math.min(3, integer(body.min_daily_ideas, settings.min_daily_ideas))),
    max_budget_cents: Math.max(0, Math.min(5e3, integer(body.max_budget_cents, settings.max_budget_cents))),
    min_score: Math.max(0, Math.min(100, integer(body.min_score, settings.min_score))),
    min_roi_score: Math.max(0, Math.min(100, integer(body.min_roi_score, settings.min_roi_score))),
    min_probability_weighted_value_cents: Math.max(0, Math.min(1e8, integer(body.min_probability_weighted_value_cents, settings.min_probability_weighted_value_cents))),
    min_expected_profit_cents: Math.max(0, Math.min(1e8, integer(body.min_expected_profit_cents, settings.min_expected_profit_cents))),
    duplicate_window_days: Math.max(1, Math.min(365, integer(body.duplicate_window_days, settings.duplicate_window_days))),
    scheduled_local_time: text(body.scheduled_local_time, settings.scheduled_local_time),
    kanban_creation_enabled: body.kanban_creation_enabled === void 0 ? settings.kanban_creation_enabled : boolInt(body.kanban_creation_enabled),
    auto_create_draft_kanban_cards: body.auto_create_draft_kanban_cards === void 0 ? settings.auto_create_draft_kanban_cards : boolInt(body.auto_create_draft_kanban_cards),
    assistant_enabled: body.assistant_enabled === void 0 ? settings.assistant_enabled : boolInt(body.assistant_enabled),
    diagnostics_enabled: body.diagnostics_enabled === void 0 ? settings.diagnostics_enabled : boolInt(body.diagnostics_enabled)
  };
  const requestedAssignees = Array.isArray(body.allowed_assignees) ? body.allowed_assignees.map((v) => text(v)).filter((v) => !!v && OPPORTUNITY_ALLOWED_ASSIGNEES.includes(v)) : allowedAssignees;
  await env.DB.prepare(`UPDATE opportunity_settings SET updated_at = ?, enabled = ?, max_daily_ideas = ?, min_daily_ideas = ?, max_budget_cents = ?, min_score = ?, min_roi_score = ?, min_probability_weighted_value_cents = ?, min_expected_profit_cents = ?, duplicate_window_days = ?, scheduled_local_time = ?, kanban_creation_enabled = ?, auto_create_draft_kanban_cards = ?, assistant_enabled = ?, diagnostics_enabled = ?, allowed_assignees_json = ?, roi_filters_json = ? WHERE id = 'default'`).bind(now(), patchValues.enabled, patchValues.max_daily_ideas, patchValues.min_daily_ideas, patchValues.max_budget_cents, patchValues.min_score, patchValues.min_roi_score, patchValues.min_probability_weighted_value_cents, patchValues.min_expected_profit_cents, patchValues.duplicate_window_days, patchValues.scheduled_local_time, patchValues.kanban_creation_enabled, patchValues.auto_create_draft_kanban_cards, patchValues.assistant_enabled, patchValues.diagnostics_enabled, jsonString(requestedAssignees.length ? requestedAssignees : OPPORTUNITY_ALLOWED_ASSIGNEES), jsonString({ min_roi_score: patchValues.min_roi_score, min_probability_weighted_value_cents: patchValues.min_probability_weighted_value_cents, min_expected_profit_cents: patchValues.min_expected_profit_cents, max_startup_cost_cents: patchValues.max_budget_cents })).run();
  await auditOpportunity(env, "settings_updated", { actor: "admin", changed_keys: Object.keys(body) }, void 0, void 0, void 0, request);
  return json({ ok: true, contract: OPPORTUNITY_CONTRACT, settings: publicOpportunitySettings(await getOpportunitySettings(env)) });
}
__name(opportunitySettingsRoute, "opportunitySettingsRoute");
async function opportunitySources(env) {
  const settings = await getOpportunitySettings(env);
  const configured = parseJsonValue(settings.trend_sources_json, []);
  const rssCount = (await fetchFallbackRssSignals(env, 20)).length;
  const samKeyPresent = !!samApiKey(env);
  return json({ ok: true, contract: OPPORTUNITY_CONTRACT, sources: [
    { key: "sam_gov", enabled: configured.includes("sam_gov"), available: samKeyPresent, api_key_present: samKeyPresent, read_only: true, no_proposal_submission: true },
    { key: "usaspending", enabled: configured.includes("usaspending"), available: true, read_only: true, no_proposal_submission: true },
    { key: "fallback_rss", enabled: configured.includes("fallback_rss"), available: rssCount > 0, private_analysis_only: true, count: rssCount },
    { key: "fallback_seed", enabled: true, available: true, count: OPPORTUNITY_SEED_SIGNALS.length }
  ] });
}
__name(opportunitySources, "opportunitySources");
async function trendSources(env) {
  const settings = env.DB ? await getOpportunitySettings(env) : null;
  const configured = settings ? parseJsonValue(settings.trend_sources_json, []) : [];
  const quota = await serpTrendQuotaState(env);
  const serpKeyPresent = !!serpApiKey(env);
  return json({ ok: true, contract: OPPORTUNITY_CONTRACT, sources: TREND_SOURCE_KEYS.map((key) => ({
    key,
    configured: configured.includes(key) || key === "fallback_seed",
    available: key === "sam_gov" ? !!samApiKey(env) : key === "google_trends" ? serpKeyPresent && quota.remaining > 0 : true,
    api_key_present: key === "sam_gov" ? !!samApiKey(env) : key === "google_trends" ? serpKeyPresent : void 0,
    env_names_only: key === "sam_gov" ? ["SAM_GOV_API_KEY", "SAM_API_KEY"] : key === "google_trends" ? ["SERP_API_KEY", "SERPAPI_API_KEY", "SEARCHAPI_API_KEY", "GOOGLE_TRENDS_API_KEY"] : [],
    provider: key === "google_trends" ? SERP_TRENDS_PROVIDER_KEY : key,
    quota: key === "google_trends" ? { monthly_quota: quota.quota, month: quota.month, searches_used: quota.used, searches_remaining: quota.remaining, cache_window_days: TREND_CACHE_WINDOW_DAYS } : void 0,
    read_only: true,
    private_analysis_only: true,
    no_external_action_allowed: true,
    no_secret_values_returned: true
  })), safety: { private_analysis_only: true, requires_owner_approval: true, no_spend_send_publish_charge: true, legacy_audience_guardrail: true }, revenue_feedback: { source: "stripe_revenue_feedback", stores_aggregated_feedback_only: true, no_secret_values_returned: true } });
}
__name(trendSources, "trendSources");
async function trendScans(request, env) {
  if (!env.DB) return json({ error: "db_binding_required" }, { status: 500 });
  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(100, integer(url.searchParams.get("limit"), 25)));
  const rows = await env.DB.prepare("SELECT * FROM trend_scans ORDER BY created_at DESC LIMIT ?").bind(limit).all();
  return json({ ok: true, contract: OPPORTUNITY_CONTRACT, scans: rows.results || [], safety: { private_analysis_only: true, no_external_action_allowed: true } });
}
__name(trendScans, "trendScans");
async function linkTrendResultToSimilarOpportunities(env, scanId, resultId, signal) {
  if (!env.DB) return [];
  const needle = `${signal.title} ${signal.summary} ${signal.category}`;
  const rows = await env.DB.prepare("SELECT id, title, target_customer, summary, metadata_json FROM opportunities ORDER BY created_at DESC LIMIT 100").all();
  const related = [];
  for (const row of rows.results || []) {
    const meta = parseJsonValue(text(row.metadata_json, "{}"), {});
    const haystack = `${text(row.title, "")} ${text(row.target_customer, "")} ${text(row.summary, "")} ${text(meta.offer, "")}`;
    if (tokenSimilarity(needle, haystack) < 0.2) continue;
    const oppId = text(row.id);
    if (!oppId) continue;
    related.push(oppId);
    await env.DB.prepare("INSERT OR IGNORE INTO trend_to_opportunity_links (id, created_at, scan_id, trend_result_id, opportunity_id, relation_type, confidence, metadata_json) VALUES (?, ?, ?, ?, ?, 'similarity_match', 'medium', ?)").bind(id("trend_link"), now(), scanId, resultId, oppId, jsonString({ private_analysis_only: true, no_external_action_allowed: true })).run();
  }
  return related.slice(0, 10);
}
__name(linkTrendResultToSimilarOpportunities, "linkTrendResultToSimilarOpportunities");
async function scanTrends(env, options = {}) {
  if (!env.DB) return { ok: false, error: "db_binding_required" };
  const settings = await getOpportunitySettings(env);
  const scanId = id("trend_scan");
  const ts = now();
  const topic = text(options.topic, "opportunity intelligence");
  const keyword = text(options.keyword, topic);
  const region = text(options.region, "US");
  const configured = parseJsonValue(settings.trend_sources_json, ["sam_gov", "usaspending", "fallback_rss", "fallback_seed"]);
  const sources = (options.sources && options.sources.length ? options.sources : configured).filter((source) => TREND_SOURCE_KEYS.includes(source) || source === "fallback_rss");
  await env.DB.prepare("INSERT INTO trend_scans (id, created_at, updated_at, started_at, status, trigger_type, topic, keyword, region, sources_json, provider_diagnostics_json, raw_evidence_json) VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?, ?, '{}', ?)").bind(scanId, ts, ts, ts, text(options.trigger_type, "manual"), topic, keyword, region, jsonString(sources), jsonString({ safety: "private_analysis_only", no_external_action_allowed: true })).run();
  const signals = [];
  const providerStatus = [];
  try {
    if (sources.includes("google_trends")) {
      const serp = await fetchSerpApiTrendSignals(env, keyword, region, Math.max(1, Math.min(20, integer(options.limit, 10))));
      signals.push(...serp.signals);
      providerStatus.push({ provider: serp.provider, source: "google_trends", status: serp.status, count: serp.count, api_key_present: !!serp.api_key_present, quota: serp.quota, cache_hit: !!serp.cache_hit, error: serp.error, env_names_only: ["SERP_API_KEY", "SERPAPI_API_KEY", "SEARCHAPI_API_KEY", "GOOGLE_TRENDS_API_KEY"], no_secret_values: true });
    }
    const government = await fetchGovernmentSignals(env, sources, Math.max(1, Math.min(20, integer(options.limit, 12))));
    signals.push(...government.signals);
    providerStatus.push(...government.providerStatus);
    if (sources.includes("fallback_rss") || sources.includes("rss_content") || sources.includes("public_rss")) {
      const rss = await fetchFallbackRssSignals(env, Math.max(1, Math.min(20, integer(options.limit, 8))));
      signals.push(...rss);
      providerStatus.push({ provider: "rss_content", status: "ok", count: rss.length, private_analysis_only: true });
    }
    if (sources.includes("fallback_seed") || !signals.length) {
      signals.push(...OPPORTUNITY_SEED_SIGNALS.map((signal) => ({ ...signal, observed_at: now(), confidence: "low", region })));
      providerStatus.push({ provider: "fallback_seed", status: "ok", count: OPPORTUNITY_SEED_SIGNALS.length });
    }
    if (sources.includes("stripe_revenue_feedback")) providerStatus.push({ provider: "stripe_revenue_feedback", status: "available_for_aggregate_feedback", count: 0, revenue_feedback: true, no_secret_values: true });
    let resultCount = 0;
    for (const signal of signals.slice(0, Math.max(1, Math.min(50, integer(options.limit, 20))))) {
      const draft = validateScoutDraft(draftFromSignal({ ...signal, region }, settings), settings);
      const money = draft ? calculateOpportunityMoney(draft) : { revenue_potential_cents: 0, profit_potential_cents: 0, priority_score: 0 };
      const resultId = id("trend_result");
      const dedupeKey = `${signal.source}:${signal.source_id}:${slugify(topic || signal.title)}`.slice(0, 240);
      const related = await linkTrendResultToSimilarOpportunities(env, scanId, resultId, signal);
      await env.DB.prepare(`INSERT OR IGNORE INTO trend_scan_results (id, scan_id, created_at, source, source_id, topic, keyword, region, title, url, summary, metric_name, metric_value, velocity, confidence, priority_score, revenue_potential_cents, profit_potential_cents, raw_evidence_json, related_opportunity_ids_json, trend_dedupe_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(resultId, scanId, now(), signal.source, signal.source_id, topic, keyword, region, signal.title, signal.url || null, signal.summary, signal.metric_name || "trend_strength", signal.metric_value ?? null, signal.velocity ?? null, signal.confidence || draft?.confidence || "low", integer(money.priority_score, 0), integer(money.revenue_potential_cents, 0), integer(money.profit_potential_cents, 0), jsonString({ ...safeStoragePayload(signal.raw_metadata || {}), private_analysis_only: true }), jsonString(related), dedupeKey).run();
      resultCount += 1;
    }
    await env.DB.prepare("UPDATE trend_scans SET updated_at = ?, finished_at = ?, status = 'success', provider_diagnostics_json = ?, results_count = ?, confidence = ?, raw_evidence_json = ? WHERE id = ?").bind(now(), now(), jsonString(providerStatus), resultCount, resultCount ? "medium" : "low", jsonString({ sources, topic, keyword, region, no_external_action_allowed: true }), scanId).run();
    return { ok: true, contract: OPPORTUNITY_CONTRACT, scan_id: scanId, status: "success", results_count: resultCount, providers: providerStatus, safety: { private_analysis_only: true, requires_owner_approval: true, no_external_action_allowed: true, no_spend_send_publish_charge: true, legacy_audience_guardrail: true } };
  } catch (error) {
    await env.DB.prepare("UPDATE trend_scans SET updated_at = ?, finished_at = ?, status = 'failed', provider_diagnostics_json = ? WHERE id = ?").bind(now(), now(), jsonString({ error: error instanceof Error ? error.message.slice(0, 240) : "trend_scan_failed" }), scanId).run();
    return { ok: false, contract: OPPORTUNITY_CONTRACT, scan_id: scanId, error: "trend_scan_failed" };
  }
}
__name(scanTrends, "scanTrends");
async function manualTrendSearch(request, env) {
  const body = await readJson(request);
  const result = await scanTrends(env, {
    trigger_type: "manual",
    topic: text(body.topic),
    keyword: text(body.keyword ?? body.query),
    region: text(body.region, "US"),
    sources: Array.isArray(body.sources) ? body.sources.map((v) => text(v)).filter((v) => !!v) : void 0,
    limit: integer(body.limit, 20)
  });
  await auditOpportunity(env, "trend_scan_manual", { actor: "admin", scan_id: text(result.scan_id), results_count: integer(result.results_count, 0), private_analysis_only: true }, void 0, void 0, void 0, request).catch(() => void 0);
  return json(result, result.ok === false ? { status: 500 } : {});
}
__name(manualTrendSearch, "manualTrendSearch");
async function opportunityDiagnostics(env) {
  const settings = await getOpportunitySettings(env);
  return json({ ok: true, contract: OPPORTUNITY_CONTRACT, diagnostics: { db: !!env.DB, ai: !!env.AI, kv: !!env.KV, sam_gov: { api_key_present: !!samApiKey(env), env_names_only: ["SAM_GOV_API_KEY", "SAM_API_KEY"], read_only: true, no_proposal_submission: true }, settings: publicOpportunitySettings(settings), guardrails: opportunityGates(settings), action_classes: OPPORTUNITY_ACTION_CLASSES, env_names_only: ["AI", "DB", "KV", "SAM_GOV_API_KEY", "SAM_API_KEY"] } });
}
__name(opportunityDiagnostics, "opportunityDiagnostics");
async function opportunityPatch(request, env, opportunityId) {
  if (!env.DB) return json({ error: "db_binding_required" }, { status: 500 });
  const body = await readJson(request);
  const current = await env.DB.prepare("SELECT id, status FROM opportunities WHERE id = ? LIMIT 1").bind(opportunityId).first();
  if (!current) return json({ error: "opportunity_not_found" }, { status: 404 });
  await env.DB.prepare(`UPDATE opportunities SET updated_at = ?, title = COALESCE(?, title), summary = COALESCE(?, summary), target_customer = COALESCE(?, target_customer), monetization_path = COALESCE(?, monetization_path), owner_notes = COALESCE(?, owner_notes), status = CASE WHEN status = 'new' THEN 'edited' ELSE status END WHERE id = ?`).bind(now(), text(body.title), text(body.summary), text(body.target_customer), text(body.monetization_path), text(body.owner_notes), opportunityId).run();
  if (body.plan && typeof body.plan === "object") {
    const plan = body.plan;
    await env.DB.prepare("UPDATE opportunity_plans SET updated_at = ?, status = 'edited', objective = COALESCE(?, objective), kanban_title = COALESCE(?, kanban_title), kanban_body = COALESCE(?, kanban_body), recommended_assignee = COALESCE(?, recommended_assignee), owner_edits_json = ? WHERE opportunity_id = ?").bind(now(), text(plan.objective), text(plan.kanban_title), text(plan.kanban_body), text(plan.recommended_assignee), jsonString(plan), opportunityId).run();
  }
  await auditOpportunity(env, "opportunity_edited", { actor: "admin", opportunity_id: opportunityId }, void 0, opportunityId, void 0, request);
  return json({ ok: true, contract: OPPORTUNITY_CONTRACT, opportunity: (await listOpportunityRows(env)).find((row) => row.id === opportunityId) || null });
}
__name(opportunityPatch, "opportunityPatch");
async function opportunityApproveReject(request, env, opportunityId, action) {
  if (!env.DB) return json({ error: "db_binding_required" }, { status: 500 });
  const body = await readJson(request);
  const opp = await env.DB.prepare("SELECT id FROM opportunities WHERE id = ? LIMIT 1").bind(opportunityId).first();
  if (!opp) return json({ error: "opportunity_not_found" }, { status: 404 });
  if (action === "approve") {
    await env.DB.prepare("UPDATE opportunities SET updated_at = ?, status = 'approved', approved_by = ?, approved_at = ? WHERE id = ?").bind(now(), text(body.actor, "admin"), now(), opportunityId).run();
    await env.DB.prepare("UPDATE opportunity_plans SET updated_at = ?, status = 'approved' WHERE opportunity_id = ?").bind(now(), opportunityId).run();
  } else {
    await env.DB.prepare("UPDATE opportunities SET updated_at = ?, status = 'rejected', rejected_reason = ? WHERE id = ?").bind(now(), text(body.reason, "Rejected by admin"), opportunityId).run();
  }
  await auditOpportunity(env, `opportunity_${action}d`, { actor: "admin", opportunity_id: opportunityId, reason: text(body.reason) }, void 0, opportunityId, void 0, request);
  return json({ ok: true, contract: OPPORTUNITY_CONTRACT, opportunity: (await listOpportunityRows(env)).find((row) => row.id === opportunityId) || null });
}
__name(opportunityApproveReject, "opportunityApproveReject");
async function ensureKanbanBoard(env, slug) {
  if (!env.DB) throw new Error("db_binding_required");
  const ts = now();
  let board = await env.DB.prepare("SELECT id FROM kanban_boards WHERE slug = ? LIMIT 1").bind(slug).first();
  if (!board) {
    const boardId = id("kb_board");
    await env.DB.prepare("INSERT INTO kanban_boards (id, created_at, updated_at, slug, name) VALUES (?, ?, ?, ?, ?)").bind(boardId, ts, ts, slug, "MehyarSoft LLC").run();
    for (const [idx, col] of ["Todo", "Doing", "Review", "Done"].entries()) {
      await env.DB.prepare("INSERT INTO kanban_columns (id, board_id, created_at, updated_at, name, position, status_key) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id("kb_col"), boardId, ts, ts, col, idx + 1, col.toLowerCase()).run();
    }
    board = { id: boardId };
  }
  const column = await env.DB.prepare("SELECT id FROM kanban_columns WHERE board_id = ? AND status_key = 'todo' ORDER BY position LIMIT 1").bind(board.id).first();
  return { boardId: board.id, columnId: column?.id || "" };
}
__name(ensureKanbanBoard, "ensureKanbanBoard");
async function opportunityExecutionLoop(env, opportunityId) {
  if (!env.DB) return json({ error: "db_binding_required" }, { status: 500 });
  const settings = await getOpportunitySettings(env);
  const opportunity = (await listOpportunityRows(env)).find((row) => row.id === opportunityId) || null;
  if (!opportunity) return json({ error: "opportunity_not_found" }, { status: 404 });
  const roiFilters = parseJsonValue(settings.roi_filters_json, { min_roi_score: settings.min_roi_score, min_probability_weighted_value_cents: settings.min_probability_weighted_value_cents, min_expected_profit_cents: settings.min_expected_profit_cents, max_startup_cost_cents: settings.max_budget_cents });
  const roi = {
    passes_filters: integer(opportunity.priority_score, 0) >= settings.min_roi_score && integer(opportunity.probability_weighted_value_cents, 0) >= settings.min_probability_weighted_value_cents && integer(opportunity.expected_profit_cents, 0) >= settings.min_expected_profit_cents && integer(opportunity.startup_cost_cents, 0) <= settings.max_budget_cents,
    filters: roiFilters,
    score: integer(opportunity.priority_score, 0),
    startup_cost_cents: integer(opportunity.startup_cost_cents, 0),
    labor_hours: Number(opportunity.labor_hours || 0),
    expected_gross_revenue_cents: integer(opportunity.expected_gross_revenue_cents, 0),
    expected_profit_cents: integer(opportunity.expected_profit_cents, 0),
    probability_weighted_value_cents: integer(opportunity.probability_weighted_value_cents, 0),
    break_even_units: integer(opportunity.break_even_units, 0),
    lead_count_target: integer(opportunity.lead_count_target, 0)
  };
  const action_class_gates = (await listOpportunityActionGates(env)).map(publicActionGate);
  return json({ ok: true, contract: OPPORTUNITY_CONTRACT, opportunity_id: opportunityId, roi, daily_kpis: opportunity.daily_kpis || [], owner_approval_gates: opportunity.owner_approval_gates || [], kanban_blueprint: opportunity.kanban_blueprint || [], agent_follow_up_cards: opportunity.agent_follow_up_cards || [], action_class_gates, safety: { no_external_action_allowed: true, public_actions_blocked_until_owner_approval: true, auto_create_draft_kanban_cards: !!settings.auto_create_draft_kanban_cards } });
}
__name(opportunityExecutionLoop, "opportunityExecutionLoop");
async function opportunityCreateKanban(request, env, opportunityId) {
  if (!env.DB) return json({ error: "db_binding_required" }, { status: 500 });
  const settings = await getOpportunitySettings(env);
  const body = await readJson(request);
  if (!settings.kanban_creation_enabled) return json({ error: "kanban_creation_disabled", gates: opportunityGates(settings) }, { status: 409 });
  const opp = await env.DB.prepare("SELECT * FROM opportunities WHERE id = ? LIMIT 1").bind(opportunityId).first();
  const plan = await env.DB.prepare("SELECT * FROM opportunity_plans WHERE opportunity_id = ? ORDER BY created_at DESC LIMIT 1").bind(opportunityId).first();
  if (!opp || !plan) return json({ error: "opportunity_or_plan_not_found" }, { status: 404 });
  if (settings.require_approval_before_kanban && opp.status !== "approved") return json({ error: "approval_required_before_kanban" }, { status: 409 });
  if (integer(opp.estimated_cost_cents) > settings.max_budget_cents) return json({ error: "budget_cap_exceeded" }, { status: 409 });
  const gateDecision = await assessOpportunityActionGate(env, "kanban", { actor: text(body.actor, "admin"), owner_approved: opp.status === "approved", opportunity_id: opportunityId, plan_id: text(plan.id), amount_cents: integer(opp.estimated_cost_cents, 0) });
  await auditOpportunityActionGate(env, gateDecision, { route: "create_kanban", internal_only: true }, request);
  if (gateDecision.allowed === false) return json({ error: gateDecision.reason, gate_decision: gateDecision }, { status: 409 });
  if (gateDecision.allowed === true) await auditOpportunity(env, "action_class_approved", { actor: "admin", action_class: gateDecision.action_class, opportunity_id: opportunityId }, void 0, opportunityId, text(plan.id), request);
  const assignee = text(body.assignee ?? plan.recommended_assignee, "productops");
  if (!OPPORTUNITY_ALLOWED_ASSIGNEES.includes(assignee)) return json({ error: "invalid_assignee", allowed_assignees: OPPORTUNITY_ALLOWED_ASSIGNEES }, { status: 400 });
  const { boardId, columnId } = await ensureKanbanBoard(env, settings.default_board || "mehyarsoft-llc");
  const cardId = id("kb_card");
  const cardTitle = text(body.title ?? plan.kanban_title, text(opp.title, "Opportunity Scout task") || "Opportunity Scout task");
  const cardBody = text(body.body ?? plan.kanban_body, text(opp.summary, "Owner-approved Opportunity Scout task") || "Owner-approved Opportunity Scout task");
  await env.DB.prepare(`INSERT INTO kanban_cards (id, board_id, column_id, created_at, updated_at, title, body, assignee, due_date, status, priority, source_type, source_opportunity_id, acceptance_criteria_json, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'todo', ?, 'opportunity_scout', ?, ?, ?)`).bind(cardId, boardId, columnId || null, now(), now(), cardTitle, cardBody, assignee, text(body.due_date), text(body.priority, text(opp.priority_tier, "medium")), opportunityId, text(plan.acceptance_criteria_json, "[]"), jsonString({ created_by: "opportunity_scout", no_external_action_allowed: true, suggested_price_cents: integer(opp.suggested_price_cents, 0), revenue_potential_cents: integer(opp.revenue_potential_cents, 0), profit_potential_cents: integer(opp.profit_potential_cents, 0), priority_score: integer(opp.priority_score, 0), priority_tier: text(opp.priority_tier, "low") })).run();
  await env.DB.prepare("INSERT INTO kanban_activity (id, board_id, card_id, created_at, actor, action, body, metadata_json) VALUES (?, ?, ?, ?, 'Opportunity Scout', 'card_created', ?, ?)").bind(id("kb_act"), boardId, cardId, now(), "Created after admin approval/config gates.", jsonString({ opportunity_id: opportunityId })).run();
  await env.DB.prepare("UPDATE opportunities SET updated_at = ?, status = 'kanban_created', kanban_task_id = ?, kanban_created_at = ? WHERE id = ?").bind(now(), cardId, now(), opportunityId).run();
  await env.DB.prepare("UPDATE opportunity_plans SET updated_at = ?, status = 'kanban_created' WHERE opportunity_id = ?").bind(now(), opportunityId).run();
  await auditOpportunity(env, "kanban_created", { actor: "admin", card_id: cardId, assignee }, void 0, opportunityId, text(plan.id), request);
  return json({ ok: true, contract: OPPORTUNITY_CONTRACT, card_id: cardId, board_id: boardId, assignee, external_action_allowed: false, requires_owner_approval: true });
}
__name(opportunityCreateKanban, "opportunityCreateKanban");
async function opportunityRegenerate(request, env, opportunityId) {
  if (!env.DB) return json({ error: "db_binding_required" }, { status: 500 });
  const opp = await env.DB.prepare("SELECT * FROM opportunities WHERE id = ? LIMIT 1").bind(opportunityId).first();
  if (!opp) return json({ error: "opportunity_not_found" }, { status: 404 });
  await auditOpportunity(env, "regenerate_requested", { actor: "admin", opportunity_id: opportunityId }, text(opp.run_id), opportunityId, void 0, request);
  const result = await runOpportunityScout(env, "regenerate", request);
  return json({ ...result, regenerated_from: opportunityId });
}
__name(opportunityRegenerate, "opportunityRegenerate");
async function opportunityAssistant(request, env) {
  const settings = await getOpportunitySettings(env);
  if (!settings.assistant_enabled) return json({ error: "assistant_disabled" }, { status: 409 });
  const body = await readJson(request);
  const prompt = text(body.prompt, "Explain the current opportunity and safest next step.");
  const safeInput = { prompt, opportunity_id: text(body.opportunity_id), guardrails: opportunityGates(settings) };
  const response = await runAI(env, "You are the internal Opportunity Scout assistant. Return strict JSON with summary, next_steps, risks, external_action_allowed=false, requires_owner_approval=true. Never instruct sending, spending, publishing, buying domains, ads, email, SMS, or use of legacy audiences.", safeInput);
  let parsed = parseJsonValue(response, { summary: response.slice(0, 1e3) });
  parsed = { ...parsed, external_action_allowed: false, requires_owner_approval: true, compliance_sensitive_legacy_audience_use_allowed: false };
  await auditOpportunity(env, "assistant_used", { actor: "admin", opportunity_id: text(body.opportunity_id), prompt_length: prompt.length }, void 0, text(body.opportunity_id), void 0, request);
  return json({ ok: true, contract: OPPORTUNITY_CONTRACT, assistant: parsed });
}
__name(opportunityAssistant, "opportunityAssistant");
async function listGovernmentOpportunities(request, env) {
  if (!env.DB) return json({ error: "db_binding_required" }, { status: 500 });
  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(100, integer(url.searchParams.get("limit"), 25)));
  const source = text(url.searchParams.get("source"));
  const rows = source ? await env.DB.prepare("SELECT id, created_at, updated_at, source_type, notice_id, title, solicitation_number, agency, office, posted_date, response_deadline, naics_code, set_aside, place_of_performance, url, description, score, status FROM government_opportunities WHERE source_type = ? ORDER BY updated_at DESC LIMIT ?").bind(source, limit).all() : await env.DB.prepare("SELECT id, created_at, updated_at, source_type, notice_id, title, solicitation_number, agency, office, posted_date, response_deadline, naics_code, set_aside, place_of_performance, url, description, score, status FROM government_opportunities ORDER BY updated_at DESC LIMIT ?").bind(limit).all();
  return json({ ok: true, contract: OPPORTUNITY_CONTRACT, opportunities: rows.results || [], safety: { read_only: true, no_proposal_submission: true, no_external_action_allowed: true } });
}
__name(listGovernmentOpportunities, "listGovernmentOpportunities");
async function runGovernmentIngest(request, env) {
  if (!env.DB) return json({ error: "db_binding_required" }, { status: 500 });
  const body = await readJson(request);
  const requested = Array.isArray(body.sources) ? body.sources.map((v) => text(v)).filter((v) => !!v && GOVERNMENT_SOURCE_KEYS.includes(v)) : GOVERNMENT_SOURCE_KEYS;
  const result = await fetchGovernmentSignals(env, requested, Math.max(1, Math.min(20, integer(body.limit, 12))));
  await auditOpportunity(env, "government_ingest", { actor: "admin", provider_count: result.providerStatus.length, signals_fetched: result.signals.length, no_proposal_submission: true }, void 0, void 0, void 0, request);
  return json({ ok: true, contract: OPPORTUNITY_CONTRACT, signals_fetched: result.signals.length, providers: result.providerStatus, safety: { read_only: true, no_proposal_submission: true, no_external_action_allowed: true } });
}
__name(runGovernmentIngest, "runGovernmentIngest");
async function governmentDiagnostics(env) {
  const state = env.DB ? await env.DB.prepare("SELECT source_key, updated_at, last_run_at, last_status, last_count, last_error FROM source_ingest_state WHERE source_key IN ('sam_gov','usaspending') ORDER BY source_key").all() : { results: [] };
  return json({ ok: true, contract: OPPORTUNITY_CONTRACT, diagnostics: { sam_gov: { api_key_present: !!samApiKey(env), env_names_only: ["SAM_GOV_API_KEY", "SAM_API_KEY"] }, usaspending: { api_key_required: false }, source_state: state.results || [], safety: { read_only: true, no_proposal_submission: true, no_secret_logging: true } } });
}
__name(governmentDiagnostics, "governmentDiagnostics");
var GOVERNMENT_WORKSPACE_CONTRACT = "government-workspace-admin-v1";
var GOVERNMENT_DRAFT_STATUSES = ["owner_review_required", "needs_edit", "approved_internal", "archived"];
async function getGovernmentOpportunity(env, opportunityId) {
  if (!env.DB) return null;
  return await env.DB.prepare("SELECT id, created_at, updated_at, source_type, notice_id, title, solicitation_number, agency, office, posted_date, response_deadline, naics_code, set_aside, place_of_performance, url, description, score, status, raw_metadata_json FROM government_opportunities WHERE id = ? OR notice_id = ? LIMIT 1").bind(opportunityId, opportunityId).first();
}
__name(getGovernmentOpportunity, "getGovernmentOpportunity");
function governmentChecklist(opp) {
  return [
    { id: "owner_review", label: "Owner review before any response", status: "required", detail: "No auto-submit, no external portal action, and no representative claim without human approval." },
    { id: "fit", label: "Fit and capability check", status: opp ? "ready" : "missing_opportunity", detail: "Confirm NAICS, deadline, scope, eligibility, and delivery capacity." },
    { id: "compliance", label: "Compliance gates", status: "required", detail: "SAM.gov/agency rules, pricing, certifications, and legal/compliance review remain manual." },
    { id: "draft", label: "Draft response package", status: "owner_review_required", detail: "Drafts are internal planning artifacts only; auto_submit_allowed=false." }
  ];
}
__name(governmentChecklist, "governmentChecklist");
function normalizeGovernmentDraft(row) {
  return {
    id: text(row.id),
    opportunity_id: text(row.opportunity_id),
    created_at: text(row.created_at),
    updated_at: text(row.updated_at),
    template_key: text(row.template_key, "owner_review_response_helper_v1"),
    status: text(row.status, "owner_review_required"),
    subject: text(row.subject, "Government opportunity owner-review draft"),
    body_text: text(row.body_text ?? row.draft_body, ""),
    owner_notes: text(row.owner_notes),
    owner_review_only: true,
    auto_submit_allowed: false,
    external_action_allowed: false,
    requires_owner_approval: true
  };
}
__name(normalizeGovernmentDraft, "normalizeGovernmentDraft");
async function listGovernmentDrafts(env, opportunityId) {
  if (!env.DB) return [];
  try {
    const rows = await env.DB.prepare("SELECT id, opportunity_id, created_at, updated_at, template_key, status, subject, body_text, owner_notes FROM government_response_drafts WHERE opportunity_id = ? ORDER BY updated_at DESC LIMIT 20").bind(opportunityId).all();
    return (rows.results || []).map(normalizeGovernmentDraft);
  } catch {
    return [];
  }
}
__name(listGovernmentDrafts, "listGovernmentDrafts");
async function governmentOpportunityWorkspace(request, env, opportunityId) {
  const opp = await getGovernmentOpportunity(env, opportunityId);
  if (!opp) return json({ error: "government_opportunity_not_found" }, { status: 404 });
  const drafts = await listGovernmentDrafts(env, text(opp.id, opportunityId));
  const workspace = {
    id: `gov_workspace_${text(opp.id, opportunityId)}`,
    opportunity_id: text(opp.id, opportunityId),
    status: text(opp.status, "active"),
    owner_review_only: true,
    auto_submit_allowed: false,
    external_action_allowed: false,
    no_proposal_submission: true,
    checklist: governmentChecklist(opp),
    drafts,
    notes: text(opp.raw_metadata_json) ? ["Raw source metadata retained server-side; response package requires owner review."] : []
  };
  await auditOpportunity(env, "government_workspace_viewed", { actor: "admin", opportunity_id: text(opp.id), workspace_id: workspace.id, no_proposal_submission: true }, void 0, text(opp.id), void 0, request);
  return json({ ok: true, contract: GOVERNMENT_WORKSPACE_CONTRACT, opportunity: opp, workspace, drafts, safety: { owner_review_only: true, auto_submit_allowed: false, external_action_allowed: false } });
}
__name(governmentOpportunityWorkspace, "governmentOpportunityWorkspace");
async function createGovernmentDraft(request, env, opportunityId) {
  if (!env.DB) return json({ error: "db_binding_required" }, { status: 500 });
  const opp = await getGovernmentOpportunity(env, opportunityId);
  if (!opp) return json({ error: "government_opportunity_not_found" }, { status: 404 });
  const body = await readJson(request);
  const draftId = id("gov_draft");
  const templateKey = text(body.template_key ?? body.templateKey, "owner_review_response_helper_v1");
  const ownerNotes = text(body.owner_notes ?? body.ownerNotes);
  const subject = text(body.subject, `Owner-review response helper: ${text(opp.title, "Government opportunity")}`);
  const draftBody = [
    `Opportunity: ${text(opp.title, "Untitled government opportunity")}`,
    `Agency: ${text(opp.agency, "unknown")}`,
    `Solicitation: ${text(opp.solicitation_number ?? opp.notice_id, "unknown")}`,
    `Deadline: ${text(opp.response_deadline, "unknown")}`,
    "",
    "Owner-review checklist:",
    "- Confirm eligibility, scope, pricing, and compliance requirements manually.",
    "- Do not submit this draft automatically.",
    "- Use this only as an internal response/planning aid.",
    ownerNotes ? `
Owner notes: ${ownerNotes}` : ""
  ].join("\n");
  await env.DB.prepare("INSERT INTO government_response_drafts (id, opportunity_id, created_at, updated_at, template_key, status, subject, body_text, owner_notes, metadata_json) VALUES (?, ?, ?, ?, ?, 'owner_review_required', ?, ?, ?, ?)").bind(draftId, text(opp.id), now(), now(), templateKey, subject, draftBody, ownerNotes, jsonString({ owner_review_only: true, auto_submit_allowed: false, source: "api.mehyar.us/v1" })).run();
  await auditOpportunity(env, "government_draft_created", { actor: "admin", draft_id: draftId, opportunity_id: text(opp.id), auto_submit_allowed: false }, void 0, text(opp.id), void 0, request);
  const draft = await env.DB.prepare("SELECT id, opportunity_id, created_at, updated_at, template_key, status, subject, body_text, owner_notes FROM government_response_drafts WHERE id = ? LIMIT 1").bind(draftId).first();
  return json({ ok: true, contract: GOVERNMENT_WORKSPACE_CONTRACT, draft: normalizeGovernmentDraft(draft || { id: draftId, opportunity_id: text(opp.id), subject, body_text: draftBody, status: "owner_review_required" }), safety: { owner_review_only: true, auto_submit_allowed: false } });
}
__name(createGovernmentDraft, "createGovernmentDraft");
async function updateGovernmentDraft(request, env, draftId) {
  if (!env.DB) return json({ error: "db_binding_required" }, { status: 500 });
  const body = await readJson(request);
  const status = text(body.status, "owner_review_required");
  if (!GOVERNMENT_DRAFT_STATUSES.includes(status)) return json({ error: "invalid_status", allowed: GOVERNMENT_DRAFT_STATUSES }, { status: 400 });
  const current = await env.DB.prepare("SELECT * FROM government_response_drafts WHERE id = ? LIMIT 1").bind(draftId).first();
  if (!current) return json({ error: "government_draft_not_found" }, { status: 404 });
  await env.DB.prepare("UPDATE government_response_drafts SET updated_at = ?, status = ?, subject = COALESCE(?, subject), body_text = COALESCE(?, body_text), owner_notes = COALESCE(?, owner_notes), metadata_json = ? WHERE id = ?").bind(now(), status, text(body.subject), text(body.body_text ?? body.draft_body ?? body.bodyText), text(body.owner_notes ?? body.ownerNotes), jsonString({ owner_review_only: true, auto_submit_allowed: false, last_update_source: "api.mehyar.us/v1" }), draftId).run();
  const updated = await env.DB.prepare("SELECT id, opportunity_id, created_at, updated_at, template_key, status, subject, body_text, owner_notes FROM government_response_drafts WHERE id = ? LIMIT 1").bind(draftId).first();
  await auditOpportunity(env, "government_draft_updated", { actor: "admin", draft_id: draftId, status, auto_submit_allowed: false }, void 0, text(updated?.opportunity_id), void 0, request);
  return json({ ok: true, contract: GOVERNMENT_WORKSPACE_CONTRACT, draft: normalizeGovernmentDraft(updated || current), safety: { owner_review_only: true, auto_submit_allowed: false } });
}
__name(updateGovernmentDraft, "updateGovernmentDraft");
async function scheduledOpportunityScout(env) {
  if (!env.DB) return;
  try {
    await runOpportunityScout(env, "scheduled");
  } catch {
  }
}
__name(scheduledOpportunityScout, "scheduledOpportunityScout");
function scoreLead(body) {
  const serialized = JSON.stringify(body).toLowerCase();
  let score = 20;
  if (serialized.includes("pharma") || serialized.includes("health") || serialized.includes("clinic")) score += 25;
  if (serialized.includes("automation") || serialized.includes("ai") || serialized.includes("crm")) score += 20;
  if (serialized.includes("urgent") || serialized.includes("missed call") || serialized.includes("booking")) score += 20;
  if (serialized.includes("budget") || serialized.includes("retainer") || serialized.includes("project")) score += 10;
  score = Math.min(score, 100);
  return { score, next_action: score >= 70 ? "Call within 24 hours and propose paid audit." : "Send qualification follow-up and offer tech audit." };
}
__name(scoreLead, "scoreLead");
function decodeXml(value) {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/g, "'").replace(/&#x([0-9a-f]+);/gi, (_m, hex) => String.fromCharCode(parseInt(hex, 16))).replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(parseInt(n, 10)));
}
__name(decodeXml, "decodeXml");
function stripXmlHtml(value, max = 1200) {
  if (!value) return null;
  const clean = stripHtml(decodeXml(value)).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ").replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, max) : null;
}
__name(stripXmlHtml, "stripXmlHtml");
function xmlTag(block, tag) {
  const escaped = tag.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  const match = block.match(new RegExp(`<(?:[a-z0-9_]+:)?${escaped}\\b[^>]*>([\\s\\S]*?)<\\/(?:[a-z0-9_]+:)?${escaped}>`, "i"));
  return match ? decodeXml(match[1]).trim() : null;
}
__name(xmlTag, "xmlTag");
function xmlAttr(tagText, attr) {
  const match = tagText.match(new RegExp(`${attr}=["']([^"']+)["']`, "i"));
  return match ? decodeXml(match[1]).trim() : null;
}
__name(xmlAttr, "xmlAttr");
function canonicalizeUrl(value, base) {
  try {
    const url = new URL(decodeXml(value), base || void 0);
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith("utm_") || ["fbclid", "gclid", "mc_cid", "mc_eid"].includes(key.toLowerCase())) url.searchParams.delete(key);
    }
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}
__name(canonicalizeUrl, "canonicalizeUrl");
function itemBlocks(xml) {
  const blocks = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map((m) => m[0]);
  if (blocks.length) return blocks;
  return [...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)].map((m) => m[0]);
}
__name(itemBlocks, "itemBlocks");
function itemLink(block, feedUrl) {
  const atomAlternate = [...block.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]).find((tag) => !/rel=["'](?:self|hub)["']/i.test(tag));
  const atomHref = atomAlternate ? xmlAttr(atomAlternate, "href") : null;
  const raw = atomHref || xmlTag(block, "link") || xmlTag(block, "id") || xmlTag(block, "guid");
  return raw ? canonicalizeUrl(raw, feedUrl) : null;
}
__name(itemLink, "itemLink");
function imageFromItem(block, description) {
  const media = block.match(/<(?:media:)?(?:content|thumbnail)\b[^>]*(?:url|href)=["']([^"']+)["'][^>]*>/i);
  if (media) return decodeXml(media[1]);
  const enclosure = block.match(/<enclosure\b[^>]*url=["']([^"']+)["'][^>]*(?:type=["']image\/[^"']+["'])?[^>]*>/i);
  if (enclosure && (/type=["']image\//i.test(enclosure[0]) || /\.(png|jpe?g|gif|webp)(\?|$)/i.test(enclosure[1]))) return decodeXml(enclosure[1]);
  const img = description?.match(/<img\b[^>]*src=["']([^"']+)["']/i);
  return img ? decodeXml(img[1]) : null;
}
__name(imageFromItem, "imageFromItem");
function parseFeed(xml, feedUrl, limit = 20) {
  const items = [];
  for (const block of itemBlocks(xml).slice(0, limit)) {
    const title = stripXmlHtml(xmlTag(block, "title"), 240);
    const sourceUrl = itemLink(block, feedUrl);
    if (!title || !sourceUrl) continue;
    const descriptionRaw = xmlTag(block, "description") || xmlTag(block, "summary");
    const contentRaw = xmlTag(block, "encoded") || xmlTag(block, "content");
    const excerpt = stripXmlHtml(descriptionRaw || contentRaw, 500);
    const rawContent = stripXmlHtml(contentRaw, 5e3);
    const image = imageFromItem(block, descriptionRaw || contentRaw);
    const publishedRaw = xmlTag(block, "pubDate") || xmlTag(block, "published") || xmlTag(block, "updated") || xmlTag(block, "date");
    const parsedDate = publishedRaw ? Date.parse(publishedRaw) : NaN;
    const canonical = canonicalizeUrl(sourceUrl, feedUrl) || sourceUrl;
    const fullAvailable = rawContent && excerpt ? rawContent.length > excerpt.length + 250 : !!rawContent && rawContent.length > 1200;
    items.push({
      title,
      source_url: sourceUrl,
      canonical_url: canonical,
      excerpt,
      published_at: Number.isFinite(parsedDate) ? new Date(parsedDate).toISOString() : null,
      author: stripXmlHtml(xmlTag(block, "creator") || xmlTag(block, "author") || xmlTag(block, "name"), 160),
      image_url: image ? canonicalizeUrl(image, sourceUrl) : null,
      raw_excerpt_private: excerpt,
      raw_content_private: rawContent,
      full_content_available: fullAvailable ? 1 : 0
    });
  }
  return items;
}
__name(parseFeed, "parseFeed");
function scoreRssArticle(item, source) {
  const haystack = `${item.title} ${item.excerpt || ""} ${source.category || ""} ${source.vertical || ""}`.toLowerCase();
  const tags = [];
  let client = 20;
  let seo = 20;
  let useCase = 20;
  const boosts = [
    [/\b(ai|automation|agent|workflow)\b/i, "ai_automation", 18, 12, 18],
    [/\b(crm|lead|sales|follow[- ]?up|pipeline)\b/i, "crm_growth", 22, 14, 20],
    [/\b(local|small business|smb|service business|agency)\b/i, "smb_fit", 20, 16, 22],
    [/\b(seo|search|google|ranking|content)\b/i, "seo", 10, 24, 14],
    [/\b(compliance|privacy|ftc|nist|hipaa|security)\b/i, "compliance_safe_ai", 12, 16, 18],
    [/\b(cloudflare|zapier|hubspot|salesforce|zoho)\b/i, "platform_workflow", 14, 12, 16]
  ];
  for (const [regex, tag, c, s, u] of boosts) {
    if (regex.test(haystack)) {
      tags.push(tag);
      client += c;
      seo += s;
      useCase += u;
    }
  }
  const tierBoost = source.tier === 1 ? 10 : source.tier === 2 ? 5 : 0;
  client = Math.min(100, client + tierBoost);
  seo = Math.min(100, seo + Math.min(Math.max(source.priority || 50, 0), 100) / 10);
  useCase = Math.min(100, useCase + tierBoost);
  return { client: Math.round(client), seo: Math.round(seo), use_case: Math.round(useCase), total: Math.round(client * 0.4 + seo * 0.3 + useCase * 0.3), tags: [...new Set(tags)] };
}
__name(scoreRssArticle, "scoreRssArticle");
async function testRssFeed(feedUrl) {
  try {
    const response = await fetch(feedUrl, { headers: { "user-agent": "MehyarSoftBot/0.1 (+https://mehyar.us); RSS metadata only" } });
    const body = await response.text();
    if (!response.ok) return { ok: false, http_status: response.status, parse_status: "http_error", item_count: 0, image_found_count: 0, full_content_available: false, error: `HTTP ${response.status}`, sample_titles: [] };
    const items = parseFeed(body, feedUrl, 50);
    const imageCount = items.filter((item) => item.image_url).length;
    const fullContent = items.some((item) => item.full_content_available === 1);
    return { ok: items.length > 0, http_status: response.status, parse_status: items.length ? "ok" : "no_items", item_count: items.length, image_found_count: imageCount, full_content_available: fullContent, error: items.length ? void 0 : "No RSS/Atom items parsed", sample_titles: items.slice(0, 5).map((item) => item.title) };
  } catch (error) {
    return { ok: false, http_status: 0, parse_status: "fetch_error", item_count: 0, image_found_count: 0, full_content_available: false, error: error instanceof Error ? error.message.slice(0, 300) : "fetch_failed", sample_titles: [] };
  }
}
__name(testRssFeed, "testRssFeed");
async function upsertRssSource(request, env) {
  const body = await readJson(request);
  if (!env.DB) return json({ error: "db_binding_required" }, { status: 500 });
  const feedUrl = text(body.feed_url ?? body.feedUrl ?? body.url);
  const name = text(body.name);
  if (!feedUrl || !name) return json({ error: "name_and_feed_url_required" }, { status: 400 });
  const normalizedFeedUrl = canonicalizeUrl(feedUrl) || feedUrl;
  const sourceId = text(body.id) || id("rss_src");
  const active = body.active === void 0 ? text(body.status, "active") === "active" ? 1 : 0 : boolInt(body.active);
  const status = text(body.status, active ? "active" : "inactive") || "inactive";
  const ts = now();
  await env.DB.prepare(`INSERT INTO rss_sources (id, created_at, updated_at, name, feed_url, site_url, category, vertical, tier, priority, status, active, license_notes, rights_notes, auto_deactivate_after, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(feed_url) DO UPDATE SET updated_at=excluded.updated_at, name=excluded.name, site_url=excluded.site_url, category=excluded.category, vertical=excluded.vertical, tier=excluded.tier, priority=excluded.priority, status=excluded.status, active=excluded.active, license_notes=excluded.license_notes, rights_notes=excluded.rights_notes, auto_deactivate_after=excluded.auto_deactivate_after, metadata_json=excluded.metadata_json`).bind(sourceId, ts, ts, name, normalizedFeedUrl, text(body.site_url ?? body.siteUrl), text(body.category), text(body.vertical), integer(body.tier, 2), integer(body.priority, 50), status, active, text(body.license_notes ?? body.licenseNotes), text(body.rights_notes ?? body.rightsNotes, "Private analysis only; do not reuse source images/full text without permission."), Math.max(integer(body.auto_deactivate_after ?? body.autoDeactivateAfter, 3), 1), jsonString(safeStorageMetadata(body))).run();
  const saved = await env.DB.prepare("SELECT id FROM rss_sources WHERE feed_url = ? LIMIT 1").bind(normalizedFeedUrl).first();
  const savedSourceId = saved?.id || sourceId;
  await writeRssSourceAudit(env, savedSourceId, "source_upserted", { surface: "admin", status, active, feed_url: normalizedFeedUrl });
  await logEvent(env, "rss.source.upserted", { surface: "admin", source_id: savedSourceId, status, active }, void 0, request);
  return json({ ok: true, source_id: savedSourceId, feed_url: normalizedFeedUrl, status, active });
}
__name(upsertRssSource, "upsertRssSource");
async function listRssSources(request, env) {
  if (!env.DB) return json({ error: "db_binding_required" }, { status: 500 });
  const url = new URL(request.url);
  const status = text(url.searchParams.get("status"));
  const active = url.searchParams.get("active");
  const args = [];
  let where = "";
  if (status) {
    where = "WHERE status = ?";
    args.push(status);
  }
  if (active !== null) {
    where += where ? " AND active = ?" : "WHERE active = ?";
    args.push(boolInt(active));
  }
  const rows = await env.DB.prepare(`SELECT id, name, feed_url, site_url, category, vertical, tier, priority, status, active, last_test_at, last_success_at, last_error, http_status, parse_status, item_count, image_found_count, full_content_available, license_notes, rights_notes, consecutive_failures, auto_deactivate_after FROM rss_sources ${where} ORDER BY active DESC, priority DESC, name ASC LIMIT 200`).bind(...args).all();
  return json({ ok: true, sources: rows.results || [], contract: "rss-content-intelligence-admin-v1" });
}
__name(listRssSources, "listRssSources");
async function patchRssSource(request, env, sourceId) {
  const body = await readJson(request);
  if (!env.DB) return json({ error: "db_binding_required" }, { status: 500 });
  const existing = await env.DB.prepare("SELECT id FROM rss_sources WHERE id = ? LIMIT 1").bind(sourceId).first();
  if (!existing) return json({ error: "rss_source_not_found" }, { status: 404 });
  const active = body.active === void 0 ? null : boolInt(body.active);
  const status = text(body.status, active === 1 ? "active" : active === 0 ? "inactive" : null);
  await env.DB.prepare(`UPDATE rss_sources SET updated_at = ?, name = COALESCE(?, name), feed_url = COALESCE(?, feed_url), site_url = COALESCE(?, site_url), category = COALESCE(?, category), vertical = COALESCE(?, vertical), tier = COALESCE(?, tier), priority = COALESCE(?, priority), status = COALESCE(?, status), active = COALESCE(?, active), license_notes = COALESCE(?, license_notes), rights_notes = COALESCE(?, rights_notes), auto_deactivate_after = COALESCE(?, auto_deactivate_after) WHERE id = ?`).bind(now(), text(body.name), text(body.feed_url ?? body.feedUrl ?? body.url), text(body.site_url ?? body.siteUrl), text(body.category), text(body.vertical), body.tier === void 0 ? null : integer(body.tier), body.priority === void 0 ? null : integer(body.priority), status, active, text(body.license_notes ?? body.licenseNotes), text(body.rights_notes ?? body.rightsNotes), body.auto_deactivate_after === void 0 && body.autoDeactivateAfter === void 0 ? null : Math.max(integer(body.auto_deactivate_after ?? body.autoDeactivateAfter, 3), 1), sourceId).run();
  await writeRssSourceAudit(env, sourceId, "source_updated", { surface: "admin", status: status || "unchanged", active: active ?? "unchanged" });
  await logEvent(env, "rss.source.updated", { surface: "admin", source_id: sourceId, status: status || "unchanged", active: active ?? "unchanged" }, void 0, request);
  return json({ ok: true, source_id: sourceId });
}
__name(patchRssSource, "patchRssSource");
async function getRssSource(env, sourceId) {
  if (!env.DB) return null;
  return await env.DB.prepare("SELECT * FROM rss_sources WHERE id = ? OR feed_url = ? LIMIT 1").bind(sourceId, sourceId).first();
}
__name(getRssSource, "getRssSource");
async function testRssSource(request, env, sourceId) {
  if (!env.DB) return json({ error: "db_binding_required" }, { status: 500 });
  const source = await getRssSource(env, sourceId);
  if (!source) return json({ error: "rss_source_not_found" }, { status: 404 });
  const result = await testRssFeed(source.feed_url);
  const failures = result.ok ? 0 : (source.consecutive_failures || 0) + 1;
  const threshold = Math.max(source.auto_deactivate_after || 3, 1);
  const nextStatus = result.ok ? "active" : failures >= threshold ? "deactivated" : "inactive";
  await env.DB.prepare(`UPDATE rss_sources SET updated_at=?, last_test_at=?, last_success_at=CASE WHEN ? THEN ? ELSE last_success_at END, last_error=?, http_status=?, parse_status=?, item_count=?, image_found_count=?, full_content_available=?, consecutive_failures=?, status=?, active=? WHERE id=?`).bind(now(), now(), result.ok ? 1 : 0, now(), result.error || null, result.http_status, result.parse_status, result.item_count, result.image_found_count, result.full_content_available ? 1 : 0, failures, nextStatus, result.ok ? 1 : 0, source.id).run();
  await writeRssSourceAudit(env, source.id, result.ok ? "source_test_ok" : "source_test_failed", { surface: "admin", http_status: result.http_status, parse_status: result.parse_status, item_count: result.item_count, image_found_count: result.image_found_count, full_content_available: result.full_content_available, consecutive_failures: failures, auto_deactivate_after: threshold, status: nextStatus, last_error: result.error || null });
  await logEvent(env, result.ok ? "rss.source.test_ok" : "rss.source.test_failed", { surface: "admin", source_id: source.id, http_status: result.http_status, parse_status: result.parse_status, item_count: result.item_count, status: nextStatus }, void 0, request);
  return json({ ok: result.ok, source_id: source.id, status: nextStatus, result });
}
__name(testRssSource, "testRssSource");
async function bulkTestRssSources(request, env) {
  if (!env.DB) return json({ error: "db_binding_required" }, { status: 500 });
  const body = request.method === "POST" ? await readJson(request) : {};
  const limit = Math.min(Math.max(integer(body.limit, 10), 1), 25);
  const rows = await env.DB.prepare("SELECT id FROM rss_sources WHERE active = 1 OR status = 'active' ORDER BY priority DESC, COALESCE(last_test_at, '') ASC LIMIT ?").bind(limit).all();
  const results = [];
  for (const row of rows.results || []) {
    const response = await testRssSource(request, env, row.id);
    results.push(await response.json());
  }
  return json({ ok: true, tested: results.length, results });
}
__name(bulkTestRssSources, "bulkTestRssSources");
async function ingestRssSource(env, source, request, maxItems = 10) {
  if (!env.DB) return { ok: false, error: "db_binding_required" };
  const response = await fetch(source.feed_url, { headers: { "user-agent": "MehyarSoftBot/0.1 (+https://mehyar.us); RSS metadata only" } });
  const xml = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const items = parseFeed(xml, source.feed_url, maxItems);
  let inserted = 0;
  let updated = 0;
  const articleIds = [];
  for (const item of items) {
    const existing = await env.DB.prepare("SELECT id FROM rss_articles WHERE canonical_url = ? LIMIT 1").bind(item.canonical_url).first();
    const articleId = existing?.id || id("rss_art");
    const score = scoreRssArticle(item, source);
    await env.DB.prepare(`INSERT INTO rss_articles (id, source_id, created_at, updated_at, fetched_at, published_at, source_name, source_url, canonical_url, title, excerpt, author, image_url, image_license, license_notes, rights_notes, raw_excerpt_private, raw_content_private, full_content_available, client_acquisition_score, seo_score, use_case_fit_score, total_score, use_case_tags, status, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'private_analysis', ?)
      ON CONFLICT(canonical_url) DO UPDATE SET updated_at=excluded.updated_at, fetched_at=excluded.fetched_at, published_at=COALESCE(excluded.published_at, rss_articles.published_at), source_name=excluded.source_name, title=excluded.title, excerpt=COALESCE(excluded.excerpt, rss_articles.excerpt), author=COALESCE(excluded.author, rss_articles.author), image_url=COALESCE(excluded.image_url, rss_articles.image_url), image_license=excluded.image_license, license_notes=excluded.license_notes, rights_notes=excluded.rights_notes, raw_excerpt_private=COALESCE(excluded.raw_excerpt_private, rss_articles.raw_excerpt_private), raw_content_private=COALESCE(excluded.raw_content_private, rss_articles.raw_content_private), full_content_available=excluded.full_content_available, client_acquisition_score=excluded.client_acquisition_score, seo_score=excluded.seo_score, use_case_fit_score=excluded.use_case_fit_score, total_score=excluded.total_score, use_case_tags=excluded.use_case_tags, metadata_json=excluded.metadata_json`).bind(articleId, source.id, now(), now(), now(), item.published_at, source.name, item.source_url, item.canonical_url, item.title, item.excerpt, item.author, item.image_url, source.rights_notes || "Do not reuse source image without explicit license.", source.license_notes || null, source.rights_notes || "Private analysis only; no public full-article republication.", item.raw_excerpt_private, item.raw_content_private, item.full_content_available, score.client, score.seo, score.use_case, score.total, jsonString(score.tags), jsonString({ source_category: source.category, source_vertical: source.vertical, copyright_policy: "metadata_and_excerpt_private_only" })).run();
    existing ? updated++ : inserted++;
    articleIds.push(articleId);
  }
  await env.DB.prepare("UPDATE rss_sources SET updated_at=?, last_success_at=?, last_error=NULL, http_status=?, parse_status='ok', item_count=?, image_found_count=?, full_content_available=?, consecutive_failures=0, status='active', active=1 WHERE id=?").bind(now(), now(), response.status, items.length, items.filter((item) => item.image_url).length, items.some((item) => item.full_content_available === 1) ? 1 : 0, source.id).run();
  await logEvent(env, "rss.ingest", { surface: request ? "admin" : "scheduled", source_id: source.id, inserted, updated, count: items.length, article_ids: articleIds.slice(0, 20) }, void 0, request);
  return { source_id: source.id, source_name: source.name, fetched: items.length, inserted, updated, article_ids: articleIds };
}
__name(ingestRssSource, "ingestRssSource");
async function ingestRss(request, env) {
  if (!env.DB) return json({ error: "db_binding_required" }, { status: 500 });
  const body = await readJson(request);
  const limit = Math.min(Math.max(integer(body.limit, 5), 1), 25);
  const maxItems = Math.min(Math.max(integer(body.max_items ?? body.maxItems, 10), 1), 25);
  const sourceId = text(body.source_id ?? body.sourceId);
  const rows = sourceId ? { results: [await getRssSource(env, sourceId)].filter(Boolean) } : await env.DB.prepare("SELECT * FROM rss_sources WHERE active = 1 AND status = 'active' ORDER BY priority DESC, COALESCE(last_success_at, '') ASC LIMIT ?").bind(limit).all();
  const results = [];
  for (const source of rows.results || []) {
    try {
      results.push(await ingestRssSource(env, source, request, maxItems));
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 300) : "ingest_failed";
      await env.DB.prepare("UPDATE rss_sources SET updated_at=?, last_test_at=?, last_error=?, consecutive_failures=consecutive_failures+1, status=CASE WHEN consecutive_failures + 1 >= auto_deactivate_after THEN 'deactivated' ELSE 'inactive' END, active=0 WHERE id=?").bind(now(), now(), message, source.id).run();
      await logEvent(env, "rss.ingest.error", { surface: "admin", source_id: source.id, message }, void 0, request);
      results.push({ source_id: source.id, ok: false, error: message });
    }
  }
  return json({ ok: true, processed_sources: results.length, results, copyright_policy: "Admin/private metadata and excerpts only; no public full-article republishing by default." });
}
__name(ingestRss, "ingestRss");
async function listRssArticles(request, env) {
  if (!env.DB) return json({ error: "db_binding_required" }, { status: 500 });
  const url = new URL(request.url);
  const limit = Math.min(Math.max(integer(url.searchParams.get("limit"), 25), 1), 100);
  const offset = Math.max(integer(url.searchParams.get("offset"), 0), 0);
  const q = text(url.searchParams.get("q"));
  const args = [];
  let where = "";
  if (q) {
    where = "WHERE title LIKE ? OR excerpt LIKE ? OR source_name LIKE ?";
    args.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const rows = await env.DB.prepare(`SELECT id, source_id, fetched_at, published_at, source_name, source_url, canonical_url, title, excerpt, author, image_url, image_license, license_notes, rights_notes, full_content_available, client_acquisition_score, seo_score, use_case_fit_score, total_score, use_case_tags, status FROM rss_articles ${where} ORDER BY total_score DESC, COALESCE(published_at, fetched_at) DESC LIMIT ? OFFSET ?`).bind(...args, limit, offset).all();
  await logEvent(env, "rss.articles.viewed", { surface: "admin", limit, offset, q: q ? "present-redacted" : null }, void 0, request);
  return json({ ok: true, articles: rows.results || [], contract: "rss-content-intelligence-admin-v1", public_republishing: false });
}
__name(listRssArticles, "listRssArticles");
async function getRssArticle(request, env, articleId) {
  if (!env.DB) return json({ error: "db_binding_required" }, { status: 500 });
  const row = await env.DB.prepare("SELECT * FROM rss_articles WHERE id = ? LIMIT 1").bind(articleId).first();
  if (!row) return json({ error: "rss_article_not_found" }, { status: 404 });
  await logEvent(env, "rss.article.viewed", { surface: "admin", article_id: articleId }, void 0, request);
  return json({ ok: true, article: row, warning: "Admin-only private view. Do not republish source full text or images without explicit license." });
}
__name(getRssArticle, "getRssArticle");
async function scheduledRssIngest(env) {
  if (!env.DB) return;
  const cadenceMs = 6 * 60 * 60 * 1e3;
  if (env.KV) {
    const last = await env.KV.get("rss:last_scheduled_ingest_at");
    if (last && Date.now() - Date.parse(last) < cadenceMs) return;
    await env.KV.put("rss:last_scheduled_ingest_at", now());
  }
  const rows = await env.DB.prepare("SELECT * FROM rss_sources WHERE active = 1 AND status = 'active' ORDER BY priority DESC, COALESCE(last_success_at, '') ASC LIMIT 5").all();
  for (const source of rows.results || []) {
    try {
      await ingestRssSource(env, source, void 0, 10);
    } catch (error) {
      await logEvent(env, "rss.scheduled_ingest.error", { surface: "scheduled", source_id: source.id, message: error instanceof Error ? error.message.slice(0, 240) : "ingest_failed" });
    }
  }
}
__name(scheduledRssIngest, "scheduledRssIngest");
async function writeRssSourceAudit(env, sourceId, action, payload) {
  if (!env.DB) return;
  await env.DB.prepare("INSERT INTO rss_source_audit (id, created_at, source_id, action, actor, payload_json) VALUES (?, ?, ?, ?, ?, ?)").bind(id("rss_aud"), now(), sourceId, action, text(payload.actor, "admin") || "admin", jsonString(safeStoragePayload(payload))).run();
}
__name(writeRssSourceAudit, "writeRssSourceAudit");
async function setExistingRssSourceStatus(request, env, sourceId, status, action) {
  if (!env.DB) return json({ error: "db_binding_required" }, { status: 500 });
  const source = await getRssSource(env, sourceId);
  if (!source) return json({ error: "rss_source_not_found" }, { status: 404 });
  const active = status === "active" ? 1 : 0;
  await env.DB.prepare("UPDATE rss_sources SET updated_at = ?, status = ?, active = ?, consecutive_failures = CASE WHEN ? = 1 THEN 0 ELSE consecutive_failures END WHERE id = ?").bind(now(), status, active, active, source.id).run();
  await writeRssSourceAudit(env, source.id, action, { surface: "admin", status, active });
  await logEvent(env, `rss.${action}`, { surface: "admin", source_id: source.id, status, active }, void 0, request);
  return json({ ok: true, source: await getRssSource(env, source.id), copyright_policy: "Private analysis/excerpts only; no public full-article republication without explicit rights." });
}
__name(setExistingRssSourceStatus, "setExistingRssSourceStatus");
async function rssHealth(env) {
  if (!env.DB) return json({ error: "db_binding_required" }, { status: 500 });
  const byStatus = await env.DB.prepare("SELECT status, active, COUNT(*) AS count FROM rss_sources GROUP BY status, active ORDER BY count DESC").all();
  const eligible = await env.DB.prepare("SELECT COUNT(*) AS count FROM rss_sources WHERE active = 1 AND status = 'active' AND parse_status = 'ok' AND COALESCE(item_count, 0) > 0").first();
  const failing = await env.DB.prepare("SELECT id, name, feed_url, status, active, last_test_at, last_error, http_status, parse_status, consecutive_failures, auto_deactivate_after FROM rss_sources WHERE consecutive_failures > 0 OR status = 'deactivated' OR last_error IS NOT NULL ORDER BY consecutive_failures DESC, last_test_at DESC LIMIT 25").all();
  const stale = await env.DB.prepare("SELECT id, name, feed_url, status, active, priority, last_test_at FROM rss_sources WHERE last_test_at IS NULL OR last_test_at < datetime('now','-24 hours') ORDER BY priority DESC, COALESCE(last_test_at, '') ASC LIMIT 25").all();
  return json({ ok: true, by_status: byStatus.results || [], ingest_eligible_count: eligible?.count || 0, failing: failing.results || [], stale: stale.results || [], scheduled_check: "Cloudflare cron calls scheduled RSS ingest/health cadence; failing sources auto-mark inactive/deactivated by threshold.", copyright_policy: "Full-content feeds are private analysis signals only, not republication permission; public outputs must use original summaries/excerpts and attribution." });
}
__name(rssHealth, "rssHealth");
async function rssSourceAudit(env, sourceId) {
  if (!env.DB) return json({ error: "db_binding_required" }, { status: 500 });
  const source = await getRssSource(env, sourceId);
  if (!source) return json({ error: "rss_source_not_found" }, { status: 404 });
  const audit = await env.DB.prepare("SELECT id, created_at, action, actor, payload_json FROM rss_source_audit WHERE source_id = ? ORDER BY created_at DESC LIMIT 50").bind(source.id).all();
  const events = await env.DB.prepare("SELECT id, created_at, type, actor, surface, payload_json FROM events WHERE type LIKE 'rss.%' AND payload_json LIKE ? ORDER BY created_at DESC LIMIT 50").bind(`%${source.id}%`).all();
  return json({ ok: true, source_id: source.id, audit: audit.results || [], events: events.results || [] });
}
__name(rssSourceAudit, "rssSourceAudit");
async function requireAdmin(request, env) {
  const serviceToken = request.headers.get("x-mehyarsoft-service-token") || "";
  if (serviceToken && env.MEHYARSOFT_SERVICE_TOKEN && safeSecretEqual(serviceToken, env.MEHYARSOFT_SERVICE_TOKEN)) return null;
  const auth = request.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (env.KV && token) {
    const ok = await env.KV.get(`session:${token}`);
    if (ok) return null;
  }
  return json({ error: "admin_auth_required" }, { status: 401 });
}
__name(requireAdmin, "requireAdmin");
function safeSecretEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length || a.length < 32) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}
__name(safeSecretEqual, "safeSecretEqual");
async function createJob(env, body, status = "queued") {
  if (!env.DB) return null;
  const jobId = id("job");
  const ts = now();
  await env.DB.prepare(`INSERT INTO jobs (id, created_at, updated_at, type, status, priority, lead_id, prospect_id, campaign_id, input_json, queued_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(jobId, ts, ts, text(body.type, "general"), status, integer(body.priority), text(body.lead_id ?? body.leadId), text(body.prospect_id ?? body.prospectId), text(body.campaign_id ?? body.campaignId), jsonString(safeStorageMetadata(body)), ts).run();
  return jobId;
}
__name(createJob, "createJob");
async function queueJob(env, payload) {
  const jobId = await createJob(env, payload);
  const queuePayload = { ...payload, job_id: jobId };
  if (env.JOBS) await env.JOBS.send(queuePayload);
  await logEvent(env, "job.queued", queuePayload, text(payload.leadId ?? payload.lead_id) || void 0);
  return jobId;
}
__name(queueJob, "queueJob");
async function storeGeneratedReport(env, reportType, body, output) {
  if (!env.DB) return null;
  const reportId = id("rpt");
  await env.DB.prepare(`INSERT INTO generated_reports_metadata (id, created_at, report_type, lead_id, prospect_id, job_id, title, storage_key, status, summary, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(reportId, now(), reportType, text(body.lead_id ?? body.leadId), text(body.prospect_id ?? body.prospectId), text(body.job_id ?? body.jobId), text(body.title, reportType), text(body.storage_key ?? body.storageKey), "generated", output.slice(0, 1e3), jsonString({ input_keys: Object.keys(body) })).run();
  return reportId;
}
__name(storeGeneratedReport, "storeGeneratedReport");
var ZOHO_KV_PREFIX = "zoho:mail:";
var ZOHO_OAUTH_SCOPES = [
  "ZohoMail.accounts.READ",
  "ZohoMail.folders.READ",
  "ZohoMail.messages.READ",
  "ZohoMail.messages.CREATE",
  "ZohoCalendar.settings.READ",
  "ZohoCalendar.calendar.READ",
  "ZohoCalendar.freebusy.READ",
  "ZohoCalendar.event.READ",
  "ZohoCalendar.event.CREATE"
];
function html(message, status = 200) {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MehyarSoft Zoho OAuth</title><style>body{font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#061f2a;color:#eefcff;display:grid;place-items:center;min-height:100vh;margin:0}.card{max-width:680px;background:#0a3444;border:1px solid #1b6076;border-radius:24px;padding:32px;box-shadow:0 24px 80px #0008}h1{margin:0 0 12px;font-size:28px}p{line-height:1.55;color:#c8eaf2}.ok{color:#8ef0c8}.bad{color:#ffb4b4}</style></head><body><main class="card">${message}</main></body></html>`, { status, headers: { "content-type": "text/html; charset=utf-8", ...corsHeaders } });
}
__name(html, "html");
function zohoAccountsBase(env, override) {
  return (override || env.MEHYARSOFT_ZOHO_ACCOUNTS_BASE || "https://accounts.zoho.com").replace(/\/$/, "");
}
__name(zohoAccountsBase, "zohoAccountsBase");
function zohoMailApiBase(env) {
  return (env.MEHYARSOFT_ZOHO_MAIL_API_BASE || "https://mail.zoho.com/api").replace(/\/$/, "");
}
__name(zohoMailApiBase, "zohoMailApiBase");
function zohoCalendarApiBase(env) {
  return (env.MEHYARSOFT_ZOHO_CALENDAR_API_BASE || "https://calendar.zoho.com/api/v1").replace(/\/$/, "");
}
__name(zohoCalendarApiBase, "zohoCalendarApiBase");
function zohoTokenUrl(env, override) {
  return `${zohoAccountsBase(env, override)}/oauth/v2/token`;
}
__name(zohoTokenUrl, "zohoTokenUrl");
function requireZohoConfig(env) {
  if (!env.KV) return json({ error: "kv_binding_required" }, { status: 500 });
  const missing = [
    "MEHYARSOFT_ZOHO_CLIENT_ID",
    "MEHYARSOFT_ZOHO_CLIENT_SECRET",
    "MEHYARSOFT_ZOHO_AUTHORIZED_REDIRECT_URI",
    "MEHYARSOFT_ZOHO_CONTACT_EMAIL"
  ].filter((key) => !env[key]);
  if (missing.length) return json({ error: "zoho_config_missing", missing }, { status: 500 });
  return null;
}
__name(requireZohoConfig, "requireZohoConfig");
async function zohoStoreToken(env, token, accountsServer) {
  if (!env.KV) throw new Error("KV binding is required for Zoho token storage");
  if (token.refresh_token) await env.KV.put(`${ZOHO_KV_PREFIX}refresh_token`, token.refresh_token);
  if (token.access_token) {
    const ttl = Math.max(60, Math.min(3600, integer(token.expires_in, 3600) - 60));
    await env.KV.put(`${ZOHO_KV_PREFIX}access_token`, token.access_token, { expirationTtl: ttl });
  }
  if (token.api_domain) await env.KV.put(`${ZOHO_KV_PREFIX}api_domain`, token.api_domain);
  if (accountsServer) await env.KV.put(`${ZOHO_KV_PREFIX}accounts_server`, accountsServer);
  await env.KV.put(`${ZOHO_KV_PREFIX}connected_at`, now());
}
__name(zohoStoreToken, "zohoStoreToken");
async function zohoRefreshAccessToken(env) {
  const configError = requireZohoConfig(env);
  if (configError) throw new Error("Zoho is not configured");
  const cached = await env.KV.get(`${ZOHO_KV_PREFIX}access_token`);
  if (cached) return cached;
  const refreshToken = await env.KV.get(`${ZOHO_KV_PREFIX}refresh_token`);
  if (!refreshToken) throw new Error("Zoho refresh token is missing; complete browser OAuth first");
  const accountsServer = await env.KV.get(`${ZOHO_KV_PREFIX}accounts_server`);
  const form = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: env.MEHYARSOFT_ZOHO_CLIENT_ID,
    client_secret: env.MEHYARSOFT_ZOHO_CLIENT_SECRET,
    grant_type: "refresh_token"
  });
  const response = await fetch(zohoTokenUrl(env, accountsServer), { method: "POST", body: form });
  const token = await response.json();
  if (!response.ok || token.error || !token.access_token) throw new Error(`Zoho token refresh failed: ${token.error || response.status}`);
  await zohoStoreToken(env, token, accountsServer);
  return token.access_token;
}
__name(zohoRefreshAccessToken, "zohoRefreshAccessToken");
async function zohoFetch(env, path, init = {}) {
  const accessToken = await zohoRefreshAccessToken(env);
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Zoho-oauthtoken ${accessToken}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json; charset=utf-8");
  return fetch(`${zohoMailApiBase(env)}${path}`, { ...init, headers });
}
__name(zohoFetch, "zohoFetch");
async function zohoCalendarFetch(env, path, init = {}) {
  const accessToken = await zohoRefreshAccessToken(env);
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Zoho-oauthtoken ${accessToken}`);
  return fetch(`${zohoCalendarApiBase(env)}${path}`, { ...init, headers });
}
__name(zohoCalendarFetch, "zohoCalendarFetch");

var BOOKING_TIMEZONE = "America/New_York";
var BOOKING_SLOT_MINUTES = 30;
var BOOKING_BUFFER_MINUTES = 15;
var BOOKING_MIN_NOTICE_HOURS = 24;
var BOOKING_HORIZON_DAYS = 30;
var BOOKING_DAY_START_HOUR = 9;
var BOOKING_DAY_END_HOUR = 17;

function calendarDateParts(date, timeZone = BOOKING_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
}
__name(calendarDateParts, "calendarDateParts");
function zonedDateToUtc(year, month, day, hour, minute, timeZone = BOOKING_TIMEZONE) {
  const wanted = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guess = wanted;
  for (let i = 0; i < 3; i += 1) {
    const actual = calendarDateParts(new Date(guess), timeZone);
    const represented = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second || 0);
    guess += wanted - represented;
  }
  return new Date(guess);
}
__name(zonedDateToUtc, "zonedDateToUtc");
function basicZohoDate(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}
__name(basicZohoDate, "basicZohoDate");
function parseZohoDate(value) {
  const raw = text(value, "") || "";
  const match = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z|[+-]\d{4})?$/);
  if (!match) {
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? new Date(parsed) : null;
  }
  const suffix = match[7] || "Z";
  const iso = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}${suffix === "Z" ? "Z" : `${suffix.slice(0, 3)}:${suffix.slice(3)}`}`;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? new Date(parsed) : null;
}
__name(parseZohoDate, "parseZohoDate");
function isBookingWeekday(parts) {
  const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  return weekday >= 1 && weekday <= 5;
}
__name(isBookingWeekday, "isBookingWeekday");
function slotLabel(date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: BOOKING_TIMEZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(date);
}
__name(slotLabel, "slotLabel");
async function zohoBusyRanges(env, start, end) {
  const ownerEmail = lowerEmail(env.MEHYARSOFT_ZOHO_CONTACT_EMAIL || "info@mehyar.us");
  const params = new URLSearchParams({
    uemail: ownerEmail,
    sdate: basicZohoDate(start).replace(/Z$/, ""),
    edate: basicZohoDate(end).replace(/Z$/, ""),
    ftype: "eventbased"
  });
  const response = await zohoCalendarFetch(env, `/calendars/freebusy?${params.toString()}`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) {
    const providerText = typeof payload.error === "string" ? payload.error : typeof payload.message === "string" ? payload.message : "authorization_or_scope_error";
    const error = new Error(`Zoho Calendar authorization needs to be refreshed (${response.status}: ${providerText})`);
    error.status = response.status;
    error.oauthRequired = response.status === 401 || response.status === 403 || /scope|oauth|authorization/i.test(JSON.stringify(payload));
    throw error;
  }
  return (Array.isArray(payload.freebusy) ? payload.freebusy : []).map((item) => ({
    start: parseZohoDate(item.startTime || item.start || item.start_time),
    end: parseZohoDate(item.endTime || item.end || item.end_time),
    type: item.fbtype || "busy"
  })).filter((item) => item.start && item.end && item.type !== "free");
}
__name(zohoBusyRanges, "zohoBusyRanges");
async function calendarAvailability(request, env) {
  try {
    const url = new URL(request.url);
    const requestedDays = Math.max(1, Math.min(integer(url.searchParams.get("days"), 14), BOOKING_HORIZON_DAYS));
    const nowDate = /* @__PURE__ */ new Date();
    const rangeStart = new Date(nowDate.getTime() + BOOKING_MIN_NOTICE_HOURS * 36e5);
    const rangeEnd = new Date(nowDate.getTime() + requestedDays * 864e5);
    const busy = await zohoBusyRanges(env, rangeStart, rangeEnd);
    const slots = [];
    const startParts = calendarDateParts(rangeStart);
    for (let offset = 0; offset <= requestedDays && slots.length < 80; offset += 1) {
      const dayCursor = new Date(Date.UTC(startParts.year, startParts.month - 1, startParts.day + offset, 12));
      const dayParts = calendarDateParts(dayCursor, "UTC");
      if (!isBookingWeekday(dayParts)) continue;
      for (let hour = BOOKING_DAY_START_HOUR; hour < BOOKING_DAY_END_HOUR; hour += 1) {
        const start = zonedDateToUtc(dayParts.year, dayParts.month, dayParts.day, hour, 0);
        const end = new Date(start.getTime() + BOOKING_SLOT_MINUTES * 6e4);
        const bufferedEnd = new Date(end.getTime() + BOOKING_BUFFER_MINUTES * 6e4);
        if (start < rangeStart || end > rangeEnd) continue;
        const overlaps = busy.some((period) => start < new Date(period.end.getTime() + BOOKING_BUFFER_MINUTES * 6e4) && bufferedEnd > period.start);
        if (!overlaps) slots.push({
          start: start.toISOString(),
          end: end.toISOString(),
          label: slotLabel(start),
          date: new Intl.DateTimeFormat("en-CA", { timeZone: BOOKING_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(start),
          timezone: BOOKING_TIMEZONE
        });
      }
    }
    return json({
      ok: true,
      source: "zoho_calendar",
      timezone: BOOKING_TIMEZONE,
      duration_minutes: BOOKING_SLOT_MINUTES,
      buffer_minutes: BOOKING_BUFFER_MINUTES,
      min_notice_hours: BOOKING_MIN_NOTICE_HOURS,
      work_hours: "Monday-Friday, 9:00 AM-5:00 PM Eastern",
      slots
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Zoho Calendar availability failed";
    return json({ error: "zoho_calendar_unavailable", message, oauth_required: error?.oauthRequired === true || /scope|oauth|token|401|403/i.test(message) }, { status: 503 });
  }
}
__name(calendarAvailability, "calendarAvailability");
async function defaultZohoCalendar(env) {
  const response = await zohoCalendarFetch(env, "/calendars/default");
  const payload = await response.json().catch(() => ({}));
  const calendars = Array.isArray(payload.calendars) ? payload.calendars : [];
  const calendar = calendars[0];
  if (!response.ok || !calendar?.uid) throw new Error(`Zoho default calendar lookup failed: ${payload.error || payload.message || response.status}`);
  return calendar;
}
__name(defaultZohoCalendar, "defaultZohoCalendar");
function escapeCalendarHtml(value) {
  return (text(value, "") || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
__name(escapeCalendarHtml, "escapeCalendarHtml");
async function createCalendarBooking(request, env) {
  const body = await readJson(request);
  const bookingId = text(body.booking_id ?? body.bookingId, "") || id("booking");
  const clientEmail = lowerEmail(body.email);
  const clientName = text(body.name, "") || "Client";
  const phone = text(body.phone, "") || "Not provided";
  const businessName = text(body.business_name ?? body.company, "") || "Not provided";
  const service = text(body.service_interest ?? body.service, "Consulting call") || "Consulting call";
  const notes = text(body.message ?? body.notes, "") || "No additional notes";
  const start = new Date(text(body.start, ""));
  if (!clientEmail || !Number.isFinite(start.getTime())) return json({ error: "valid_email_and_start_required" }, { status: 400 });
  const minimum = Date.now() + BOOKING_MIN_NOTICE_HOURS * 36e5;
  const maximum = Date.now() + BOOKING_HORIZON_DAYS * 864e5;
  if (start.getTime() < minimum || start.getTime() > maximum) return json({ error: "slot_outside_booking_window" }, { status: 409 });
  const parts = calendarDateParts(start);
  if (!isBookingWeekday(parts) || parts.hour < BOOKING_DAY_START_HOUR || parts.hour >= BOOKING_DAY_END_HOUR || parts.minute !== 0) {
    return json({ error: "slot_outside_work_hours" }, { status: 409 });
  }
  const end = new Date(start.getTime() + BOOKING_SLOT_MINUTES * 6e4);
  const existing = env.KV ? await env.KV.get(`zoho:calendar:booking:${bookingId}`) : null;
  if (existing) return json({ ok: true, idempotent: true, booking_id: bookingId, event: JSON.parse(existing) });
  const busy = await zohoBusyRanges(env, start, new Date(end.getTime() + BOOKING_BUFFER_MINUTES * 6e4));
  if (busy.some((period) => start < new Date(period.end.getTime() + BOOKING_BUFFER_MINUTES * 6e4) && new Date(end.getTime() + BOOKING_BUFFER_MINUTES * 6e4) > period.start)) {
    return json({ error: "slot_no_longer_available" }, { status: 409 });
  }
  try {
    const calendar = await defaultZohoCalendar(env);
    const eventData = {
      title: `MehyarSoft phone call - ${clientName}`,
      dateandtime: { timezone: BOOKING_TIMEZONE, start: basicZohoDate(start), end: basicZohoDate(end) },
      isallday: false,
      isprivate: true,
      attendees: [{ email: clientEmail, status: "NEEDS-ACTION" }],
      reminders: [{ action: "email", minutes: -60 }],
      richtext_description: `<p><strong>Booked through mehyar.us</strong></p><p>Business: ${escapeCalendarHtml(businessName)}<br>Phone: ${escapeCalendarHtml(phone)}<br>Service: ${escapeCalendarHtml(service)}<br>Notes: ${escapeCalendarHtml(notes)}<br>Booking ID: ${escapeCalendarHtml(bookingId)}</p>`
    };
    const params = new URLSearchParams({ eventdata: JSON.stringify(eventData) });
    const response = await zohoCalendarFetch(env, `/calendars/${encodeURIComponent(calendar.uid)}/events?${params.toString()}`, { method: "POST" });
    const payload = await response.json().catch(() => ({}));
    const event = Array.isArray(payload.events) ? payload.events[0] : null;
    if (!response.ok || !event) return json({ error: "zoho_event_create_failed", status: response.status, provider: summarizeProviderPayload(payload) }, { status: 502 });
    const result = {
      event_id: text(event.id ?? event.uid),
      calendar_uid: text(event.caluid, calendar.uid),
      start: start.toISOString(),
      end: end.toISOString(),
      timezone: BOOKING_TIMEZONE,
      view_url: text(event.viewEventURL),
      meeting_url: text(event.conference_data?.meetingdata?.meeting_link ?? event.app_data?.meetingdata?.meetinglink)
    };
    if (env.KV) await env.KV.put(`zoho:calendar:booking:${bookingId}`, JSON.stringify(result), { expirationTtl: 90 * 86400 });
    await logEvent(env, "calendar.booking.created", { surface: "public_booking", booking_id: bookingId, event_id: result.event_id, start: result.start, attendee: "redacted" }, void 0, request);
    return json({ ok: true, booking_id: bookingId, event: result });
  } catch (error) {
    return json({ error: "zoho_calendar_booking_failed", message: error instanceof Error ? error.message : "Calendar booking failed" }, { status: 502 });
  }
}
__name(createCalendarBooking, "createCalendarBooking");
async function calendarStatus(env) {
  const refreshTokenPresent = !!(env.KV && await env.KV.get(`${ZOHO_KV_PREFIX}refresh_token`));
  if (!refreshTokenPresent) return json({ ok: false, configured: true, connected: false, oauth_required: true, scopes: ZOHO_OAUTH_SCOPES });
  try {
    const [settingsResponse, calendar] = await Promise.all([zohoCalendarFetch(env, "/settings"), defaultZohoCalendar(env)]);
    const settingsPayload = await settingsResponse.json().catch(() => ({}));
    if (!settingsResponse.ok) throw new Error(`Zoho Calendar scope check failed: ${settingsPayload.error || settingsPayload.message || settingsResponse.status}`);
    return json({ ok: true, configured: true, connected: true, contact_email: env.MEHYARSOFT_ZOHO_CONTACT_EMAIL, calendar: { uid: calendar.uid, name: calendar.name, timezone: calendar.timezone }, booking_timezone: BOOKING_TIMEZONE, scopes: ZOHO_OAUTH_SCOPES });
  } catch (error) {
    return json({ ok: false, configured: true, connected: false, oauth_required: true, message: error instanceof Error ? error.message : "Zoho Calendar authorization required", scopes: ZOHO_OAUTH_SCOPES }, { status: 409 });
  }
}
__name(calendarStatus, "calendarStatus");
function zohoAccountId(account) {
  const raw = account.accountId ?? account.account_id ?? account.id;
  return raw === void 0 || raw === null ? null : String(raw);
}
__name(zohoAccountId, "zohoAccountId");
function zohoAccountEmails(account) {
  const raw = [account.primaryEmailAddress, account.emailAddress, account.mailBoxAddress, account.email].filter((value) => typeof value === "string").map((value) => value.toLowerCase());
  return [...new Set(raw)];
}
__name(zohoAccountEmails, "zohoAccountEmails");
async function getZohoAccount(env) {
  if (!env.KV) throw new Error("KV binding is required for Zoho account lookup");
  const cachedId = await env.KV.get(`${ZOHO_KV_PREFIX}account_id`);
  if (cachedId) return { account: { accountId: cachedId }, account_id: cachedId, source: "cache" };
  const response = await zohoFetch(env, "/accounts");
  const payload = await response.json();
  if (!response.ok) throw new Error(`Zoho account lookup failed: ${response.status}`);
  const accounts = Array.isArray(payload.data) ? payload.data : [];
  const wanted = (env.MEHYARSOFT_ZOHO_CONTACT_EMAIL || "").toLowerCase();
  const selected = accounts.find((account) => zohoAccountEmails(account).includes(wanted)) || accounts[0];
  const accountId = selected ? zohoAccountId(selected) : null;
  if (!selected || !accountId) throw new Error("No Zoho Mail account id returned for configured contact mailbox");
  await env.KV.put(`${ZOHO_KV_PREFIX}account_id`, accountId);
  return { account: selected, account_id: accountId, source: "api" };
}
__name(getZohoAccount, "getZohoAccount");
function summarizeProviderPayload(payload, debug = false) {
  if (debug) return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : { payload };
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return void 0;
  const record = payload;
  const summary = {};
  for (const key of ["error", "code", "status", "message", "error_description"]) {
    const value = text(record[key]);
    if (value) summary[key] = value.slice(0, 240);
  }
  return Object.keys(summary).length ? summary : { keys: Object.keys(record).slice(0, 20) };
}
__name(summarizeProviderPayload, "summarizeProviderPayload");
function safeZohoError(error) {
  const message = error instanceof Error ? error.message : "Zoho Mail operation failed";
  return json({ error: "zoho_mail_error", message }, { status: 502 });
}
__name(safeZohoError, "safeZohoError");
function lowerEmail(value) {
  const raw = text(value);
  if (!raw) return null;
  const match = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].toLowerCase() : raw.toLowerCase();
}
__name(lowerEmail, "lowerEmail");
function stripHtml(input) {
  return input.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/\s+/g, " ").trim();
}
__name(stripHtml, "stripHtml");
function sanitizeMailBody(value, max = 12e3) {
  const raw = text(value);
  if (!raw) return null;
  return stripHtml(raw).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "").slice(0, max);
}
__name(sanitizeMailBody, "sanitizeMailBody");
function firstText(record, keys, fallback = null) {
  for (const key of keys) {
    const value = text(record[key]);
    if (value) return value;
  }
  return fallback;
}
__name(firstText, "firstText");
function textList(value, fallback = []) {
  if (Array.isArray(value)) return value.map((item) => text(item)).filter((item) => !!item).slice(0, 20);
  const raw = text(value);
  if (!raw) return fallback;
  return raw.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 20);
}
__name(textList, "textList");
function newsletterLeadWhere(alias = "leads") {
  const p = alias ? `${alias}.` : "";
  return `${p}consent = 1 AND (lower(COALESCE(${p}source, '')) LIKE '%newsletter%' OR lower(COALESCE(${p}source, '')) LIKE '%subscriber%' OR lower(COALESCE(${p}service_interest, '')) LIKE '%newsletter%' OR lower(COALESCE(${p}metadata_json, '')) LIKE '%newsletter%')`;
}
__name(newsletterLeadWhere, "newsletterLeadWhere");
function csvSafe(value) {
  const raw = text(value, "") || "";
  const clean = raw.replace(/[\r\n]+/g, " ").slice(0, 1e3);
  const guarded = /^[=+\-@\t]/.test(clean) ? `'${clean}` : clean;
  return `"${guarded.replace(/"/g, '""')}"`;
}
__name(csvSafe, "csvSafe");
function zohoMessageId(record) {
  return firstText(record, ["messageId", "message_id", "mailId", "mail_id", "id"]);
}
__name(zohoMessageId, "zohoMessageId");
function messageReceivedAt(record) {
  const raw = firstText(record, ["receivedTime", "received_time", "receivedDate", "received_date", "sentDateInGMT", "sentDate", "date"]);
  if (!raw) return null;
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 0) return new Date(numeric > 1e10 ? numeric : numeric * 1e3).toISOString();
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : raw;
}
__name(messageReceivedAt, "messageReceivedAt");
function normalizeZohoMessage(record, folderId) {
  const messageId = zohoMessageId(record);
  if (!messageId) return null;
  const fromEmail = lowerEmail(record.fromAddress ?? record.sender ?? record.from ?? record.from_email);
  const toEmail = lowerEmail(record.toAddress ?? record.recipient ?? record.to ?? record.to_email);
  const body = sanitizeMailBody(record.content ?? record.body ?? record.summary ?? record.message ?? record.snippet);
  const snippet = sanitizeMailBody(record.summary ?? record.snippet ?? record.subject ?? body, 500);
  return {
    id: `mail_${messageId}`.replace(/[^a-zA-Z0-9_-]/g, "_"),
    zoho_message_id: messageId,
    thread_id: firstText(record, ["threadId", "thread_id", "conversationId", "conversation_id", "parentMessageId"]),
    folder_id: folderId || firstText(record, ["folderId", "folder_id"]),
    from_email: fromEmail,
    from_name: firstText(record, ["sender", "fromName", "from_name", "displayName"]),
    to_email: toEmail,
    subject: firstText(record, ["subject"], "(no subject)"),
    snippet,
    body_text: body,
    received_at: messageReceivedAt(record) || now(),
    is_read: boolInt(record.isRead ?? record.read ?? record.status === "read"),
    metadata_json: jsonString({ zoho_keys: Object.keys(record).slice(0, 50) })
  };
}
__name(normalizeZohoMessage, "normalizeZohoMessage");
async function matchMailLead(env, email) {
  if (!env.DB || !email) return { lead_id: null, prospect_id: null };
  const normalized = email.toLowerCase();
  const lead = await env.DB.prepare("SELECT id FROM leads WHERE lower(email) = ? ORDER BY created_at DESC LIMIT 1").bind(normalized).first();
  const prospect = lead ? null : await env.DB.prepare("SELECT id FROM prospects WHERE lower(email) = ? ORDER BY created_at DESC LIMIT 1").bind(normalized).first();
  return { lead_id: lead?.id || null, prospect_id: prospect?.id || null };
}
__name(matchMailLead, "matchMailLead");
async function upsertMailMessage(env, message) {
  if (!env.DB) return "skipped";
  const ts = now();
  const match = await matchMailLead(env, message.from_email || null);
  const existing = await env.DB.prepare("SELECT id FROM mail_messages WHERE zoho_message_id = ? LIMIT 1").bind(message.zoho_message_id).first();
  await env.DB.prepare(`INSERT INTO mail_messages (id, zoho_message_id, thread_id, folder_id, direction, from_email, from_name, to_email, subject, snippet, body_text, received_at, is_read, lead_id, prospect_id, metadata_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'inbound', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(zoho_message_id) DO UPDATE SET thread_id=excluded.thread_id, folder_id=excluded.folder_id, from_email=excluded.from_email, from_name=excluded.from_name, to_email=excluded.to_email, subject=excluded.subject, snippet=excluded.snippet, body_text=COALESCE(excluded.body_text, mail_messages.body_text), received_at=excluded.received_at, is_read=excluded.is_read, lead_id=COALESCE(excluded.lead_id, mail_messages.lead_id), prospect_id=COALESCE(excluded.prospect_id, mail_messages.prospect_id), metadata_json=excluded.metadata_json, updated_at=excluded.updated_at`).bind(message.id, message.zoho_message_id, message.thread_id || null, message.folder_id || null, message.from_email || null, message.from_name || null, message.to_email || null, message.subject || null, message.snippet || null, message.body_text || null, message.received_at || ts, message.is_read ?? 0, match.lead_id, match.prospect_id, message.metadata_json || "{}", ts, ts).run();
  return existing ? "updated" : "inserted";
}
__name(upsertMailMessage, "upsertMailMessage");
async function fetchZohoMessageContent(env, accountId, messageId) {
  const response = await zohoFetch(env, `/accounts/${encodeURIComponent(accountId)}/messages/${encodeURIComponent(messageId)}/content`);
  if (!response.ok) return null;
  const payload = await response.json();
  return sanitizeMailBody(payload.data ?? payload.content ?? payload.message ?? payload.body);
}
__name(fetchZohoMessageContent, "fetchZohoMessageContent");
async function syncZohoInbox(env, source = "manual", limit = 25) {
  if (!env.DB) return { ok: false, error: "db_binding_required" };
  const startedAt = now();
  const account = await getZohoAccount(env);
  const folderId = await getZohoInboxFolderId(env, account.account_id);
  const params = new URLSearchParams({ limit: String(Math.min(Math.max(limit, 1), 50)) });
  if (folderId) params.set("folderId", folderId);
  const response = await zohoFetch(env, `/accounts/${encodeURIComponent(account.account_id)}/messages/view?${params.toString()}`);
  const payload = await response.json();
  if (!response.ok) throw new Error(`Zoho inbox sync failed: ${response.status}`);
  const rawMessages = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.messages) ? payload.messages : [];
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const messageIds = [];
  for (const raw of rawMessages) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      skipped += 1;
      continue;
    }
    const normalized = normalizeZohoMessage(raw, folderId);
    if (!normalized) {
      skipped += 1;
      continue;
    }
    if (!normalized.body_text) normalized.body_text = await fetchZohoMessageContent(env, account.account_id, normalized.zoho_message_id);
    const result = await upsertMailMessage(env, normalized);
    if (result === "inserted") inserted += 1;
    else if (result === "updated") updated += 1;
    else skipped += 1;
    messageIds.push(normalized.zoho_message_id);
  }
  if (env.KV) await env.KV.put(`${ZOHO_KV_PREFIX}last_inbox_sync_at`, startedAt);
  await logEvent(env, "mail.sync", { surface: source, account_id: account.account_id, folder_id: folderId, inserted, updated, skipped, count: rawMessages.length, message_ids: messageIds.slice(0, 20) });
  return { ok: true, source, account_id: account.account_id, folder_id: folderId, inserted, updated, skipped, count: rawMessages.length, synced_at: startedAt };
}
__name(syncZohoInbox, "syncZohoInbox");
function nyHour(date = /* @__PURE__ */ new Date()) {
  const hour = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }).format(date);
  return Number(hour);
}
__name(nyHour, "nyHour");
async function scheduledInboxSync(env) {
  const hour = nyHour();
  const activeHours = hour >= 8 && hour < 20;
  if (!activeHours && env.KV) {
    const last = await env.KV.get(`${ZOHO_KV_PREFIX}last_offhour_sync_at`);
    if (last && Date.now() - Date.parse(last) < 30 * 60 * 1e3) return;
    await env.KV.put(`${ZOHO_KV_PREFIX}last_offhour_sync_at`, now());
  }
  try {
    await syncZohoInbox(env, "scheduled", 25);
  } catch (error) {
    await logEvent(env, "mail.sync.error", { surface: "scheduled", message: error instanceof Error ? error.message : "sync_failed" });
  }
}
__name(scheduledInboxSync, "scheduledInboxSync");
async function adminMailInbox(request, env) {
  if (!env.DB) return json({ ok: false, error: "db_binding_required" }, { status: 500 });
  const url = new URL(request.url);
  const limit = Math.min(Math.max(integer(url.searchParams.get("limit"), 25), 1), 100);
  const offset = Math.max(integer(url.searchParams.get("offset"), 0), 0);
  const q = text(url.searchParams.get("q"));
  const args = [];
  let where = "WHERE direction = 'inbound'";
  if (q) {
    where += " AND (subject LIKE ? OR from_email LIKE ? OR snippet LIKE ?)";
    args.push(`%${q}%`, `%${q.toLowerCase()}%`, `%${q}%`);
  }
  const rows = await env.DB.prepare(`SELECT id, zoho_message_id, thread_id, from_email, from_name, subject, snippet, received_at, is_read, lead_id, prospect_id, updated_at FROM mail_messages ${where} ORDER BY COALESCE(received_at, created_at) DESC LIMIT ? OFFSET ?`).bind(...args, limit, offset).all();
  const messages = [];
  for (const row of rows.results || []) {
    messages.push({ ...row, suppression_status: await mailSuppressionStatus(env, row.from_email) });
  }
  return json({ ok: true, limit, offset, messages, threads: messages, contract: "direct-api-v1-admin-email" });
}
__name(adminMailInbox, "adminMailInbox");
async function getMailMessage(env, idOrZoho) {
  if (!env.DB) return null;
  return await env.DB.prepare("SELECT * FROM mail_messages WHERE id = ? OR zoho_message_id = ? LIMIT 1").bind(idOrZoho, idOrZoho).first();
}
__name(getMailMessage, "getMailMessage");
async function mailSuppressionStatus(env, email) {
  const normalized = lowerEmail(email);
  if (!env.DB || !normalized) return { suppressed: false, status: "unknown", channels: [], reasons: [] };
  const rows = await env.DB.prepare("SELECT channel, reason FROM suppressions WHERE value = ? AND channel IN ('email', 'all') ORDER BY created_at DESC LIMIT 5").bind(normalized).all();
  const channels = [...new Set((rows.results || []).map((row) => text(row.channel)).filter((value) => !!value))];
  const reasons = [...new Set((rows.results || []).map((row) => text(row.reason)).filter((value) => !!value))];
  if (!channels.length) return { suppressed: false, status: "clear", channels: [], reasons: [] };
  return { suppressed: true, status: channels.includes("all") ? "all_suppressed" : "email_suppressed", channels, reasons };
}
__name(mailSuppressionStatus, "mailSuppressionStatus");
async function mailAuditTail(env, message) {
  if (!env.DB) return [];
  const rows = await env.DB.prepare(`SELECT id, created_at, type, actor, surface
    FROM events
    WHERE lead_id = ? OR payload_json LIKE ? OR payload_json LIKE ?
    ORDER BY created_at DESC LIMIT 12`).bind(message.lead_id || "", `%${message.id}%`, `%${message.zoho_message_id}%`).all();
  return rows.results || [];
}
__name(mailAuditTail, "mailAuditTail");
async function getMailDraft(env, draftId) {
  if (!env.DB) return null;
  return await env.DB.prepare("SELECT id, mail_message_id, lead_id, prospect_id, to_email, subject, draft_body, status FROM mail_reply_drafts WHERE id = ? LIMIT 1").bind(draftId).first();
}
__name(getMailDraft, "getMailDraft");
async function adminMailMessage(request, env, messageId) {
  const msg = await getMailMessage(env, messageId);
  if (!msg) return json({ error: "mail_message_not_found" }, { status: 404 });
  let thread = [];
  if (env.DB && msg.thread_id) {
    const rows = await env.DB.prepare("SELECT id, zoho_message_id, direction, from_email, to_email, subject, snippet, body_text, received_at, sent_at, lead_id, prospect_id FROM mail_messages WHERE thread_id = ? ORDER BY COALESCE(received_at, sent_at, created_at) ASC LIMIT 50").bind(msg.thread_id).all();
    thread = rows.results;
  }
  const suppression_status = await mailSuppressionStatus(env, msg.from_email);
  const audit_tail = await mailAuditTail(env, msg);
  await logEvent(env, "mail.message.viewed", { surface: "admin", mail_message_id: msg.id, zoho_message_id: msg.zoho_message_id }, msg.lead_id || void 0, request);
  return json({ ok: true, message: { ...msg, suppression_status, audit_tail }, thread, suppression_status, audit_tail, contract: "direct-api-v1-admin-email" });
}
__name(adminMailMessage, "adminMailMessage");
async function adminMailSync(env) {
  try {
    return json(await syncZohoInbox(env, "manual", 25));
  } catch (error) {
    await logEvent(env, "mail.sync.error", { surface: "admin", message: error instanceof Error ? error.message : "sync_failed" });
    return safeZohoError(error);
  }
}
__name(adminMailSync, "adminMailSync");
function adminReplyPrompt(message, extra) {
  return {
    instruction: "Draft only. Do not send. Write a concise founder-led MehyarSoft reply to the inbound email. If the context is missed-lead rescue or automation follow-up, include the $330 AI Missed Lead Rescue as an optional next step. Avoid guarantees, spam language, and regulated-industry claims.",
    inbound: {
      from_email: message.from_email,
      from_name: message.from_name,
      subject: message.subject,
      body_text: message.body_text,
      lead_id: message.lead_id,
      prospect_id: message.prospect_id
    },
    admin_context: extra
  };
}
__name(adminReplyPrompt, "adminReplyPrompt");
async function createAdminMailDraft(request, env, messageId) {
  const body = await readJson(request);
  const msg = await getMailMessage(env, messageId);
  if (!msg) return json({ error: "mail_message_not_found" }, { status: 404 });
  const output = await runAI(env, "Create a human-editable email reply draft. Return JSON with subject and body fields only; no sending action.", adminReplyPrompt(msg, body));
  const draftId = id("draft");
  const subject = text(body.subject, msg.subject?.startsWith("Re:") ? msg.subject : `Re: ${msg.subject || "MehyarSoft follow-up"}`) || "Re: MehyarSoft follow-up";
  if (env.DB) {
    await env.DB.prepare("INSERT INTO mail_reply_drafts (id, created_at, updated_at, mail_message_id, lead_id, prospect_id, to_email, subject, draft_body, ai_output_json, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 'admin')").bind(draftId, now(), now(), msg.id, msg.lead_id || null, msg.prospect_id || null, msg.from_email || null, subject, output, output).run();
  }
  await logEvent(env, "mail.draft_created", { surface: "admin", draft_id: draftId, mail_message_id: msg.id, to: "redacted" }, msg.lead_id || void 0, request);
  return json({ ok: true, draft_id: draftId, mail_message_id: msg.id, to: msg.from_email, subject, draft_body: output, requires_admin_send: true });
}
__name(createAdminMailDraft, "createAdminMailDraft");
async function sentTodayCount(env) {
  if (!env.DB) return 0;
  const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM mail_messages WHERE direction = 'outbound' AND sent_at >= datetime('now', 'start of day')").first();
  return row?.count || 0;
}
__name(sentTodayCount, "sentTodayCount");
async function ownerNotificationSentTodayCount(env) {
  if (!env.DB) return 0;
  const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM mail_messages WHERE direction = 'outbound' AND to_email = ? AND sent_at >= datetime('now', 'start of day')").bind(lowerEmail(env.OWNER_EMAIL || env.MEHYARSOFT_ZOHO_TARGET_FORWARD_EMAIL || "mrswelim@gmail.com")).first();
  return row?.count || 0;
}
__name(ownerNotificationSentTodayCount, "ownerNotificationSentTodayCount");
function clampText(value, max) {
  const clean = (value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}\u2026` : clean;
}
__name(clampText, "clampText");
async function deliverOwnerNotification(env, body, request) {
  const destination = lowerEmail(env.OWNER_EMAIL || env.MEHYARSOFT_ZOHO_TARGET_FORWARD_EMAIL || "info@mehyar.us");
  if (!destination || !destination.endsWith("@mehyar.us")) return { ok: false, error: "owner_notification_destination_mismatch", status: 500 };
  const subject = clampText(text(body.subject, "New MehyarSoft intake") || "New MehyarSoft intake", 140);
  const content = clampText(text(body.content ?? body.body ?? body.message, "A new MehyarSoft intake was received. Open the admin dashboard for full details."), 3500);
  const cap = Math.max(integer(env.MEHYARSOFT_ADMIN_NOTIFICATION_DAILY_CAP, 100), 1);
  const count = await ownerNotificationSentTodayCount(env);
  if (count >= cap) return { ok: false, error: "owner_notification_daily_cap_reached", status: 429 };
  try {
    const account = await getZohoAccount(env);
    const sendPayload = { fromAddress: env.MEHYARSOFT_ZOHO_CONTACT_EMAIL, toAddress: destination, subject, content, mailFormat: "plaintext", askReceipt: "no" };
    const response = await zohoFetch(env, `/accounts/${encodeURIComponent(account.account_id)}/messages`, { method: "POST", body: JSON.stringify(sendPayload) });
    const payload = await response.json();
    if (!response.ok) return { ok: false, error: "owner_notification_send_failed", status: response.status };
    const outboundId = id("mail_out");
    const zohoSentId = firstText(payload, ["messageId", "message_id", "id"], outboundId) || outboundId;
    const leadId = text(body.lead_id ?? body.leadId);
    if (env.DB) {
      await env.DB.prepare(`INSERT INTO mail_messages (id, zoho_message_id, thread_id, direction, from_email, to_email, subject, body_text, sent_at, lead_id, metadata_json, created_at, updated_at)
        VALUES (?, ?, ?, 'outbound', ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(outboundId, zohoSentId, zohoSentId, env.MEHYARSOFT_ZOHO_CONTACT_EMAIL || null, destination, subject, sanitizeMailBody(content), now(), null, jsonString({ internal_owner_notification: true, external_lead_id: leadId, provider_keys: Object.keys(payload).slice(0, 30) }), now(), now()).run();
    }
    await logEvent(env, "owner_notification.sent", { surface: "admin", outbound_id: outboundId, external_lead_id: leadId, to: "redacted", subject }, void 0, request);
    return { ok: true, outbound_id: outboundId, status: 200 };
  } catch (error) {
    await logEvent(env, "owner_notification.error", { surface: "admin", message: error instanceof Error ? error.message : "owner_notification_failed" }, void 0, request);
    return { ok: false, error: error instanceof Error ? error.message : "owner_notification_failed", status: 502 };
  }
}
__name(deliverOwnerNotification, "deliverOwnerNotification");
async function sendOwnerIntakeNotification(request, env) {
  const body = await readJson(request);
  const result = await deliverOwnerNotification(env, body, request);
  if (!result.ok) return json({ error: result.error || "owner_notification_failed" }, { status: result.status || 502 });
  return json({ ok: true, outbound_id: result.outbound_id, to: lowerEmail(env.OWNER_EMAIL || env.MEHYARSOFT_ZOHO_TARGET_FORWARD_EMAIL || "info@mehyar.us") });
}
__name(sendOwnerIntakeNotification, "sendOwnerIntakeNotification");
async function sendAdminClientReply(request, env) {
  const body = await readJson(request);
  const normalizedTo = lowerEmail(body.to);
  const subject = clampText(text(body.subject, "MehyarSoft follow-up") || "MehyarSoft follow-up", 140);
  const content = text(body.content ?? body.message ?? body.body, "") || "";
  const leadId = text(body.lead_id ?? body.leadId, "") || null;
  const confirmed = body.confirm_send === true || body.confirmSend === true || body.confirm_manual_send === true || body.confirmManualSend === true;
  if (!normalizedTo) return json({ error: "valid_recipient_required" }, { status: 400 });
  if (!content || content.length > 12e3) return json({ error: "valid_content_required" }, { status: 400 });
  if (!confirmed) return json({ error: "confirm_send_required" }, { status: 409 });
  const suppressionStatus = await mailSuppressionStatus(env, normalizedTo);
  if (suppressionStatus.suppressed) return json({ error: "recipient_suppressed", suppression_status: suppressionStatus }, { status: 403 });
  const cap = Math.max(integer(env.MEHYARSOFT_ADMIN_MAIL_DAILY_SEND_CAP, 25), 1);
  const count = await sentTodayCount(env);
  if (count >= cap) return json({ error: "daily_send_cap_reached", cap }, { status: 429 });
  try {
    const account = await getZohoAccount(env);
    const sendPayload = {
      fromAddress: env.MEHYARSOFT_ZOHO_CONTACT_EMAIL,
      toAddress: normalizedTo,
      subject,
      content,
      mailFormat: "plaintext",
      askReceipt: "no"
    };
    const response = await zohoFetch(env, `/accounts/${encodeURIComponent(account.account_id)}/messages`, { method: "POST", body: JSON.stringify(sendPayload) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return json({ error: "zoho_client_reply_failed", status: response.status, provider: summarizeProviderPayload(payload) }, { status: 502 });
    const outboundId = id("mail_out");
    const zohoSentId = firstText(payload, ["messageId", "message_id", "id"], outboundId) || outboundId;
    if (env.DB) {
      await env.DB.prepare(`INSERT INTO mail_messages (id, zoho_message_id, thread_id, direction, from_email, to_email, subject, body_text, sent_at, lead_id, metadata_json, created_at, updated_at)
        VALUES (?, ?, ?, 'outbound', ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(outboundId, zohoSentId, zohoSentId, env.MEHYARSOFT_ZOHO_CONTACT_EMAIL || null, normalizedTo, subject, sanitizeMailBody(content), now(), leadId, jsonString({ client_ops_reply: true }), now(), now()).run();
    }
    await logEvent(env, "client_ops.reply_sent", { surface: "admin", outbound_id: outboundId, lead_id: leadId, to: "redacted", subject }, leadId || void 0, request);
    return json({ ok: true, outbound_id: outboundId, provider_message_id: zohoSentId, suppression_status: suppressionStatus });
  } catch (error) {
    return safeZohoError(error);
  }
}
__name(sendAdminClientReply, "sendAdminClientReply");
async function deliverAdminMailReply(request, env, msg, body, draftId) {
  const to = text(body.to, msg.from_email || null);
  const normalizedTo = lowerEmail(to);
  const subject = text(body.subject, msg.subject?.startsWith("Re:") ? msg.subject : `Re: ${msg.subject || "MehyarSoft follow-up"}`) || "Re: MehyarSoft follow-up";
  const content = text(body.content ?? body.body ?? body.message ?? body.draft_body ?? body.draftBody);
  if (!to || !normalizedTo) return json({ error: "to_required" }, { status: 400 });
  if (!content) return json({ error: "content_required" }, { status: 400 });
  if (normalizedTo !== msg.from_email) return json({ error: "reply_target_mismatch", expected: msg.from_email }, { status: 403 });
  const confirmed = body.confirm_send === true || body.confirmSend === true || body.confirm_manual_send === true || body.confirmManualSend === true;
  if (!confirmed) return json({ error: "confirm_send_required" }, { status: 409 });
  const suppression_status = await mailSuppressionStatus(env, normalizedTo);
  if (suppression_status.suppressed) return json({ error: "recipient_suppressed", suppression_status }, { status: 403 });
  const cap = Math.max(integer(env.MEHYARSOFT_ADMIN_MAIL_DAILY_SEND_CAP, 25), 1);
  const count = await sentTodayCount(env);
  if (count >= cap) return json({ error: "daily_send_cap_reached", cap }, { status: 429 });
  try {
    const account = await getZohoAccount(env);
    const sendPayload = { fromAddress: env.MEHYARSOFT_ZOHO_CONTACT_EMAIL, toAddress: normalizedTo, subject, content, mailFormat: text(body.mailFormat, "plaintext") || "plaintext", askReceipt: "no" };
    const response = await zohoFetch(env, `/accounts/${encodeURIComponent(account.account_id)}/messages`, { method: "POST", body: JSON.stringify(sendPayload) });
    const payload = await response.json();
    const debugProvider = body.debug_provider === true || body.debugProvider === true;
    if (!response.ok) return json({ error: "zoho_reply_send_failed", status: response.status, provider: summarizeProviderPayload(payload, debugProvider) }, { status: 502 });
    const outboundId = id("mail_out");
    const zohoSentId = firstText(payload, ["messageId", "message_id", "id"], outboundId) || outboundId;
    if (env.DB) {
      await env.DB.prepare(`INSERT INTO mail_messages (id, zoho_message_id, thread_id, direction, from_email, to_email, subject, body_text, sent_at, lead_id, prospect_id, metadata_json, created_at, updated_at)
        VALUES (?, ?, ?, 'outbound', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(outboundId, zohoSentId, msg.thread_id || msg.zoho_message_id, env.MEHYARSOFT_ZOHO_CONTACT_EMAIL || null, normalizedTo, subject, sanitizeMailBody(content), now(), msg.lead_id || null, msg.prospect_id || null, jsonString({ reply_to: msg.id, draft_id: draftId || null, zoho_response_keys: Object.keys(payload).slice(0, 30) }), now(), now()).run();
      if (draftId) {
        await env.DB.prepare("UPDATE mail_reply_drafts SET status = 'sent', sent_mail_message_id = ?, updated_at = ? WHERE id = ?").bind(outboundId, now(), draftId).run();
      }
    }
    await logEvent(env, "mail.reply_sent", { surface: "admin", mail_message_id: msg.id, draft_id: draftId || null, outbound_id: outboundId, to: "redacted", subject }, msg.lead_id || void 0, request);
    return json({ ok: true, outbound_id: outboundId, replied_to: msg.id, draft_id: draftId || null, account_id: account.account_id, provider: summarizeProviderPayload(payload, debugProvider), suppression_status });
  } catch (error) {
    await logEvent(env, "mail.reply_error", { surface: "admin", mail_message_id: msg.id, draft_id: draftId || null, message: error instanceof Error ? error.message : "reply_failed" }, msg.lead_id || void 0, request);
    return safeZohoError(error);
  }
}
__name(deliverAdminMailReply, "deliverAdminMailReply");
async function sendAdminMailReply(request, env, messageId) {
  const body = await readJson(request);
  const msg = await getMailMessage(env, messageId);
  if (!msg) return json({ error: "mail_message_not_found" }, { status: 404 });
  return deliverAdminMailReply(request, env, msg, body);
}
__name(sendAdminMailReply, "sendAdminMailReply");
async function updateAdminMailDraft(request, env, draftId) {
  const body = await readJson(request);
  const draft = await getMailDraft(env, draftId);
  if (!draft) return json({ error: "mail_draft_not_found" }, { status: 404 });
  const subject = text(body.subject, draft.subject || "Re: MehyarSoft follow-up") || "Re: MehyarSoft follow-up";
  const draftBody = text(body.draft_body ?? body.draftBody ?? body.content ?? body.body, draft.draft_body || "");
  if (!draftBody) return json({ error: "draft_body_required" }, { status: 400 });
  await env.DB.prepare("UPDATE mail_reply_drafts SET subject = ?, draft_body = ?, status = 'draft', updated_at = ? WHERE id = ?").bind(subject, draftBody, now(), draftId).run();
  await logEvent(env, "mail.draft_updated", { surface: "admin", draft_id: draftId, mail_message_id: draft.mail_message_id }, draft.lead_id || void 0, request);
  return json({ ok: true, draft_id: draftId, subject, draft_body: draftBody, status: "draft" });
}
__name(updateAdminMailDraft, "updateAdminMailDraft");
async function approveAdminMailDraft(request, env, draftId) {
  const draft = await getMailDraft(env, draftId);
  if (!draft) return json({ error: "mail_draft_not_found" }, { status: 404 });
  await env.DB.prepare("UPDATE mail_reply_drafts SET status = 'approved', updated_at = ? WHERE id = ?").bind(now(), draftId).run();
  await logEvent(env, "mail.draft_approved", { surface: "admin", draft_id: draftId, mail_message_id: draft.mail_message_id }, draft.lead_id || void 0, request);
  return json({ ok: true, draft_id: draftId, status: "approved", requires_manual_send: true });
}
__name(approveAdminMailDraft, "approveAdminMailDraft");
async function sendAdminMailDraft(request, env, draftId) {
  const body = await readJson(request);
  const draft = await getMailDraft(env, draftId);
  if (!draft) return json({ error: "mail_draft_not_found" }, { status: 404 });
  if (draft.status === "sent") return json({ error: "mail_draft_already_sent" }, { status: 409 });
  const msg = await getMailMessage(env, draft.mail_message_id);
  if (!msg) return json({ error: "mail_message_not_found" }, { status: 404 });
  return deliverAdminMailReply(request, env, msg, { ...body, to: draft.to_email || msg.from_email, subject: draft.subject, content: draft.draft_body }, draftId);
}
__name(sendAdminMailDraft, "sendAdminMailDraft");
async function zohoOAuthStart(env) {
  const configError = requireZohoConfig(env);
  if (configError) return configError;
  const state = crypto.randomUUID();
  await env.KV.put(`${ZOHO_KV_PREFIX}oauth_state:${state}`, "1", { expirationTtl: 600 });
  const authUrl = new URL(`${zohoAccountsBase(env)}/oauth/v2/auth`);
  authUrl.searchParams.set("scope", ZOHO_OAUTH_SCOPES.join(","));
  authUrl.searchParams.set("client_id", env.MEHYARSOFT_ZOHO_CLIENT_ID);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("redirect_uri", env.MEHYARSOFT_ZOHO_AUTHORIZED_REDIRECT_URI);
  authUrl.searchParams.set("state", state);
  return json({ ok: true, authorization_url: authUrl.toString(), scopes: ZOHO_OAUTH_SCOPES, expires_in_seconds: 600 });
}
__name(zohoOAuthStart, "zohoOAuthStart");
async function zohoOAuthCallback(request, env) {
  const configError = requireZohoConfig(env);
  if (configError) return configError;
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const accountsServer = url.searchParams.get("accounts-server") || url.searchParams.get("accounts_server");
  const error = url.searchParams.get("error");
  const contactEmail = env.MEHYARSOFT_ZOHO_CONTACT_EMAIL || "contact@mehyar.us";
  if (error) {
    await logEvent(env, "zoho.oauth.error", { error, state_present: !!state, surface: "oauth" }, void 0, request);
    return html(`<h1 class="bad">Zoho authorization failed</h1><p>${error.replace(/[<>]/g, "")}</p>`, 400);
  }
  if (!code || !state) return html('<h1 class="bad">Missing OAuth code/state</h1><p>Restart authorization from the owner-only OAuth start endpoint.</p>', 400);
  const stateKey = `${ZOHO_KV_PREFIX}oauth_state:${state}`;
  const stateOk = await env.KV.get(stateKey);
  if (!stateOk) return html('<h1 class="bad">Invalid or expired OAuth state</h1><p>Restart authorization from the owner-only OAuth start endpoint.</p>', 400);
  await env.KV.delete(stateKey);
  const form = new URLSearchParams({
    code,
    client_id: env.MEHYARSOFT_ZOHO_CLIENT_ID,
    client_secret: env.MEHYARSOFT_ZOHO_CLIENT_SECRET,
    redirect_uri: env.MEHYARSOFT_ZOHO_AUTHORIZED_REDIRECT_URI,
    grant_type: "authorization_code"
  });
  const tokenResponse = await fetch(zohoTokenUrl(env, accountsServer), { method: "POST", body: form });
  const token = await tokenResponse.json();
  if (!tokenResponse.ok || token.error || !token.access_token) {
    await logEvent(env, "zoho.oauth.exchange_failed", { status: tokenResponse.status, error: token.error || "token_exchange_failed", surface: "oauth" }, void 0, request);
    return html(`<h1 class="bad">Zoho token exchange failed</h1><p>Status: ${tokenResponse.status}. Error: ${(token.error || "unknown").replace(/[<>]/g, "")}</p>`, 502);
  }
  await zohoStoreToken(env, token, accountsServer);
  await logEvent(env, "zoho.oauth.connected", { mailbox: contactEmail, has_refresh_token: !!token.refresh_token, api_domain_present: !!token.api_domain, surface: "oauth" }, void 0, request);
  if (!token.refresh_token) {
    return html('<h1 class="bad">Zoho connected without a refresh token</h1><p>Restart authorization and make sure access_type=offline plus prompt=consent are used.</p>', 409);
  }
  return html(`<h1 class="ok">Zoho Mail and Calendar connected</h1><p>OAuth refresh token was stored securely for ${contactEmail}. You can close this window.</p>`);
}
__name(zohoOAuthCallback, "zohoOAuthCallback");
async function zohoMailStatus(env) {
  const configError = requireZohoConfig(env);
  if (configError) return configError;
  try {
    const refreshTokenPresent = !!await env.KV.get(`${ZOHO_KV_PREFIX}refresh_token`);
    if (!refreshTokenPresent) return json({ ok: false, configured: true, connected: false, reason: "oauth_required", scopes: ZOHO_OAUTH_SCOPES });
    const account = await getZohoAccount(env);
    return json({ ok: true, configured: true, connected: true, contact_email: env.MEHYARSOFT_ZOHO_CONTACT_EMAIL, account_id: account.account_id, account_source: account.source, send_default_target_configured: !!env.MEHYARSOFT_ZOHO_TARGET_FORWARD_EMAIL });
  } catch (error) {
    return safeZohoError(error);
  }
}
__name(zohoMailStatus, "zohoMailStatus");
async function getZohoInboxFolderId(env, accountId) {
  if (!env.KV) return null;
  const cached = await env.KV.get(`${ZOHO_KV_PREFIX}inbox_folder_id`);
  if (cached) return cached;
  const response = await zohoFetch(env, `/accounts/${encodeURIComponent(accountId)}/folders`);
  const payload = await response.json();
  if (!response.ok) return null;
  const folders = Array.isArray(payload.data) ? payload.data : [];
  const inbox = folders.find((folder) => {
    const name = String(folder.folderName || folder.folder_name || folder.name || "").toLowerCase();
    const type = String(folder.folderType || folder.folder_type || folder.type || "").toLowerCase();
    return name === "inbox" || type === "inbox";
  });
  const rawId = inbox?.folderId || inbox?.folder_id || inbox?.id;
  const folderId = rawId === void 0 || rawId === null ? null : String(rawId);
  if (folderId) await env.KV.put(`${ZOHO_KV_PREFIX}inbox_folder_id`, folderId);
  return folderId;
}
__name(getZohoInboxFolderId, "getZohoInboxFolderId");
async function readZohoMessages(request, env) {
  try {
    const url = new URL(request.url);
    const limit = Math.min(Math.max(integer(url.searchParams.get("limit"), 10), 1), 25);
    const requestedFolderId = url.searchParams.get("folder_id") || url.searchParams.get("folderId");
    const account = await getZohoAccount(env);
    const folderId = requestedFolderId || await getZohoInboxFolderId(env, account.account_id);
    const params = new URLSearchParams({ limit: String(limit) });
    if (folderId) params.set("folderId", folderId);
    const response = await zohoFetch(env, `/accounts/${encodeURIComponent(account.account_id)}/messages/view?${params.toString()}`);
    const payload = await response.json();
    if (!response.ok) return json({ error: "zoho_messages_read_failed", status: response.status, folder_id: folderId || null, provider: summarizeProviderPayload(payload) }, { status: 502 });
    await logEvent(env, "zoho.messages.read", { surface: "admin", limit, folder_id: folderId || null });
    return json({ ok: true, account_id: account.account_id, contact_email: env.MEHYARSOFT_ZOHO_CONTACT_EMAIL, limit, folder_id: folderId || null, payload });
  } catch (error) {
    return safeZohoError(error);
  }
}
__name(readZohoMessages, "readZohoMessages");
async function sendZohoMessage(request, env) {
  await logEvent(env, "zoho.direct_send_disabled", { surface: "admin", path: "/v1/mail/zoho/send" }, void 0, request);
  return json({ error: "direct_send_disabled", message: "Use /v1/admin/email/drafts/:id/send with confirm_manual_send plus suppression and daily-cap gates." }, { status: 410 });
}
__name(sendZohoMessage, "sendZohoMessage");
async function refreshZohoToken(env) {
  try {
    await zohoRefreshAccessToken(env);
    return json({ ok: true, access_token_cached: true });
  } catch (error) {
    return safeZohoError(error);
  }
}
__name(refreshZohoToken, "refreshZohoToken");
async function handleLead(request, env) {
  const body = await readJson(request);
  const leadId = id("lead");
  const triage = scoreLead(body);
  const ts = now();
  if (env.DB) {
    await env.DB.prepare(`INSERT INTO leads (id, created_at, updated_at, name, email, phone, business_name, website, service_interest, message, source, source_url, utm_source, utm_medium, utm_campaign, consent, consent_channel, status, score, next_action, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      leadId,
      ts,
      ts,
      text(body.name),
      text(body.email)?.toLowerCase() || null,
      text(body.phone),
      text(body.business_name ?? body.businessName),
      text(body.website),
      text(body.service_interest ?? body.serviceInterest),
      text(body.message),
      text(body.source, "website"),
      text(body.source_url ?? body.sourceUrl),
      text(body.utm_source ?? body.utmSource),
      text(body.utm_medium ?? body.utmMedium),
      text(body.utm_campaign ?? body.utmCampaign),
      boolInt(body.consent),
      text(body.consent_channel ?? body.consentChannel),
      "new",
      triage.score,
      triage.next_action,
      jsonString(safeStorageMetadata(body))
    ).run();
  }
  await logEvent(env, "lead.created", body, leadId, request);
  const jobId = await queueJob(env, { type: "lead_triage", leadId, payload_summary: safeStorageMetadata(body) });
  return json({ ok: true, lead_id: leadId, job_id: jobId, triage });
}
__name(handleLead, "handleLead");
async function handleNewsletterSignup(request, env) {
  const body = await readJson(request);
  const email = lowerEmail(body.email);
  if (!email) return json({ error: "email_required" }, { status: 400 });
  const consent = body.consent !== false && body.accepted !== false && body.opt_in !== false && body.optIn !== false;
  if (!consent) return json({ error: "consent_required" }, { status: 400 });
  const suppressionStatus = await mailSuppressionStatus(env, email);
  if (suppressionStatus.suppressed) {
    await logEvent(env, "newsletter.signup_suppressed", { surface: "public", source: text(body.source, "newsletter"), status: suppressionStatus.status }, void 0, request);
    return json({ ok: true, accepted: false, suppressed: true, suppression_status: suppressionStatus }, { status: 202 });
  }
  const leadId = id("lead");
  const ts = now();
  const source = text(body.source ?? body.form_source ?? body.formSource, "newsletter") || "newsletter";
  const sourceUrl = text(body.source_url ?? body.sourceUrl ?? body.page_url ?? body.pageUrl ?? body.url);
  const interestTags = textList(body.interest_tags ?? body.interestTags ?? body.tags ?? body.interests, ["newsletter"]);
  const serviceInterest = text(body.service_interest ?? body.serviceInterest, interestTags.join(", ") || "newsletter") || "newsletter";
  const metadata = safeStorageMetadata({ ...body, email: "redacted", phone: body.phone ? "redacted" : void 0, interest_tags: interestTags, newsletter: true });
  const triage = scoreLead({ ...body, source, service_interest: serviceInterest, newsletter: true });
  if (env.DB) {
    await env.DB.prepare(`INSERT INTO leads (id, created_at, updated_at, name, email, phone, business_name, website, service_interest, message, source, source_url, utm_source, utm_medium, utm_campaign, consent, consent_channel, status, score, next_action, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      leadId,
      ts,
      ts,
      text(body.name),
      email,
      text(body.phone),
      text(body.business_name ?? body.businessName),
      text(body.website),
      serviceInterest,
      text(body.message, "Newsletter signup"),
      source,
      sourceUrl,
      text(body.utm_source ?? body.utmSource),
      text(body.utm_medium ?? body.utmMedium),
      text(body.utm_campaign ?? body.utmCampaign),
      1,
      text(body.consent_channel ?? body.consentChannel, "email_newsletter"),
      "subscriber",
      triage.score,
      "Send welcome/relationship-building newsletter only; no campaign blast without compliance review.",
      jsonString(metadata)
    ).run();
  }
  await logEvent(env, "newsletter.signup", { surface: "public", lead_id: leadId, source, source_url: sourceUrl, interest_tag_count: interestTags.length, consent: 1 }, leadId, request);
  const jobId = await queueJob(env, { type: "newsletter_signup", leadId, source, interest_tag_count: interestTags.length, payload_summary: metadata });
  const notification = await deliverOwnerNotification(env, {
    subject: "New MehyarSoft newsletter subscriber",
    content: [`New consented newsletter signup`, `Email: ${email}`, `Name: ${text(body.name, "") || "(not provided)"}`, `Source: ${source}`, `Source page: ${sourceUrl || "(not provided)"}`, `Interest tags: ${interestTags.join(", ") || "newsletter"}`, `Lead ID: ${leadId}`].join("\n"),
    lead_id: leadId
  }, request);
  if (!notification.ok) await logEvent(env, "newsletter.owner_notification_failed", { surface: "public", lead_id: leadId, error: notification.error || "notification_failed", status: notification.status || 0 }, leadId, request);
  return json({ ok: true, accepted: true, lead_id: leadId, subscriber_id: leadId, job_id: jobId, suppression_status: suppressionStatus, owner_notification: { attempted: true, ok: notification.ok } });
}
__name(handleNewsletterSignup, "handleNewsletterSignup");
async function handleNewsletterUnsubscribe(request, env) {
  const body = await readJson(request);
  const email = lowerEmail(body.email ?? body.value);
  if (!email) return json({ error: "email_required" }, { status: 400 });
  if (env.DB) {
    await env.DB.prepare("INSERT OR IGNORE INTO suppressions (id, created_at, channel, value, reason, source, metadata_json) VALUES (?, ?, 'email', ?, ?, ?, ?)").bind(id("sup"), now(), email, text(body.reason, "newsletter_unsubscribe"), text(body.source, "newsletter_unsubscribe"), jsonString(safeStorageMetadata({ ...body, email: "redacted" }))).run();
    await env.DB.prepare("UPDATE leads SET status = 'unsubscribed', updated_at = ? WHERE lower(email) = ? AND " + newsletterLeadWhere("")).bind(now(), email).run();
  }
  await logEvent(env, "newsletter.unsubscribe", { surface: "public", channel: "email", value: "redacted", reason: text(body.reason, "newsletter_unsubscribe") || "newsletter_unsubscribe" }, void 0, request);
  return json({ ok: true, suppressed: true, channel: "email" });
}
__name(handleNewsletterUnsubscribe, "handleNewsletterUnsubscribe");
async function newsletterSubscriberRow(env, subscriberId) {
  if (!env.DB) return null;
  return await env.DB.prepare(`SELECT id, created_at, updated_at, name, email, business_name, service_interest, source, source_url, status, score, next_action, follow_up_at, last_contacted_at, metadata_json FROM leads WHERE id = ? AND ${newsletterLeadWhere("")} LIMIT 1`).bind(subscriberId).first();
}
__name(newsletterSubscriberRow, "newsletterSubscriberRow");
function parseMetadataJson(value) {
  const raw = text(value, "{}");
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
__name(parseMetadataJson, "parseMetadataJson");
async function normalizeNewsletterSubscriber(env, row) {
  const metadata = parseMetadataJson(row.metadata_json);
  const suppression_status = await mailSuppressionStatus(env, text(row.email));
  return {
    id: text(row.id),
    created_at: text(row.created_at),
    updated_at: text(row.updated_at),
    name: text(row.name),
    email: text(row.email),
    business_name: text(row.business_name),
    service_interest: text(row.service_interest),
    source: text(row.source),
    source_page: text(row.source_url),
    source_url: text(row.source_url),
    status: text(row.status, "subscriber"),
    lifecycle_stage: text(row.status, "subscriber"),
    score: integer(row.score, 0),
    next_action: text(row.next_action),
    next_follow_up_at: text(row.follow_up_at),
    last_contacted_at: text(row.last_contacted_at),
    interest_tags: Array.isArray(metadata.interest_tags) ? metadata.interest_tags : textList(row.service_interest, ["newsletter"]),
    consent_timestamp: text(row.created_at),
    recommended_offer: "330_ai_missed_lead_rescue_audit",
    promoted_lead_id: ["prospect", "lead", "qualified", "won"].includes((text(row.status, "") || "").toLowerCase()) ? text(row.id) : null,
    suppression_status
  };
}
__name(normalizeNewsletterSubscriber, "normalizeNewsletterSubscriber");
async function adminNewsletterSubscribers(request, env) {
  if (!env.DB) return json({ error: "db_binding_required" }, { status: 500 });
  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(100, integer(url.searchParams.get("limit"), 50)));
  const offset = Math.max(0, integer(url.searchParams.get("offset"), 0));
  const rows = await env.DB.prepare(`SELECT id, created_at, updated_at, name, email, business_name, service_interest, source, source_url, status, score, next_action, follow_up_at, last_contacted_at, metadata_json FROM leads WHERE ${newsletterLeadWhere()} ORDER BY created_at DESC LIMIT ? OFFSET ?`).bind(limit, offset).all();
  const subscribers = [];
  for (const row of rows.results || []) subscribers.push(await normalizeNewsletterSubscriber(env, row));
  await logEvent(env, "newsletter.subscribers_viewed", { surface: "admin", count: subscribers.length, limit, offset }, void 0, request);
  return json({ ok: true, contract: "newsletter-money-cockpit-admin-v1", subscribers, items: subscribers, export_url: "/v1/admin/subscribers.csv", updated_at: now(), safety: { no_outreach_send: true, admin_auth_required: true } });
}
__name(adminNewsletterSubscribers, "adminNewsletterSubscribers");
async function promoteNewsletterSubscriber(request, env, subscriberId) {
  if (!env.DB) return json({ error: "db_binding_required" }, { status: 500 });
  const body = await readJson(request);
  const row = await newsletterSubscriberRow(env, subscriberId);
  if (!row) return json({ error: "subscriber_not_found" }, { status: 404 });
  const suppression_status = await mailSuppressionStatus(env, text(row.email));
  if (suppression_status.suppressed) return json({ error: "subscriber_suppressed", suppression_status }, { status: 403 });
  const target = text(body.target_stage ?? body.targetStage, "prospect");
  const safeStage = ["subscriber", "prospect", "lead", "qualified", "won"].includes(target) ? target : "prospect";
  await env.DB.prepare("UPDATE leads SET status = ?, updated_at = ?, next_action = ?, follow_up_at = COALESCE(?, follow_up_at), metadata_json = ? WHERE id = ?").bind(safeStage, now(), "Owner-review conversion follow-up only; no campaign blast or auto-send.", text(body.next_follow_up_at ?? body.nextFollowUpAt), jsonString({ ...parseMetadataJson(row.metadata_json), promoted_from_newsletter: true, promoted_at: now(), no_outreach_send: true }), subscriberId).run();
  await logEvent(env, "newsletter.subscriber_promoted", { surface: "admin", lead_id: subscriberId, lifecycle_stage: safeStage, no_outreach_send: true }, subscriberId, request);
  const updated = await newsletterSubscriberRow(env, subscriberId) || row;
  return json({ ok: true, contract: "newsletter-money-cockpit-admin-v1", lead_id: subscriberId, subscriber: await normalizeNewsletterSubscriber(env, updated), safety: { no_outreach_send: true, requires_owner_review: true } });
}
__name(promoteNewsletterSubscriber, "promoteNewsletterSubscriber");
async function createNewsletterZohoDraft(request, env, subscriberId) {
  if (!env.DB) return json({ error: "db_binding_required" }, { status: 500 });
  const body = await readJson(request);
  const row = await newsletterSubscriberRow(env, subscriberId);
  if (!row) return json({ error: "subscriber_not_found" }, { status: 404 });
  const email = lowerEmail(row.email);
  if (!email) return json({ error: "subscriber_email_required" }, { status: 400 });
  const suppression_status = await mailSuppressionStatus(env, email);
  if (suppression_status.suppressed) return json({ error: "subscriber_suppressed", suppression_status }, { status: 403 });
  const mailId = id("mail_newsletter");
  const draftId = id("draft");
  const subject = "Re: MehyarSoft newsletter follow-up";
  const draftBody = [
    `Hi ${text(row.name, "there") || "there"},`,
    "",
    "Thanks for joining the MehyarSoft checklist/newsletter path. If useful, I can turn the same audit lens into a short, practical review of your lead follow-up and automation gaps.",
    "",
    "This is a draft only for owner review and manual send; no automated outreach was performed.",
    "",
    "- MehyarSoft"
  ].join("\n");
  await env.DB.prepare(`INSERT INTO mail_messages (id, zoho_message_id, thread_id, direction, from_email, from_name, to_email, subject, snippet, body_text, received_at, lead_id, metadata_json, created_at, updated_at)
    VALUES (?, ?, ?, 'inbound', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(mailId, mailId, mailId, email, text(row.name), env.MEHYARSOFT_ZOHO_CONTACT_EMAIL || null, "Newsletter subscriber follow-up context", text(row.service_interest, "Newsletter signup"), text(row.message, "Newsletter signup"), text(row.created_at, now()), subscriberId, jsonString({ synthetic_newsletter_context: true, no_external_send: true }), now(), now()).run();
  await env.DB.prepare("INSERT INTO mail_reply_drafts (id, created_at, updated_at, mail_message_id, lead_id, to_email, subject, draft_body, ai_output_json, status, created_by, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 'admin', ?)").bind(draftId, now(), now(), mailId, subscriberId, email, text(body.subject, subject), draftBody, jsonString({ template_key: text(body.template_key, "newsletter_to_consulting_intro"), body_text: draftBody }), jsonString({ requires_manual_send: true, no_external_send: true })).run();
  await logEvent(env, "newsletter.zoho_draft_created", { surface: "admin", draft_id: draftId, lead_id: subscriberId, no_external_send: true }, subscriberId, request);
  return json({ ok: true, contract: "newsletter-money-cockpit-admin-v1", thread_id: mailId, draft: { id: draftId, thread_id: mailId, lead_id: subscriberId, to_email: email, subject: text(body.subject, subject), body_text: draftBody, status: "draft", requires_manual_send: true, requires_manual_approval: true }, safety: { no_outreach_send: true, requires_manual_send: true } });
}
__name(createNewsletterZohoDraft, "createNewsletterZohoDraft");
async function adminMetricsData(env) {
  if (!env.DB) return { mode: "stub", leads: 0, newsletter_subscribers_total: 0, newsletter_subscribers_active: 0, message: "D1 not configured yet." };
  const total = await env.DB.prepare("SELECT COUNT(*) AS count FROM leads").first();
  const byStatus = await env.DB.prepare("SELECT status, COUNT(*) AS count FROM leads GROUP BY status").all();
  const bySource = await env.DB.prepare("SELECT source, COUNT(*) AS count FROM leads GROUP BY source ORDER BY count DESC LIMIT 20").all();
  const recent = await env.DB.prepare("SELECT id, created_at, business_name, service_interest, source, status, score, next_action FROM leads ORDER BY created_at DESC LIMIT 20").all();
  const jobs = await env.DB.prepare("SELECT status, COUNT(*) AS count FROM jobs GROUP BY status").all();
  const campaigns = await env.DB.prepare("SELECT compliance_status, COUNT(*) AS count FROM campaigns GROUP BY compliance_status").all();
  const suppressions = await env.DB.prepare("SELECT channel, COUNT(*) AS count FROM suppressions GROUP BY channel").all();
  const newsletterTotal = await env.DB.prepare(`SELECT COUNT(*) AS count FROM leads WHERE ${newsletterLeadWhere()}`).first();
  const newsletterActive = await env.DB.prepare(`SELECT COUNT(*) AS count FROM leads WHERE ${newsletterLeadWhere()} AND lower(COALESCE(status, '')) != 'unsubscribed' AND lower(email) NOT IN (SELECT value FROM suppressions WHERE channel IN ('email', 'all'))`).first();
  const newsletterBySource = await env.DB.prepare(`SELECT source, COUNT(*) AS count FROM leads WHERE ${newsletterLeadWhere()} GROUP BY source ORDER BY count DESC LIMIT 20`).all();
  return {
    leads_total: total?.count || 0,
    by_status: byStatus.results,
    by_source: bySource.results,
    jobs: jobs.results,
    campaigns: campaigns.results,
    suppressions: suppressions.results,
    newsletter_subscribers_total: newsletterTotal?.count || 0,
    newsletter_subscribers_active: newsletterActive?.count || 0,
    subscribers_total: newsletterTotal?.count || 0,
    subscribers_active: newsletterActive?.count || 0,
    newsletter_by_source: newsletterBySource.results,
    recent: recent.results
  };
}
__name(adminMetricsData, "adminMetricsData");
async function adminSubscribersCsv(env) {
  if (!env.DB) return new Response("error\nD1 not configured\n", { status: 500, headers: { "content-type": "text/csv; charset=utf-8", "Cache-Control": "no-store", ...corsHeaders } });
  const rows = await env.DB.prepare(`SELECT id, created_at, name, email, business_name, service_interest, source, source_url, status FROM leads WHERE ${newsletterLeadWhere()} AND lower(COALESCE(status, '')) != 'unsubscribed' AND lower(email) NOT IN (SELECT value FROM suppressions WHERE channel IN ('email', 'all')) ORDER BY created_at DESC LIMIT 5000`).all();
  const header = ["id", "created_at", "name", "email", "business_name", "interest_tags", "source", "source_url", "status"];
  const lines = [header.join(",")];
  for (const row of rows.results || []) {
    lines.push([row.id, row.created_at, row.name, row.email, row.business_name, row.service_interest, row.source, row.source_url, row.status].map(csvSafe).join(","));
  }
  await logEvent(env, "newsletter.subscribers_exported", { surface: "admin", count: rows.results?.length || 0 });
  return new Response(`${lines.join("\n")}
`, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": "attachment; filename=mehyarsoft-newsletter-subscribers.csv", "Cache-Control": "no-store", ...corsHeaders } });
}
__name(adminSubscribersCsv, "adminSubscribersCsv");
async function adminMetrics(env) {
  return json(await adminMetricsData(env));
}
__name(adminMetrics, "adminMetrics");
async function adminDashboard(env) {
  const metrics = await adminMetricsData(env);
  const record = metrics;
  return json({
    ok: true,
    updated_at: now(),
    dashboard: {
      ...record,
      recent_leads: Array.isArray(record.recent) ? record.recent : [],
      leads: Array.isArray(record.recent) ? record.recent : [],
      source_attribution: Array.isArray(record.by_source) ? record.by_source : [],
      campaigns: Array.isArray(record.campaigns) ? record.campaigns : [],
      compliance_gates: [
        { key: "admin_auth", label: "Admin auth", status: "ok", detail: "Owner dashboard requires bearer session." },
        { key: "suppression", label: "Suppression controls", status: "ok", detail: "Suppression counts are available before outreach." },
        { key: "manual_send", label: "Manual send", status: "ok", detail: "Outbound replies require approved admin action." }
      ],
      revenue: {
        pipeline_value_cents: 0,
        first_330_collected_cents: 0,
        first_330_target_cents: 33e3,
        monthly_recurring_cents: 0,
        monthly_recurring_target_cents: 9e5
      },
      audit_tail: [],
      conversion_trend: [],
      zoho_status: null
    }
  });
}
__name(adminDashboard, "adminDashboard");
async function login(request, env) {
  const rateLimited = await checkAdminLoginRateLimit(request, env);
  if (rateLimited) return rateLimited;
  const body = await readJson(request);
  const expectedUser = env.ADMIN_USERNAME || "admin";
  const expectedPassword = env.ADMIN_PASSWORD;
  if (body.username !== expectedUser || !expectedPassword || body.password !== expectedPassword) {
    await logEvent(env, "admin.login_failed", { username: text(body.username, "unknown") || "unknown" }, void 0, request);
    return json({ error: "invalid_credentials" }, { status: 403 });
  }
  const token = crypto.randomUUID();
  if (env.KV) await env.KV.put(`session:${token}`, "1", { expirationTtl: 60 * 60 * 8 });
  await logEvent(env, "admin.login_ok", { username: text(body.username, "admin") || "admin" }, void 0, request);
  return json({ ok: true, token, expires_in_seconds: 28800 });
}
__name(login, "login");
async function createCrmNote(request, env) {
  const body = await readJson(request);
  if (!env.DB) return json({ mode: "stub", ok: true, note: body });
  const noteId = id("note");
  const ts = now();
  await env.DB.prepare(`INSERT INTO crm_notes (id, created_at, lead_id, prospect_id, note_type, status, body, next_action, follow_up_at, actor, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(noteId, ts, text(body.lead_id ?? body.leadId), text(body.prospect_id ?? body.prospectId), text(body.note_type ?? body.noteType, "note"), text(body.status), text(body.body ?? body.note ?? body.message, ""), text(body.next_action ?? body.nextAction), text(body.follow_up_at ?? body.followUpAt), text(body.actor, "admin"), jsonString(safeStorageMetadata(body))).run();
  await logEvent(env, "crm.note.created", { ...body, note_id: noteId }, text(body.lead_id ?? body.leadId) || void 0, request);
  return json({ ok: true, note_id: noteId });
}
__name(createCrmNote, "createCrmNote");
async function createCampaign(request, env) {
  const body = await readJson(request);
  if (!env.DB) return json({ mode: "stub", ok: true, campaign: body });
  const campaignId = id("cmp");
  const ts = now();
  await env.DB.prepare(`INSERT INTO campaigns (id, created_at, updated_at, name, channel, segment, compliance_status, template, status, owner, scheduled_at, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(campaignId, ts, ts, text(body.name, "Untitled campaign"), text(body.channel, "email"), text(body.segment), text(body.compliance_status ?? body.complianceStatus, "draft"), text(body.template), text(body.status, "draft"), text(body.owner), text(body.scheduled_at ?? body.scheduledAt), jsonString(safeStorageMetadata(body))).run();
  await logEvent(env, "campaign.created", { ...body, campaign_id: campaignId }, void 0, request);
  return json({ ok: true, campaign_id: campaignId });
}
__name(createCampaign, "createCampaign");
async function importProspects(request, env) {
  const body = await readJson(request);
  const rawProspects = Array.isArray(body.prospects) ? body.prospects.slice(0, 100) : [body];
  const prospects = rawProspects.filter((item) => item !== null && typeof item === "object" && !Array.isArray(item));
  if (!env.DB) return json({ mode: "stub", ok: true, accepted: prospects.length, limit: 100 });
  let inserted = 0;
  const ids = [];
  const seenEmails = /* @__PURE__ */ new Set();
  for (const prospect of prospects) {
    const email = text(prospect.email)?.toLowerCase() || null;
    if (email && seenEmails.has(email)) continue;
    if (email) seenEmails.add(email);
    if (email) {
      const suppressed = await env.DB.prepare("SELECT id FROM suppressions WHERE channel IN ('email', 'all') AND value = ? LIMIT 1").bind(email).first();
      if (suppressed) continue;
    }
    const prospectId = id("pro");
    const ts = now();
    await env.DB.prepare(`INSERT INTO prospects (id, created_at, updated_at, name, email, phone, company, website, industry, source, segment, status, score, suppression_checked_at, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(prospectId, ts, ts, text(prospect.name), email, text(prospect.phone), text(prospect.company ?? prospect.business_name ?? prospect.businessName), text(prospect.website), text(prospect.industry), text(prospect.source ?? body.source, "manual"), text(prospect.segment ?? body.segment), text(prospect.status, "new"), integer(prospect.score), ts, jsonString(safeStorageMetadata(prospect))).run();
    inserted += 1;
    ids.push(prospectId);
  }
  await logEvent(env, "prospects.imported", { accepted: prospects.length, inserted, source: text(body.source, "manual") }, void 0, request);
  return json({ ok: true, accepted: prospects.length, inserted, prospect_ids: ids, limit: 100 });
}
__name(importProspects, "importProspects");
async function addSuppression(request, env) {
  const body = await readJson(request);
  const channel = text(body.channel, "email") || "email";
  const value = (text(body.value, "") || "").toLowerCase();
  if (!value) return json({ error: "value_required" }, { status: 400 });
  if (env.DB) {
    await env.DB.prepare("INSERT OR IGNORE INTO suppressions (id, created_at, channel, value, reason, source, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id("sup"), now(), channel, value, text(body.reason, "manual"), text(body.source, "api"), jsonString(safeStorageMetadata(body))).run();
  }
  await logEvent(env, "suppression.created", { channel, value: "redacted", reason: text(body.reason, "manual") || "manual" }, void 0, request);
  return json({ ok: true, suppressed: value });
}
__name(addSuppression, "addSuppression");
async function retainerHealth(env) {
  if (!env.DB) return json({ ok: true, mode: "stub", active_clients: [], risks: [], next_review: "weekly" });
  const active = await env.DB.prepare("SELECT id, client_name, status, monthly_value_cents, sla_status, last_touch_at, next_review_at, renewal_at, risk_level, risk_reason FROM retainer_health WHERE status = 'active' ORDER BY next_review_at ASC LIMIT 50").all();
  const risks = await env.DB.prepare("SELECT id, client_name, risk_level, risk_reason, next_review_at, renewal_at FROM retainer_health WHERE risk_level IN ('medium', 'high', 'critical') OR sla_status != 'ok' ORDER BY CASE risk_level WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END, next_review_at ASC LIMIT 25").all();
  const totals = await env.DB.prepare("SELECT status, COUNT(*) AS count, SUM(monthly_value_cents) AS monthly_value_cents FROM retainer_health GROUP BY status").all();
  return json({ ok: true, active_clients: active.results, risks: risks.results, totals: totals.results, next_review: "weekly" });
}
__name(retainerHealth, "retainerHealth");
async function systemAuditLog(env) {
  if (!env.DB) return json({ ok: true, version: "0.1.0", capabilities: CAPABILITIES, note: "D1 not configured yet." });
  const recent = await env.DB.prepare("SELECT id, created_at, type, lead_id, actor, surface FROM events ORDER BY created_at DESC LIMIT 50").all();
  const byType = await env.DB.prepare("SELECT type, COUNT(*) AS count FROM events GROUP BY type ORDER BY count DESC LIMIT 25").all();
  const failedJobs = await env.DB.prepare("SELECT id, created_at, type, error FROM jobs WHERE status = 'failed' ORDER BY created_at DESC LIMIT 20").all();
  return json({ ok: true, version: "0.1.0", capabilities: CAPABILITIES, events_recent: recent.results, events_by_type: byType.results, failed_jobs: failedJobs.results });
}
__name(systemAuditLog, "systemAuditLog");
var ADMIN_ANALYTICS_CONTRACT = "admin-analytics-v1";
var ANALYTICS_ZERO = { activeUsers: 0, sessions: 0, screenPageViews: 0, conversions: 0 };
var GA4_OAUTH_KV_PREFIX = "ga4:oauth:";
var GA4_READONLY_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
var GA4_DEFAULT_PROPERTY_ID = "537727417";
var GA4_LIVE_REDIRECT_URI = "https://api.mehyar.us/v1/admin/analytics/google/oauth/callback";
var GA4_LOCAL_REDIRECT_URI = "http://localhost:8787/v1/admin/analytics/google/oauth/callback";
function ga4PropertyId(env) {
  return (env.GA4_PROPERTY_ID || env.GOOGLE_ANALYTICS_PROPERTY_ID || GA4_DEFAULT_PROPERTY_ID).replace(/^properties\//, "");
}
__name(ga4PropertyId, "ga4PropertyId");
function ga4OAuthClientId(env) {
  return env.MEHYAR_GA4_OAUTH_CLIENT_ID || env.MEHYAR_GOOGLE_OAUTH_CLIENT_ID || null;
}
__name(ga4OAuthClientId, "ga4OAuthClientId");
function ga4OAuthClientSecret(env) {
  return env.MEHYAR_GA4_OAUTH_CLIENT_SECRET || env.MEHYAR_GOOGLE_OAUTH_CLIENT_SECRET || null;
}
__name(ga4OAuthClientSecret, "ga4OAuthClientSecret");
function ga4OAuthRedirectUri(request) {
  const url = new URL(request.url);
  return url.hostname === "localhost" || url.hostname === "127.0.0.1" ? GA4_LOCAL_REDIRECT_URI : GA4_LIVE_REDIRECT_URI;
}
__name(ga4OAuthRedirectUri, "ga4OAuthRedirectUri");
function missingAnalyticsEnv(env) {
  const missing = [];
  if (!env.GA4_PROPERTY_ID && !env.GOOGLE_ANALYTICS_PROPERTY_ID) missing.push("GA4_PROPERTY_ID");
  if (!ga4OAuthClientId(env)) missing.push("MEHYAR_GA4_OAUTH_CLIENT_ID or MEHYAR_GOOGLE_OAUTH_CLIENT_ID");
  if (!ga4OAuthClientSecret(env)) missing.push("MEHYAR_GA4_OAUTH_CLIENT_SECRET or MEHYAR_GOOGLE_OAUTH_CLIENT_SECRET");
  return missing;
}
__name(missingAnalyticsEnv, "missingAnalyticsEnv");
async function ga4OAuthConnected(env) {
  if (!env.KV) return false;
  return !!await env.KV.get(`${GA4_OAUTH_KV_PREFIX}refresh_token`);
}
__name(ga4OAuthConnected, "ga4OAuthConnected");
async function analyticsDiagnostics(env) {
  const missing = missingAnalyticsEnv(env);
  const connected = await ga4OAuthConnected(env);
  return {
    database: env.DB ? { status: "ok", binding: "DB" } : { status: "missing_binding", missing: ["DB"] },
    token_storage: env.KV ? { status: "ok", binding: "KV", stored_secret_values_returned: false } : { status: "missing_binding", missing: ["KV"] },
    ga4_oauth: {
      status: missing.length ? "missing_client" : connected ? "connected" : "missing_refresh_token",
      connected,
      property_id: ga4PropertyId(env),
      scope: GA4_READONLY_SCOPE,
      env_names_only: ["MEHYAR_GOOGLE_OAUTH_CLIENT_ID", "MEHYAR_GOOGLE_OAUTH_CLIENT_SECRET", "MEHYAR_GA4_OAUTH_CLIENT_ID", "MEHYAR_GA4_OAUTH_CLIENT_SECRET", "GA4_PROPERTY_ID", "GOOGLE_ANALYTICS_PROPERTY_ID"],
      missing
    },
    stripe: { status: env.DB ? "queried_if_tables_exist" : "skipped_without_database", safe: true },
    privacy: { status: "aggregate_only", pii_exposed: false, credentials_exposed: false, env_values_returned: false }
  };
}
__name(analyticsDiagnostics, "analyticsDiagnostics");
async function ga4StoreToken(env, token) {
  if (!env.KV) throw new Error("KV binding is required for Google Analytics OAuth token storage");
  if (token.refresh_token) await env.KV.put(`${GA4_OAUTH_KV_PREFIX}refresh_token`, token.refresh_token);
  if (token.access_token) {
    const ttl = Math.max(60, Math.min(3600, integer(token.expires_in, 3600) - 60));
    await env.KV.put(`${GA4_OAUTH_KV_PREFIX}access_token`, token.access_token, { expirationTtl: ttl });
  }
  await env.KV.put(`${GA4_OAUTH_KV_PREFIX}connected_at`, now());
}
__name(ga4StoreToken, "ga4StoreToken");
async function ga4RefreshAccessToken(env) {
  if (!env.KV) throw new Error("KV binding is required for Google Analytics OAuth");
  const cached = await env.KV.get(`${GA4_OAUTH_KV_PREFIX}access_token`);
  if (cached) return cached;
  const refreshToken = await env.KV.get(`${GA4_OAUTH_KV_PREFIX}refresh_token`);
  const clientId = ga4OAuthClientId(env);
  const clientSecret = ga4OAuthClientSecret(env);
  if (!refreshToken) throw new Error("Google Analytics refresh token is missing; complete browser OAuth first");
  if (!clientId || !clientSecret) throw new Error("Google Analytics OAuth client env vars are missing");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: formEncode({ refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token" })
  });
  const token = await response.json().catch(() => ({}));
  if (!response.ok || token.error || !token.access_token) throw new Error(`Google Analytics token refresh failed: ${token.error || response.status}`);
  await ga4StoreToken(env, token);
  return token.access_token;
}
__name(ga4RefreshAccessToken, "ga4RefreshAccessToken");
async function ga4RunReport(env, startDate, endDate) {
  const accessToken = await ga4RefreshAccessToken(env);
  const propertyId = ga4PropertyId(env);
  const response = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: "pagePath" }],
      metrics: [{ name: "activeUsers" }, { name: "sessions" }, { name: "screenPageViews" }, { name: "conversions" }],
      limit: 10
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) return { traffic: ANALYTICS_ZERO, pages: [], events: { ctaClicks: 0, checkoutAttempts: 0 }, error: `ga4_data_api_${response.status}` };
  const totals = Array.isArray(payload.totals) ? payload.totals[0] : void 0;
  const metricValues = Array.isArray(totals?.metricValues) ? totals?.metricValues : [];
  const metric = /* @__PURE__ */ __name((index) => integer(metricValues[index]?.value), "metric");
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  return {
    traffic: { activeUsers: metric(0), sessions: metric(1), screenPageViews: metric(2), conversions: metric(3) },
    pages: rows.map((row) => {
      const dims = Array.isArray(row.dimensionValues) ? row.dimensionValues : [];
      const metrics = Array.isArray(row.metricValues) ? row.metricValues : [];
      return { path: text(dims[0]?.value, "/"), activeUsers: integer(metrics[0]?.value), sessions: integer(metrics[1]?.value), pageViews: integer(metrics[2]?.value), conversions: integer(metrics[3]?.value) };
    }),
    events: { ctaClicks: 0, checkoutAttempts: 0 }
  };
}
__name(ga4RunReport, "ga4RunReport");
async function adminAnalyticsGoogleOAuthStart(request, env) {
  if (!env.KV) return json({ error: "kv_binding_required", missing: ["KV"] }, { status: 500 });
  const missing = missingAnalyticsEnv(env).filter((name) => name.includes("OAUTH") || name.includes("GOOGLE"));
  if (missing.length) return json({ error: "google_oauth_client_missing", missing, env_values_returned: false }, { status: 500 });
  const state = crypto.randomUUID();
  await env.KV.put(`${GA4_OAUTH_KV_PREFIX}state:${state}`, "pending", { expirationTtl: 900 });
  const redirectUri = ga4OAuthRedirectUri(request);
  const consent = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  consent.searchParams.set("client_id", ga4OAuthClientId(env));
  consent.searchParams.set("redirect_uri", redirectUri);
  consent.searchParams.set("response_type", "code");
  consent.searchParams.set("scope", GA4_READONLY_SCOPE);
  consent.searchParams.set("access_type", "offline");
  consent.searchParams.set("prompt", "consent");
  consent.searchParams.set("state", state);
  return json({ ok: true, contract: ADMIN_ANALYTICS_CONTRACT, consent_url: consent.toString(), redirect_uri: redirectUri, scope: GA4_READONLY_SCOPE, property_id: ga4PropertyId(env), safety: { admin_only: true, env_values_returned: false, client_secret_returned: false } });
}
__name(adminAnalyticsGoogleOAuthStart, "adminAnalyticsGoogleOAuthStart");
async function adminAnalyticsGoogleOAuthCallback(request, env) {
  if (!env.KV) return json({ error: "kv_binding_required", missing: ["KV"] }, { status: 500 });
  const url = new URL(request.url);
  const callbackError = url.searchParams.get("error");
  if (callbackError) return json({ error: "google_oauth_callback_error", code: callbackError, description: text(url.searchParams.get("error_description"), "") }, { status: 400 });
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return json({ error: "google_oauth_callback_missing_code_or_state" }, { status: 400 });
  const pending = await env.KV.get(`${GA4_OAUTH_KV_PREFIX}state:${state}`);
  if (!pending) return json({ error: "google_oauth_state_invalid_or_expired" }, { status: 400 });
  const clientId = ga4OAuthClientId(env);
  const clientSecret = ga4OAuthClientSecret(env);
  if (!clientId || !clientSecret) return json({ error: "google_oauth_client_missing", missing: missingAnalyticsEnv(env), env_values_returned: false }, { status: 500 });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: formEncode({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: ga4OAuthRedirectUri(request), grant_type: "authorization_code" })
  });
  const token = await response.json().catch(() => ({}));
  if (!response.ok || token.error) return json({ error: "google_oauth_token_exchange_failed", status: response.status, code: token.error || "http_error", description: text(token.error_description, "") }, { status: 502 });
  if (!token.refresh_token && !await env.KV.get(`${GA4_OAUTH_KV_PREFIX}refresh_token`)) return json({ error: "google_oauth_refresh_token_missing", message: "Re-open consent with prompt=consent and approve offline access." }, { status: 502 });
  await ga4StoreToken(env, token);
  await env.KV.delete(`${GA4_OAUTH_KV_PREFIX}state:${state}`);
  await logEvent(env, "analytics.google_oauth_connected", { surface: "oauth_callback", provider: "google", scope: GA4_READONLY_SCOPE, property_id: ga4PropertyId(env), refresh_token_stored: !!token.refresh_token }, void 0, request);
  return html('<h1 class="ok">Google Analytics connected</h1><p>Refresh token stored securely in KV. You can close this tab and return to the admin analytics dashboard.</p><p>No credential values were returned.</p>');
}
__name(adminAnalyticsGoogleOAuthCallback, "adminAnalyticsGoogleOAuthCallback");
async function adminAnalyticsOverview(request, env) {
  const diagnostics = await analyticsDiagnostics(env);
  let revenue = { totalCents: 0, paymentCount: 0, currency: "usd" };
  let offerLeads = 0;
  let opportunities = [];
  if (env.DB) {
    try {
      const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM leads WHERE source = 'micro_offer' OR service_interest LIKE '%audit%' OR metadata_json LIKE '%micro_offer%'").first();
      offerLeads = row?.count || 0;
    } catch {
    }
    try {
      const row = await env.DB.prepare("SELECT COALESCE(SUM(amount_cents),0) AS amount_cents, COUNT(*) AS count FROM billing_orders WHERE status IN ('paid','checkout_created')").first();
      revenue = { totalCents: integer(row?.amount_cents), paymentCount: integer(row?.count), currency: "usd" };
    } catch {
    }
    try {
      const rows = await env.DB.prepare("SELECT id, title, score, status, updated_at, url FROM government_opportunities ORDER BY score DESC, updated_at DESC LIMIT 10").all();
      opportunities = rows.results || [];
    } catch {
    }
  }
  const period = { startDate: new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10), endDate: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10) };
  let ga4 = { traffic: ANALYTICS_ZERO, pages: [], events: { ctaClicks: 0, checkoutAttempts: 0 } };
  if (diagnostics.ga4_oauth?.status === "connected") {
    try {
      ga4 = await ga4RunReport(env, period.startDate, period.endDate);
    } catch (error) {
      ga4.error = error instanceof Error ? error.message.replace(/Bearer\s+[^\s]+/g, "Bearer redacted") : "ga4_query_failed";
    }
  }
  const snapshot = {
    ok: env.DB ? true : false,
    contract: ADMIN_ANALYTICS_CONTRACT,
    captured_at: now(),
    provider: { name: "ga4-data-api", auth: "oauth_refresh_token", configured: missingAnalyticsEnv(env).length === 0, connected: diagnostics.ga4_oauth?.connected === true, property_id: ga4PropertyId(env) },
    diagnostics,
    period,
    traffic: ga4.traffic,
    events: ga4.events,
    pages: ga4.pages,
    offers: [{ slug: "micro-offer", path: "/micro-offer", title: "Micro Offer", pageViews: 0, activeUsers: 0, ctaClicks: 0, checkoutAttempts: 0, leadCount: offerLeads, fulfillmentCount: 0 }],
    opportunities: { top: opportunities },
    revenue,
    correlations: { offerRevenue: { totalCents: revenue.totalCents, checkoutAttempts: 0, microOfferLeads: offerLeads }, trendToTraffic: opportunities.map((opportunity) => ({ opportunityId: opportunity.id, title: opportunity.title, fitScore: integer(opportunity.score), sourceUrl: text(opportunity.url, ""), relatedPageViews: 0 })) },
    safety: { aggregate_only: true, env_values_returned: false, no_secret_logging: true }
  };
  await logEvent(env, "analytics.overview_viewed", { surface: "admin", provider: "ga4-data-api", configured: snapshot.provider.configured, connected: snapshot.provider.connected, ga4_error: ga4.error || null }, void 0, request);
  return json(snapshot);
}
__name(adminAnalyticsOverview, "adminAnalyticsOverview");
async function adminAnalyticsDiagnostics(_request, env) {
  return json({ ok: true, contract: ADMIN_ANALYTICS_CONTRACT, diagnostics: await analyticsDiagnostics(env), safety: { missing_env_names_only: true, credential_values_returned: false } });
}
__name(adminAnalyticsDiagnostics, "adminAnalyticsDiagnostics");
var COMMAND_CENTER_CONTRACT = "mehyarsoft-command-center-admin-v1";
var COMMAND_CENTER_BOARDS = ["mehyarsoft-llc", "mehyar-media", "rochelle-love", "axial-news"];
var COMMAND_CENTER_SAFE_ACTIONS = ["comment", "request_review", "acknowledge_warning", "read_only_health_check"];
var COMMAND_CENTER_FORBIDDEN_ACTION_RE = /\b(deploy|merge|push|charge|invoice|subscription|email|sms|blast|send|submit|sam\.gov submission|publish|post public|delete|drop|truncate|destructive|import audience|mass message)\b/i;
var SECRET_LIKE_RE = /(sk_live_|sk_test_|rk_live_|pk_live_|whsec_|xox[baprs]-|ghp_|github_pat_|AKIA[0-9A-Z]{16}|-----BEGIN|Bearer\s+[a-z0-9._-]+|[A-Za-z0-9_=-]{32,})/g;
var COMMAND_CENTER_ENV_GROUPS = {
  sam_gov: { label: "SAM.gov", env: ["SAM_GOV_API_KEY", "SAM_API_KEY"], gates: ["no_auto_submit", "read_only_ingest"] },
  opportunity_scout: { label: "Opportunity Scout", env: ["SERP_API_KEY", "SERPAPI_API_KEY", "GOOGLE_TRENDS_API_KEY", "SEARCHAPI_API_KEY", "APIFY_API_KEY"], gates: ["approval_before_kanban", "no_external_action"] },
  stripe: { label: "Stripe", env: ["STRIPE_MEHYARSOFT_SECRET_KEY_SANDBOX", "STRIPE_MEHYARSOFT_WEBHOOK_SECRET_SANDBOX", "STRIPE_MEHYARSOFT_PUBLISHABLE_KEY_SANDBOX", "STRIPE_MEHYARSOFT_SECRET_KEY_LIVE", "STRIPE_MEHYARSOFT_WEBHOOK_SECRET_LIVE", "STRIPE_MEHYARSOFT_LIVE_CHARGES_ENABLED"], gates: ["owner_approval_required", "live_charges_blocked_by_default"] },
  analytics: { label: "Analytics", env: ["GA4_MEASUREMENT_ID", "GTM_CONTAINER_ID"], gates: ["public_tag_ids_only", "revenue_correlation_review"] },
  compliance: { label: "Compliance / control gates", env: ["ADMIN_USERNAME", "ADMIN_PASSWORD_HASH"], gates: ["owner_only_auth", "suppression", "audit_logs", "no_secret_responses"] }
};
function parseCommandCenterJson(value) {
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === "object" && !Array.isArray(item)) : [];
  } catch {
    return [];
  }
}
__name(parseCommandCenterJson, "parseCommandCenterJson");
function sanitizeCommandCenterText(value, max = 700) {
  const raw = text(value, "") || "";
  return raw.replace(SECRET_LIKE_RE, "secret_like_redacted").replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "email_redacted").replace(/\+?\d[\d\s().-]{7,}\d/g, "phone_redacted").replace(/\s+/g, " ").trim().slice(0, max);
}
__name(sanitizeCommandCenterText, "sanitizeCommandCenterText");
function envVarStatus(env, names) {
  return names.map((name) => ({ name, present: !!env[name], value_policy: "value_present_only" }));
}
__name(envVarStatus, "envVarStatus");
function readinessState(present, total, blocked) {
  if (blocked) return "blocked";
  if (!total) return "unknown";
  if (present === total) return "ready";
  if (present > 0) return "partial";
  return "unknown";
}
__name(readinessState, "readinessState");
function commandCenterThresholds(env) {
  return {
    stale_task_hours: Math.max(1, integer(env.COMMAND_CENTER_STALE_TASK_HOURS, 24)),
    stale_watchdog_minutes: Math.max(5, integer(env.COMMAND_CENTER_STALE_WATCHDOG_MINUTES, 40))
  };
}
__name(commandCenterThresholds, "commandCenterThresholds");
function laneType(title) {
  const value = (text(title, "") || "").toLowerCase();
  if (/sam|government|proposal|contract/.test(value)) return "sam_gov";
  if (/stripe|billing|checkout|invoice|payment/.test(value)) return "stripe";
  if (/analytic|ga4|gtm|tag|event/.test(value)) return "analytics";
  if (/opportunity|scout|trend|roi|offer/.test(value)) return "opportunity_scout";
  if (/compliance|suppression|audit|approval|gate/.test(value)) return "compliance";
  return "admin_ops";
}
__name(laneType, "laneType");
function safeTaskTitle(value) {
  return sanitizeCommandCenterText(value, 180) || "Untitled task";
}
__name(safeTaskTitle, "safeTaskTitle");
function commandCenterBoardRecord(row) {
  const counts = row.counts || {};
  const done = integer(row.done ?? counts.done);
  const running = integer(row.running ?? counts.running);
  const ready = integer(row.ready ?? counts.ready);
  const todo = integer(row.todo ?? counts.todo);
  const blocked = integer(row.blocked ?? counts.blocked);
  const total = integer(row.total, done + running + ready + todo + blocked);
  return {
    board_slug: text(row.board_slug ?? row.slug, "unknown"),
    counts: { done, running, ready, todo, blocked },
    done,
    running,
    ready,
    todo,
    blocked,
    total,
    completion_percent: total ? Math.round(done / total * 1e3) / 10 : integer(row.completion_percent),
    cash_blockers: integer(row.cash_blockers),
    last_movement: text(row.last_movement ?? row.last_movement_at),
    last_movement_at: text(row.last_movement_at ?? row.last_movement),
    latest_run_status: text(row.latest_run_status, "unknown"),
    next_safe_action: sanitizeCommandCenterText(row.next_safe_action, 220) || "Review blockers only; no dispatch from API.",
    source: text(row.source, "command_center")
  };
}
__name(commandCenterBoardRecord, "commandCenterBoardRecord");
function commandCenterFallbackBoards(env) {
  const snapshot = parseCommandCenterJson(env.COMMAND_CENTER_BOARD_SNAPSHOT_JSON);
  if (snapshot.length) return snapshot.map((row) => commandCenterBoardRecord({
    board_slug: text(row.board_slug ?? row.slug, "unknown"),
    counts: row.counts || { done: integer(row.done), running: integer(row.running), ready: integer(row.ready), todo: integer(row.todo), blocked: integer(row.blocked) },
    total: integer(row.total),
    cash_blockers: integer(row.cash_blockers),
    last_movement_at: text(row.last_movement_at ?? row.last_movement),
    latest_run_status: text(row.latest_run_status, "unknown"),
    next_safe_action: sanitizeCommandCenterText(row.next_safe_action, 220),
    source: "configured_snapshot"
  }));
  return COMMAND_CENTER_BOARDS.map((slug) => commandCenterBoardRecord({ board_slug: slug, counts: { done: 0, running: 0, ready: 0, todo: 0, blocked: 0 }, completion_percent: 0, last_movement_at: null, latest_run_status: "unknown", cash_blockers: 0, next_safe_action: "No board snapshot available; review Kanban source before scaling.", source: "empty_safe_default" }));
}
__name(commandCenterFallbackBoards, "commandCenterFallbackBoards");
async function commandCenterBoards(env) {
  if (!env.DB) return commandCenterFallbackBoards(env);
  try {
    const rows = await env.DB.prepare(`SELECT b.slug AS board_slug, c.status, COUNT(*) AS count, MAX(c.updated_at) AS last_movement_at FROM kanban_boards b LEFT JOIN kanban_cards c ON c.board_id = b.id WHERE b.slug IN ('mehyarsoft-llc','mehyar-media','rochelle-love','axial-news') GROUP BY b.slug, c.status`).all();
    const grouped = /* @__PURE__ */ new Map();
    for (const slug of COMMAND_CENTER_BOARDS) grouped.set(slug, { board_slug: slug, counts: { done: 0, running: 0, ready: 0, todo: 0, blocked: 0 }, last_movement_at: null, latest_run_status: "unknown", cash_blockers: 0, next_safe_action: "Review blockers only; no dispatch from API.", source: "d1" });
    for (const row of rows.results || []) {
      const slug = text(row.board_slug, "unknown");
      const status = text(row.status, "todo");
      const item = grouped.get(slug) || { board_slug: slug, counts: {}, source: "d1" };
      const counts = item.counts;
      counts[status] = integer(row.count);
      if (text(row.last_movement_at) && (!item.last_movement_at || String(row.last_movement_at) > String(item.last_movement_at))) item.last_movement_at = row.last_movement_at;
      if (["blocked", "review", "review-required"].includes(status)) item.cash_blockers = integer(item.cash_blockers) + integer(row.count);
      grouped.set(slug, item);
    }
    return [...grouped.values()].map((item) => commandCenterBoardRecord(item));
  } catch {
    return commandCenterFallbackBoards(env);
  }
}
__name(commandCenterBoards, "commandCenterBoards");
async function commandCenterBlockers(request, env) {
  const url = new URL(request.url);
  const wantedBoard = text(url.searchParams.get("board"));
  const thresholds = commandCenterThresholds(env);
  const staleHours = integer(thresholds.stale_task_hours, 24);
  if (!env.DB) return [];
  try {
    const rows = await env.DB.prepare(`SELECT c.id, c.title, c.assignee, c.status, c.updated_at, b.slug AS board_slug, c.metadata_json FROM kanban_cards c JOIN kanban_boards b ON b.id = c.board_id WHERE (? IS NULL OR b.slug = ?) AND (c.status IN ('blocked','review','review-required') OR c.title LIKE '%review-required%' OR c.metadata_json LIKE '%review-required%') ORDER BY c.updated_at ASC LIMIT 80`).bind(wantedBoard, wantedBoard).all();
    const nowMs = Date.now();
    return (rows.results || []).map((row) => {
      const updated = text(row.updated_at);
      const age = updated ? Math.max(0, Math.round((nowMs - Date.parse(updated)) / 36e3) / 100) : null;
      const title = safeTaskTitle(row.title);
      return { task_id: text(row.id), board_slug: text(row.board_slug), title, assignee: text(row.assignee, "unassigned"), status: text(row.status, "unknown"), lane_type: laneType(title), age_hours: age, stale: typeof age === "number" ? age >= staleHours : false, review_required: /review|required/i.test(`${title} ${text(row.status, "")}`), blocker_summary: "Sanitized blocker metadata only; full task bodies redacted.", recommended_safe_manual_action: "comment_or_request_review_only", downstream_unblocks: [], repo_path: null, risk_label: typeof age === "number" && age >= staleHours ? "stale_blocker" : "blocked_lane" };
    });
  } catch {
    return [];
  }
}
__name(commandCenterBlockers, "commandCenterBlockers");
async function commandCenterReadiness(env) {
  const out = [];
  for (const [key, config] of Object.entries(COMMAND_CENTER_ENV_GROUPS)) {
    const vars = envVarStatus(env, config.env);
    const present = vars.filter((item) => item.present).length;
    const blocked = key === "stripe" && env.STRIPE_MEHYARSOFT_LIVE_CHARGES_ENABLED !== "1" && env.STRIPE_MEHYARSOFT_LIVE_CHARGES_ENABLED !== "true";
    const gates = config.gates.map((gate) => ({ name: gate, present: true, value_policy: "boolean_only" }));
    const safeActions = ["review", "comment", "request_review"];
    out.push({
      key,
      label: config.label,
      state: readinessState(present, vars.length, blocked && present > 0),
      env: vars,
      detail: `${present}/${vars.length} protected env flags present; gates are boolean/name-only and values are never returned.`,
      safe_actions: safeActions,
      env_vars: vars,
      gates,
      safe_manual_actions: safeActions,
      external_action_allowed: false
    });
  }
  return out;
}
__name(commandCenterReadiness, "commandCenterReadiness");
async function commandCenterRepoCollisions(env) {
  if (!env.DB) return [];
  try {
    const rows = await env.DB.prepare(`SELECT json_extract(metadata_json, '$.workspace_path') AS workspace_path, GROUP_CONCAT(id) AS task_ids, GROUP_CONCAT(title, ' || ') AS titles, COUNT(*) AS active_count FROM kanban_cards WHERE status IN ('todo','running','ready','blocked','review','review-required') AND json_extract(metadata_json, '$.workspace_path') IS NOT NULL GROUP BY workspace_path HAVING COUNT(*) > 1 ORDER BY active_count DESC LIMIT 40`).all();
    return (rows.results || []).map((row) => ({ workspace_path: text(row.workspace_path), active_task_ids: text(row.task_ids, "").split(",").filter(Boolean), active_task_titles: text(row.titles, "").split(" || ").map((v) => safeTaskTitle(v)).slice(0, 10), active_count: integer(row.active_count), dispatch_blocked: true, recommended_sequence: "Finish/review one workspace lane before dispatching another." }));
  } catch {
    return [];
  }
}
__name(commandCenterRepoCollisions, "commandCenterRepoCollisions");
async function commandCenterWatchdogs(env) {
  const snapshot = parseCommandCenterJson(env.COMMAND_CENTER_WATCHDOG_SNAPSHOT_JSON);
  const staleMinutes = integer(commandCenterThresholds(env).stale_watchdog_minutes, 40);
  const base = snapshot.length ? snapshot : [
    { job_name: "All Kanbans Watchdog", job_id: "c8e3753eb62c", schedule_display: "every 20m", enabled: true, state: "scheduled" },
    { job_name: "MehyarSoft Vision Improvement Agent", job_id: "781a81226cfe", schedule_display: "every 20m", enabled: true, state: "scheduled" }
  ];
  return base.map((row) => {
    const last = text(row.last_run_at);
    const stale = last ? Date.now() - Date.parse(last) > staleMinutes * 6e4 : true;
    return { job_id: text(row.job_id), job_name: sanitizeCommandCenterText(row.job_name, 120), schedule_display: text(row.schedule_display, "unknown"), enabled: row.enabled !== false, state: text(row.state, "unknown"), last_run_at: last, last_status: text(row.last_status, "unknown"), next_run_at: text(row.next_run_at), delivery_status: text(row.delivery_status, "unknown"), output_summary: sanitizeCommandCenterText(row.output_summary, 260), no_agent: row.no_agent === true, script: row.script ? "present-redacted" : null, stale };
  });
}
__name(commandCenterWatchdogs, "commandCenterWatchdogs");
async function commandCenterLastMovements(env) {
  if (!env.DB) return [];
  try {
    const rows = await env.DB.prepare(`SELECT b.slug AS board_slug, a.card_id AS task_id, a.action AS event_kind, a.actor, a.created_at, a.body FROM kanban_activity a LEFT JOIN kanban_boards b ON b.id = a.board_id ORDER BY a.created_at DESC LIMIT 50`).all();
    return (rows.results || []).map((row) => ({ board_slug: text(row.board_slug, "unknown"), task_id: text(row.task_id), event_kind: text(row.event_kind), actor: sanitizeCommandCenterText(row.actor, 80), timestamp: text(row.created_at), sanitized_payload_summary: sanitizeCommandCenterText(row.body, 180) }));
  } catch {
    return [];
  }
}
__name(commandCenterLastMovements, "commandCenterLastMovements");
function commandCenterTopAction(blockers) {
  const first = blockers.find((row) => row.lane_type === "analytics") || blockers[0];
  if (!first) return {
    label: "No cash-lane blocker found",
    revenue_lane: "admin_ops",
    urgency: "normal",
    why_it_matters: "No blocked revenue lane is visible; keep review gates clean before assigning more work.",
    safe_action_cta: "Review ready gates only; no deploy, send, charge, or submit control is available here.",
    lane_type: "admin_ops",
    safe_action: "review_ready_gates_only",
    owner_decision_needed: false,
    downstream_unblocks: []
  };
  const lane = text(first.lane_type, "cash-lane");
  const taskId = text(first.task_id);
  const stale = first.stale === true || text(first.risk_label) === "stale_blocker";
  return {
    label: `Review ${lane} blocker: ${safeTaskTitle(first.title)}`,
    revenue_lane: lane,
    urgency: stale ? "high" : "normal",
    why_it_matters: "This blocker is holding a cash-lane or deploy-readiness sequence; the safe move is human review/comment only.",
    safe_action_cta: "Open task, review checklist, then comment/request review only.",
    source_task_id: taskId,
    task_id: taskId,
    board_slug: text(first.board_slug),
    owner_decision_needed: true,
    downstream_unblocks: first.downstream_unblocks || [],
    lane_type: lane,
    safe_action: "comment_or_request_review_only"
  };
}
__name(commandCenterTopAction, "commandCenterTopAction");
async function commandCenterSummary(request, env) {
  const [boards, blockers, readiness, repoCollisions, watchdogs, lastMovements] = await Promise.all([commandCenterBoards(env), commandCenterBlockers(request, env), commandCenterReadiness(env), commandCenterRepoCollisions(env), commandCenterWatchdogs(env), commandCenterLastMovements(env)]);
  return json({ ok: true, contract: COMMAND_CENTER_CONTRACT, generated_at: now(), thresholds: commandCenterThresholds(env), top_action: commandCenterTopAction(blockers), watchdogs, boards, blockers, readiness, repo_collisions: repoCollisions, last_movements: lastMovements, safety: { env_values_returned: false, full_task_bodies_redacted: true, no_external_side_effects_performed: true } });
}
__name(commandCenterSummary, "commandCenterSummary");
async function commandCenterAction(request, env, action) {
  if (!COMMAND_CENTER_SAFE_ACTIONS.includes(action)) return json({ error: "forbidden_or_unsafe_action", allowed_actions: COMMAND_CENTER_SAFE_ACTIONS }, { status: 400 });
  const body = await readJson(request);
  const message = sanitizeCommandCenterText(body.message ?? body.comment ?? body.reason);
  if (COMMAND_CENTER_FORBIDDEN_ACTION_RE.test(message) || COMMAND_CENTER_FORBIDDEN_ACTION_RE.test(String(body.action_type || ""))) return json({ error: "forbidden_or_unsafe_action", allowed_actions: COMMAND_CENTER_SAFE_ACTIONS, no_external_side_effects_performed: true }, { status: 400 });
  const taskId = sanitizeCommandCenterText(body.task_id, 80);
  const boardSlug = COMMAND_CENTER_BOARDS.includes(text(body.board_slug, "") || "") ? text(body.board_slug) : "mehyarsoft-llc";
  const audit = { action_id: id("cmd_action"), action_type: action, actor: sanitizeCommandCenterText(body.actor, 80) || "admin", task_id: taskId || null, board_slug: boardSlug, timestamp: now(), result: "accepted_logged_only", sanitized_message: message, no_external_side_effects_performed: true };
  await logEvent(env, "command_center.manual_action", { surface: "admin", ...audit }, void 0, request);
  return json({ ok: true, contract: COMMAND_CENTER_CONTRACT, audit, safety: { no_external_side_effects_performed: true, env_values_returned: false } });
}
__name(commandCenterAction, "commandCenterAction");
async function commandCenterReadOnlyHealthCheck(request, env) {
  const body = await readJson(request);
  const message = sanitizeCommandCenterText(body.message ?? body.comment ?? body.reason ?? "Read-only Command Center health check requested.");
  if (COMMAND_CENTER_FORBIDDEN_ACTION_RE.test(message) || COMMAND_CENTER_FORBIDDEN_ACTION_RE.test(String(body.action_type || ""))) return json({ error: "forbidden_or_unsafe_action", allowed_actions: COMMAND_CENTER_SAFE_ACTIONS, no_external_side_effects_performed: true }, { status: 400 });
  const [readiness, watchdogs] = await Promise.all([commandCenterReadiness(env), commandCenterWatchdogs(env)]);
  const readinessStates = readiness.reduce((acc, row) => {
    const state = text(row.state, "unknown") || "unknown";
    acc[state] = (acc[state] || 0) + 1;
    return acc;
  }, {});
  const staleWatchdogs = watchdogs.filter((row) => row.stale === true).length;
  const audit = { action_id: id("cmd_action"), action_type: "read_only_health_check", actor: sanitizeCommandCenterText(body.actor, 80) || "admin", task_id: null, board_slug: null, timestamp: now(), result: "accepted_logged_only", sanitized_message: message, no_external_side_effects_performed: true };
  await logEvent(env, "command_center.manual_action", { surface: "admin", ...audit }, void 0, request);
  return json({ ok: true, contract: COMMAND_CENTER_CONTRACT, health_check: { mode: "read_only", status: staleWatchdogs ? "watchdog_attention" : "ok", readiness_states: readinessStates, watchdog_count: watchdogs.length, stale_watchdog_count: staleWatchdogs }, audit, safety: { no_external_side_effects_performed: true, env_values_returned: false, full_task_bodies_redacted: true } });
}
__name(commandCenterReadOnlyHealthCheck, "commandCenterReadOnlyHealthCheck");
async function handleAdminAi(request, env, path, instruction) {
  const body = await readJson(request);
  await logEvent(env, path.slice(4).replaceAll("/", "."), body, text(body.lead_id ?? body.leadId) || void 0, request);
  let jobId = null;
  if (path === "/v1/jobs") jobId = await queueJob(env, body);
  const output = await runAI(env, instruction, body);
  let reportId = null;
  if (path === "/v1/ai/proposal") reportId = await storeGeneratedReport(env, "proposal", { ...body, job_id: jobId }, output);
  return json({ ok: true, job_id: jobId, report_id: reportId, output });
}
__name(handleAdminAi, "handleAdminAi");
async function handlePublicAi(request, env, path, instruction) {
  const body = await readJson(request);
  await logEvent(env, path.slice(4).replaceAll("/", "."), body, text(body.lead_id ?? body.leadId) || void 0, request);
  let jobId = null;
  if (path === "/v1/webhooks/missed-call" || path === "/v1/booking/request") jobId = await queueJob(env, { type: path, payload_summary: safeStorageMetadata(body) });
  const output = await runAI(env, instruction, body);
  let reportId = null;
  if (path === "/v1/audit/business" || path === "/v1/audit/website") reportId = await storeGeneratedReport(env, path.endsWith("business") ? "business_audit" : "website_audit", { ...body, job_id: jobId }, output);
  return json({ ok: true, job_id: jobId, report_id: reportId, output });
}
__name(handlePublicAi, "handlePublicAi");
var index_default = {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    const url = new URL(request.url);
    const path = url.pathname;
    if (request.method === "GET" && path === "/health") {
      return json({ ok: true, service: "mehyarsoft-api", business: env.BUSINESS_NAME, version: "0.1.0", capabilities: CAPABILITIES.length, bindings: { ai: !!env.AI, db: !!env.DB, kv: !!env.KV, r2: !!env.REPORTS, queues: !!env.JOBS } });
    }
    if (request.method === "GET" && path === "/v1/capabilities") return json({ capabilities: CAPABILITIES });
    if (request.method === "GET" && path === "/v1/billing/services") return handleBillingServices(request, env);
    if (request.method === "POST" && path === "/v1/billing/checkout") return handleCreateCheckout(request, env);
    const billingSessionMatch = path.match(/^\/v1\/billing\/sessions\/([^/]+)$/);
    if (request.method === "GET" && billingSessionMatch) return handleBillingSession(request, env, decodeURIComponent(billingSessionMatch[1]));
    if (request.method === "POST" && path === "/v1/webhooks/stripe") return handleStripeWebhook(request, env);
    if (request.method === "GET" && (path === "/v1/integrations/zoho/oauth/callback" || path === "/oauth/zoho/callback")) return zohoOAuthCallback(request, env);
    if (request.method === "GET" && path === "/v1/admin/analytics/google/oauth/callback") return adminAnalyticsGoogleOAuthCallback(request, env);
    if (request.method === "POST" && path === "/v1/leads") return handleLead(request, env);
    if (request.method === "POST" && path === "/v1/newsletter/signup") return handleNewsletterSignup(request, env);
    if (request.method === "POST" && path === "/v1/newsletter/unsubscribe") return handleNewsletterUnsubscribe(request, env);
    if (request.method === "POST" && path === "/v1/admin/login") return login(request, env);
    const publicAiRoutes = {
      "/v1/ai/triage": "Score this lead for MehyarSoft offer fit and next action.",
      "/v1/audit/business": "Create a local business tech audit with problems, lost revenue risk, and paid next step.",
      "/v1/audit/website": "Analyze this website for conversion, trust, CTA, follow-up, and system gaps.",
      "/v1/webhooks/missed-call": "Summarize missed-call webhook and recommend SMS/email follow-up.",
      "/v1/notify/email": "Prepare owner notification summary for this event.",
      "/v1/booking/request": "Summarize booking request and qualification questions."
    };
    if (request.method === "POST" && publicAiRoutes[path]) return handlePublicAi(request, env, path, publicAiRoutes[path]);
    if (request.method === "POST" && path === "/v1/compliance/suppressions") return addSuppression(request, env);
    const adminPaths = ["/v1/admin/me", "/v1/admin/metrics", "/v1/admin/dashboard", "/v1/admin/subscribers.csv", "/v1/admin/rss/sources", "/v1/admin/rss/sources/bulk-test", "/v1/admin/rss/health", "/v1/admin/rss/ingest", "/v1/admin/rss/articles", "/v1/admin/notifications/intake", "/v1/admin/client-ops/reply", "/v1/admin/calendar/status", "/v1/admin/calendar/availability", "/v1/admin/calendar/book", "/v1/crm/timeline", "/v1/outreach/campaigns", "/v1/ai/email-draft", "/v1/ai/social-draft", "/v1/prospects/import", "/v1/ai/copy-risk-check", "/v1/ai/proposal", "/v1/retainers/health", "/v1/jobs", "/v1/system/audit-log", "/v1/integrations/zoho/oauth/start", "/oauth/zoho/start", "/v1/integrations/zoho/oauth/refresh", "/v1/mail/zoho/status", "/v1/mail/zoho/messages", "/v1/mail/zoho/send", "/v1/admin/mail/inbox", "/v1/admin/mail/sync", "/v1/admin/email/threads", "/v1/admin/opportunity-scout/runs", "/v1/admin/opportunity-scout/run-now", "/v1/admin/opportunity-scout/opportunities", "/v1/admin/opportunity-scout/settings", "/v1/admin/opportunity-scout/automation-gates", "/v1/admin/opportunity-scout/automation-gates/check", "/v1/admin/opportunity-scout/government/diagnostics", "/v1/admin/government/opportunities", "/v1/admin/government/ingest", "/v1/admin/trends/scans", "/v1/admin/trends/search", "/v1/admin/trends/sources", "/v1/admin/billing/ledger", "/v1/admin/newsletter/subscribers", "/v1/admin/analytics", "/v1/admin/analytics/diagnostics", "/v1/admin/command-center/summary", "/v1/admin/command-center/boards", "/v1/admin/command-center/blockers", "/v1/admin/command-center/readiness", "/v1/admin/command-center/repo-collisions", "/v1/admin/command-center/watchdogs"];
    const dynamicAdminPath = path.startsWith("/v1/admin/opportunity-scout") || path.startsWith("/v1/admin/trends") || path.startsWith("/v1/admin/government") || path.startsWith("/v1/admin/newsletter") || path.startsWith("/v1/admin/billing") || path.startsWith("/v1/admin/analytics") || path.startsWith("/v1/admin/command-center") || path.startsWith("/api/admin/command-center") || path.startsWith("/v1/admin/rss/sources/") || path.startsWith("/v1/admin/rss/articles/") || path.startsWith("/v1/admin/mail/messages/") || path.startsWith("/v1/admin/email/threads/") || path.startsWith("/v1/admin/email/drafts/");
    const adminError = adminPaths.includes(path) || dynamicAdminPath ? await requireAdmin(request, env) : null;
    if (adminError) return adminError;
    if (request.method === "GET" && path === "/v1/admin/me") return json({ ok: true, sub: "mehyar500", email: env.MEHYARSOFT_ZOHO_CONTACT_EMAIL || "info@mehyar.us", role: "owner" });
    if (request.method === "GET" && path === "/v1/admin/analytics") return adminAnalyticsOverview(request, env);
    if (request.method === "GET" && path === "/v1/admin/analytics/diagnostics") return adminAnalyticsDiagnostics(request, env);
    if (request.method === "GET" && path === "/v1/admin/analytics/google/oauth/start") return adminAnalyticsGoogleOAuthStart(request, env);
    if (request.method === "GET" && (path === "/api/admin/command-center/summary" || path === "/v1/admin/command-center/summary")) return commandCenterSummary(request, env);
    if (request.method === "GET" && (path === "/api/admin/command-center/boards" || path === "/v1/admin/command-center/boards")) return json({ ok: true, contract: COMMAND_CENTER_CONTRACT, boards: await commandCenterBoards(env), safety: { full_task_bodies_redacted: true } });
    if (request.method === "GET" && (path === "/api/admin/command-center/blockers" || path === "/v1/admin/command-center/blockers")) return json({ ok: true, contract: COMMAND_CENTER_CONTRACT, blockers: await commandCenterBlockers(request, env), safety: { full_task_bodies_redacted: true } });
    if (request.method === "GET" && (path === "/api/admin/command-center/readiness" || path === "/v1/admin/command-center/readiness")) return json({ ok: true, contract: COMMAND_CENTER_CONTRACT, readiness: await commandCenterReadiness(env), safety: { env_values_returned: false } });
    if (request.method === "GET" && (path === "/api/admin/command-center/repo-collisions" || path === "/v1/admin/command-center/repo-collisions")) return json({ ok: true, contract: COMMAND_CENTER_CONTRACT, repo_collisions: await commandCenterRepoCollisions(env) });
    if (request.method === "GET" && (path === "/api/admin/command-center/watchdogs" || path === "/v1/admin/command-center/watchdogs")) return json({ ok: true, contract: COMMAND_CENTER_CONTRACT, watchdogs: await commandCenterWatchdogs(env) });
    if (request.method === "POST" && (path === "/api/admin/command-center/actions/comment" || path === "/v1/admin/command-center/actions/comment")) return commandCenterAction(request, env, "comment");
    if (request.method === "POST" && (path === "/api/admin/command-center/actions/request-review" || path === "/v1/admin/command-center/actions/request-review")) return commandCenterAction(request, env, "request_review");
    if (request.method === "POST" && (path === "/api/admin/command-center/actions/acknowledge-warning" || path === "/v1/admin/command-center/actions/acknowledge-warning")) return commandCenterAction(request, env, "acknowledge_warning");
    if (request.method === "POST" && (path === "/api/admin/command-center/actions/health-check" || path === "/v1/admin/command-center/actions/health-check")) return commandCenterReadOnlyHealthCheck(request, env);
    if (request.method === "GET" && path === "/v1/admin/metrics") return adminMetrics(env);
    if (request.method === "GET" && path === "/v1/admin/dashboard") return adminDashboard(env);
    if (request.method === "GET" && path === "/v1/admin/billing/ledger") return adminBillingLedger(request, env);
    const billingOfferOpportunityMatch = path.match(/^\/v1\/admin\/billing\/offers\/from-opportunity\/([^/]+)$/);
    if (billingOfferOpportunityMatch && request.method === "POST") return createBillingOfferFromOpportunity(request, env, decodeURIComponent(billingOfferOpportunityMatch[1]));
    if (request.method === "GET" && path === "/v1/admin/subscribers.csv") return adminSubscribersCsv(env);
    if (request.method === "GET" && path === "/v1/admin/newsletter/subscribers") return adminNewsletterSubscribers(request, env);
    const newsletterSubscriberMatch = path.match(/^\/v1\/admin\/newsletter\/subscribers\/([^/]+)\/(promote|zoho-draft)$/);
    if (newsletterSubscriberMatch && request.method === "POST" && newsletterSubscriberMatch[2] === "promote") return promoteNewsletterSubscriber(request, env, decodeURIComponent(newsletterSubscriberMatch[1]));
    if (newsletterSubscriberMatch && request.method === "POST" && newsletterSubscriberMatch[2] === "zoho-draft") return createNewsletterZohoDraft(request, env, decodeURIComponent(newsletterSubscriberMatch[1]));
    if (request.method === "GET" && path === "/v1/admin/opportunity-scout/today") return opportunityToday(request, env);
    if (request.method === "GET" && path === "/v1/admin/opportunity-scout/runs") return opportunityRuns(request, env);
    if ((request.method === "GET" || request.method === "PATCH") && path === "/v1/admin/opportunity-scout/settings") return opportunitySettingsRoute(request, env);
    if ((request.method === "GET" || request.method === "PATCH") && path === "/v1/admin/opportunity-scout/automation-gates") return automationGatesRoute(request, env);
    if (request.method === "POST" && path === "/v1/admin/opportunity-scout/automation-gates/check") return automationGateCheckRoute(request, env);
    if (request.method === "GET" && path === "/v1/admin/opportunity-scout/sources") return opportunitySources(env);
    if (request.method === "GET" && path === "/v1/admin/trends/sources") return trendSources(env);
    if (request.method === "GET" && path === "/v1/admin/trends/scans") return trendScans(request, env);
    if (request.method === "POST" && path === "/v1/admin/trends/search") return manualTrendSearch(request, env);
    if (request.method === "GET" && path === "/v1/admin/opportunity-scout/diagnostics") return opportunityDiagnostics(env);
    if (request.method === "GET" && path === "/v1/admin/opportunity-scout/government/diagnostics") return governmentDiagnostics(env);
    if (request.method === "GET" && path === "/v1/admin/government/opportunities") return listGovernmentOpportunities(request, env);
    if (request.method === "POST" && path === "/v1/admin/government/ingest") return runGovernmentIngest(request, env);
    const governmentWorkspaceMatch = path.match(/^\/v1\/admin\/government\/opportunities\/([^/]+)\/(workspace|drafts)$/);
    if (governmentWorkspaceMatch && request.method === "GET" && governmentWorkspaceMatch[2] === "workspace") return governmentOpportunityWorkspace(request, env, decodeURIComponent(governmentWorkspaceMatch[1]));
    if (governmentWorkspaceMatch && request.method === "POST" && governmentWorkspaceMatch[2] === "drafts") return createGovernmentDraft(request, env, decodeURIComponent(governmentWorkspaceMatch[1]));
    const governmentDraftMatch = path.match(/^\/v1\/admin\/government\/drafts\/([^/]+)$/);
    if (governmentDraftMatch && request.method === "PATCH") return updateGovernmentDraft(request, env, decodeURIComponent(governmentDraftMatch[1]));
    const governmentOpportunityPatchMatch = path.match(/^\/v1\/admin\/government\/opportunities\/([^/]+)$/);
    if (governmentOpportunityPatchMatch && request.method === "PATCH") return opportunityPatch(request, env, decodeURIComponent(governmentOpportunityPatchMatch[1]));
    if (request.method === "POST" && (path === "/v1/admin/opportunity-scout/run" || path === "/v1/admin/opportunity-scout/run-now")) return json(await runOpportunityScout(env, "manual", request));
    if (request.method === "GET" && path === "/v1/admin/opportunity-scout/opportunities") return json({ ok: true, contract: OPPORTUNITY_CONTRACT, opportunities: await listOpportunityRows(env) });
    if (request.method === "POST" && path === "/v1/admin/opportunity-scout/assistant") return opportunityAssistant(request, env);
    const opportunityMatch = path.match(/^\/v1\/admin\/opportunity-scout\/opportunities\/([^/]+)(?:\/(approve|reject|regenerate|regenerate-plan|create-kanban|execution-loop))?$/);
    if (opportunityMatch && request.method === "GET" && !opportunityMatch[2]) return json({ ok: true, contract: OPPORTUNITY_CONTRACT, opportunity: (await listOpportunityRows(env)).find((row) => row.id === decodeURIComponent(opportunityMatch[1])) || null });
    if (opportunityMatch && request.method === "PATCH" && !opportunityMatch[2]) return opportunityPatch(request, env, decodeURIComponent(opportunityMatch[1]));
    if (opportunityMatch && request.method === "POST" && opportunityMatch[2] === "approve") return opportunityApproveReject(request, env, decodeURIComponent(opportunityMatch[1]), "approve");
    if (opportunityMatch && request.method === "POST" && opportunityMatch[2] === "reject") return opportunityApproveReject(request, env, decodeURIComponent(opportunityMatch[1]), "reject");
    if (opportunityMatch && request.method === "POST" && (opportunityMatch[2] === "regenerate" || opportunityMatch[2] === "regenerate-plan")) return opportunityRegenerate(request, env, decodeURIComponent(opportunityMatch[1]));
    if (opportunityMatch && request.method === "GET" && opportunityMatch[2] === "execution-loop") return opportunityExecutionLoop(env, decodeURIComponent(opportunityMatch[1]));
    if (opportunityMatch && request.method === "POST" && opportunityMatch[2] === "create-kanban") return opportunityCreateKanban(request, env, decodeURIComponent(opportunityMatch[1]));
    if (request.method === "GET" && path === "/v1/admin/rss/sources") return listRssSources(request, env);
    if (request.method === "POST" && path === "/v1/admin/rss/sources") return upsertRssSource(request, env);
    if (request.method === "POST" && path === "/v1/admin/rss/sources/bulk-test") return bulkTestRssSources(request, env);
    if (request.method === "GET" && path === "/v1/admin/rss/health") return rssHealth(env);
    if (request.method === "POST" && path === "/v1/admin/rss/ingest") return ingestRss(request, env);
    if (request.method === "GET" && path === "/v1/admin/rss/articles") return listRssArticles(request, env);
    const rssArticleMatch = path.match(/^\/v1\/admin\/rss\/articles\/([^/]+)$/);
    if (rssArticleMatch && request.method === "GET") return getRssArticle(request, env, decodeURIComponent(rssArticleMatch[1]));
    const rssMatch = path.match(/^\/v1\/admin\/rss\/sources\/([^/]+)(?:\/(test|activate|deactivate|reactivate|audit))?$/);
    if (rssMatch && request.method === "GET" && !rssMatch[2]) {
      const source = await getRssSource(env, decodeURIComponent(rssMatch[1]));
      return source ? json({ ok: true, source }) : json({ error: "rss_source_not_found" }, { status: 404 });
    }
    if (rssMatch && request.method === "PATCH" && !rssMatch[2]) return patchRssSource(request, env, decodeURIComponent(rssMatch[1]));
    if (rssMatch && request.method === "DELETE" && !rssMatch[2]) return setExistingRssSourceStatus(request, env, decodeURIComponent(rssMatch[1]), "deactivated", "source_deleted_deactivated");
    if (rssMatch && request.method === "POST" && rssMatch[2] === "test") return testRssSource(request, env, decodeURIComponent(rssMatch[1]));
    if (rssMatch && request.method === "POST" && rssMatch[2] === "activate") return setExistingRssSourceStatus(request, env, decodeURIComponent(rssMatch[1]), "active", "source_activated");
    if (rssMatch && request.method === "POST" && rssMatch[2] === "deactivate") return setExistingRssSourceStatus(request, env, decodeURIComponent(rssMatch[1]), "deactivated", "source_deactivated");
    if (rssMatch && request.method === "POST" && rssMatch[2] === "reactivate") return setExistingRssSourceStatus(request, env, decodeURIComponent(rssMatch[1]), "active", "source_reactivated");
    if (rssMatch && request.method === "GET" && rssMatch[2] === "audit") return rssSourceAudit(env, decodeURIComponent(rssMatch[1]));
    if (request.method === "POST" && path === "/v1/admin/notifications/intake") return sendOwnerIntakeNotification(request, env);
    if (request.method === "POST" && path === "/v1/admin/client-ops/reply") return sendAdminClientReply(request, env);
    if (request.method === "GET" && path === "/v1/admin/calendar/status") return calendarStatus(env);
    if (request.method === "GET" && path === "/v1/admin/calendar/availability") return calendarAvailability(request, env);
    if (request.method === "POST" && path === "/v1/admin/calendar/book") return createCalendarBooking(request, env);
    if (request.method === "POST" && path === "/v1/crm/timeline") return createCrmNote(request, env);
    if (request.method === "POST" && path === "/v1/outreach/campaigns") return createCampaign(request, env);
    if (request.method === "POST" && path === "/v1/prospects/import") return importProspects(request, env);
    if (request.method === "GET" && path === "/v1/retainers/health") return retainerHealth(env);
    if (request.method === "GET" && path === "/v1/system/audit-log") return systemAuditLog(env);
    if (request.method === "GET" && (path === "/v1/integrations/zoho/oauth/start" || path === "/oauth/zoho/start")) return zohoOAuthStart(env);
    if (request.method === "POST" && path === "/v1/integrations/zoho/oauth/refresh") return refreshZohoToken(env);
    if (request.method === "GET" && path === "/v1/mail/zoho/status") return zohoMailStatus(env);
    if (request.method === "GET" && path === "/v1/mail/zoho/messages") return readZohoMessages(request, env);
    if (request.method === "POST" && path === "/v1/mail/zoho/send") return sendZohoMessage(request, env);
    if (request.method === "GET" && (path === "/v1/admin/mail/inbox" || path === "/v1/admin/email/threads")) return adminMailInbox(request, env);
    if (request.method === "POST" && path === "/v1/admin/mail/sync") return adminMailSync(env);
    const mailMatch = path.match(/^\/v1\/admin\/mail\/messages\/([^/]+)(?:\/(draft|reply))?$/);
    if (mailMatch && request.method === "GET" && !mailMatch[2]) return adminMailMessage(request, env, decodeURIComponent(mailMatch[1]));
    if (mailMatch && request.method === "POST" && mailMatch[2] === "draft") return createAdminMailDraft(request, env, decodeURIComponent(mailMatch[1]));
    if (mailMatch && request.method === "POST" && mailMatch[2] === "reply") return sendAdminMailReply(request, env, decodeURIComponent(mailMatch[1]));
    const emailThreadMatch = path.match(/^\/v1\/admin\/email\/threads\/([^/]+)(?:\/drafts\/ai)?$/);
    if (emailThreadMatch && request.method === "GET") return adminMailMessage(request, env, decodeURIComponent(emailThreadMatch[1]));
    if (emailThreadMatch && request.method === "POST" && path.endsWith("/drafts/ai")) return createAdminMailDraft(request, env, decodeURIComponent(emailThreadMatch[1]));
    const emailDraftMatch = path.match(/^\/v1\/admin\/email\/drafts\/([^/]+)(?:\/(approve|send))?$/);
    if (emailDraftMatch && request.method === "PATCH" && !emailDraftMatch[2]) return updateAdminMailDraft(request, env, decodeURIComponent(emailDraftMatch[1]));
    if (emailDraftMatch && request.method === "POST" && emailDraftMatch[2] === "approve") return approveAdminMailDraft(request, env, decodeURIComponent(emailDraftMatch[1]));
    if (emailDraftMatch && request.method === "POST" && emailDraftMatch[2] === "send") return sendAdminMailDraft(request, env, decodeURIComponent(emailDraftMatch[1]));
    const adminAiRoutes = {
      "/v1/ai/email-draft": "Draft a concise lawful B2B prospecting email for MehyarSoft; no deceptive claims.",
      "/v1/ai/social-draft": "Draft social content for MehyarSoft founder-led consulting offer.",
      "/v1/ai/copy-risk-check": "Flag unverifiable claims, regulated-industry risk, spam language, and reputation risk.",
      "/v1/ai/proposal": "Generate a scoped proposal with offer tier, price band, deliverables, risks, and next step.",
      "/v1/jobs": "Classify this job and return execution plan."
    };
    if (request.method === "POST" && adminAiRoutes[path]) return handleAdminAi(request, env, path, adminAiRoutes[path]);
    return json({ error: "not_found", path }, { status: 404 });
  },
  async scheduled(_event, env, _ctx) {
    await scheduledInboxSync(env);
    await scheduledRssIngest(env);
    await scheduledOpportunityScout(env);
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
