// GET /api/admin/mayor/sent
//
// One-call founder inbox of outbound sends. Shows every send the Mayor has
// fired — subject, body, from/to/provider/timing — plus reply tracking so
// you can see which sends sparked replies and which got ignored.
//
// Query params:
//   limit      → cap (default 50, max 200)
//   offset     → for pagination
//   status     → comma-separated (e.g. "sent,delivered,opened")
//   provider   → filter by provider (resend | ses | sendgrid | manual_approval)
//   days       → only last N days
//   q          → LIKE match on subject / body / to_email / from_email / from_name
//   replied    → "1" = only shows that already have an inbound reply
//
// Auth: admin bearer token.

import { verifyAdminToken, json, corsHeaders } from "../../../_shared/adminAuth.js";
import { ensureSentHistorySchema } from "../../../_shared/migrateSentSends.js";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

function boundInt(s, lo, hi, fallback) {
  const n = parseInt(s, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

export async function onRequestGet({ request, env }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  // Idempotent migration: add subject/body_text/etc. columns on first call.
  await ensureSentHistorySchema(env);

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").slice(0, 100).trim();
  const statusFilter = (url.searchParams.get("status") || "").slice(0, 200).trim();
  const provider = (url.searchParams.get("provider") || "").slice(0, 64).trim();
  const days = boundInt(url.searchParams.get("days"), 0, 365, 0);
  const replied = url.searchParams.get("replied") === "1";
  const limit = boundInt(url.searchParams.get("limit"), 1, 200, 50);
  const offset = boundInt(url.searchParams.get("offset"), 0, 1_000_000, 0);

  // Always bind positional args. D1 throws on .bind(undefined).
  const where = [];
  const args = [];
  if (q) {
    where.push("(ps.subject LIKE ? OR ps.body_text LIKE ? OR ps.to_email LIKE ? OR ps.from_email LIKE ? OR ps.from_name LIKE ?)");
    const wild = `%${q}%`;
    for (let i = 0; i < 5; i++) args.push(wild);
  }
  if (statusFilter) {
    const statuses = statusFilter.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 16);
    if (statuses.length > 0) {
      where.push(`ps.status IN (${statuses.map(() => "?").join(",")})`);
      args.push(...statuses);
    }
  }
  if (provider) {
    where.push("ps.provider = ?");
    args.push(provider);
  }
  if (days > 0) {
    where.push("ps.created_at >= datetime('now', ?)");
    args.push(`-${days} days`);
  }
  if (replied) {
    where.push(`EXISTS (SELECT 1 FROM prospect_replies pr WHERE pr.send_id = ps.id)`);
  }
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";

  // Sent rows joined to:
  //  - prospects (denormalized business / domain name)
  //  - outreach_steps (template name + step-order)
  //  - prospect_drafts (status of the underlying draft, if any)
  //  - Aggregate reply count + most-recent reply classification via correlated subquery
  const rowsSql = `
    SELECT
      ps.id,
      ps.created_at,
      ps.scheduled_for,
      ps.attempted_at,
      ps.finished_at,
      ps.provider,
      ps.provider_id,
      ps.status,
      ps.channel,
      ps.subject,
      ps.body_text,
      ps.to_email,
      ps.from_email,
      ps.from_name,
      ps.reply_to,
      ps.list_unsub_header,
      ps.physical_address,
      ps.prospect_id,
      ps.draft_id,
      p.business_name                AS prospect_name,
      p.root_domain                  AS prospect_domain,
      p.stage                        AS prospect_stage,
      os.name                        AS step_name,
      os.step_order,
      os.subject_template            AS step_subject_template,
      pd.status                      AS draft_status,
      pd.body_text                   AS draft_body,
      pd.from_email                  AS draft_from_email,
      (SELECT COUNT(*) FROM prospect_replies pr WHERE pr.send_id = ps.id) AS reply_count,
      (SELECT pr.classification FROM prospect_replies pr WHERE pr.send_id = ps.id ORDER BY pr.received_at DESC LIMIT 1) AS last_reply_class,
      (SELECT pr.received_at FROM prospect_replies pr WHERE pr.send_id = ps.id ORDER BY pr.received_at DESC LIMIT 1) AS last_reply_at
    FROM prospect_sends ps
    LEFT JOIN prospects p ON p.id = ps.prospect_id
    LEFT JOIN prospect_drafts pd ON pd.id = ps.draft_id
    LEFT JOIN outreach_steps os ON os.id = pd.step_id
    ${whereSql}
    ORDER BY ps.created_at DESC
    LIMIT ? OFFSET ?
  `;
  args.push(limit, offset);

  let rows = [];
  try {
    const stmt = env.LEADS_DB.prepare(rowsSql);
    const out = await stmt.bind(...args).all();
    rows = out.results || [];
  } catch (e) {
    console.error("mayor/sent query failed", e);
    return json({ ok: false, error: "query_failed", details: String(e?.message || e) }, 500, request, env);
  }

  // Roll-ups over the WHERE (not the page): status counts + provider counts.
  const rollupSql = `
    SELECT status, COUNT(*) AS n FROM prospect_sends ${whereSql}
    GROUP BY status
  `;
  const providerRollupSql = `
    SELECT provider, COUNT(*) AS n FROM prospect_sends ${whereSql}
    GROUP BY provider
  `;
  let byStatus = {};
  let byProvider = {};
  try {
    const roll = await env.LEADS_DB.prepare(rollupSql).bind(...args.slice(0, args.length - 2)).all();
    for (const r of roll.results || []) byStatus[r.status] = r.n;
  } catch { /* ignore */ }
  try {
    const roll = await env.LEADS_DB.prepare(providerRollupSql).bind(...args.slice(0, args.length - 2)).all();
    for (const r of roll.results || []) byProvider[r.provider] = r.n;
  } catch { /* ignore */ }

  return json({
    ok: true,
    items: rows,
    total: rows.length,
    limit,
    offset,
    q,
    status_filter: statusFilter,
    provider_filter: provider,
    days,
    replied_only: replied,
    by_status: byStatus,
    by_provider: byProvider,
    updated_at: new Date().toISOString(),
  }, 200, request, env);
}
