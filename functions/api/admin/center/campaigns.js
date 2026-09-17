// GET /api/admin/center/campaigns — campaign timeline across brands.
import { guard, onOptions, qAllSoft, qOne, REGISTRY, json } from "./_lib.js";

export async function onRequestOptions({ request, env }) {
  return onOptions(request, env);
}

export async function onRequestGet({ request, env }) {
  const g = await guard(request, env);
  if (g.res) return g.res;
  if (!env?.INTEL_DB) return json({ ok: false, error: "intel_db_not_bound", missing: { intel: true } }, 200, request, env);

  const intelIds = REGISTRY.map((b) => b.sources?.intel).filter(Boolean);
  const camps = await qAllSoft(env.INTEL_DB,
    `SELECT id, brand_id, kind, name, status, created_at FROM campaigns
      WHERE brand_id IN (${intelIds.map(() => "?").join(",")}) ORDER BY created_at DESC LIMIT 100`,
    intelIds);

  const brandName = Object.fromEntries(REGISTRY.map((b) => [b.sources?.intel, b.name]));
  const regId = Object.fromEntries(REGISTRY.map((b) => [b.sources?.intel, b.id]));
  const out = [];
  for (const c of camps) {
    const st = await qOne(env.INTEL_DB,
      `SELECT MAX(tds.date) AS last_date,
              COALESCE(SUM(tds.sends),0) AS sends, COALESCE(SUM(tds.opens),0) AS opens,
              COALESCE(SUM(tds.clicks),0) AS clicks, COALESCE(SUM(tds.bounces),0) AS bounces
         FROM template_daily_stats tds JOIN templates t ON t.id = tds.template_id
        WHERE t.campaign_id = ? AND tds.date >= date('now','-7 days')`, [c.id]).catch(() => null);
    out.push({
      id: c.id, brandId: regId[c.brand_id] || c.brand_id, brandName: brandName[c.brand_id] || c.brand_id,
      kind: c.kind, name: c.name, status: c.status, lastDate: st?.last_date || null,
      sends7d: Number(st?.sends || 0), opens7d: Number(st?.opens || 0),
      clicks7d: Number(st?.clicks || 0), bounces7d: Number(st?.bounces || 0),
    });
  }
  // Most-recently-active first; never-active at the bottom.
  out.sort((a, b) => (b.lastDate || "").localeCompare(a.lastDate || ""));
  return json({ ok: true, campaigns: out }, 200, request, env);
}
