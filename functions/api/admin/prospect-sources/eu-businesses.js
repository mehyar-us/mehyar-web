// POST /api/admin/prospect-sources/eu-businesses
//
// Find businesses in European Union cities using OpenStreetMap Overpass API.
// No API key required. Returns real businesses (name, address, lat/lon,
// website if available) ready to be scanned + scored by the existing
// prospect-sources/scan pipeline.
//
// Body:
//   {
//     countries?:   ["DE", "FR", "NL", ...]   // ISO-3166-1 alpha-2 codes; default = top EU markets
//     verticals?:   ["dental", "cafe", "gym", ...]  // mapped to OSM tags
//     city?:        string   // optional — narrow to one city
//     max_per_city?: number (default 20)
//     max_total?:   number (default 100)
//     include_website_only?: bool (default true)  // skip businesses without a website
//     dry_run?:     bool  // if true, don't insert — just return what would be found
//   }
//
// Owner-only.

import { verifyAdminToken, json, corsHeaders } from "../../_shared/adminAuth.js";

const DEFAULTS_COUNTRIES = ["DE", "FR", "NL", "ES", "IT", "IE", "BE", "AT", "SE", "DK", "FI", "PL"];
const DEFAULTS_VERTICALS = ["dental", "cafe", "gym", "clinic", "law_firm", "agency", "restaurant", "hotel", "spa", "veterinary"];

// ── Vertical → OSM tag mapping ──────────────────────────────────────────────
// Each entry: key=value (or array of {key,value}) passed to Overpass.
const VERTICAL_TO_OSM = {
  dental:        [{ k: "amenity", v: "dentist" }, { k: "healthcare", v: "dentist" }],
  cafe:          [{ k: "amenity", v: "cafe" }],
  restaurant:    [{ k: "amenity", v: "restaurant" }],
  gym:           [{ k: "leisure", v: "fitness_centre" }, { k: "leisure", v: "sports_centre" }],
  clinic:        [{ k: "amenity", v: "clinic" }, { k: "amenity", v: "doctors" }],
  law_firm:      [{ k: "office", v: "lawyer" }, { k: "office", v: "notary" }],
  agency:        [{ k: "office", v: "company" }, { k: "office", v: "consulting" }],
  hotel:         [{ k: "tourism", v: "hotel" }, { k: "tourism", v: "guest_house" }],
  spa:           [{ k: "leisure", v: "spa" }, { k: "amenity", v: "spa" }],
  veterinary:    [{ k: "amenity", v: "veterinary" }],
  coworking:     [{ k: "office", v: "coworking" }],
  bakery:        [{ k: "shop", v: "bakery" }],
  florist:       [{ k: "shop", v: "florist" }],
  accounting:    [{ k: "office", v: "accountant" }],
  pharmacy:      [{ k: "amenity", v: "pharmacy" }],
};

// Cities to query within each country (capitals + major business hubs)
const CITIES_BY_COUNTRY = {
  DE: ["Berlin", "Munich", "Hamburg", "Frankfurt", "Cologne", "Stuttgart", "Düsseldorf"],
  FR: ["Paris", "Lyon", "Marseille", "Toulouse", "Bordeaux", "Nice", "Lille"],
  NL: ["Amsterdam", "Rotterdam", "The Hague", "Utrecht", "Eindhoven"],
  ES: ["Madrid", "Barcelona", "Valencia", "Seville", "Bilbao", "Málaga"],
  IT: ["Rome", "Milan", "Turin", "Florence", "Naples", "Bologna"],
  IE: ["Dublin", "Cork", "Galway", "Limerick"],
  BE: ["Brussels", "Antwerp", "Ghent", "Bruges"],
  AT: ["Vienna", "Salzburg", "Graz", "Innsbruck"],
  SE: ["Stockholm", "Gothenburg", "Malmö"],
  DK: ["Copenhagen", "Aarhus", "Odense"],
  FI: ["Helsinki", "Espoo", "Tampere"],
  PL: ["Warsaw", "Kraków", "Wrocław", "Gdańsk", "Poznań"],
};

const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.fr/api/interpreter",
];

