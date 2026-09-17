// GET /api/admin/center/health — alerts, deliverability snapshots, learnings.
import { guard, onOptions, qAllSoft, qOne, etDate, REGISTRY, json } from "./_lib.js";

export async function onRequestOptions({ request, env }) {
  return onOptions(request, env);
}

export async function onRequestGet({ request, env }) {
  const g = await guard(request, env);
  if (g.res) return g.res;

  const alerts = [];
  const snapshots = [];
  const learnings = [];

  // ── Warmup pauses ──────────────────────────────────────────────────────
  if (env.JOBS_DB) {
    const rows = await qAllSoft(env.JOBS_DB, `SELECT brand, paused, pause_reason FROM warmup_control`);
    const regByJobs = Object.fromEntries(REGISTRY.filter((b) => b.sources?.jobs).map((b) => [b.sources.jobs, b]));
    for (const r of rows) {
      const b = regByJobs[r.brand];
      if (r.paused === 1) {
        alerts.push({
          severity: "crit", brandId: b?.id || r.brand, brandName: b?.name || r.brand,
          message: `Warmup paused${r.pause_reason ? ": " + r.pause_reason : ""}`, at: etDate(),
        });
      }
    }
    // Bounce / complaint rates, trailing 7d per warmup brand
    for (const b of REGISTRY) {
      const jk = b.sources?.jobs;
      if (!jk) continue;
      const r = await qOne(env.JOBS_DB,
        `SELECT COALESCE(SUM(sent_count),0) AS sent, COALESCE(SUM(bounce_count),0) AS bn,
                COALESCE(SUM(complaint_count),0) AS cp
           FROM warmup_campaign_daily WHERE brand = ? AND date >= date('now','-7 days')`, [jk]).catch(() => null);
      const sent = Number(r?.sent || 0);
      if (sent <= 0) continue;
      const br = Number(r.bn) / sent, cr = Number(r.cp) / sent;
      if (cr > 0) {
        alerts.push({ severity: "crit", brandId: b.id, brandName: b.name, message: `Spam complaint in trailing 7d (${(cr * 100).toFixed(2)}%)`, at: etDate() });
      } else if (br > 0.08) {
        alerts.push({ severity: "crit", brandId: b.id, brandName: b.name, message: `Bounce rate ${(br * 100).toFixed(1)}% trailing 7d (abort line 8%)`, at: etDate() });
      } else if (br > 0.02) {
        alerts.push({ severity: "warn", brandId: b.id, brandName: b.name, message: `Bounce rate ${(br * 100).toFixed(1)}% trailing 7d (watch line 2%)`, at: etDate() });
      }
    }
  }

  // ── Deliverability snapshots + send schedules ──────────────────────────
  if (env.INTEL_DB) {
    const domains = [...new Set(REGISTRY.map((b) => b.domain))];
    const domToBrand = {};
    for (const b of REGISTRY) if (!domToBrand[b.domain]) domToBrand[b.domain] = b;
    for (const d of domains) {
      const s = await qOne(env.INTEL_DB,
        `SELECT * FROM deliverability_snapshots WHERE domain = ? ORDER BY date DESC LIMIT 1`, [d]).catch(() => null);
      if (!s) continue;
      const b = domToBrand[d];
      const sent = Number(s.sent || 0);
      const row = {
        date: s.date, domain: s.domain, brandId: b?.id || null, brandName: b?.name || d,
        esp: s.esp, sent, delivered: Number(s.delivered || 0),
        bounceRate: sent > 0 ? (Number(s.bounce_hard || 0) + Number(s.bounce_soft || 0)) / sent : null,
        complaintRate: sent > 0 ? Number(s.complaints || 0) / sent : null,
        verdict: s.verdict,
      };
      snapshots.push(row);
      if (s.verdict === "RED") {
        alerts.push({ severity: "crit", brandId: row.brandId, brandName: row.brandName, message: `Deliverability RED on ${d} (${s.esp || "esp?"})`, at: s.date });
      } else if (s.verdict === "YELLOW") {
        alerts.push({ severity: "warn", brandId: row.brandId, brandName: row.brandName, message: `Deliverability YELLOW on ${d}`, at: s.date });
      }
    }
    const scheds = await qAllSoft(env.INTEL_DB,
      `SELECT brand_id, kind, schedule_desc, enabled, last_run_at, last_status FROM send_schedules ORDER BY brand_id, kind`);
    for (const sc of scheds) {
      const b = REGISTRY.find((x) => x.sources?.intel === sc.brand_id);
      if (sc.enabled === 0) {
        alerts.push({ severity: "info", brandId: b?.id || sc.brand_id, brandName: b?.name || sc.brand_id, message: `Schedule disabled: ${sc.kind} (${sc.schedule_desc || "no desc"})`, at: sc.last_run_at });
      } else if (sc.last_status && !/ok|success|sent/i.test(String(sc.last_status))) {
        alerts.push({ severity: "warn", brandId: b?.id || sc.brand_id, brandName: b?.name || sc.brand_id, message: `Schedule ${sc.kind} last status: ${sc.last_status}`, at: sc.last_run_at });
      }
    }
    const lr = await qAllSoft(env.INTEL_DB,
      `SELECT id, created_at, brand_id, kind, summary, action_taken FROM learnings ORDER BY created_at DESC LIMIT 5`);
    for (const l of lr) {
      const b = REGISTRY.find((x) => x.sources?.intel === l.brand_id);
      learnings.push({ id: l.id, createdAt: l.created_at, brandId: b?.id || l.brand_id, kind: l.kind, summary: l.summary, actionTaken: l.action_taken });
    }
  }

  const rank = { crit: 0, warn: 1, info: 2 };
  alerts.sort((a, b) => (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3));
  return json({ ok: true, alerts, snapshots, learnings }, 200, request, env);
}
