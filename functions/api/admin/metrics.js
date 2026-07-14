// GET /api/admin/metrics — admin-only counters for the dashboard
// Accepts either Pages HMAC JWT or Worker UUID token (see _shared/adminAuth.js).
const SAFE_FAILURE = "Admin metrics unavailable.";

import { verifyAdminToken, json, corsHeaders, isAllowedOrigin } from "../../_shared/adminAuth.js";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestGet({ request, env }) {
  try {
    if (!isAllowedOrigin(request, env)) return json({ ok: false, message: SAFE_FAILURE }, 403, request, env);
    const auth = await verifyAdminToken(request, env);
    if (!auth.ok) return json({ ok: false, message: SAFE_FAILURE }, 401, request, env);
    if (!env?.LEADS_DB) return json({ ok: false, message: "LEADS_DB binding missing." }, 503, request, env);

    const rows = await env.LEADS_DB.prepare("SELECT form_type, COUNT(*) AS count FROM leads GROUP BY form_type").all();
    const suppression = await env.LEADS_DB.prepare("SELECT COUNT(*) AS count FROM suppression_list").first();
    const latest = await env.LEADS_DB.prepare("SELECT MAX(created_at) AS updated_at FROM leads").first();
    const counts = Object.fromEntries((rows.results || []).map((row) => [row.form_type, Number(row.count || 0)]));

    return json({
      leads: Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0),
      contactRequests: Number(counts.contact || 0),
      auditRequests: Number(counts.audit || 0),
      bookingRequests: Number(counts.booking || 0),
      microOfferRequests: Number(counts.micro_offer || 0),
      newsletterRequests: Number(counts.newsletter || 0),
      suppressions: Number(suppression?.count || 0),
      updatedAt: latest?.updated_at || new Date().toISOString(),
    }, 200, request, env);
  } catch (error) {
    console.error("admin metrics error", { error: error?.name || "unknown" });
    return json({ ok: false, message: SAFE_FAILURE }, 500, request, env);
  }
}
