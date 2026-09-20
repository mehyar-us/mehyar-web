// functions/api/floodlens/health.js
// GET /api/floodlens/health — the §4 FEMA health probe as an endpoint.
// Write-free: liveness (MapServer?f=json → 200 + mapName) + a functional
// layer-28 point query at two control points with known-stable answers:
//   - downtown Miami (-80.1918, 25.7617): expect SFHA_TF=T, FLD_ZONE starting
//     with A or V
//   - rural Nevada (-117.0000, 39.3000): expect no features
// Always sends a browser UA. Budgets: p50 < 2s, alert > 8s, hard timeout 15s.

import { FEMA_BASES, BROWSER_UA, femaLiveness } from "../_shared/floodlensCore.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function pointQueryUrl(base, lon, lat) {
  const q = new URL(`${base}/28/query`);
  q.searchParams.set("geometry", `${lon},${lat}`);
  q.searchParams.set("geometryType", "esriGeometryPoint");
  q.searchParams.set("inSR", "4326");
  q.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  q.searchParams.set("outFields", "FLD_ZONE,ZONE_SUBTY,SFHA_TF");
  q.searchParams.set("returnGeometry", "false");
  q.searchParams.set("f", "json");
  return q.toString();
}

async function functionalProbe(base, lon, lat, expect) {
  const t0 = Date.now();
  try {
    const r = await fetch(pointQueryUrl(base, lon, lat), {
      headers: { "user-agent": BROWSER_UA, accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    const j = await r.json().catch(() => null);
    const ms = Date.now() - t0;
    if (!r.ok || !j || j.error) return { ok: false, ms, error: `http_${r.status}` };
    const feats = Array.isArray(j.features) ? j.features : [];
    if (expect === "sfha") {
      const a = (feats[0] && feats[0].attributes) || {};
      const zone = String(a.FLD_ZONE || "");
      const pass = a.SFHA_TF === "T" && /^[AV]/.test(zone);
      return { ok: pass, ms, zone, sfha_tf: a.SFHA_TF, features: feats.length, error: pass ? null : "unexpected_zone" };
    }
    // expect "empty"
    const pass = feats.length === 0;
    return { ok: pass, ms, features: feats.length, error: pass ? null : "unexpected_features" };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, error: String((e && e.message) || e).slice(0, 120) };
  }
}

export async function onRequestGet() {
  const t0 = Date.now();
  const checks = [];
  let base = null;

  for (const b of FEMA_BASES) {
    const live = await femaLiveness(b);
    checks.push({ check: "liveness", base: b, ...live });
    if (live.ok && !base) base = b;
  }
  if (!base) {
    return json({
      ok: false, status: "DOWN", ms: Date.now() - t0, checks,
      note: "FEMA unreachable from the worker — lookups will serve <=7-day cache with a banner, else an honest error.",
    }, 503);
  }

  const miami = await functionalProbe(base, -80.1918, 25.7617, "sfha");
  checks.push({ check: "functional_miami", base, ...miami });
  const nevada = await functionalProbe(base, -117.0, 39.3, "empty");
  checks.push({ check: "functional_nevada", base, ...nevada });

  const allOk = checks.every((c) => c.ok);
  const slow = checks.some((c) => (c.ms || 0) > 8000);
  return json({
    ok: allOk,
    status: allOk ? (slow ? "DEGRADED_SLOW" : "UP") : "DEGRADED",
    ms: Date.now() - t0,
    base,
    checks,
  }, allOk ? 200 : 503);
}
