// functions/api/_shared/floodlensCore.js
// FloodLens shared backend: FEMA NFHL client, US Census geocoder,
// deterministic zone table, geohash-7 helpers, rate-limit helpers.
//
// Endpoint notes (verified 2026-09-20 against multiple Sept-2026 sources,
// incl. a 2026-09-02 live capture; sandbox/PC could not reach FEMA live):
//   - Primary base: https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer
//   - Alternate base: https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer
//     (the /gis/nfhl path can 404 behind some gateways — try both)
//   - Layer 28 = S_Fld_Haz_Ar (flood zone polygons)
//   - FIRM panel layer = 3 (per 2026 consumer docs) or 4 (per older docs) —
//     try 3 first, fall back to 4. EFF_DATE lives on the panel layer.
//   - FEMA 403s non-browser User-Agents: ALWAYS send a browser UA.

export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export const FEMA_BASES = [
  "https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer",
  "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer",
];

export const FEMA_TIMEOUT_MS = 15000;

export const DISCLAIMER_SHORT = "Not an official flood determination.";

export const DISCLAIMER_LONG =
  "Not an official flood determination. This lookup reads FEMA's National Flood Hazard " +
  "Layer for informational purposes only. It is not a certified flood zone determination and " +
  "does not replace the Standard Flood Hazard Determination Form (SFHDF) your lender or " +
  "insurer requires. Flood-zone boundaries are approximate, maps are updated over time " +
  "(see the map effective date shown), and recent Letters of Map Change may not yet be " +
  "reflected. For insurance, lending, or building decisions, consult your local floodplain " +
  "administrator, your insurance agent, or a licensed flood-determination provider. " +
  "Premium ranges shown are estimates, not quotes — get a real quote at floodsmart.gov.";

