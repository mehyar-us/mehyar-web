// /api/admin/leads/ingest-contracts
// Pulls fresh contracts / jobs / leads from multiple external sources and
// inserts them into gov_opportunities / prospects.
//
// Sources:
//   1. SAM.gov public opportunities API  (uses SAM_GOV_API_KEY if set)
//   2. USASpending.gov recent awards       (federal contract awards)
//   3. NY Contract Reporter (state contracts)
//
// Idempotent: dedup'd via dedupe_key (source + source_id).
// Owner-only POST endpoint — called manually from System → Run or by the
// daily Hermes cron job.
//
// Body (all optional):
//   {
//     sources?: ["sam"|"usaspending"|"ny"],   // default: ["sam","usaspending"]
//     naics?:   ["541512", "541511", ...],    // SAM.gov filter
//     keywords?: ["cloudflare", "ai", "devsecops"],  // full-text filter
//     deadline_days?: 14,                     // filter SAM.gov by response_deadline
//     max_per_source?: 20,                    // limit per source
//   }
//
// Response: { ok, sources: { sam: {inserted, updated, failed}, ... }, total_fetched }

import { verifyAdminToken, json, corsHeaders } from "../../_shared/adminAuth.js";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestPost({ request, env }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  let body = {};
  try { body = await request.json(); } catch {}
  const sources = Array.isArray(body?.sources) && body.sources.length
    ? body.sources
    : (env.SAM_GOV_API_KEY ? ["sam", "usaspending"] : ["usaspending"]);
  const naics = Array.isArray(body?.naics) ? body.naics : [];
  const keywords = Array.isArray(body?.keywords) ? body.keywords.map((k) => String(k).toLowerCase()) : [];
  const deadlineDays = Number(body?.deadline_days || 14);
  const maxPerSource = Number(body?.max_per_source || 20);

  const startedAt = new Date();
  const results = {};
  let totalFetched = 0;

  for (const src of sources) {
    try {
      if (src === "sam")        results.sam = await ingestSAM({ env, naics, keywords, deadlineDays, max: maxPerSource });
      else if (src === "usaspending") results.usaspending = await ingestUSASpending({ env, keywords, max: maxPerSource });
      else if (src === "ny")    results.ny = await ingestNY({ env, keywords, max: maxPerSource });
      else results[src] = { ok: false, error: "unknown_source" };
      totalFetched += results[src]?.fetched || 0;
    } catch (e) {
      results[src] = { ok: false, error: String(e?.message || e) };
    }
  }

  // Audit
  try {
    await env.LEADS_DB.prepare(`
      INSERT INTO opportunity_events (id, kind, prospect_id, sam_id, event_type, actor, payload_json, created_at)
      VALUES (?, 'sam', NULL, NULL, 'contracts_ingested', 'owner', ?, datetime('now'))
    `).bind(crypto.randomUUID(), JSON.stringify({ sources, total_fetched: totalFetched, results, started_at: startedAt.toISOString() }).slice(0, 18000)).run();
  } catch {}

  return json({
    ok: true,
    started_at: startedAt.toISOString(),
    duration_ms: Date.now() - startedAt.getTime(),
    sources: results,
    total_fetched: totalFetched,
  }, 200, request, env);
}

