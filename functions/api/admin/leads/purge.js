// POST /api/admin/leads/purge — Owner-only one-shot cleanup of test/QA leads.
//
// SELECTs all leads and DELETEs rows matching any of these patterns:
//   - email matches (case-insensitive): %acceptance% %qa% %example.com
//   - name matches (case-insensitive): %acceptance% %qa% %hot zero% %live checklist% %owner notify%
//   - email is exactly mrswelim@gmail.com … KEEP one row
//
// Dry-run by default (?dryRun=1) returns the list of IDs that would be
// deleted without touching anything. Set ?confirm=DELETE to actually delete.
//
// All runs append to the cron_runs table so /admin can show what happened.

import { verifyAdminToken, json, corsHeaders } from "../../_shared/adminAuth.js";

const TEST_PATTERNS = [
  "acceptance",
  "qa+",
  "qa@",
  "qa@example",
  "live checklist",
  "owner notify",
  "hot zero",
  "hotzero",
  "qa ",
  " test ",
  "internal acc",
  "mehyarsoft acc",
  "disabled+1",
];

function matchesText(row) {
  const text = [
    String(row.name || ""),
    String(row.email || ""),
    String(row.message || ""),
  ].join(" ").toLowerCase();
  if (text.includes("@mehyar.us") && !text.includes("acceptance") && !text.includes("hotzero") && !text.includes("qa+")) return false;
  for (const p of TEST_PATTERNS) {
    if (text.includes(p.toLowerCase())) return true;
  }
  // Also catch the explicit test email addresses
  const email = String(row.email || "").toLowerCase();
  if (email.endsWith("@example.com")) return true;
  if (email.includes("+acceptance+") || email.includes("+qa+") || email.includes("+qa@")) return true;
  if (email.startsWith("hotzero+")) return true;
  if (email === "owner-notify-qa@example.com") return true;
  return false;
}

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestPost({ request, env }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") === "1";
  const confirm = url.searchParams.get("confirm");
  if (!dryRun && confirm !== "DELETE") {
    return json({ ok: false, error: "dry_run_required", message: "Re-run with ?confirm=DELETE to actually delete." }, 400, request, env);
  }

  try {
    const all = await env.LEADS_DB.prepare(`SELECT id, created_at, name, email, form_type, status FROM leads ORDER BY created_at ASC`).all();
    const matches = (all.results || []).filter(matchesText);
    const ids = matches.map((r) => r.id);

    if (dryRun) {
      await logCronRun(env, "leads.purge", { dryRun: true, matched: ids.length, totalLeads: (all.results || []).length, request_kind: "owner" });
      return json({
        ok: true,
        dryRun: true,
        matched: ids.length,
        totalLeads: (all.results || []).length,
        preview: matches.map((r) => ({ id: r.id, name: r.name, email: r.email, form: r.form_type })),
      }, 200, request, env);
    }

    // Real delete — chunk in case the table is large.
    let deleted = 0;
    const chunkSize = 50;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const placeholders = chunk.map(() => "?").join(",");
      const result = await env.LEADS_DB.prepare(`DELETE FROM leads WHERE id IN (${placeholders})`).bind(...chunk).run();
      deleted += (result?.meta?.changes || 0);
    }

    await logCronRun(env, "leads.purge", { ok: true, deleted, totalLeads: (all.results || []).length, request_kind: "owner" });

    return json({
      ok: true,
      deleted,
      totalLeads: (all.results || []).length,
      remaining: (all.results || []).length - deleted,
    }, 200, request, env);
  } catch (err) {
    console.error("leads.purge failed", err);
    return json({ ok: false, error: "unhandled", details: String(err?.message || err) }, 500, request, env);
  }
}

async function logCronRun(env, name, payload) {
  try {
    await env.LEADS_DB.prepare(`CREATE TABLE IF NOT EXISTS cron_runs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`).run();
    await env.LEADS_DB.prepare(`INSERT INTO cron_runs (id, name, payload_json, created_at) VALUES (?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), name, JSON.stringify(payload), new Date().toISOString())
      .run();
  } catch (e) {
    console.error("cron_runs log failed", e);
  }
}