const HTTP_TIMEOUT_MS = 18_000;

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
    ? body.countries.filter((c) => typeof c === "string" && c.length === 2).map((c) => c.toUpperCase())
    : DEFAULTS_COUNTRIES;
  const verticals = (Array.isArray(body.verticals) && body.verticals.length)
    ? body.verticals.filter((v) => VERTICAL_TO_OSM[v])
    : DEFAULTS_VERTICALS;
  const explicitCity = (body.city || "").trim();
  const maxPerCity = Math.max(1, Math.min(parseInt(body.max_per_city, 10) || 20, 50));
  const maxTotal = Math.max(1, Math.min(parseInt(body.max_total, 10) || 100, 500));
  const websiteOnly = body.include_website_only !== false;
  const dryRun = body.dry_run === true;

  // Build city list (one country+city pair at a time, round-robin to spread load)
  const targets = [];
  for (const cc of countries) {
    const cities = explicitCity ? [explicitCity] : (CITIES_BY_COUNTRY[cc] || []);
    for (const city of cities) targets.push({ country: cc, city });
  }

  // Run queries with concurrency cap
  const concurrency = 4;
  const results = [];
  const errors = [];
  for (let i = 0; i < targets.length; i += concurrency) {
    const batch = targets.slice(i, i + concurrency);
    const settled = await Promise.allSettled(batch.map((t) => queryOverpass(t.country, t.city, verticals, maxPerCity, websiteOnly)));
    for (let j = 0; j < settled.length; j++) {
      const t = batch[j];
      const s = settled[j];
      if (s.status === "fulfilled") {
        results.push(...s.value);
      } else {
        errors.push({ country: t.country, city: t.city, error: String(s.reason?.message || s.reason) });
      }
    }
    if (results.length >= maxTotal) break;
  }

  // Dedupe by root_domain (or business_name+city if no domain)
  const seen = new Set();
  const deduped = [];
  for (const r of results) {
    const key = (r.root_domain || `${r.business_name}|${r.city}`).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(r);
    if (deduped.length >= maxTotal) break;
  }

  // Insert into prospects (skip dry_run)
  let inserted = 0;
  let skippedExisting = 0;
  if (!dryRun) {
    const sourceName = `EU Businesses (${countries.join("+")})`;
    const sourceId = await ensureSource(env, {
      name: sourceName,
      kind: "seed",
      tag: `[EU ${countries.length}cc]`,
      description: `OSM Overpass seed across ${countries.join(", ")}. Verticals: ${verticals.join(", ")}. Cities: ${targets.slice(0, 8).map((t) => `${t.country}:${t.city}`).join(", ")}${targets.length > 8 ? ` (+${targets.length - 8} more)` : ""}.`,
    });
    const now = new Date().toISOString();
    for (const r of deduped) {
      try {
        const id = crypto.randomUUID();
        // Dedupe by root_domain (existing row with same domain → skip)
        const existing = r.root_domain
          ? await env.LEADS_DB.prepare(`SELECT id FROM prospects WHERE root_domain = ? LIMIT 1`).bind(r.root_domain).first()
          : null;
        if (existing) { skippedExisting++; continue; }

        await env.LEADS_DB.prepare(`
          INSERT INTO prospects
            (id, business_name, root_domain, website, city, region, country, vertical,
             email, phone, source, source_ref, status, meta_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?)
        `).bind(
          id,
          r.business_name.slice(0, 160),
          r.root_domain.slice(0, 200),
          r.website.slice(0, 400),
          r.city,
          r.country,
          r.country,
          r.vertical,
          r.email || null,
          r.phone || null,
          sourceName,
          sourceId,
          JSON.stringify({ lat: r.lat, lon: r.lon, osm_imported: true, verticals, countries }),
          now,
          now,
        ).run();
        inserted++;
      } catch (e) {
        errors.push({ business: r.business_name, error: String(e?.message || e) });
      }
    }
  }

  return json({
    ok: true,
    dry_run: dryRun,
    countries,
    verticals,
    targets_planned: targets.length,
    results_found: results.length,
    unique_after_dedup: deduped.length,
    inserted,
    skipped_existing: skippedExisting,
    sample: deduped.slice(0, 5),
    errors: errors.slice(0, 10),
  }, 200, request, env);
}

// ─── helpers ───────────────────────────────────────────────────────────────

async function queryOverpass(country, city, verticals, maxPerCity, websiteOnly) {
  // Convert verticals to Overpass tag queries
  const tagBlocks = [];
  for (const v of verticals) {
    const tags = VERTICAL_TO_OSM[v] || [];
    for (const t of tags) {
      tagBlocks.push(`  node["${t.k}"="${t.v}"](around:${20_000},${getAreaLatLon(city)});`);
    }
  }
  if (tagBlocks.length === 0) return [];

  const query = `
[out:json][timeout:25];
(
${tagBlocks.join("\n")}
);
out body ${maxPerCity * 4};
`.trim();

  const payload = new URLSearchParams({ data: query }).toString();

  let lastErr = null;
  for (const url of OVERPASS_URLS) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "MehyarSoft-EUScout/1.0" },
        body: payload,
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!r.ok) { lastErr = new Error(`overpass_${url}_${r.status}`); continue; }
      const j = await r.json();
      return parseOverpassElements(j.elements || [], city, country, verticals, websiteOnly, maxPerCity);
    } catch (e) {
      lastErr = e;
      continue;
    }
  }
  throw lastErr || new Error("overpass_failed_all_endpoints");
}