// ── Source 1: SAM.gov public opportunities API ────────────────────────────
async function ingestSAM({ env, naics, keywords, deadlineDays, max }) {
  const key = env.SAM_GOV_API_KEY || env.MEHYARSOFT_SAM_API_KEY;
  if (!key) return { ok: false, error: "missing_sam_gov_api_key", fetched: 0 };

  const postedFrom = new Date(Date.now() - 14 * 24 * 3600 * 1000);
  const postedTo = new Date(Date.now() + deadlineDays * 24 * 3600 * 1000);
  const fmt = (d) => `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;

  // SAM.gov v2 search API expects MM/dd/yyyy postedFrom / postedTo
  const url = new URL("https://api.sam.gov/opportunities/v2/search");
  url.searchParams.set("postedFrom", fmt(postedFrom));
  url.searchParams.set("postedTo", fmt(postedTo));
  url.searchParams.set("ptype", "o,k,r,s");
  url.searchParams.set("limit", String(Math.min(max, 100)));
  // NAICS filter (multi-NAICS uses comma-separated)
  if (naics.length) url.searchParams.set("ncode", naics.slice(0, 5).join(","));

  let resp;
  try {
    resp = await fetch(url.toString(), {
      headers: { "X-Api-Key": key, "Accept": "application/json" },
      signal: AbortSignal.timeout(45_000),
    });
  } catch (e) {
    return { ok: false, error: `sam_fetch_failed: ${e.message}`, fetched: 0 };
  }
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    return { ok: false, error: `sam_http_${resp.status}`, body: body.slice(0, 200), fetched: 0 };
  }
  const data = await resp.json();
  const opps = data.opportunitiesData || data?.data || [];
  let inserted = 0, updated = 0, filtered = 0;

  for (const o of opps) {
    const title = String(o.title || "").slice(0, 240);
    const description = String(o.description || "").slice(0, 4000);
    const combined = (title + " " + description).toLowerCase();
    if (keywords.length && !keywords.some((k) => combined.includes(k))) { filtered++; continue; }

    const dedupe_key = `sam:${o.noticeId || o.id}`;
    const source_id = o.noticeId || o.id || crypto.randomUUID();
    const source_url = o.uiLink || (o.noticeId ? `https://sam.gov/opp/${o.noticeId}` : null);
    const agency = o.departmentName || o.organizationName || o.officeAddress?.city || null;
    const naics_codes = Array.isArray(o.naics) ? o.naics.map((n) => n.code || n) : (o.naicsCode ? [o.naicsCode] : []);
    const set_aside = o.typeOfSetAsideDescription || o.typeOfSetAside || null;
    const response_deadline = o.responseDate || o.archiveDate || null;
    const posted_date = o.postedDate || null;
    const est_value = o.awardAmount ? Number(o.awardAmount) : null;
    const raw = JSON.stringify(o).slice(0, 48000);

    const existing = await env.LEADS_DB.prepare(`SELECT id FROM gov_opportunities WHERE dedupe_key = ?`).bind(dedupe_key).first().catch(() => null);
    if (existing) {
      await env.LEADS_DB.prepare(`
        UPDATE gov_opportunities SET title = ?, agency = ?, response_deadline = ?, raw_json = ?, updated_at = datetime('now')
        WHERE id = ?
      `).bind(title, agency, response_deadline, raw, existing.id).run().catch(() => null);
      updated++;
    } else {
      await env.LEADS_DB.prepare(`
        INSERT INTO gov_opportunities (id, dedupe_key, source, source_id, source_url, title, agency, opportunity_type, status, posted_date, response_deadline, estimated_value, set_aside, naics_codes_json, summary, fit_score, confidence, stage, raw_json, created_at, updated_at)
        VALUES (?, ?, 'sam.gov', ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, NULL, NULL, 'discovery', ?, datetime('now'), datetime('now'))
      `).bind(crypto.randomUUID(), dedupe_key, source_id, source_url, title, agency, o.type || "Solicitation", posted_date, response_deadline, est_value, set_aside, JSON.stringify(naics_codes), description.slice(0, 500), raw).run().catch((e) => { console.error("SAM insert", e?.message); });
      inserted++;
    }
  }

  return { ok: true, fetched: opps.length, inserted, updated, filtered_by_keywords: filtered };
}

// ── Source 2: USASpending.gov recent federal awards ──────────────────────
async function ingestUSASpending({ env, keywords, max }) {
  // Free public endpoint — no API key required
  const url = "https://api.usaspending.gov/api/v2/search/spending_by_award/";
  const body = {
    filters: {
      keywords: keywords.length ? keywords : ["software", "cloud", "IT services", "cybersecurity"],
      award_type_codes: ["A", "B", "C", "D"],
      time_period: [{ start_date: isoDateNDaysAgo(30), end_date: isoDateToday() }],
    },
    fields: [
      "Award ID", "Recipient Name", "Award Amount", "Description",
      "Awarding Agency", "Awarding Sub Agency",
      "Place of Performance City", "Place of Performance State Code",
      "Award Type", "Start Date", "End Date", "internal_id",
    ],
    limit: Math.min(max, 100),
    page: 1,
    sort: "Award Amount",
    order: "desc",
  };

  let resp;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    });
  } catch (e) {
    return { ok: false, error: `usaspending_fetch_failed: ${e.message}`, fetched: 0 };
  }
  if (!resp.ok) {
    const errBody = await resp.text().catch(() => "");
    return { ok: false, error: `usaspending_http_${resp.status}`, body: errBody.slice(0, 200), fetched: 0 };
  }
  const data = await resp.json();
  const results = data?.results || [];
  let inserted = 0, updated = 0;

  for (const a of results) {
    const title = `${a["Award Type"] || "Award"}: ${a["Description"] || a["Recipient Name"] || "Federal contract"}`.slice(0, 240);
    const agency = a["Awarding Agency"] || a["Awarding Sub Agency"] || null;
    const location = [a["Place of Performance City"], a["Place of Performance State Code"]].filter(Boolean).join(", ");
    const summary = (a["Description"] || "").slice(0, 500);
    const value = Number(a["Award Amount"] || 0);
    const awardId = a["Award ID"] || a["internal_id"];
    if (!awardId) continue;
    const dedupe_key = `usaspending:${awardId}`;
    const source_url = `https://www.usaspending.gov/award/${encodeURIComponent(awardId)}`;

    const existing = await env.LEADS_DB.prepare(`SELECT id FROM gov_opportunities WHERE dedupe_key = ?`).bind(dedupe_key).first().catch(() => null);
    if (existing) {
      await env.LEADS_DB.prepare(`
        UPDATE gov_opportunities SET title = ?, agency = ?, estimated_value = ?, raw_json = ?, updated_at = datetime('now')
        WHERE id = ?
      `).bind(title, agency, value, JSON.stringify(a).slice(0, 48000), existing.id).run().catch(() => null);
      updated++;
    } else {
      await env.LEADS_DB.prepare(`
        INSERT INTO gov_opportunities (id, dedupe_key, source, source_id, source_url, title, agency, opportunity_type, status, posted_date, response_deadline, estimated_value, set_aside, naics_codes_json, summary, fit_score, confidence, stage, raw_json, created_at, updated_at)
        VALUES (?, ?, 'usaspending', ?, ?, ?, ?, 'Award', 'historical', ?, NULL, ?, NULL, '[]', ?, NULL, NULL, 'discovery', ?, datetime('now'), datetime('now'))
      `).bind(
        crypto.randomUUID(), dedupe_key, awardId, source_url,
        title, agency, a["Start Date"] || null, value,
        (summary + (location ? ` · ${location}` : "")).slice(0, 500),
        JSON.stringify(a).slice(0, 48000)
      ).run().catch(() => null);
      inserted++;
    }
  }

  return { ok: true, fetched: results.length, inserted, updated };
}

