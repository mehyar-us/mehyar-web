// /api/mayor/test/seed-prospects — POST-only test fixture.
//
// Inserts 3 deterministic Brooklyn businesses into the prospects table so the
// end-to-end Mayor flow can be exercised without depending on Google Places
// API quota. Each prospect already has a real-looking website, email, and
// phone so the rest of the pipeline (rescan → draft → approve → send) has
// something concrete to chew on.
//
// If GOOGLE_PLACES_API_KEY is set, also fetches 5 live Brooklyn businesses
// from Google Places and inserts them with source='google_places_live' so
// the discover → rescan pipeline can be exercised against real sites.
//
// Body params (all optional):
//   ?reset=1    truncate prospects + dependent tables first (irreversible)
//   ?count=N    override the default 3 (max 10)
//   ?live=N     number of live Google Places businesses to add (max 20)
//
// This endpoint is dev/test only. It refuses to run unless the request
// carries the same GOV_INGEST_TOKEN the orchestrator uses, so a random
// browser request can't poison the DB.

import { verifyAdminToken, json, corsHeaders } from "../../_shared/adminAuth.js";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

async function bearerAccepted(request, env) {
  const h = request.headers.get("authorization") || "";
  if (!h.startsWith("Bearer ")) return false;
  const tok = h.slice(7);
  if (tok && env?.GOV_INGEST_TOKEN && tok === env.GOV_INGEST_TOKEN) return true;
  const a = await verifyAdminToken(request, env);
  return a.ok;
}

const TEST_PROSPECTS = [
  {
    business_name: "Brooklyn Test Bakery",
    website: "https://brooklyn-test-bakery.example.com",
    root_domain: "brooklyn-test-bakery.example.com",
    email: "owner@brooklyn-test-bakery.example.com",
    phone: "+1-718-555-0142",
    vertical: "bakery",
    city: "Brooklyn",
    region: "NY",
    postal_code: "11201",
    address: "123 Smith St, Brooklyn, NY 11201",
    source: "seed",
    source_ref: "test-bakery-001",
  },
  {
    business_name: "Park Slope Dental Studio",
    website: "https://parkslopedental.example.com",
    root_domain: "parkslopedental.example.com",
    email: "office@parkslopedental.example.com",
    phone: "+1-718-555-0287",
    vertical: "dental",
    city: "Brooklyn",
    region: "NY",
    postal_code: "11215",
    address: "350 5th Ave, Brooklyn, NY 11215",
    source: "seed",
    source_ref: "test-dental-001",
  },
  {
    business_name: "Greenpoint Coffee Bar",
    website: "https://greenpointcoffee.example.com",
    root_domain: "greenpointcoffee.example.com",
    email: "hello@greenpointcoffee.example.com",
    phone: "+1-718-555-0319",
    vertical: "cafe",
    city: "Brooklyn",
    region: "NY",
    postal_code: "11222",
    address: "210 Franklin St, Brooklyn, NY 11222",
    source: "seed",
    source_ref: "test-cafe-001",
  },
];

const LIVE_QUERIES = ["bakery in Brooklyn NY", "cafe in Brooklyn NY", "dental office Brooklyn NY", "gym Brooklyn NY", "restaurant Brooklyn NY"];

async function fetchLiveProspects(env, maxResults) {
  const apiKey = env?.GOOGLE_PLACES_API_KEY || env?.MEHYAR_GOOGLE_PLACES_API_KEY;
  if (!apiKey) return { businesses: [], error: "no_google_places_key" };

  const found = [];
  for (const q of LIVE_QUERIES) {
    if (found.length >= maxResults) break;
    try {
      const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(q)}&key=${apiKey}`;
      const resp = await fetch(url);
      const data = await resp.json();
      if (data?.status !== "OK" && data?.status !== "ZERO_RESULTS") {
        return { businesses: found, error: `google_places_${data?.status}` };
      }
      for (const r of (data?.results || []).slice(0, 3)) {
        if (found.length >= maxResults) break;
        let website = r?.website || "";
        let phone = r?.formatted_phone_number || "";
        let email = "";
        if (r?.place_id) {
          try {
            const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${r.place_id}&fields=website,formatted_phone_number,formatted_address,name,place_id&key=${apiKey}`;
            const dResp = await fetch(detailsUrl);
            const dData = await dResp.json();
            const d = dData?.result || {};
            website = website || d.website || "";
            phone = phone || d.formatted_phone_number || "";
            // Address components → city/state/zip
            let city = "", region = "", postal = "";
            for (const c of (d.address_components || [])) {
              if (c.types?.includes("locality")) city = c.long_name;
              if (c.types?.includes("administrative_area_level_1")) region = c.short_name;
              if (c.types?.includes("postal_code")) postal = c.long_name;
            }
            // Email heuristic — common patterns
            const bizName = (r.name || "business").toLowerCase().replace(/[^a-z0-9]/g, "");
            email = `info@${(website || `${bizName}.com`).replace(/^https?:\/\//, "").split("/")[0]}`;
            found.push({
              business_name: r.name,
              website: website || "",
              root_domain: website ? website.replace(/^https?:\/\//, "").split("/")[0] : "",
              email,
              phone,
              vertical: q.split(" ")[0],
              city: city || "Brooklyn",
              region: region || "NY",
              postal_code: postal || "",
              address: d.formatted_address || r.formatted_address || "",
              source: "google_places_live",
              source_ref: r.place_id,
            });
          } catch (_) {}
        }
      }
    } catch (e) {
      return { businesses: found, error: String(e?.message || e) };
    }
  }
  return { businesses: found };
}

