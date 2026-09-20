// TEMPORARY diagnostic — REMOVE BEFORE LAUNCH.
// GET /api/floodlens/diag?address=... — runs every lookup stage with
// per-stage try/catch + timings to isolate the production 502.
import {
  geocodeAddress, femaZoneLookup, zoneInfo,
  geohash, effDateToIso, randomToken,
} from "../_shared/floodlensCore.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function onRequestGet({ request, env }) {
  const stages = {};
  const mark = (name, fn) => Promise.resolve().then(fn).then(
    (v) => { stages[name] = { ok: true, ms: v && v.ms, note: v && v.note }; return v && v.val; },
    (e) => { stages[name] = { ok: false, error: String((e && e.message) || e).slice(0, 200) }; throw e; }
  );
  const t = (fn) => { const t0 = Date.now(); return Promise.resolve().then(fn).then((val) => ({ val, ms: Date.now() - t0 })); };
  try {
    const url = new URL(request.url);
    const address = (url.searchParams.get("address") || "").slice(0, 300);
    if (!address || address.length < 5) return json({ ok: false, stages, error: "invalid_address" }, 400);
    const db = env.LEADS_DB;

    const geo = await mark("geocode", () => t(() => geocodeAddress(address)).then((r) => ({ ...r, note: `${r.lat},${r.lon}`, val: r.val })));
    const gh = await mark("geohash", () => t(() => geohash(geo.lat, geo.lon, 7)).then((r) => ({ ...r, note: r.val, val: r.val })));
    const cache = await mark("findCache", () =>
      t(() => db.prepare("SELECT * FROM floodlens_lookups WHERE geohash = ? AND degraded = 0 AND queried_at > datetime('now', ?) ORDER BY queried_at DESC LIMIT 1").bind(gh, "-1 days").first())
        .then((r) => ({ ...r, note: r.val ? "hit" : "miss", val: r.val })));
    const fema = await mark("femaZoneLookup", () =>
      t(() => femaZoneLookup(geo.lat, geo.lon)).then((r) => ({ ...r, note: r.val.ok ? `zone=${r.val.zone && r.val.zone.fld_zone}` : `err=${r.val.error}`, val: r.val })));
    const zi = await mark("zoneInfo", () =>
      t(() => { const z = fema.zone ? zoneInfo(fema.zone.fld_zone, fema.zone.zone_subty) : zoneInfo(null, null); return { val: z, note: z.zone }; }));
    const mapEff = await mark("effDateToIso", () =>
      t(() => effDateToIso(fema.panel && fema.panel.eff_date)).then((r) => ({ ...r, note: String(r.val), val: r.val })));
    // Raw FEMA layer introspection: what does /28/query actually return?
    await mark("femaRaw", () =>
      t(async () => {
        const base = "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer";
        const layersR = await fetch(base + "/layers?f=json", { headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36" }, signal: AbortSignal.timeout(15000) });
        const layersJ = await layersR.json().catch(() => null);
        const layers = layersJ && Array.isArray(layersJ.layers) ? layersJ.layers.map((l) => l.id + ":" + l.name).slice(0, 40) : ("layers_status_" + layersR.status);
        const q = base + "/28/query?geometry=" + geo.lon + "," + geo.lat + "&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=FLD_ZONE&returnGeometry=false&f=json";
        const qr = await fetch(q, { headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36" }, signal: AbortSignal.timeout(15000) });
        const qb = await qr.text();
        return { val: null, note: "q28_status=" + qr.status + " body=" + qb.slice(0, 200) + " | layers=" + JSON.stringify(layers).slice(0, 300) };
      }));
    const token = "diag" + randomToken(8);
    await mark("storeLookup", () =>
      t(() => db.prepare(
        "INSERT INTO floodlens_lookups (token, address, normalized, lat, lon, geohash, zone, zone_subtype, sfha, risk, risk_plain, band, bfe, dfirm_id, firm_pan, data_as_of, queried_at, degraded, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).bind(token, address, geo.matched, geo.lat, geo.lon, gh, zi.zone, zi.zone_subtype, zi.sfha, zi.risk, zi.risk_plain, zi.band,
        fema.zone ? fema.zone.static_bfe : null,
        (fema.zone && fema.zone.dfirm_id) || (fema.panel && fema.panel.dfirm_id) || null,
        (fema.panel && fema.panel.firm_pan) || null,
        mapEff, new Date().toISOString(), 0, "diag").run())
        .then((r) => ({ ...r, note: "inserted", val: null })));
    return json({ ok: true, stages, token });
  } catch (e) {
    return json({ ok: false, stages, fatal: String((e && e.message) || e).slice(0, 200) }, 500);
  }
}
