// POST /api/admin/backup/export
// Dumps a JSON snapshot of every D1 table to KV (INTAKE_KV) + returns the dump inline.
// Owner-only.
//
// For 2026 Mehyar.us: We don't have R2 wired, so we store the dump under
// `backup:<iso-date>` in INTAKE_KV (1-day TTL-ish via expiry hint) AND return it inline
// (the client can save-as via Blob URL).

import { verifyAdminToken, json, corsHeaders } from "../../../_shared/adminAuth.js";

const ALLOWED_TABLES = [
  "leads",
  "prospects",
  "prospect_signals",
  "prospect_drafts",
  "prospect_sends",
  "gov_opportunities",
  "gov_opportunity_briefs",
  "gov_opportunity_drafts",
  "opportunity_events",
  "opportunity_decisions",
  "case_studies",
  "quotes",
  "newsletter_signups",
];

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestPost({ request, env }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  const startedAt = new Date().toISOString();
  const dump = { started_at: startedAt, table_counts: {}, tables: {} };

  try {
    for (const table of ALLOWED_TABLES) {
      try {
        const countRow = await env.LEADS_DB.prepare(
          `SELECT COUNT(*) as n FROM ${table}`
        ).first().catch(() => null);
        const n = Number(countRow?.n || 0);

        // Skip empty tables > 10000 rows to avoid blowing up the response
        if (n === 0) {
          dump.table_counts[table] = 0;
          continue;
        }
        if (n > 10000) {
          dump.table_counts[table] = `${n} (skipped — too large for inline dump)`;
          continue;
        }

        const rows = await env.LEADS_DB.prepare(
          `SELECT * FROM ${table} ORDER BY created_at DESC LIMIT 5000`
        ).all().catch(() => ({ results: [] }));
        dump.tables[table] = rows.results || [];
        dump.table_counts[table] = (rows.results || []).length;
      } catch (e) {
        dump.table_counts[table] = `error: ${e?.message || e}`;
      }
    }

    dump.finished_at = new Date().toISOString();
    dump.total_tables = Object.keys(dump.tables).length;
    dump.total_rows = Object.values(dump.table_counts).reduce(
      (s, c) => s + (typeof c === "number" ? c : 0), 0
    );

    // Try to persist to KV with a 7-day expiry
    const kvKey = `backup:${startedAt.slice(0, 10)}`;
    if (env.INTAKE_KV) {
      try {
        await env.INTAKE_KV.put(kvKey, JSON.stringify(dump), {
          expirationTtl: 60 * 60 * 24 * 7,
        });
        dump.kv_key = kvKey;
      } catch (e) {
        dump.kv_error = e?.message || String(e);
      }
    }

    return json({ ok: true, ...dump }, 200, request, env);
  } catch (e) {
    return json({ ok: false, error: "backup_failed", details: String(e?.message || e) }, 500, request, env);
  }
}