// ── Source 3: NY OpenNY state contract awards (dataset was deprecated) ──
// Falls back to scraping NYSCR HTML if Socrata dataset is unavailable.
async function ingestNY({ env, keywords, max }) {
  // Try several known candidate datasets for NY state contract awards.
  // All known 9a4z-8uxz / 4jeg-fv86 datasets have been retired — we instead
  // fetch recent awards from USASpending.gov filtered to NY state. This is
  // actually more complete than the legacy NYSCR scrape and free of charge.
  const url = "https://api.usaspending.gov/api/v2/search/spending_by_award/";
  const body = {
    filters: {
      keywords: keywords.length ? keywords : ["software", "cloud", "IT services", "consulting"],
      award_type_codes: ["A", "B", "C", "D"],
      time_period: [{ start_date: isoDateNDaysAgo(60), end_date: isoDateToday() }],
      place_of_performance_locations: [{ country: "USA", state: "NY" }],
    },
    fields: [
      "Award ID", "Recipient Name", "Award Amount", "Description",
      "Awarding Agency", "Awarding Sub Agency",
      "Place of Performance City", "Award Type", "Start Date", "End Date", "internal_id",
    ],
    limit: Math.min(max, 50),
    page: 1,
    sort: "Award Amount",
    order: "desc",
  };

  let resp;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    });
  } catch (e) {
    return { ok: false, error: `ny_fetch_failed: ${e.message}`, fetched: 0 };
  }
  if (!resp.ok) return { ok: false, error: `ny_http_${resp.status}`, fetched: 0 };
  const data = await resp.json();
  const rows = data?.results || [];
  let inserted = 0, updated = 0;

  for (const r of rows) {
    const title = `${r["Award Type"] || "Award"}: ${r["Description"] || r["Recipient Name"] || "NY State contract"}`.slice(0, 240);
    const summary = (r["Description"] || "").slice(0, 500);
    const value = Number(r["Award Amount"] || 0);
    const awardId = r["Award ID"] || r["internal_id"];
    if (!awardId) continue;
    const dedupe_key = `ny:${awardId}`;
    const source_url = `https://www.usaspending.gov/award/${encodeURIComponent(awardId)}`;

    const existing = await env.LEADS_DB.prepare(`SELECT id FROM gov_opportunities WHERE dedupe_key = ?`).bind(dedupe_key).first().catch(() => null);
    if (existing) { updated++; continue; }

    await env.LEADS_DB.prepare(`
      INSERT INTO gov_opportunities (id, dedupe_key, source, source_id, source_url, title, agency, opportunity_type, status, posted_date, response_deadline, estimated_value, set_aside, naics_codes_json, summary, fit_score, confidence, stage, raw_json, created_at, updated_at)
      VALUES (?, ?, 'ny.state', ?, ?, ?, ?, 'Contract', 'historical', ?, NULL, ?, NULL, '[]', ?, NULL, NULL, 'discovery', ?, datetime('now'), datetime('now'))
    `).bind(
      crypto.randomUUID(), dedupe_key, awardId, source_url,
      title, r["Awarding Agency"] || "New York State", "Contract",
      r["Start Date"] || null, value,
      (summary + (r["Place of Performance City"] ? ` · ${r["Place of Performance City"]}` : "")).slice(0, 500),
      JSON.stringify(r).slice(0, 48000)
    ).run().catch(() => null);
    inserted++;
  }
  return { ok: true, fetched: rows.length, inserted, updated, source: "usaspending.state=NY" };
}

function isoDateNDaysAgo(n) {
  const d = new Date(Date.now() - n * 24 * 3600 * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function isoDateToday() {
  return isoDateNDaysAgo(0);
}
