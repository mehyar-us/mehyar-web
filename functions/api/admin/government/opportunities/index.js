import { forbidden, jsonResponse, listGovOpportunities, responseHeaders, runGovOpportunityIngest, verifyAdminRequest } from "../../../_shared/govOpportunities.js";
import { getGovOpportunityBrief } from "../../../_shared/govBriefing.js";

function clampNumber(v, lo, hi, fallback) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: responseHeaders(request, env, "GET, POST, OPTIONS") });
}

export async function onRequestGet({ request, env }) {
  try {
    if (!(await verifyAdminRequest(request, env))) return forbidden(request, env);
    const opportunities = await listGovOpportunities(env, new URL(request.url));
    // Include briefs if present
    const items = await Promise.all((opportunities || []).map(async (opp) => ({
      ...opp,
      brief: await getGovOpportunityBrief(env.LEADS_DB, opp.id).catch(() => null),
    })));
    return jsonResponse({ ok: true, opportunities: items, items, briefs_included: true }, 200, request, env);
  } catch (error) {
    console.error("gov opportunities list error", { error: error?.name || "unknown" });
    return jsonResponse({ ok: false, message: "Government opportunity admin unavailable." }, 500, request, env);
  }
}
