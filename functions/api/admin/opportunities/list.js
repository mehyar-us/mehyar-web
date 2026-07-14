// GET /api/admin/opportunities/list?kind=prospect|sam|all&stage=&q=&limit=&offset=
// Unified list of both kinds. Each row carries `kind` so the SPA can dispatch.

import { verifyAdminToken, json, corsHeaders } from "../../_shared/adminAuth.js";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestGet({ request, env }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") || "all";
  const stage = url.searchParams.get("stage") || "";
  const q = (url.searchParams.get("q") || "").slice(0, 100).trim();
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "60", 10) || 60, 200);
  const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10) || 0, 0);

  try {
    const items = [];

    if (kind === "all" || kind === "prospect") {
      const a = await env.LEADS_DB.prepare(buildProspectSql(stage, q)).bind(...bindArgs(stage, q, limit, offset)).all().catch((e) => ({ error: String(e?.message || e) }));
      if (!a.error) items.push(...mapProspects(a.results || []));
    }
    if (kind === "all" || kind === "sam") {
      const a = await env.LEADS_DB.prepare(buildSamSql(stage, q)).bind(...bindArgs(stage, q, limit, offset)).all().catch((e) => ({ error: String(e?.message || e) }));
      if (!a.error) items.push(...mapSam(a.results || []));
    }

    // Sort: last_touched_at desc, with deadline soonest first when same day
    items.sort((a, b) => {
      const ta = new Date(a.last_touched_at || a.updated_at || a.created_at || 0).getTime();
      const tb = new Date(b.last_touched_at || b.updated_at || b.created_at || 0).getTime();
      return tb - ta;
    });

    return json({ ok: true, items, total: items.length, limit, offset, kind, stage, q, updatedAt: new Date().toISOString() }, 200, request, env);
  } catch (err) {
    console.error("opportunities list error", err);
    return json({ ok: false, error: "unhandled", details: String(err?.message || err) }, 500, request, env);
  }
}

function buildProspectSql(stage, q) {
  const conds = [];
  const args = [];
  if (q) {
    conds.push("(business_name LIKE ? OR root_domain LIKE ? OR website LIKE ? OR email LIKE ?)");
    const w = `%${q}%`;
    args.push(w, w, w, w);
  }
  if (stage) { conds.push("stage = ?"); args.push(stage); }
  const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
  return `
    SELECT p.id, p.business_name, p.website, p.root_domain, p.email, p.phone,
           p.vertical, p.city, p.region, p.country, p.status, p.stage,
           p.last_scanned_at, p.last_drafted_at, p.last_sent_at,
           p.last_touched_at, p.created_at,
           (SELECT leak_score FROM prospect_signals WHERE prospect_id = p.id ORDER BY scanned_at DESC LIMIT 1) AS leak_score,
           (SELECT detected_platform FROM prospect_signals WHERE prospect_id = p.id ORDER BY scanned_at DESC LIMIT 1) AS detected_platform
    FROM prospects p
    ${where}
    ORDER BY p.last_touched_at DESC
    LIMIT ? OFFSET ?`;
}

function buildSamSql(stage, q) {
  const conds = [];
  const args = [];
  if (q) {
    conds.push("(title LIKE ? OR agency LIKE ? OR source_id LIKE ? OR summary LIKE ?)");
    const w = `%${q}%`;
    args.push(w, w, w, w);
  }
  if (stage) { conds.push("stage = ?"); args.push(stage); }
  const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
  return `
    SELECT id, title, agency, office, opportunity_type, status, stage,
           response_deadline, posted_date, fit_score, confidence,
           set_aside, source, source_id, source_url,
           last_touched_at, created_at, updated_at
    FROM gov_opportunities
    ${where}
    ORDER BY (response_deadline IS NULL), response_deadline ASC, last_touched_at DESC
    LIMIT ? OFFSET ?`;
}

function bindArgs(stage, q, limit, offset) {
  const a = [];
  if (q) for (let i = 0; i < (stage ? 4 : 4); i++) a.push(`%${q}%`);
  if (stage) a.push(stage);
  a.push(limit, offset);
  return a;
}

function mapProspects(rows) {
  return rows.map((r) => ({
    kind: "prospect",
    id: r.id,
    title: r.business_name,
    subtitle: r.root_domain || r.website || "(no website)",
    subsubtitle: [r.vertical, r.city, r.country].filter(Boolean).join(" · "),
    status: r.status,
    stage: r.stage || "Discovery",
    email: r.email,
    phone: r.phone,
    leak_score: r.leak_score == null ? null : Number(r.leak_score),
    detected_platform: r.detected_platform,
    last_touched_at: r.last_touched_at || r.updated_at || r.created_at,
    last_event_at: r.last_sent_at || r.last_drafted_at || r.last_scanned_at,
    href: `/admin/opportunities/${encodeURIComponent(r.id)}?kind=prospect`,
    deadline: null,
    agency: null,
    fit_score: null,
  }));
}

function mapSam(rows) {
  return rows.map((r) => ({
    kind: "sam",
    id: r.id,
    title: r.title,
    subtitle: r.agency || "",
    subsubtitle: r.office || r.opportunity_type || "",
    status: r.status,
    stage: r.stage || "Discovery",
    email: null,
    phone: null,
    leak_score: null,
    detected_platform: null,
    last_touched_at: r.last_touched_at || r.updated_at || r.created_at,
    last_event_at: r.updated_at || r.posted_date,
    href: `/admin/opportunities/${encodeURIComponent(r.id)}?kind=sam`,
    deadline: r.response_deadline,
    agency: r.agency,
    fit_score: r.fit_score == null ? null : Number(r.fit_score),
    set_aside: r.set_aside,
    opportunity_type: r.opportunity_type,
  }));
}
