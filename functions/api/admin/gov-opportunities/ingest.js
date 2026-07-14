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
    // Allow either admin OR a service-side X-Gov-Ingest-Token header so the
    // mehyar-cron Worker can trigger ingest from CF scheduling without a JWT.
    let authorized = false;
    const headerToken = (request.headers.get("x-gov-ingest-token") || "").trim();
    const expectedToken = (env?.GOV_INGEST_TOKEN || env?.SAM_INGEST_TOKEN || "").trim();
    if (headerToken && expectedToken && headerToken === expectedToken) authorized = true;
    if (!authorized && !(await verifyAdminRequest(request, env))) return forbidden(request, env);
    const summary = await runGovOpportunityIngest({ env, now: new Date() });
    return jsonResponse({ ok: true, summary }, 200, request, env);
  } catch (error) {
    console.error("gov ingest error", { error: error?.name || "unknown" });
    return jsonResponse({ ok: false, message: "Government opportunity ingest unavailable." }, 500, request, env);
  }
}
