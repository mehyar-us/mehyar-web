// /api/admin/leads
// Unified CRM list — prospects + SAM.gov opportunities in one stream.
//
// Query params:
//   q       search string (lowercased — matches name, agency, domain, email, city)
//   kind    "all" | "prospect" | "sam"
//   stage   filter by stage
//   sort    "deadline_asc" | "leak_desc" | "fit_desc" | "created_desc"
//   focus   an opportunity id (returns top of list pinned)
//   limit   int (default 100)
//
// Each item has shape:
//   { kind, id, title, subtitle, stage, fit_score, leak_score, email, phone,
//     city, deadline_in_days, ai_suggestion, sort_key }
//
// /api/admin/leads/<id>?kind=prospect|sam → detail
// /api/admin/leads/<id>/stage?kind=... → POST stage update
// /api/admin/leads/<id>/deep-evaluate?kind=... → POST LLM multi-service + multi-price
// /api/admin/leads/bulk → POST bulk actions

import { verifyAdminToken, json, corsHeaders } from "../_shared/adminAuth.js";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestGet({ request, env }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  const url = new URL(request.url);
  const q = String(url.searchParams.get("q") || "").trim().toLowerCase();
  const kind = url.searchParams.get("kind") || "all";
  const stage = String(url.searchParams.get("stage") || "").trim();
  const sort = url.searchParams.get("sort") || "created_desc";
  const focus = url.searchParams.get("focus");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "100", 10) || 100, 200);

  try {
    const items = [];
    const focusId = focus || null;

    // ── Prospects ─────────────────────────────────────────────────────
    if (kind === "all" || kind === "prospect") {
      let sql = `SELECT p.id, p.business_name, p.website, p.root_domain, p.email, p.phone,
                        p.city, p.vertical, p.status as stage, p.created_at, p.last_contact_at,
                        s.leak_score
                 FROM prospects p
                 LEFT JOIN prospect_signals s ON s.id = (SELECT id FROM prospect_signals WHERE prospect_id = p.id ORDER BY scanned_at DESC LIMIT 1)
                 WHERE p.root_domain NOT LIKE '%.example.com'
                   AND p.root_domain NOT LIKE 'example.com'
                   AND p.root_domain NOT LIKE '%.test'
                   AND p.root_domain NOT LIKE '%.invalid'
                   AND p.root_domain NOT LIKE '%.localhost'`;
      const params = [];
      if (q) {
        sql += ` AND (LOWER(IFNULL(p.business_name,'')) LIKE ? OR LOWER(p.root_domain) LIKE ? OR LOWER(IFNULL(p.email,'')) LIKE ? OR LOWER(IFNULL(p.city,'')) LIKE ? OR LOWER(IFNULL(p.vertical,'')) LIKE ?)`;
        const like = `%${q}%`;
        params.push(like, like, like, like, like);
      }
      if (stage) { sql += ` AND p.status = ?`; params.push(stage); }
      if (sort === "leak_desc") sql += ` ORDER BY s.leak_score DESC NULLS LAST`;
      else if (sort === "created_desc") sql += ` ORDER BY p.created_at DESC`;
      else sql += ` ORDER BY p.created_at DESC`;
      sql += ` LIMIT ?`; params.push(limit);
      const r = await env.LEADS_DB.prepare(sql).bind(...params).all().catch(() => ({ results: [] }));
      for (const p of r.results || []) {
        const last90 = p.last_contact_at ? (Date.now() - new Date(p.last_contact_at).getTime() > 90*24*3600*1000) : true;
        items.push({
          kind: "prospect",
          id: p.id,
          title: p.business_name || p.root_domain || "(unknown)",
          subtitle: `${p.vertical || ""} ${p.city ? "· " + p.city : ""}`.trim(),
          email: p.email || null,
          phone: p.phone || null,
          city: p.city || null,
          stage: p.stage || "new",
          leak_score: p.leak_score ?? null,
          deadline_in_days,
          ai_suggestion: aiSuggestionForProspect(p, last90),
          sort_key: sortKeyProspect(p, sort),
          created_at: p.created_at,
          last_contact_at: p.last_contact_at,
        });
      }
    }

    // ── SAM.gov ───────────────────────────────────────────────────────
    if (kind === "all" || kind === "sam") {
      let sql = `SELECT id, title, agency, office, response_deadline, set_aside, naics_codes_json,
                        stage, fit_score, posted_date, created_at
                 FROM gov_opportunities
                 WHERE 1=1`;
      const params = [];
      if (q) {
        sql += ` AND (LOWER(title) LIKE ? OR LOWER(IFNULL(agency,'')) LIKE ? OR LOWER(IFNULL(office,'')) LIKE ? OR LOWER(IFNULL(set_aside,'')) LIKE ?)`;
        const like = `%${q}%`;
        params.push(like, like, like, like);
      }
      if (stage) { sql += ` AND stage = ?`; params.push(stage); }
      sql += ` ORDER BY ${sort === "deadline_asc" ? "date(response_deadline) ASC" : sort === "fit_desc" ? "fit_score DESC NULLS LAST" : "created_at DESC"}`;
      sql += ` LIMIT ?`; params.push(limit);
      const r = await env.LEADS_DB.prepare(sql).bind(...params).all().catch(() => ({ results: [] }));
      const now = Date.now();
      for (const s of r.results || []) {
        const daysLeft = s.response_deadline ? Math.ceil((new Date(s.response_deadline).getTime() - now) / (1000*60*60*24)) : null;
        items.push({
          kind: "sam",
          id: s.id,
          title: s.title,
          subtitle: `${s.agency || ""} ${s.set_aside ? "· " + s.set_aside : ""}`.trim().slice(0, 120),
          stage: s.stage || "discovery",
          fit_score: s.fit_score ?? null,
          leak_score,
          deadline_in_days: daysLeft,
          ai_suggestion: aiSuggestionForSam(s, daysLeft),
          sort_key: sortKeySam(s, sort),
          response_deadline: s.response_deadline,
          agency: s.agency,
          set_aside: s.set_aside,
          created_at: s.created_at,
        });
      }
    }

    // Apply client-side sort
    items.sort((a, b) => {
      if (a.id === focusId) return -1;
      if (b.id === focusId) return 1;
      if (sort === "deadline_asc") {
        return (a.deadline_in_days ?? 9999) - (b.deadline_in_days ?? 9999);
      }
      if (sort === "leak_desc") {
        return (b.leak_score ?? 0) - (a.leak_score ?? 0);
      }
      if (sort === "fit_desc") {
        return (b.fit_score ?? 0) - (a.fit_score ?? 0);
      }
      return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
    });

    return json({ ok: true, items: items.slice(0, limit), total: items.length, updatedAt: new Date().toISOString() }, 200, request, env);
  } catch (e) {
    return json({ ok: false, error: "leads_list_failed", details: String(e?.message || e) }, 500, request, env);
  }
}

