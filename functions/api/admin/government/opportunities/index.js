import { forbidden, jsonResponse, listGovOpportunities, responseHeaders, verifyAdminRequest } from "../../../_shared/govOpportunities.js";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: responseHeaders(request, env) });
}

export async function onRequestGet({ request, env }) {
  try {
    if (!(await verifyAdminRequest(request, env))) return forbidden(request, env);
    const opportunities = await listGovOpportunities(env, new URL(request.url));
    return jsonResponse({ ok: true, opportunities, items: opportunities }, 200, request, env);
  } catch (error) {
    console.error("gov opportunities list error", { error: error?.name || "unknown" });
    return jsonResponse({ ok: false, message: "Government opportunity admin unavailable." }, 500, request, env);
  }
}
