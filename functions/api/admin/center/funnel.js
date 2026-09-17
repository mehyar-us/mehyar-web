// GET /api/admin/center/funnel — audit funnel aggregates (mehyarsoft).
// Also exports funnelAggregates() for reuse by brand.js.
import { guard, onOptions, qAllSoft, qOne, json } from "./_lib.js";

export async function onRequestOptions({ request, env }) {
  return onOptions(request, env);
}

export async function funnelAggregates(env) {
  if (!env?.LEADS_DB) return { missing: true };
  const leads24h = Number((await qOne(env.LEADS_DB,
    `SELECT COUNT(*) AS n FROM audit_leads WHERE created_at >= datetime('now','-1 day')`).catch(() => null))?.n || 0);
  const leadsTotal = Number((await qOne(env.LEADS_DB,
    `SELECT COUNT(*) AS n FROM audit_leads`).catch(() => null))?.n || 0);
  const deepRows = await qAllSoft(env.LEADS_DB,
    `SELECT deep_status AS s, COUNT(*) AS n FROM audit_leads GROUP BY deep_status`);
  const deep = { none: 0, requested: 0, paid: 0, delivered: 0 };
  for (const r of deepRows) {
    const k = String(r.s || "none").toLowerCase();
    if (k in deep) deep[k] = Number(r.n);
    else if (k === "") deep.none += Number(r.n);
  }
  const dripSends24h = Number((await qOne(env.LEADS_DB,
    `SELECT COUNT(*) AS n FROM email_send_log WHERE sent_at >= datetime('now','-1 day')`).catch(() => null))?.n || 0);
  const failRows = await qAllSoft(env.LEADS_DB,
    `SELECT kind, COUNT(*) AS n FROM email_event_log WHERE created_at >= datetime('now','-1 day') GROUP BY kind`);
  let dripFails = 0;
  for (const r of failRows) {
    if (/fail|bounce|error/i.test(String(r.kind || ""))) dripFails += Number(r.n);
  }
  // Scan-error source: best-effort lookup of a plausible table, else null.
  let scanErrors = null;
  try {
    const tables = await qAllSoft(env.LEADS_DB,
      `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%scan%error%'`);
    if (tables.length) {
      const t = tables[0].name;
      scanErrors = Number((await qOne(env.LEADS_DB,
        `SELECT COUNT(*) AS n FROM "${t}" WHERE created_at >= datetime('now','-1 day')`).catch(() => null))?.n || 0);
    }
  } catch { /* leave null */ }
  return { leads24h, leadsTotal, deepRequested: deep.requested, deepPaid: deep.paid, deepDelivered: deep.delivered, dripSends24h, dripFails, scanErrors };
}

export async function onRequestGet({ request, env }) {
  const g = await guard(request, env);
  if (g.res) return g.res;
  const data = await funnelAggregates(env);
  if (data.missing) return json({ ok: false, error: "leads_db_not_bound", missing: { leads: true } }, 200, request, env);
  return json({ ok: true, ...data }, 200, request, env);
}
