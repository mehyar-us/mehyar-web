// GET /api/admin/center/charts/sends?days=14 — stacked sends/day/brand.
import { guard, onOptions, qAllSoft, etDateMinus, JOBS_TO_REG, json } from "../_lib.js";

export async function onRequestOptions({ request, env }) {
  return onOptions(request, env);
}

export async function onRequestGet({ request, env }) {
  const g = await guard(request, env);
  if (g.res) return g.res;
  const days = Math.min(60, Math.max(1, Number(new URL(request.url).searchParams.get("days") || 14)));
  const since = etDateMinus(days);

  const byDate = {}; // date -> { regId: sends }
  const brands = new Set();

  if (env.JOBS_DB) {
    const rows = await qAllSoft(env.JOBS_DB,
      `SELECT date, brand, COALESCE(SUM(sent_count),0) AS sends
         FROM warmup_campaign_daily WHERE date >= ? GROUP BY date, brand ORDER BY date`, [since]);
    for (const r of rows) {
      const reg = JOBS_TO_REG[r.brand];
      if (!reg) continue;
      brands.add(reg);
      (byDate[r.date] = byDate[r.date] || {})[reg] = Number(r.sends || 0);
    }
  }
  if (env.LEADS_DB) {
    const rows = await qAllSoft(env.LEADS_DB,
      `SELECT substr(sent_at,1,10) AS date, COUNT(*) AS sends FROM email_send_log
        WHERE substr(sent_at,1,10) >= ? GROUP BY date ORDER BY date`, [since]);
    for (const r of rows) {
      brands.add("mehyarsoft");
      (byDate[r.date] = byDate[r.date] || {})["mehyarsoft"] = Number(r.sends || 0);
    }
  }

  const series = Object.keys(byDate).sort().map((date) => ({ date, ...byDate[date] }));
  return json({ ok: true, days, brands: [...brands], series }, 200, request, env);
}
