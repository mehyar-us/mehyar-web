import { forbidden, getGovOpportunityWorkspace, jsonResponse, responseHeaders, verifyAdminRequest } from "../../../../_shared/govOpportunities.js";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: responseHeaders(request, env) });
}

export async function onRequestGet({ request, env, params }) {
  try {
    if (!(await verifyAdminRequest(request, env))) return forbidden(request, env);
    const workspace = await getGovOpportunityWorkspace(env, params.id);
    if (!workspace) return jsonResponse({ ok: false, message: "Opportunity not found." }, 404, request, env);
    return jsonResponse({ ok: true, workspace, ...workspace }, 200, request, env);
  } catch (error) {
    console.error("gov opportunity workspace error", { error: error?.name || "unknown" });
    return jsonResponse({ ok: false, message: "Government opportunity admin unavailable." }, 500, request, env);
  }
}
