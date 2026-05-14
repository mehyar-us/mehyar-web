import { forbidden, getGovOpportunityWorkspace, jsonResponse, responseHeaders, updateGovOpportunityStatus, verifyAdminRequest } from "../../../../_shared/govOpportunities.js";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: responseHeaders(request, env, "GET, PATCH, OPTIONS") });
}

export async function onRequestGet({ request, env, params }) {
  try {
    if (!(await verifyAdminRequest(request, env))) return forbidden(request, env);
    const workspace = await getGovOpportunityWorkspace(env, params.id);
    if (!workspace) return jsonResponse({ ok: false, message: "Opportunity not found." }, 404, request, env);
    return jsonResponse({ ok: true, ...workspace }, 200, request, env);
  } catch (error) {
    console.error("gov opportunity get error", { error: error?.name || "unknown" });
    return jsonResponse({ ok: false, message: "Government opportunity admin unavailable." }, 500, request, env);
  }
}

export async function onRequestPatch({ request, env, params }) {
  try {
    if (!(await verifyAdminRequest(request, env))) return forbidden(request, env);
    const payload = await request.json().catch(() => ({}));
    const result = await updateGovOpportunityStatus(env, params.id, payload, "owner");
    return jsonResponse({ ok: true, opportunity: result, ...result }, 200, request, env);
  } catch (error) {
    const status = error?.message === "invalid_status" ? 400 : 500;
    console.error("gov opportunity patch error", { error: error?.name || "unknown" });
    return jsonResponse({ ok: false, message: status === 400 ? "Invalid opportunity status." : "Government opportunity admin unavailable." }, status, request, env);
  }
}
