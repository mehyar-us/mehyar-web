// functions/api/floodlens/lookup.js
// POST /api/floodlens/lookup — free FEMA flood-zone lookup.
// Body: { address: string }
// Rate-limited by IP (D1): FLOODLENS_FREE_PER_DAY (default 10) per 24h.
// Geocodes via the US Census geocoder (keyless), queries the FEMA NFHL
// point layer (browser UA, dual base paths), maps FLD_ZONE+ZONE_SUBTY via
// the deterministic zone table. Results cached by geohash-7 for 24h.
// ALWAYS returns data_as_of + the disclaimer + a degraded flag.
// On FEMA outage: serves <=7-day cache with a banner, else an honest
// error — NEVER invents a zone.

import {
  BROWSER_UA, DISCLAIMER_SHORT, DISCLAIMER_LONG,
  geocodeAddress, femaZoneLookup, zoneInfo,
  geohash, effDateToIso, randomToken, clientIp,
  PREMIUM_BANDS, PREMIUM_FOOTNOTE,
} from "../_shared/floodlensCore.js";

const nowSql = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function sanitizeAddress(v) {
  return String(v || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
}

async function checkRateLimit(db, ip, env) {
  const limit = Number(env.FLOODLENS_FREE_PER_DAY) || 10;
  // Counts ALL attempts (successful lookups + failed attempts) so bad
  // actors can't bypass the limit with invalid addresses or during outages.
  const row = await db
    .prepare("SELECT COUNT(*) AS c FROM floodlens_lookups WHERE ip = ? AND created_at > datetime('now','-1 day')")
    .bind(ip)
    .first();
  return { allowed: (row?.c || 0) < limit, used: row?.c || 0, limit };
}

// Records a failed attempt (bad address / FEMA outage with no cache) so it
// counts toward the rate limit. zone stays NULL; findCache excludes these
// via degraded=1, and checkout requires zone IS NOT NULL.
async function storeFailedAttempt(db, { address, ip, lat, lon, gh }) {
  try {
    await db.prepare(
      "INSERT INTO floodlens_lookups (token, address, lat, lon, geohash, degraded, ip) " +
      "VALUES (?, ?, ?, ?, ?, 1, ?)"
    ).bind(randomToken(16), address, lat || 0, lon || 0, gh || "", ip).run();
  } catch { /* rate limiting is best-effort */ }
}

async function findCache(db, gh, maxAgeDays) {
  // Freshness is measured on the ORIGINAL FEMA query time (queried_at), not
  // the copy's created_at — otherwise re-cached copies would refresh stale
  // FEMA data forever.
  return db
    .prepare(
      "SELECT * FROM floodlens_lookups WHERE geohash = ? AND degraded = 0 AND queried_at > datetime('now', ?) " +
      "ORDER BY queried_at DESC LIMIT 1"
    )
    .bind(gh, `-${maxAgeDays} days`)
    .first();
}

function rowToResult(row, { cached = false, degraded = false, banner = null } = {}) {
  const band = PREMIUM_BANDS[row.band];
  return {
    ok: true,
    token: row.token,
    address: row.address,
    normalized: row.normalized,
    lat: row.lat,
    lon: row.lon,
    zone: row.zone,
    zone_subtype: row.zone_subtype,
    sfha: Number(row.sfha) === 1,
    risk: row.risk,
    risk_plain: row.risk_plain,
    premium_estimate: band ? band.label : null,
    premium_footnote: band ? PREMIUM_FOOTNOTE : null,
    bfe: row.bfe,
    dfirm_id: row.dfirm_id,
    firm_pan: row.firm_pan,
    data_as_of: {
      map_effective: row.data_as_of,
      checked_at: row.queried_at || row.created_at,
    },
    disclaimer: DISCLAIMER_SHORT,
    disclaimer_long: DISCLAIMER_LONG,
    degraded,
    banner,
    cached,
    cache_age: row.created_at,
  };
}

async function storeLookup(db, { token, address, normalized, lat, lon, gh, zi, band, bfe, dfirm_id, firm_pan, mapEffective, degraded, ip, queriedAt }) {
  await db.prepare(
    "INSERT INTO floodlens_lookups (token, address, normalized, lat, lon, geohash, zone, zone_subtype, sfha, risk, risk_plain, band, bfe, dfirm_id, firm_pan, data_as_of, queried_at, degraded, ip) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(
    token, address, normalized, lat, lon, gh,
    zi.zone, zi.zone_subtype, zi.sfha, zi.risk, zi.risk_plain, zi.band,
    bfe, dfirm_id, firm_pan, mapEffective, queriedAt, degraded ? 1 : 0, ip
  ).run();
  // D1 read-after-write can be eventually consistent across connections; if
  // the SELECT misses, synthesize the row from the inputs we just wrote.
  const row = await db.prepare("SELECT * FROM floodlens_lookups WHERE token = ?").bind(token).first();
  if (row) return row;
  return {
    token, address, normalized, lat, lon, geohash: gh,
    zone: zi.zone, zone_subtype: zi.zone_subtype, sfha: zi.sfha,
    risk: zi.risk, risk_plain: zi.risk_plain, band: zi.band,
    bfe, dfirm_id, firm_pan, data_as_of: mapEffective,
    queried_at: queriedAt, degraded: degraded ? 1 : 0, ip,
    created_at: new Date().toISOString(),
  };
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env?.LEADS_DB) return json({ ok: false, error: "service_unavailable" }, 503);
    const db = env.LEADS_DB;

    const body = await request.json().catch(() => ({}));
    const address = sanitizeAddress(body.address);
    if (!address || address.length < 5) {
      return json({ ok: false, error: "invalid_address" }, 400);
    }
    const ip = clientIp(request);

    // ── rate limit (before any external call) ──
    const rl = await checkRateLimit(db, ip, env);
    if (!rl.allowed) {
      return json(
        { ok: false, error: "rate_limited", message: `Free lookups are limited to ${rl.limit} per day from one address. The full report has no such limit.` },
        429
      );
    }

    // ── geocode ──
    let geo;
    try {
      geo = await geocodeAddress(address);
    } catch (e) {
      await storeFailedAttempt(db, { address, ip });
      if (e && e.code === "address_not_found") {
        return json({ ok: false, error: "address_not_found", message: "We couldn't find that address. Check the spelling and include city + state." }, 404);
      }
      return json({ ok: false, error: "geocode_failed", message: "Address lookup is temporarily unavailable — try again shortly." }, 502);
    }
    const gh = geohash(geo.lat, geo.lon, 7);

    // ── 24h cache ──
    const fresh = await findCache(db, gh, 1);
    if (fresh) {
      // Record the attempt (counts toward the rate limit) but serve the cache.
      const token = randomToken(16);
      const row = await storeLookup(db, {
        token, address, normalized: fresh.normalized, lat: fresh.lat, lon: fresh.lon, gh,
        zi: { zone: fresh.zone, zone_subtype: fresh.zone_subtype, sfha: Number(fresh.sfha), risk: fresh.risk, risk_plain: fresh.risk_plain, band: fresh.band },
        bfe: fresh.bfe, dfirm_id: fresh.dfirm_id, firm_pan: fresh.firm_pan,
        mapEffective: fresh.data_as_of, degraded: false, ip, queriedAt: fresh.queried_at,
      });
      const res = rowToResult(row, { cached: true });
      res.served_from = "cache_24h";
      return json(res);
    }

    // ── live FEMA query ──
    const fema = await femaZoneLookup(geo.lat, geo.lon);
    const queriedAt = new Date().toISOString();

    if (!fema.ok) {
      // Outage path: serve <=7-day cache with a banner, else an honest error.
      const stale = await findCache(db, gh, 7);
      if (stale) {
        const token = randomToken(16);
        const row = await storeLookup(db, {
          token, address, normalized: stale.normalized, lat: stale.lat, lon: stale.lon, gh,
          zi: { zone: stale.zone, zone_subtype: stale.zone_subtype, sfha: Number(stale.sfha), risk: stale.risk, risk_plain: stale.risk_plain, band: stale.band },
          bfe: stale.bfe, dfirm_id: stale.dfirm_id, firm_pan: stale.firm_pan,
          mapEffective: stale.data_as_of, degraded: true, ip, queriedAt: stale.queried_at,
        });
        const res = rowToResult(row, {
          cached: true, degraded: true,
          banner: `FEMA is temporarily unreachable — showing last checked data from ${(stale.queried_at || stale.created_at || "").slice(0, 10)}.`,
        });
        res.served_from = "cache_7d_degraded";
        return json(res);
      }
      await storeFailedAttempt(db, { address, ip, lat: geo.lat, lon: geo.lon, gh });
      return json(
        { ok: false, error: "fema_unavailable", degraded: true, disclaimer: DISCLAIMER_SHORT,
          message: "FEMA lookup is unavailable right now — check back shortly or use FEMA's Map Service Center directly (msc.fema.gov/portal)." },
        502
      );
    }
    // (storeFailedAttempt intentionally NOT called on the outage path when a
    // degraded cache was served — that already wrote a row above.)

    const zi = fema.zone ? zoneInfo(fema.zone.fld_zone, fema.zone.zone_subty) : zoneInfo(null, null);
    const mapEffective = effDateToIso(fema.panel && fema.panel.eff_date);
    const token = randomToken(16);
    const row = await storeLookup(db, {
      token, address, normalized: geo.matched, lat: geo.lat, lon: geo.lon, gh, zi,
      bfe: fema.zone ? fema.zone.static_bfe : null,
      dfirm_id: (fema.zone && fema.zone.dfirm_id) || (fema.panel && fema.panel.dfirm_id) || null,
      firm_pan: (fema.panel && fema.panel.firm_pan) || null,
      mapEffective, degraded: false, ip, queriedAt,
    });
    const res = rowToResult(row, { cached: false });
    res.served_from = "live";
    res.fema_latency_ms = fema.latency_ms;
    return json(res);
  } catch (e) {
    console.error("floodlens lookup failed", e && e.message);
    return json({ ok: false, error: "lookup_failed" }, 500);
  }
}
