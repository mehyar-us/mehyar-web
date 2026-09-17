// GET /api/admin/center/charts/clicks?days=14 — total clicks/day (go.mehyar.us).
import { guard, onOptions, qAllSoft, etDateMinus, json } from "../_lib.js";

export async function onRequestOptions({ request, env }) {
  return onOptions(request, env);
}

export async function onRequestGet({ request, env }) {
  const g = await guard(request, env);
  if (g.res) return g.res;
  const days = Math.min(60, Math.max(1, Number(new URL(request.url).searchParams.get("days") || 14)));
  const since = etDateMinus(days);

  if (!env?.INTEL_DB) return json({ ok: false, error: "intel_db_not_bound", missing: { intel: true } }, 200, request, env);
  const rows = await qAllSoft(env.INTEL_DB,
    `SELECT date, COALESCE(SUM(clicks),0) AS clicks FROM short_link_daily_clicks
      WHERE date >= ? GROUP BY date ORDER BY date`, [since]);
  return json({ ok: true, days, series: rows.map((r) => ({ date: r.date, clicks: Number(r.clicks || 0) })) }, 200, request, env);
}
