// GET /api/admin/center/today — today's campaigns across all brands.
import { guard, onOptions, qAllSoft, qOne, etDate, REGISTRY, json } from "./_lib.js";

export async function onRequestOptions({ request, env }) {
  return onOptions(request, env);
}

export async function onRequestGet({ request, env }) {
  const g = await guard(request, env);
  if (g.res) return g.res;

  const today = etDate();
  const rows = [];
  let totalPlanned = 0, totalSent = 0;

  for (const b of REGISTRY) {
    const s = b.sources || {};
    const campaigns = [];
    let planned = 0, sent = 0;

    if (env.JOBS_DB && s.jobs) {
      const daily = await qAllSoft(env.JOBS_DB,
        `SELECT campaign_day, planned_volume, sent_count, delivered_count
           FROM warmup_campaign_daily WHERE brand = ? AND date = ?`, [s.jobs, today]);
      for (const r of daily) {
        campaigns.push({
          name: `Day ${r.campaign_day} warmup`, campaignDay: r.campaign_day,
          planned: Number(r.planned_volume || 0), sent: Number(r.sent_count || 0),
          delivered: Number(r.delivered_count || 0),
        });
        planned += Number(r.planned_volume || 0);
        sent += Number(r.sent_count || 0);
      }
    }
    if (env.LEADS_DB && s.leads === "audit") {
      const r = await qOne(env.LEADS_DB,
        `SELECT COUNT(*) AS n FROM email_send_log WHERE substr(sent_at,1,10) = ?`, [today]).catch(() => null);
      const n = Number(r?.n || 0);
      if (n > 0) campaigns.push({ name: "Audit drip", campaignDay: null, planned: null, sent: n, delivered: null });
      sent += n;
    }

    if (campaigns.length) {
      rows.push({ id: b.id, name: b.name, campaigns, planned, sent });
      totalPlanned += planned;
      totalSent += sent;
    }
  }

  return json({ ok: true, date: today, totals: { planned: totalPlanned, sent: totalSent }, rows }, 200, request, env);
}
