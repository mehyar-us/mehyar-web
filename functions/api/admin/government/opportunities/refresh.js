// POST /api/admin/government/opportunities/refresh
// Body: { limit?: number, keywords?: string }
// Auth: GOV_INGEST_TOKEN env var passed as Authorization: Bearer (separate
// from the user-session HMAC JWT). This is the cron-trigger endpoint so an
// external scheduler (cron-job.org, Hermes cron, etc.) can fire it without
// owning a user session.

import { forbidden, jsonResponse, responseHeaders, runGovOpportunityIngest } from "../../../_shared/govOpportunities.js";

function clampNumber(v, lo, hi, fallback) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

export function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: responseHeaders(request, env, "POST, OPTIONS") });
}

export async function onRequestPost({ request, env }) {
  if (!env?.LEADS_DB) return jsonResponse({ ok: false, message: "missing_db" }, 500, request, env);
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const expected = env.GOV_INGEST_TOKEN || env.MEHYARSOFT_GOV_INGEST_TOKEN || "";
  if (!expected || !token || token !== expected) {
    return jsonResponse({ ok: false, message: "missing_or_bad_ingest_token" }, 401, request, env);
  }
  try {
    const body = await request.json().catch(() => ({}));
    const limit = clampNumber(body?.limit, 5, 100, parseInt(env.GOV_INGEST_LIMIT || "40", 10) || 40);
    if (body?.keywords && typeof body.keywords === "string") {
      env.GOV_OPPORTUNITY_KEYWORDS = body.keywords;
    }
    env.GOV_INGEST_LIMIT = String(limit);
    const summary = await runGovOpportunityIngest({ env });
    // Debug surface — only when explicitly requested in body
    const debug = body?.debug === true ? {
      env_keys: Object.keys(env || {}).filter(k => !k.startsWith("_")).sort(),
      sam_api_key_present: Boolean(env?.SAM_GOV_API_KEY || env?.SAM_API_KEY || env?.MEHYARSOFT_SAM_API_KEY),
      sam_api_key_lengths: {
        MEHYARSOFT_SAM_API_KEY: env?.MEHYARSOFT_SAM_API_KEY?.length || 0,
        SAM_API_KEY: env?.SAM_API_KEY?.length || 0,
        SAM_GOV_API_KEY: env?.SAM_GOV_API_KEY?.length || 0,
      },
      llm_api_key_present: Boolean(env?.LLM_API_KEY),
      llm_base_url: env?.LLM_BASE_URL || "",
      llm_model: env?.LLM_MODEL || "",
      gov_naics: env?.GOV_NAICS || "",
    } : undefined;
    return jsonResponse({ ok: true, summary, debug }, 200, request, env);
  } catch (error) {
    console.error("gov refresh error", { error: error?.name || "unknown", message: error?.message || "" });
    return jsonResponse({ ok: false, message: "refresh_failed", error: String(error?.message || error?.name || "unknown") }, 500, request, env);
  }
}