function parseOverpassElements(elements, city, country, verticals, websiteOnly, maxPerCity) {
  const out = [];
  const seen = new Set();
  for (const el of elements) {
    if (out.length >= maxPerCity) break;
    const tags = el.tags || {};
    const name = (tags.name || tags["name:en"] || "").trim();
    if (!name || name.length < 2) continue;

    const website = (tags.website || tags["contact:website"] || tags.url || "").trim();
    const phone = (tags.phone || tags["contact:phone"] || "").trim();
    const email = (tags.email || tags["contact:email"] || "").trim();
    if (websiteOnly && !website) continue;

    let host = "";
    if (website) {
      try {
        host = new URL(website.startsWith("http") ? website : `https://${website}`).hostname.replace(/^www\./, "");
        if (!host || host.length < 4) continue;
      } catch { continue; }
    }

    // Detect which vertical this node actually belongs to
    let vertical = "business";
    for (const v of verticals) {
      const ts = VERTICAL_TO_OSM[v] || [];
      if (ts.some((t) => tags[t.k] === t.v)) { vertical = v; break; }
    }

    const key = `${host || name.toLowerCase()}|${city}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      business_name: name,
      website: website ? (website.startsWith("http") ? website : `https://${website}`) : "",
      root_domain: host,
      city,
      country,
      phone: phone || null,
      email: email || null,
      vertical,
      lat: el.lat || null,
      lon: el.lon || null,
    });
  }
  return out;
}

// Quick geocoder fallback for common cities — avoids a Nominatim roundtrip
// (would need User-Agent and rate-limiting). Good enough for ~50 EU cities.
const CITY_LATLON = {
  "Berlin": "52.520,13.405", "Munich": "48.137,11.575", "Hamburg": "53.551,9.993",
  "Frankfurt": "50.110,8.682", "Cologne": "50.937,6.960", "Stuttgart": "48.775,9.182",
  "Düsseldorf": "51.227,6.773", "Paris": "48.857,2.353", "Lyon": "45.764,4.835",
  "Marseille": "43.297,5.369", "Toulouse": "43.604,1.444", "Bordeaux": "44.837,-0.579",
  "Nice": "43.703,7.266", "Lille": "50.629,3.058", "Amsterdam": "52.370,4.895",
  "Rotterdam": "51.924,4.478", "The Hague": "52.070,4.300", "Utrecht": "52.090,5.122",
  "Eindhoven": "51.441,5.478", "Madrid": "40.416,-3.703", "Barcelona": "41.385,2.173",
  "Valencia": "39.470,-0.376", "Seville": "37.389,-5.984", "Bilbao": "43.263,-2.935",
  "Málaga": "36.720,-4.420", "Rome": "41.902,12.496", "Milan": "45.464,9.190",
  "Turin": "45.070,7.686", "Florence": "43.770,11.255", "Naples": "40.852,14.268",
  "Bologna": "44.494,11.343", "Dublin": "53.350,-6.260", "Cork": "51.899,-8.475",
  "Galway": "53.271,-9.049", "Limerick": "52.664,-8.623", "Brussels": "50.850,4.351",
  "Antwerp": "51.219,4.402", "Ghent": "51.054,3.717", "Bruges": "51.209,3.225",
  "Vienna": "48.208,16.373", "Salzburg": "47.811,13.055", "Graz": "47.071,15.439",
  "Innsbruck": "47.269,11.404", "Stockholm": "59.329,18.069", "Gothenburg": "57.709,11.974",
  "Malmö": "55.605,13.003", "Copenhagen": "55.676,12.568", "Aarhus": "56.157,10.211",
  "Odense": "55.403,10.402", "Helsinki": "60.170,24.939", "Espoo": "60.205,24.652",
  "Tampere": "61.498,23.761", "Warsaw": "52.230,21.011", "Kraków": "50.064,19.945",
  "Wrocław": "51.108,17.038", "Gdańsk": "54.352,18.646", "Poznań": "52.408,16.934",
};

function getAreaLatLon(city) {
  return CITY_LATLON[city] || CITY_LATLON[city.split(/[ -]/)[0]] || "52.520,13.405"; // Berlin fallback
}

async function ensureSource(env, src) {
  const id = `src_eu_${Date.now().toString(36)}`;
  try {
    await env.LEADS_DB.prepare(`
      INSERT INTO prospect_sources (id, name, kind, active, tag, description, created_at, updated_at)
      VALUES (?, ?, ?, 1, ?, ?, datetime('now'), datetime('now'))
    `).bind(id, src.name, src.kind, src.tag || "", src.description || "").run();
    return id;
  } catch (e) {
    // Source already exists (UNIQUE name) — find it
    try {
      const row = await env.LEADS_DB.prepare(`SELECT id FROM prospect_sources WHERE name = ? LIMIT 1`).bind(src.name).first();
      return row?.id || null;
    } catch { return null; }
  }
}