// POST /api/prospects/seed  { sources?: ["ny_dos", "csv"], items?: [{ business_name, website, vertical, city, email }] }
//
// Sources we support in this MVP:
//   - "csv":           caller passes `items[]`
//   - "ny_dos":        NYS Department of State Socrata open-data (free; no key)
//   - "google_places": requires env GOOGLE_PLACES_API_KEY (NOT wired in MVP — Phase 2)
//
// All sources write to the same `prospects` table keyed by root_domain.
// Admin-only — bearer JWT issued by /v1/admin/login.

import { verifyAdminToken, json, corsHeaders } from "../_shared/adminAuth.js";

const MAX_ITEMS = 200;
const MAX_BODY_BYTES = 16 * 1024;
const DEFAULT_LIMIT = 25;

function cap(v, max) { return (v || "").length > max ? v.slice(0, max) : v; }

function rootDomainOf(input) {
  if (!input) return "";
  let s = String(input).trim().toLowerCase();
  if (!/^https?:\/\//.test(s)) s = "https://" + s;
  try {
    const u = new URL(s);
    const host = u.hostname.replace(/^www\./, "");
    const parts = host.split(".");
    if (parts.length <= 2) return host;
    return parts.slice(-2).join(".");
  } catch { return ""; }
}

async function readBodyCap(request, maxBytes = MAX_BODY_BYTES) {
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { try { await reader.cancel(); } catch {}; throw new Error("payload_too_large"); }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.byteLength; }
  return new TextDecoder("utf-8", { fatal: false }).decode(out);
}

async function ingestCsvItems(env, items) {
  let inserted = 0, skipped = 0;
  for (const it of (items || []).slice(0, MAX_ITEMS)) {
    const root = rootDomainOf(it.website || "");
    if (!root) { skipped++; continue; }
    const existing = await env.LEADS_DB.prepare(`SELECT id FROM prospects WHERE root_domain = ?`).bind(root).first();
    if (existing) { skipped++; continue; }
    const id = crypto.randomUUID();
    await env.LEADS_DB.prepare(`
      INSERT INTO prospects (id, source, source_ref, business_name, website, root_domain, vertical, city, region, country, email, email_source, meta_json)
      VALUES (?, 'manual_csv', ?, ?, ?, ?, ?, ?, ?, 'US', ?, ?, ?)
    `).bind(
      id, id, cap(it.business_name || root, 200),
      /^https?:\/\//i.test(it.website || "") ? it.website : `https://${root}`,
      root, cap(it.vertical || null, 80), cap(it.city || null, 80), cap(it.region || null, 40),
      cap((it.email || "").toLowerCase(), 254), it.email ? "manual" : null,
      JSON.stringify({ note: cap(it.note || "", 200) })
    ).run();
    inserted++;
  }
  return { source: "csv", inserted, skipped };
}

async function ingestNyDos(env, { vertical, city, limit = DEFAULT_LIMIT } = {}) {
  const keyword = (vertical || "dental").toLowerCase();
  const where  = encodeURIComponent(`lower(business_name) like '%${keyword}%'`);
  const url = `https://data.ny.gov/resource/9a8c-v6yn.json?$limit=${limit}&website is not null&$where=${where}`;
  try {
    const resp = await fetch(url, { headers: { "user-agent": "MehyarSoft-ProspectSeeder/1.0 (+https://mehyar.us)" } });
    if (!resp.ok) throw new Error(`ny_dos_${resp.status}`);
    const rows = await resp.json().catch(() => []);
    let inserted = 0, skipped = 0;
    for (const row of rows) {
      const root = rootDomainOf(row.website || "");
      if (!root) { skipped++; continue; }
      const existing = await env.LEADS_DB.prepare(`SELECT id FROM prospects WHERE root_domain = ?`).bind(root).first();
      if (existing) { skipped++; continue; }
      const id = crypto.randomUUID();
      await env.LEADS_DB.prepare(`
        INSERT INTO prospects (id, source, source_ref, business_name, website, root_domain, vertical, city, region, country, meta_json)
        VALUES (?, 'ny_dos_csv', ?, ?, ?, ?, ?, ?, ?, 'US', ?)
      `).bind(
        id, String(row.id || id),
        cap(row.business_name || root, 200),
        row.website || `https://${root}`,
        root,
        cap(vertical || null, 80),
        cap(city || row.jurisdiction || "", 80),
        cap(row.jurisdiction || "NY", 40),
        JSON.stringify({ dos_row: cap(JSON.stringify(row).slice(0, 400), 400) }),
      ).run();
      inserted++;
    }
    return { source: "ny_dos", inserted, skipped, fetched: rows.length };
  } catch (err) {
    return { source: "ny_dos", inserted: 0, skipped: 0, error: String(err?.message || err) };
  }
}

export async function onRequestPost({ request, env }) {
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);

  let body = {};
  try {
    const raw = await readBodyCap(request);
    body = JSON.parse(raw || "{}");
  } catch { body = {}; }

  const sources = Array.isArray(body.sources) && body.sources.length
    ? body.sources
    : (body.items ? ["csv"] : ["csv"]);

  const results = [];
  if (sources.includes("csv") && Array.isArray(body.items)) {
    results.push(await ingestCsvItems(env, body.items));
  }
  if (sources.includes("ny_dos")) {
    results.push(await ingestNyDos(env, { vertical: body.vertical || "dental", city: body.city, limit: body.limit || DEFAULT_LIMIT }));
  }
  return json({ ok: true, sources: results }, 200, request, env);
}

export async function onRequestGet({ request, env }) {
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  const u = new URL(request.url);
  if (u.searchParams.get("dry_run") === "1") {
    return json({ ok: true, message: "Send a POST with sources/vertical/items to seed." }, 200, request, env);
  }
  return json({ ok: false, error: "use_POST" }, 405, request, env);
}

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}
