// POST /api/admin/prospect-sources/scan
//
// Owner-triggered batch fetch + leak-score against real live URLs.
// Re-uses the shared scanner from functions/api/admin/prospect-sources/_shared/prospectScan.js.
//
// Body:
//   {
//     seed?: [{ business_name, website, root_domain, source?, vertical?, city?, email?, phone? }, ...],
//     scan_existing?: true,           // also re-scan the existing prospects
//     auto_promote?: true (default),
//     max_concurrency?: 4,
//   }

import { verifyAdminToken, json, corsHeaders } from "../../_shared/adminAuth.js";
import { runScan } from "../../_shared/prospectScan.js";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestPost({ request, env }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  let body;
  try { body = await request.json(); } catch { body = {}; }

  try {
    const out = await runScan({ env, body });
    return json(out, 200, request, env);
  } catch (e) {
    console.error("scan failed", e);
    return json({ ok: false, error: "scan_failed", details: String(e?.message || e) }, 500, request, env);
  }
}
