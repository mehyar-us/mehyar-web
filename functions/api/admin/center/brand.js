// GET /api/admin/center/brand?id=<registryId> — full brand detail payload.
import { guard, onOptions, qAll, qAllSoft, qOne, etDate, etDateMinus, etMonthPrefix, REGISTRY, WARMUP_LADDER, WARMUP_CAP, clicks7d, revenueSince, warmupPause, latestSnapshot, json } from "./_lib.js";
import { funnelAggregates } from "./funnel.js";

export async function onRequestOptions({ request, env }) {
  return onOptions(request, env);
}

export async function onRequestGet({ request, env }) {
  const g = await guard(request, env);
  if (g.res) return g.res;

  const url = new URL(request.url);
  const id = url.searchParams.get("id") || "";
  const reg = REGISTRY.find((b) => b.id === id);
  if (!reg) return json({ ok: false, error: "unknown_brand" }, 200, request, env);
  const s = reg.sources || {};
  const today = etDate();
  const month = etMonthPrefix();

  const out = {
    ok: true,
    brand: { id: reg.id, name: reg.name, domain: reg.domain, url: reg.url, kind: reg.kind, price: reg.price || null, instagram: reg.instagram || null, status: reg.status },
    kpis: { sends7d: 0, clicks7d: 0, opens7d: 0, bounceRate7d: null, revenueMTD: 0, revenue30d: 0, purchases30d: 0 },
    todayCampaign: null,
    prevCampaigns: [],
    seriesSends: [],
    seriesClicks: [],
    topLinks: [],
    templates: [],
    warmup: null,
    health: { paused: false, pauseReason: null, bounceRate7d: null, complaintRate7d: null, snapshots: [] },
    revenue: { series: [], purchases: [] },
  };
  if (s.leads === "audit") out.funnel = await funnelAggregates(env);

  // ── Sends / opens / bounces (warmup operational DB, or audit log) ──────
  let daily = [];
  if (env.JOBS_DB && s.jobs) {
    daily = await qAllSoft(env.JOBS_DB,
      `SELECT date, campaign_day, planned_volume, sent_count, delivered_count, open_count, click_count, bounce_count, unsub_count, complaint_count
         FROM warmup_campaign_daily WHERE brand = ? ORDER BY date DESC LIMIT 60`, [s.jobs]);
  }
  const d7 = daily.filter((r) => r.date >= etDateMinus(7));
  out.kpis.sends7d = d7.reduce((a, r) => a + Number(r.sent_count || 0), 0);
  out.kpis.opens7d = d7.reduce((a, r) => a + Number(r.open_count || 0), 0);
  const sent7 = d7.reduce((a, r) => a + Number(r.sent_count || 0), 0);
  const b7 = d7.reduce((a, r) => a + Number(r.bounce_count || 0), 0);
  const c7 = d7.reduce((a, r) => a + Number(r.complaint_count || 0), 0);
  if (sent7 > 0) {
    out.kpis.bounceRate7d = b7 / sent7;
    out.health.bounceRate7d = b7 / sent7;
    out.health.complaintRate7d = c7 / sent7;
  }
  // mehyarsoft audit sends from LEADS_DB
  if (env.LEADS_DB && s.leads === "audit") {
    const r = await qOne(env.LEADS_DB,
      `SELECT COUNT(*) AS n FROM email_send_log WHERE substr(sent_at,1,10) >= ?`, [etDateMinus(7)]).catch(() => null);
    out.kpis.sends7d = Number(r?.n || 0);
  }
  out.kpis.clicks7d = await clicks7d(env, s.intel);
  out.kpis.revenueMTD = Math.round(await revenueSince(env, s.intel, month)) / 100;
  out.kpis.revenue30d = Math.round(await revenueSince(env, s.intel, etDateMinus(30))) / 100;
  if (env.INTEL_DB && s.intel) {
    const pc = await qOne(env.INTEL_DB,
      `SELECT COUNT(*) AS n FROM purchases p JOIN offers o ON o.id = p.offer_id
        WHERE o.brand_id = ? AND substr(p.purchased_at,1,10) >= ?`, [s.intel, etDateMinus(30)]).catch(() => null);
    out.kpis.purchases30d = Number(pc?.n || 0);
  }

  // ── Today + previous campaigns ──────────────────────────────────────────
  const todayRow = daily.find((r) => r.date === today) || daily[0] || null;
  if (todayRow) {
    out.todayCampaign = {
      date: todayRow.date, campaignDay: todayRow.campaign_day,
      planned: Number(todayRow.planned_volume || 0), sent: Number(todayRow.sent_count || 0),
      delivered: Number(todayRow.delivered_count || 0),
    };
  } else if (s.leads === "audit" && env.LEADS_DB) {
    const r = await qOne(env.LEADS_DB,
      `SELECT COUNT(*) AS n FROM email_send_log WHERE substr(sent_at,1,10) = ?`, [today]).catch(() => null);
    out.todayCampaign = { date: today, campaignDay: null, planned: null, sent: Number(r?.n || 0), delivered: null };
  }
  out.prevCampaigns = daily.slice(0, 14).map((r) => ({
    date: r.date, campaignDay: r.campaign_day, planned: Number(r.planned_volume || 0),
    sent: Number(r.sent_count || 0), delivered: Number(r.delivered_count || 0),
    opens: Number(r.open_count || 0), clicks: Number(r.click_count || 0),
    bounces: Number(r.bounce_count || 0), unsubs: Number(r.unsub_count || 0), complaints: Number(r.complaint_count || 0),
  }));
  out.seriesSends = daily.filter((r) => r.date >= etDateMinus(14)).reverse()
    .map((r) => ({ date: r.date, sends: Number(r.sent_count || 0) }));
  if (s.leads === "audit" && env.LEADS_DB) {
    const rows = await qAllSoft(env.LEADS_DB,
      `SELECT substr(sent_at,1,10) AS date, COUNT(*) AS sends FROM email_send_log
        WHERE substr(sent_at,1,10) >= ? GROUP BY date ORDER BY date`, [etDateMinus(14)]);
    out.seriesSends = rows.map((r) => ({ date: r.date, sends: Number(r.sends) }));
  }

  // ── Click series + top links ────────────────────────────────────────────
  if (env.INTEL_DB && s.intel) {
    const cs = await qAllSoft(env.INTEL_DB,
      `SELECT sdc.date AS date, SUM(sdc.clicks) AS clicks
         FROM short_link_daily_clicks sdc JOIN short_links sl ON sl.code = sdc.code
        WHERE sl.brand_id = ? AND sdc.date >= ? GROUP BY date ORDER BY date`, [s.intel, etDateMinus(14)]);
    out.seriesClicks = cs.map((r) => ({ date: r.date, clicks: Number(r.clicks) }));
    const tl = await qAllSoft(env.INTEL_DB,
      `SELECT sl.code, sl.label, sl.destination_url,
              COALESCE(SUM(CASE WHEN sdc.date >= date('now','-7 days') THEN sdc.clicks END),0) AS c7,
              COALESCE(SUM(CASE WHEN sdc.date >= date('now','-30 days') THEN sdc.clicks END),0) AS c30
         FROM short_links sl LEFT JOIN short_link_daily_clicks sdc ON sdc.code = sl.code
        WHERE sl.brand_id = ? GROUP BY sl.code ORDER BY c30 DESC LIMIT 15`, [s.intel]);
    out.topLinks = tl.map((r) => ({
      code: r.code, url: "https://go.mehyar.us/" + r.code, label: r.label || r.code,
      destination: r.destination_url, clicks7d: Number(r.c7 || 0), clicks30d: Number(r.c30 || 0),
    }));

    // ── Templates ─────────────────────────────────────────────────────────
    const tmpls = await qAllSoft(env.INTEL_DB,
      `SELECT t.id, t.name, t.version, t.subject, t.status, t.preflight_score, t.preflight_verdict,
              t.judge_score, t.judge_verdict, t.created_at
         FROM templates t JOIN campaigns c ON c.id = t.campaign_id
        WHERE c.brand_id = ? ORDER BY t.created_at DESC LIMIT 20`, [s.intel]);
    for (const t of tmpls) {
      const st = await qOne(env.INTEL_DB,
        `SELECT COALESCE(SUM(unsubs),0) AS u, COALESCE(SUM(opens),0) AS o
           FROM template_daily_stats WHERE template_id = ? AND date >= date('now','-7 days')`, [t.id]).catch(() => null);
      const opens = Number(st?.o || 0);
      out.templates.push({
        id: t.id, name: t.name, version: t.version, subject: t.subject, status: t.status,
        preflightScore: t.preflight_score, preflightVerdict: t.preflight_verdict,
        judgeScore: t.judge_score, judgeVerdict: t.judge_verdict,
        regret7d: opens > 0 ? Number(st.u) / opens : null,
      });
    }

    // ── Revenue series + purchases ────────────────────────────────────────
    const rs = await qAllSoft(env.INTEL_DB,
      `SELECT substr(p.purchased_at,1,10) AS date, SUM(p.amount_cents) AS cents
         FROM purchases p JOIN offers o ON o.id = p.offer_id
        WHERE o.brand_id = ? AND substr(p.purchased_at,1,10) >= ?
        GROUP BY date ORDER BY date`, [s.intel, etDateMinus(30)]);
    out.revenue.series = rs.map((r) => ({ date: r.date, revenue: Math.round(Number(r.cents || 0)) / 100 }));
    const pu = await qAllSoft(env.INTEL_DB,
      `SELECT p.purchased_at, p.amount_cents, p.offer_id, p.source
         FROM purchases p JOIN offers o ON o.id = p.offer_id
        WHERE o.brand_id = ? ORDER BY p.purchased_at DESC LIMIT 25`, [s.intel]);
    out.revenue.purchases = pu.map((r) => ({
      purchasedAt: r.purchased_at, amountCents: Number(r.amount_cents || 0), offerId: r.offer_id, source: r.source || null,
    }));
  }

  // ── Warmup ladder ───────────────────────────────────────────────────────
  if (daily.length) {
    const pause = await warmupPause(env, s);
    const days = [...daily].reverse().map((r) => ({
      date: r.date, campaignDay: r.campaign_day, planned: Number(r.planned_volume || 0),
      sent: Number(r.sent_count || 0), delivered: Number(r.delivered_count || 0),
      opens: Number(r.open_count || 0), clicks: Number(r.click_count || 0),
      bounces: Number(r.bounce_count || 0), unsubs: Number(r.unsub_count || 0), complaints: Number(r.complaint_count || 0),
    }));
    out.warmup = {
      ladder: WARMUP_LADDER, cap: WARMUP_CAP,
      currentDay: Math.max(...daily.map((r) => Number(r.campaign_day || 0))),
      paused: pause.paused, pauseReason: pause.pauseReason, days,
    };
    out.health.paused = pause.paused;
    out.health.pauseReason = pause.pauseReason;
  } else if (env.JOBS_DB && (s.jobs || s.intel)) {
    const pause = await warmupPause(env, s);
    out.health.paused = pause.paused;
    out.health.pauseReason = pause.pauseReason;
  }

  // ── Deliverability snapshots ────────────────────────────────────────────
  const snap = await latestSnapshot(env, reg.domain);
  if (snap) {
    const sent = Number(snap.sent || 0);
    out.health.snapshots = [{
      date: snap.date, domain: snap.domain, esp: snap.esp,
      sent, delivered: Number(snap.delivered || 0),
      bounceRate: sent > 0 ? (Number(snap.bounce_hard || 0) + Number(snap.bounce_soft || 0)) / sent : null,
      complaintRate: sent > 0 ? Number(snap.complaints || 0) / sent : null,
      verdict: snap.verdict,
    }];
  }

  return json(out, 200, request, env);
}
