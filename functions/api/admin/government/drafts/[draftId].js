import { forbidden, jsonResponse, responseHeaders, updateGovDraft, verifyAdminRequest } from "../../../_shared/govOpportunities.js";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: responseHeaders(request, env, "PATCH, OPTIONS") });
}

export async function onRequestPatch({ request, env, params }) {
  try {
    if (!(await verifyAdminRequest(request, env))) return forbidden(request, env);
    const payload = await request.json().catch(() => ({}));
    const draft = await updateGovDraft(env, params.draftId, payload, "owner");
    return jsonResponse({ ok: true, draft, ...draft }, 200, request, env);
  } catch (error) {
    const status = error?.message === "not_found" ? 404 : error?.message === "invalid_status" || error?.message === "owner_review_only_required" ? 400 : 500;
    console.error("gov draft patch error", { error: error?.name || "unknown" });
    return jsonResponse({ ok: false, message: status === 404 ? "Draft not found." : status === 400 ? "Draft guardrails rejected the request." : "Government opportunity admin unavailable." }, status, request, env);
  }
}