function aiSuggestionForProspect(p, last90Ok) {
  const ls = p.leak_score ?? 0;
  if (ls >= 70) return "🩸 High leak — strong sales target. Recommend deep-evaluate + ready email.";
  if (ls >= 40) return "🪜 Several improvements possible. Recommend Starter / Growth package.";
  if (ls === 0) return "⏳ Not yet scanned. Hit Scan to fetch + leak-score.";
  if (!last90Ok) return "🕒 Contact in last 90 days — skip or do long-tail follow-up.";
  return "💡 Quick win candidate. Run deep-evaluate.";
}

function aiSuggestionForSam(s, daysLeft) {
  const fit = s.fit_score ?? 0;
  if (daysLeft != null && daysLeft <= 1) return "🚨 Deadline today/tomorrow — run Auto-tender pipeline NOW";
  if (daysLeft != null && daysLeft <= 5) return "⏰ Due this week — draft should be in flight";
  if (fit >= 60) return "🎯 Strong fit — invest in a real draft";
  if (s.stage === "evaluating") return "🧠 Awaiting AI review — click the row";
  return "🛠 Manual review pending";
}

function sortKeyProspect(p, sort) {
  if (sort === "leak_desc") return (p.leak_score || 0) * -1;
  if (sort === "created_desc") return new Date(p.created_at).getTime() * -1;
  return 0;
}

function sortKeySam(s, sort) {
  if (sort === "deadline_asc") return s.response_deadline || "9999";
  if (sort === "fit_desc") return (s.fit_score || 0) * -1;
  if (sort === "created_desc") return new Date(s.created_at || 0).getTime() * -1;
  return 0;
}
