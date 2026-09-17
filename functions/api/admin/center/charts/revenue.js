// GET /api/admin/center/charts/revenue?days=30 — total revenue/day (dollars).
import { guard, onOptions, qAllSoft, etDateMinus, json } from "../_lib.js";

export async function onRequestOptions({ request, env }) {
  return onOptions(request, env);
}

export async function onRequestGet({ request, env }) {
  const g = await guard(request, env);
  if (g.res) return g.res;
  const days = Math.min(90, Math.max(1, Number(new URL(request.url).searchParams.get("days") || 30)));
  const since = etDateMinus(days);

  if (!env?.INTEL_DB) return json({ ok: false, error: "intel_db_not_bound", missing: { intel: true } }, 200, request, env);
  const rows = await qAllSoft(env.INTEL_DB,
    `SELECT substr(purchased_at,1,10) AS date, COALESCE(SUM(amount_cents),0) AS cents
       FROM purchases WHERE substr(purchased_at,1,10) >= ? GROUP BY date ORDER BY date`, [since]);
  return json({ ok: true, days, series: rows.map((r) => ({ date: r.date, total: Math.round(Number(r.cents || 0)) / 100 })) }, 200, request, env);
}
