// GET /api/admin/center/brands — brand registry + per-brand rollup.
import { guard, onOptions, qAll, qAllSoft, qOne, etDate, etMonthPrefix, REGISTRY, clicks7d, revenueSince, warmupPause, latestSnapshot, missingBindings, json } from "./_lib.js";

export async function onRequestOptions({ request, env }) {
  return onOptions(request, env);
}

export async function onRequestGet({ request, env }) {
  const g = await guard(request, env);
  if (g.res) return g.res;

  const missing = missingBindings(env);
  const today = etDate();
  const month = etMonthPrefix();

  const brands = [];
  for (const b of REGISTRY) {
    const s = b.sources || {};
    let todaySends = 0, todayPlanned = 0, clicks = 0, revenueMTD = 0;
    let health = "unknown", healthNote = "No data wired yet";

    try {
      // Today's warmup sends (operational DB)
      if (env.JOBS_DB && s.jobs) {
        const rows = await qAllSoft(
          env.JOBS_DB,
          `SELECT COALESCE(SUM(sent_count),0) AS sent, COALESCE(SUM(planned_volume),0) AS planned
             FROM warmup_campaign_daily WHERE brand = ? AND date = ?`,
          [s.jobs, today]
        );
        todaySends = Number(rows[0]?.sent || 0);
        todayPlanned = Number(rows[0]?.planned || 0);
      }
      // mehyarsoft: today's audit-funnel sends
      if (env.LEADS_DB && s.leads === "audit") {
        const r = await qOne(
          env.LEADS_DB,
          `SELECT COUNT(*) AS n FROM email_send_log WHERE substr(sent_at,1,10) = ?`,
          [today]
        ).catch(() => null);
        todaySends = Number(r?.n || 0);
      }

      clicks = await clicks7d(env, s.intel);
      revenueMTD = await revenueSince(env, s.intel, month);

      // Health: paused > bad snapshot > elevated bounce > ok/unknown
      const pause = await warmupPause(env, s);
      const snap = await latestSnapshot(env, b.domain);
      let bounceRate = null;
      if (env.JOBS_DB && s.jobs) {
        const r = await qOne(
          env.JOBS_DB,
          `SELECT COALESCE(SUM(sent_count),0) AS sent, COALESCE(SUM(bounce_count),0) AS b
             FROM warmup_campaign_daily WHERE brand = ? AND date >= date('now','-7 days')`,
          [s.jobs]
        ).catch(() => null);
        if (r && Number(r.sent) > 0) bounceRate = Number(r.b) / Number(r.sent);
      }
      if (pause.paused) {
        health = "paused";
        healthNote = pause.pauseReason || "Warmup paused";
      } else if (snap && snap.verdict === "RED") {
        health = "warn";
        healthNote = "Deliverability RED";
      } else if (bounceRate !== null && bounceRate > 0.08) {
        health = "warn";
        healthNote = `Bounce ${(bounceRate * 100).toFixed(1)}% (7d)`;
      } else if (snap && snap.verdict === "YELLOW") {
        health = "warn";
        healthNote = "Deliverability YELLOW";
      } else if (todaySends > 0 || clicks > 0 || revenueMTD > 0 || !pause.unknown) {
        health = "ok";
        healthNote = "Healthy";
      }
    } catch (e) {
      health = "unknown";
      healthNote = "Query error";
    }

    const { sources, ...pub } = b;
    brands.push({ ...pub, todaySends, todayPlanned, clicks7d: clicks, revenueMTD: Math.round(revenueMTD) / 100, health, healthNote });
  }

  return json({ ok: true, date: today, missing, brands }, 200, request, env);
}
