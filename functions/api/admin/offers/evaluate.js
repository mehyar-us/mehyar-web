import { evaluateLeadForOffer, persistOfferEvaluation, writeOfferAudit } from "../../_shared/offerFulfillment.js";

const SAFE_FAILURE = "Offer evaluation unavailable.";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestGet({ request, env }) {
  try {
    const auth = await requireAdmin(request, env);
    if (!auth.ok) return json({ ok: false, message: SAFE_FAILURE }, auth.status, request, env);
    if (!env?.LEADS_DB) return json({ ok: false, message: "LEADS_DB binding missing." }, 503, request, env);

    const url = new URL(request.url);
    const leadId = sanitize(url.searchParams.get("lead_id") || "", 80);
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") || "25")));
    const sql = leadId
      ? `SELECT e.*, l.email, l.name, l.company, l.form_type FROM lead_offer_evaluations e LEFT JOIN leads l ON l.id = e.lead_id WHERE e.lead_id = ? LIMIT 1`
      : `SELECT e.*, l.email, l.name, l.company, l.form_type FROM lead_offer_evaluations e LEFT JOIN leads l ON l.id = e.lead_id ORDER BY e.updated_at DESC LIMIT ?`;
    const statement = env.LEADS_DB.prepare(sql).bind(leadId || limit);
    const result = leadId ? await statement.first() : await statement.all();
    const rows = leadId ? (result ? [result] : []) : (result.results || []);
    return json({ ok: true, evaluations: rows.map(serializeEvaluationRow) }, 200, request, env);
  } catch (error) {
    console.error("offer evaluation list error", { error: error?.name || "unknown" });
    return json({ ok: false, message: SAFE_FAILURE }, 500, request, env);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const auth = await requireAdmin(request, env);
    if (!auth.ok) return json({ ok: false, message: SAFE_FAILURE }, auth.status, request, env);
    if (!(request.headers.get("content-type") || "").includes("application/json")) {
      return json({ ok: false, message: SAFE_FAILURE }, 415, request, env);
    }
    const body = await request.json().catch(() => ({}));
    const leadId = sanitize(body.lead_id || body.id || "", 80);
    const lead = leadId && env?.LEADS_DB ? await loadLead(env, leadId) : sanitizeLeadInput(body.lead || body);
    if (!lead) return json({ ok: false, message: "Lead not found or invalid." }, 404, request, env);

    const evaluation = evaluateLeadForOffer(lead);
    if (env?.LEADS_DB && (lead.id || leadId)) {
      const persistedLeadId = lead.id || leadId;
      await persistOfferEvaluation(env, persistedLeadId, evaluation);
      await writeOfferAudit(env, persistedLeadId, "offer_evaluated_admin", {
        lead_classification: evaluation.lead_classification,
        service_fit_score: evaluation.service_fit_score,
        offer_id: evaluation.offer_recommendation.offer_id,
        owner_review_status: evaluation.owner_review_status,
        send_allowed: evaluation.send_allowed,
        actor: auth.sub,
      });
    }

    return json({ ok: true, evaluation }, 200, request, env);
  } catch (error) {
    console.error("offer evaluation error", { error: error?.name || "unknown" });
    return json({ ok: false, message: SAFE_FAILURE }, 500, request, env);
  }
}

async function loadLead(env, leadId) {
  const row = await env.LEADS_DB.prepare(`SELECT id, form_type, name, email, phone, company, website, service_interest, budget_range, timeline, message, consent_contact, consent_marketing FROM leads WHERE id = ? LIMIT 1`)
    .bind(leadId)
    .first();
  return row || null;
}

function serializeEvaluationRow(row) {
  return {
    lead_id: row.lead_id,
    updated_at: row.updated_at,
    lead: {
      email: row.email,
      name: row.name,
      company: row.company,
      form_type: row.form_type,
    },
    lead_classification: row.lead_classification,
    service_fit_score: Number(row.service_fit_score || 0),
    offer_recommendation: {
      offer_id: row.offer_id,
      title: row.offer_title,
    },
    ai_draft_follow_up: {
      subject: row.draft_subject,
      body: row.draft_body,
      draft_only: true,
    },
    admin_status: {
      owner_review_status: row.owner_review_status,
      fulfillment_status: row.fulfillment_status,
      send_allowed: Number(row.send_allowed || 0) === 1,
    },
    audit_summary: parseJson(row.audit_summary_json),
    zoho_hooks: parseJson(row.zoho_hooks_json),
  };
}

function sanitizeLeadInput(input) {
  if (!input || typeof input !== "object") return null;
  const email = sanitize(input.email, 254).toLowerCase();
  if (!email || !email.includes("@")) return null;
  return {
    id: sanitize(input.id, 80),
    form_type: sanitize(input.form_type || "contact", 40),
    name: sanitize(input.name, 120),
    email,
    phone: sanitize(input.phone, 80),
    company: sanitize(input.company, 160),
    website: sanitize(input.website, 300),
    service_interest: sanitize(input.service_interest, 160),
    budget_range: sanitize(input.budget_range, 120),
    timeline: sanitize(input.timeline, 120),
    message: sanitize(input.message, 3000),
    consent_contact: input.consent_contact === true || input.consent_contact === 1,
    consent_marketing: input.consent_marketing === true || input.consent_marketing === 1,
  };
}

async function requireAdmin(request, env) {
  if (!isAllowedOrigin(request, env)) return { ok: false, status: 403 };
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const secret = env?.ADMIN_SESSION_SECRET || env?.HMAC_SECRET || "";
  const session = secret ? await verifyToken(token, secret) : null;
  return session ? { ok: true, status: 200, sub: session.sub } : { ok: false, status: 401 };
}

async function verifyToken(token, secret) {
  try {
    const [encodedPayload, signature] = token.split(".");
    if (!encodedPayload || !signature) return null;
    const expected = await hmacSha256(secret, encodedPayload);
    if (!timingSafeEqual(signature, expected)) return null;
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(encodedPayload)));
    if (!payload?.sub || !payload?.exp || Number(payload.exp) < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

async function hmacSha256(secret, value) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return base64UrlEncodeBytes(new Uint8Array(signature));
}

function base64UrlEncodeBytes(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}

function isAllowedOrigin(request, env) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const allowed = (env?.ALLOWED_ORIGINS || "https://mehyar.us,https://www.mehyar.us,http://localhost:5173,http://127.0.0.1:5173")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (allowed.includes(origin)) return true;
  try {
    const host = new URL(origin).hostname;
    return host.endsWith(".pages.dev") && env?.ENVIRONMENT !== "production";
  } catch {
    return false;
  }
}

function corsHeaders(request, env) {
  const origin = request.headers.get("origin");
  const allowedOrigin = origin && isAllowedOrigin(request, env) ? origin : "https://mehyar.us";
  return {
    "access-control-allow-origin": allowedOrigin,
    "vary": "Origin",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
  };
}

function json(body, status, request, env) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...corsHeaders(request, env) },
  });
}

function parseJson(value) {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function sanitize(value, max) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}
