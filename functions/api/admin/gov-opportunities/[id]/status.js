import { forbidden, jsonResponse, responseHeaders, updateGovOpportunityStatus, verifyAdminRequest } from "../../../_shared/govOpportunities.js";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: responseHeaders(request, env) });
}

export async function onRequestPost({ request, env, params }) {
  try {
    if (!(await verifyAdminRequest(request, env))) return forbidden(request, env);
    const payload = await request.json().catch(() => ({}));
    const result = await updateGovOpportunityStatus(env, params.id, payload, "owner");
    return jsonResponse({ ok: true, ...result }, 200, request, env);
  } catch (error) {
    const status = error?.message === "invalid_status" ? 400 : 500;
    console.error("gov opportunity status error", { error: error?.name || "unknown" });
    return jsonResponse({ ok: false, message: status === 400 ? "Invalid opportunity status." : "Government opportunity admin unavailable." }, status, request, env);
  }
}