export async function onRequestPost({ request, env }) {
  if (!await bearerAccepted(request, env)) {
    return json({ ok: false, error: "unauthorized" }, 401, request, env);
  }
  if (!env?.LEADS_DB) {
    return json({ ok: false, error: "missing_db" }, 500, request, env);
  }

  const url = new URL(request.url);
  const reset = url.searchParams.get("reset") === "1";
  const count = Math.min(parseInt(url.searchParams.get("count") || "3", 10) || 3, 10);
  const liveCount = Math.min(parseInt(url.searchParams.get("live") || "0", 10) || 0, 20);

  const db = env.LEADS_DB;

  // Ensure schema is up
  try {
    const { ensureProspectSchema } = await import("./_shared/prospectSchema.js").catch(() => ({}));
    if (typeof ensureProspectSchema === "function") await ensureProspectSchema(env);
  } catch (_) {}

  if (reset) {
    // Wipe test-source rows only — leave real prospects intact
    try {
      await db.prepare(`DELETE FROM prospect_signals WHERE prospect_id IN (SELECT id FROM prospects WHERE source IN ('seed','google_places_live'))`).run();
      await db.prepare(`DELETE FROM prospect_drafts   WHERE prospect_id IN (SELECT id FROM prospects WHERE source IN ('seed','google_places_live'))`).run();
      await db.prepare(`DELETE FROM prospect_sends    WHERE prospect_id IN (SELECT id FROM prospects WHERE source IN ('seed','google_places_live'))`).run();
      await db.prepare(`DELETE FROM prospect_replies  WHERE prospect_id IN (SELECT id FROM prospects WHERE source IN ('seed','google_places_live'))`).run();
      await db.prepare(`DELETE FROM prospect_contracts WHERE prospect_id IN (SELECT id FROM prospects WHERE source IN ('seed','google_places_live'))`).run();
      await db.prepare(`DELETE FROM prospects WHERE source IN ('seed','google_places_live')`).run();
    } catch (e) {
      return json({ ok: false, error: "reset_failed", message: String(e?.message || e) }, 500, request, env);
    }
  }

  const inserted = [];
  for (let i = 0; i < Math.min(count, TEST_PROSPECTS.length); i++) {
    const p = TEST_PROSPECTS[i];
    const id = `seed_${p.source_ref}`;
    try {
      await db.prepare(`
        INSERT OR REPLACE INTO prospects
          (id, created_at, updated_at, source, source_ref, business_name, website, root_domain,
           email, email_source, phone, vertical, city, region, country, postal_code,
           status, consent_state, last_scanned_at, last_drafted_at, last_sent_at, last_contact_at, meta_json)
        VALUES (?, datetime('now'), datetime('now'), ?, ?, ?, ?, ?,
                ?, 'manual', ?, ?, ?, ?, 'US', ?,
                'new', 'business_interest_b2b', NULL, NULL, NULL, NULL, '{}')
      `).bind(
        id,
        p.source, p.source_ref, p.business_name, p.website, p.root_domain,
        p.email, p.phone, p.vertical, p.city, p.region, p.postal_code,
      ).run();
      inserted.push(id);
    } catch (e) {
      // Surface but continue
      inserted.push({ id, _error: String(e?.message || e) });
    }
  }

  // Live Google Places results (if key set + ?live=N)
  let liveInserted = [];
  let liveError = null;
  if (liveCount > 0) {
    const { businesses, error } = await fetchLiveProspects(env, liveCount);
    liveError = error;
    for (const p of (businesses || [])) {
      const id = `gp_${p.source_ref}`;
      try {
        await db.prepare(`
          INSERT OR IGNORE INTO prospects
            (id, created_at, updated_at, source, source_ref, business_name, website, root_domain,
             email, email_source, phone, vertical, city, region, country, postal_code,
             status, consent_state, last_scanned_at, last_drafted_at, last_sent_at, last_contact_at, meta_json)
          VALUES (?, datetime('now'), datetime('now'), ?, ?, ?, ?, ?,
                  ?, 'pattern', ?, ?, ?, ?, 'US', ?,
                  'new', 'business_interest_b2b', NULL, NULL, NULL, NULL, '{}')
        `).bind(
          id,
          p.source, p.source_ref, p.business_name, p.website || null, p.root_domain || null,
          p.email || null, p.phone || null, p.vertical, p.city, p.region, p.postal_code,
        ).run();
        liveInserted.push(id);
      } catch (e) {
        liveInserted.push({ id, _error: String(e?.message || e) });
      }
    }
  }

  // Audit event
  try {
    await db.prepare(`
      INSERT INTO mayor_events (id, kind, loop, summary, details_json, created_at)
      VALUES (?, 'discovery', 'manual_seed', ?, ?, datetime('now'))
    `).bind(
      crypto.randomUUID(),
      `Seeded ${inserted.length} fixture + ${liveInserted.length} live prospect(s)`,
      JSON.stringify({ inserted, live_inserted: liveInserted, live_error: liveError, reset })
    ).run();
  } catch (_) {}

  return json({
    ok: true,
    inserted_count: inserted.length,
    inserted,
    live_count: liveInserted.length,
    live_inserted: liveInserted,
    live_error: liveError,
    reset,
  }, 200, request, env);
}