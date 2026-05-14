import { createGovOpportunityDraft, forbidden, jsonResponse, responseHeaders, verifyAdminRequest } from "../../../../_shared/govOpportunities.js";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: responseHeaders(request, env) });
}

export async function onRequestPost({ request, env, params }) {
  try {
    if (!(await verifyAdminRequest(request, env))) return forbidden(request, env);
    const payload = await request.json().catch(() => ({}));
    const draft = await createGovOpportunityDraft(env, params.id, payload, "owner");
    return jsonResponse({ ok: true, draft, ...draft }, 201, request, env);
  } catch (error) {
    const status = error?.message === "not_found" ? 404 : error?.message === "owner_review_only_required" || String(error?.message || "").startsWith("draft_validation_failed") ? 400 : 500;
    console.error("gov opportunity draft error", { error: error?.name || "unknown" });
    return jsonResponse({ ok: false, message: status === 404 ? "Opportunity not found." : status === 400 ? "Draft guardrails rejected the request." : "Government opportunity admin unavailable." }, status, request, env);
  }
}
