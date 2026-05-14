import { forbidden, getGovDigest, jsonResponse, responseHeaders, runGovOpportunityIngest, verifyAdminRequest } from "../../_shared/govOpportunities.js";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: responseHeaders(request, env) });
}

export async function onRequestGet({ request, env }) {
  try {
    if (!(await verifyAdminRequest(request, env))) return forbidden(request, env);
    const digest = await getGovDigest(env);
    return jsonResponse({ ok: true, ...digest }, 200, request, env);
  } catch (error) {
    console.error("gov digest error", { error: error?.name || "unknown" });
    return jsonResponse({ ok: false, message: "Government opportunity digest unavailable." }, 500, request, env);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    if (!(await verifyAdminRequest(request, env))) return forbidden(request, env);
    const summary = await runGovOpportunityIngest({ env });
    return jsonResponse({ ok: true, summary }, 200, request, env);
  } catch (error) {
    console.error("gov ingest error", { error: error?.name || "unknown" });
    return jsonResponse({ ok: false, message: "Government opportunity ingest unavailable." }, 500, request, env);
  }
}