export function randomToken(bytes = 32) {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export function clientIp(request) {
  return (
    request.headers.get("cf-connecting-ip") ||
    (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    "unknown"
  );
}

function femaFetch(url, timeoutMs = FEMA_TIMEOUT_MS) {
  return fetch(url, {
    headers: { "user-agent": BROWSER_UA, accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
}

function pointQueryUrl(base, layer, lon, lat, outFields) {
  const q = new URL(`${base}/${layer}/query`);
  q.searchParams.set("geometry", `${lon},${lat}`);
  q.searchParams.set("geometryType", "esriGeometryPoint");
  q.searchParams.set("inSR", "4326");
  q.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  q.searchParams.set("outFields", outFields);
  q.searchParams.set("returnGeometry", "false");
  q.searchParams.set("f", "json");
  return q.toString();
}

const ZONE_FIELDS =
  "FLD_ZONE,ZONE_SUBTY,SFHA_TF,DFIRM_ID,STATIC_BFE,DEPTH,VELOCITY,SOURCE_CIT,VERSION_ID";
const PANEL_FIELDS = "FIRM_PAN,DFIRM_ID,EFF_DATE,ST_FIPS,PANEL,SUFFIX";

// Liveness probe against one base. Returns {ok, ms, mapName?, error?}.
export async function femaLiveness(base, timeoutMs = 8000) {
  const t0 = Date.now();
  try {
    const r = await femaFetch(`${base}?f=json`, timeoutMs);
    const j = await r.json().catch(() => null);
    if (r.ok && j && j.mapName) {
      return { ok: true, ms: Date.now() - t0, mapName: j.mapName };
    }
    return { ok: false, ms: Date.now() - t0, error: `http_${r.status}` };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, error: String((e && e.message) || e).slice(0, 120) };
  }
}

// Full zone lookup for one point. Returns
// { ok, degraded?, base, zone: {...}, panel: {...}, latency_ms, error? }
// NEVER invents a zone: ok:false on any FEMA failure.
export async function femaZoneLookup(lat, lon) {
  const t0 = Date.now();
  let lastError = "fema_unreachable";
  for (const base of FEMA_BASES) {
    try {
      const zr = await femaFetch(pointQueryUrl(base, 28, lon, lat, ZONE_FIELDS));
      const zj = await zr.json().catch(() => null);
      if (!zr.ok || !zj || zj.error) {
        lastError = `zone_http_${zr.status}`;
        continue;
      }
      const feats = Array.isArray(zj.features) ? zj.features : [];
      if (feats.length === 0) {
        // Point outside mapped polygons — distinct from an error.
        return {
          ok: true, base, latency_ms: Date.now() - t0,
          zone: null, panel: await femaPanelLookup(base, lon, lat),
        };
      }
      // Prefer the SFHA feature when polygons overlap (most restrictive wins).
      const attrs = feats
        .map((f) => (f && f.attributes) || {})
        .sort((a, b) => (b.SFHA_TF === "T" ? 1 : 0) - (a.SFHA_TF === "T" ? 1 : 0))[0];
      const panel = await femaPanelLookup(base, lon, lat);
      return {
        ok: true, base, latency_ms: Date.now() - t0,
        zone: {
          fld_zone: attrs.FLD_ZONE ?? null,
          zone_subty: attrs.ZONE_SUBTY ?? null,
          sfha_tf: attrs.SFHA_TF ?? null,
          dfirm_id: attrs.DFIRM_ID ?? null,
          static_bfe: attrs.STATIC_BFE ?? null,
          depth: attrs.DEPTH ?? null,
          velocity: attrs.VELOCITY ?? null,
          source_cit: attrs.SOURCE_CIT ?? null,
          version_id: attrs.VERSION_ID ?? null,
        },
        panel,
      };
    } catch (e) {
      lastError = String((e && e.message) || e).slice(0, 120);
    }
  }
  return { ok: false, error: lastError, latency_ms: Date.now() - t0 };
}

async function femaPanelLookup(base, lon, lat) {
  // Layer 3 vs 4 disagreement across 2026 sources — try 3, then 4.
  for (const layer of [3, 4]) {
    try {
      const r = await femaFetch(pointQueryUrl(base, layer, lon, lat, PANEL_FIELDS), 10000);
      const j = await r.json().catch(() => null);
      if (r.ok && j && Array.isArray(j.features) && j.features.length > 0) {
        const a = j.features[0].attributes || {};
        return {
          firm_pan: a.FIRM_PAN ?? null,
          dfirm_id: a.DFIRM_ID ?? null,
          eff_date: a.EFF_DATE ?? null, // epoch ms
          st_fips: a.ST_FIPS ?? null,
          layer,
        };
      }
    } catch { /* try next layer */ }
  }
  return null;
}

// ── Deterministic zone table (§2 of the FEMA brief) ───────────────────────
// Returns { zone, zone_subtype, sfha (0/1), risk (key), risk_plain, band }
// band keys drive the premium table: V | A | AH | X | Xshaded | D | null
export function zoneInfo(fldZone, zoneSubty) {
  const z = String(fldZone || "").trim().toUpperCase();
  const sub = String(zoneSubty || "").trim().toUpperCase();
  const noData = {
    zone: z || "UNKNOWN", zone_subtype: zoneSubty || null, sfha: 0,
    risk: "no_data", risk_plain: "No data — outside mapped coverage", band: null,
  };
  if (!z || z === "OPEN WATER" || z === "AREA NOT INCLUDED" || sub.includes("AREA NOT INCLUDED")) {
    return noData;
  }
  if (/^V\d*$/.test(z) || z === "V" || z === "VE") {
    return {
      zone: z, zone_subtype: zoneSubty || null, sfha: 1, risk: "high_coastal",
      risk_plain: "High risk — coastal (wave action). Insurance required with a federally backed mortgage.",
      band: "V",
    };
  }
  if (/^A\d*$/.test(z) || ["A", "AE", "AH", "AO", "AR", "A99"].includes(z)) {
    const tail =
      z === "AH" ? " Ponding/shallow flooding." :
      z === "AO" ? " Shallow sheet-flow flooding." :
      z === "AR" ? " Levee/dam system under construction." :
      z === "A99" ? " Protection system not yet complete." : "";
    return {
      zone: z, zone_subtype: zoneSubty || null, sfha: 1, risk: "high",
      risk_plain: `High risk — 1%-annual-chance flood area.${tail} Insurance required with a federally backed mortgage.`.trim(),
      band: z === "AH" || z === "AO" ? "AH" : "A",
    };
  }
  if (z === "X" || z === "X500" || z === "B") {
    const shaded = sub.includes("0.2 PCT") || z === "B" || z === "X500";
    return shaded
      ? {
          zone: z, zone_subtype: zoneSubty || null, sfha: 0, risk: "moderate",
          risk_plain: "Moderate risk — between the 1% and 0.2% flood limits. Insurance optional but recommended.",
          band: "Xshaded",
        }
      : {
          zone: z, zone_subtype: zoneSubty || null, sfha: 0, risk: "minimal",
          risk_plain: "Minimal risk — outside the SFHA and above the 0.2% flood elevation. Insurance optional.",
          band: "X",
        };
  }
  if (z === "C") {
    return {
      zone: z, zone_subtype: zoneSubty || null, sfha: 0, risk: "minimal",
      risk_plain: "Minimal risk — outside the SFHA. Insurance optional.", band: "X",
    };
  }
  if (z === "D") {
    return {
      zone: z, zone_subtype: zoneSubty || null, sfha: 0, risk: "undetermined",
      risk_plain: "Undetermined — not studied. Treat with caution.", band: "D",
    };
  }
  return {
    zone: z, zone_subtype: zoneSubty || null, sfha: 0, risk: "unknown",
    risk_plain: "Unclassified zone — treat with caution.", band: null,
  };
}

// ── Premium bands (§3 — $250k building coverage, estimates NOT quotes) ────
export const PREMIUM_BANDS = {
  X: { low: 400, high: 900, label: "$400–$900/yr" },
  Xshaded: { low: 500, high: 1200, label: "$500–$1,200/yr" },
  A: { low: 800, high: 2000, label: "$800–$2,000/yr" },
  AH: { low: 700, high: 1800, label: "$700–$1,800/yr" },
  V: { low: 1600, high: 7000, label: "$1,600–$7,000+/yr" },
  D: { low: 900, high: 2000, label: "$900–$2,000/yr" },
};

export const PREMIUM_FOOTNOTE =
  "Estimates based on published NFIP data (FEMA, 2025–2026) for a $250,000 " +
  "building-coverage policy. Your actual premium is set by your insurer under " +
  "FEMA's Risk Rating 2.0 and varies by property. Never a quote — get a real " +
  "quote at floodsmart.gov.";

// ── US Census geocoder (keyless) ───────────────────────────────────────────
export async function geocodeAddress(address) {
  const q = new URL("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress");
  q.searchParams.set("address", address);
  q.searchParams.set("benchmark", "Public_AR_Current");
  q.searchParams.set("vintage", "Current_Current");
  q.searchParams.set("format", "json");
  const r = await fetch(q.toString(), {
    headers: { "user-agent": BROWSER_UA, accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`geocode_http_${r.status}`);
  const j = await r.json().catch(() => null);
  const matches = (j && j.result && j.result.addressMatches) || [];
  if (matches.length === 0) {
    const err = new Error("address_not_found");
    err.code = "address_not_found";
    throw err;
  }
  const m = matches[0];
  return {
    lat: m.coordinates.y,
    lon: m.coordinates.x,
    matched: m.matchedAddress || address,
    tigerLineId: m.tigerLine ? m.tigerLine.tigerLineId : null,
  };
}

// ── Geohash (precision 7 ≈ 150m cell, per the caching spec) ────────────────
const GH_BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";
export function geohash(lat, lon, precision = 7) {
  let idx = 0, bit = 0, even = true, out = "";
  let latMin = -90, latMax = 90, lonMin = -180, lonMax = 180;
  while (out.length < precision) {
    if (even) {
      const mid = (lonMin + lonMax) / 2;
      if (lon >= mid) { idx = idx * 2 + 1; lonMin = mid; } else { idx = idx * 2; lonMax = mid; }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) { idx = idx * 2 + 1; latMin = mid; } else { idx = idx * 2; latMax = mid; }
    }
    even = !even;
    if (++bit === 5) { out += GH_BASE32[idx]; bit = 0; idx = 0; }
  }
  return out;
}

export function effDateToIso(effDate) {
  if (!effDate) return null;
  const n = Number(effDate);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n).toISOString().slice(0, 10);
}
