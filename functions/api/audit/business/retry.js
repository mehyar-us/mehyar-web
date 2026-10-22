// functions/api/audit/business/retry.js
// POST /api/audit/business/retry — admin rebuild of a failed/stuck audit.
// Auth: Bearer AUDIT_CRON_SECRET. Body: { audit_id }
// Reuses buildAuditBusinessReport; the status lease makes it idempotent.

import { buildAuditBusinessReport } from "../../_shared/auditBusinessBuild.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env?.LEADS_DB) return json({ ok: false, error: "service_unavailable" }, 503);
    const authz = request.headers.get("authorization") || "";
    if (!env.AUDIT_CRON_SECRET || authz !== "Bearer " + env.AUDIT_CRON_SECRET) {
      return json({ ok: false, error: "unauthorized" }, 401);
    }
    const body = await request.json().catch(() => ({}));
    const auditId = String(body.audit_id || "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(auditId)) {
      return json({ ok: false, error: "invalid_audit_id" }, 400);
    }
    const res = await buildAuditBusinessReport(env, auditId);
    if (res.ok) {
      return json({ ok: true, audit_id: auditId, status: "ready", score: res.score, already_ready: !!res.already_ready });
    }
    const code = res.error === "not_found" ? 404
      : res.error === "already_running" ? 409
      : res.error === "not_paid" ? 402
      : 500;
    return json({ ok: false, error: res.error || "generation_failed" }, code);
  } catch (e) {
    console.error("audit business retry error", e && e.message);
    return json({ ok: false, error: "generation_failed" }, 500);
  }
}
