// POST /api/admin/prospect-sources/eu-gov
//
// Fetch recent EU public procurement notices from TED (Tenders Electronic Daily)
// and insert them into gov_opportunities as kind='sam_eu' so they show up
// alongside SAM.gov in the CRM and can be deep-evaluated the same way.
//
// Body:
//   {
//     countries?:    ["DE", "FR", ...]   // ISO-3166-1 alpha-2 EU codes (default = top 8 EU markets)
//     cpv_keywords?: ["software", "consulting", ...]   // CPV category hints (optional)
//     days_back?:    number (default 14)
//     min_value_eur?: number (default 0)    // filter tiny contracts
//     max_results?:  number (default 60)
//     dry_run?:      bool
//   }
//
// Owner-only.

import { verifyAdminToken, json, corsHeaders } from "../../_shared/adminAuth.js";

const DEFAULTS_COUNTRIES = ["DE", "FR", "NL", "ES", "IT", "IE", "BE", "PL"];
// TED notice types: can=prior information, pin=call for competition, sub=Award
const TED_TYPES = "can+pin+sub";

// CPV (Common Procurement Vocabulary) section codes most relevant to MehyarSoft
//   72 = IT services (software dev, consulting, support)
//   73 = R&D / software products
//   79 = Business services
const RELEVANT_CPV_PREFIXES = ["72", "73", "79"];

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestPost({ request, env }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  let body;
  try { body = await request.json(); } catch { body = {}; }

  const countries = (Array.isArray(body.countries) && body.countries.length)
    ? body.countries.map((c) => String(c).toUpperCase()).filter((c) => c.length === 2)
    : DEFAULTS_COUNTRIES;
  const cpvKeywords = Array.isArray(body.cpv_keywords) ? body.cpv_keywords.filter((k) => typeof k === "string") : [];
  const daysBack = Math.max(1, Math.min(parseInt(body.days_back, 10) || 14, 60));
  const minValueEur = Math.max(0, parseInt(body.min_value_eur, 10) || 0);
  const maxResults = Math.max(1, Math.min(parseInt(body.max_results, 10) || 60, 200));
  const dryRun = body.dry_run === true;

  // Build TED search URL
  // TED search v3 endpoint: https://api.ted.europa.eu/api/v3/notices/search
  // Free public access, no key required for limited volume.
  // Fallback: TED RSS per-country (more reliable for small queries).
  const since = new Date(Date.now() - daysBack * 86400_000).toISOString().slice(0, 10);
  const qParts = [];
  qParts.push(`publication-date>=${since}`);
  qParts.push(`buyer-country=(${countries.join(" OR ")})`);
  // CPV filter if user supplied prefixes
  if (Array.isArray(body.cpv_prefixes) && body.cpv_prefixes.length) {
    qParts.push(`classification-cpv=(${body.cpv_prefixes.join(" OR ")})`);
  } else if (cpvKeywords.length) {
    qParts.push(`description=(${cpvKeywords.join(" OR ")})`);
  } else {
    qParts.push(`classification-cpv=(${RELEVANT_CPV_PREFIXES.join(" OR ")})`);
  }

  const tedUrl = `https://api.ted.europa.eu/api/v3/notices/search?${qParts.map((p) => `q=${encodeURIComponent("*")}&filter=${encodeURIComponent(p)}`).join("&")}&limit=${maxResults}&fields=notice-id,publication-date,buyer-name,buyer-country,description,title,deadline,classification-cpv,estimated-value,notice-type`;

  let items = [];
  let fetchErr = null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 18_000);
    const r = await fetch(tedUrl, {
      headers: { "user-agent": "MehyarSoft-TEDScout/1.0" },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (r.ok) {
      const j = await r.json();
      items = parseTedResults(j, countries, minValueEur);
    } else {
      fetchErr = `ted_http_${r.status}`;
    }
  } catch (e) {
    fetchErr = String(e?.message || e);
  }

  // Fallback to TED RSS per country if v3 API fails
  if (items.length === 0) {
    for (const cc of countries.slice(0, 6)) {
      try {
        const rssUrl = `https://ted.europa.eu/rss/notices/rss.xml?country=${cc}&q=software+OR+consulting+OR+IT`;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 10_000);
        const r = await fetch(rssUrl, {
          headers: { "user-agent": "MehyarSoft-TEDScout/1.0" },
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        if (r.ok) {
          const text = await r.text();
          const parsed = parseTedRss(text, cc);
          items.push(...parsed);
        }
      } catch {}
    }
  }

  items = items.slice(0, maxResults);

  // Insert
  let inserted = 0;
  let skippedExisting = 0;
  const errors = [];
  if (!dryRun) {
    for (const it of items) {
      try {
        const tedId = it.ted_id || it.title.slice(0, 80);
        const id = `ted_${tedId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 100)}`;
        // Dedupe by source_id (TED notice id)
        const existing = await env.LEADS_DB.prepare(
          `SELECT id FROM gov_opportunities WHERE source = 'ted' AND source_id = ? LIMIT 1`
        ).bind(tedId).first().catch(() => null);
        if (existing) { skippedExisting++; continue; }

        const now = new Date().toISOString();
        await env.LEADS_DB.prepare(`
          INSERT INTO gov_opportunities
            (id, title, agency, office, posted_date, response_deadline, stage,
             naics_codes_json, set_aside, fit_score, source, source_id, source_url, raw_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 'discovery', ?, ?, NULL, 'ted', ?, ?, ?, ?, ?)
        `).bind(
          id,
          it.title.slice(0, 240),
          it.buyer_name.slice(0, 200),
          it.buyer_country,
          it.publication_date || now,
          it.deadline || null,
          JSON.stringify(it.cpv_codes || []),
          `TED-EU`,
          tedId,
          it.url || null,
          JSON.stringify({ ted_id: tedId, estimated_value_eur: it.estimated_value_eur, cpv: it.cpv_codes, notice_type: it.notice_type, buyer_country: it.buyer_country }),
          now,
          now,
        ).run();
        inserted++;
      } catch (e) {
        errors.push({ title: it.title?.slice(0, 80), error: String(e?.message || e) });
      }
    }
  }

  return json({
    ok: true,
    dry_run: dryRun,
    source: fetchErr && items.length ? "ted_rss_fallback" : "ted_v3",
    fetch_error: fetchErr,
    countries,
    days_back: daysBack,
    results_found: items.length,
    inserted,
    skipped_existing: skippedExisting,
    sample: items.slice(0, 5).map((it) => ({ title: it.title, buyer: it.buyer_name, country: it.buyer_country, deadline: it.deadline, value: it.estimated_value_eur })),
    errors: errors.slice(0, 10),
  }, 200, request, env);
}

// ─── parsers ────────────────────────────────────────────────────────────────

function parseTedResults(j, countries, minValue) {
  const arr = Array.isArray(j?.results) ? j.results
    : Array.isArray(j?.data) ? j.data
    : Array.isArray(j?.notices) ? j.notices
    : Array.isArray(j) ? j : [];
  return arr.map((it) => {
    const tedId = it["notice-id"] || it.notice_id || it.id || "";
    const title = (it.title || it.description || it.subject || "(no title)").toString().slice(0, 240);
    const buyer = it["buyer-name"] || it.buyer_name || it.buyer || "";
    const country = (it["buyer-country"] || it.buyer_country || it.country || "").toString().toUpperCase();
    const deadline = it.deadline || it["response-deadline"] || null;
    const pubDate = it["publication-date"] || it.publication_date || it.date || null;
    const cpvRaw = it["classification-cpv"] || it.classification_cpv || it.cpv || "";
    const cpv = String(cpvRaw).split(/[,;\s]+/).filter(Boolean);
    const valueStr = it["estimated-value"] || it.estimated_value || it.value || "";
    const value = Number(String(valueStr).replace(/[^0-9.]/g, "")) || null;
    const url = `https://ted.europa.eu/notice/${tedId}`;
    return {
      ted_id: tedId,
      title,
      buyer_name: buyer,
      buyer_country: country || (countries[0] || "EU"),
      deadline,
      publication_date: pubDate,
      cpv_codes: cpv.slice(0, 5),
      estimated_value_eur: value,
      url,
      notice_type: it["notice-type"] || it.notice_type || "",
    };
  }).filter((it) => !minValue || (it.estimated_value_eur || 0) >= minValue);
}

function parseTedRss(xml, country) {
  // Best-effort RSS extraction. TED RSS uses <item><title><link><description><pubDate>.
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml))) {
    const block = m[1];
    const title = (block.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "";
    const link  = (block.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || "";
    const desc  = (block.match(/<description>([\s\S]*?)<\/description>/) || [])[1] || "";
    const pub   = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || "";
    if (!title) continue;
    const tedId = (link.match(/\/notice\/([^/?]+)/) || [])[1] || link;
    items.push({
      ted_id: tedId,
      title: decodeXml(title).slice(0, 240),
      buyer_name: extractBuyerFromRss(desc) || `TED ${country}`,
      buyer_country: country,
      deadline: extractDeadlineFromRss(desc),
      publication_date: pub ? new Date(pub).toISOString().slice(0, 10) : null,
      cpv_codes: [],
      estimated_value_eur: extractValueFromRss(desc),
      url: link,
      notice_type: "",
    });
  }
  return items;
}

function decodeXml(s) {
  return String(s || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ").trim();
}

function extractBuyerFromRss(desc) {
  const m = String(desc).match(/buyer[:\s]+([^<,\n]+)/i);
  return m ? decodeXml(m[1]).trim().slice(0, 200) : null;
}

function extractDeadlineFromRss(desc) {
  const m = String(desc).match(/deadline[:\s]+([0-9]{4}-[0-9]{2}-[0-9]{2})/i);
  return m ? m[1] : null;
}

function extractValueFromRss(desc) {
  const m = String(desc).match(/value[:\s]+EUR\s?([\d,]+)/i);
  return m ? Number(m[1].replace(/,/g, "")) : null;
}