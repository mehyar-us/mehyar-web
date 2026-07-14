// Cloudflare Pages scheduled handler — runs daily via the Pages Trigger UI
// or wrangler (see .github/workflows/deploy-cloudflare-pages.yml post-deploy
// step). When fire, it:
//   1. Pulls fresh SAM.gov opportunities
//   2. Surfaces send-due outreach prospects (NEVER auto-sends — manual approval required)
// Both write a run row into D1 so /admin can show the history.
//
// IMPORTANT: Pages Functions with a scheduled handler require the cron
// trigger to be configured in the Cloudflare dashboard OR via wrangler
// (see Cloudflare docs: "Cron Triggers for Pages Functions"). Until
// configured, this handler is dormant.
//
// To enable without going through Hermes:
//   1. CF Dashboard: project → Settings → Triggers → Scheduled
//   2. Add a cron expression like "0 8 * * *" (8am UTC daily)
//   3. Logs land in D1 cron_runs, surfaced via /admin/cron/runs

import { runGovOpportunityIngest } from "./api/_shared/govOpportunities.js";

async function logCronRun(env, payload) {
  if (!env?.LEADS_DB) return;
  try {
    await env.LEADS_DB.prepare(`CREATE TABLE IF NOT EXISTS cron_runs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`).run();
    await env.LEADS_DB.prepare(`INSERT INTO cron_runs (id, name, payload_json, created_at) VALUES (?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), "sam-ingest", JSON.stringify(payload), new Date().toISOString())
      .run();
  } catch (e) {
    console.error("cron_runs insert failed", e);
  }
}

export async function onScheduled({ env, scheduledTime }) {
  const startedAt = new Date();
  let govSummary = null;
  let govError = null;
  let outreachSummary = null;
  let outreachError = null;

  // ── 1. SAM.gov opportunity ingest ──────────────────────────────────────────
  try {
    govSummary = await runGovOpportunityIngest({ env, now: scheduledTime ? new Date(scheduledTime) : new Date() });
    console.info("gov opportunity scheduled ingest complete", {
      run_id: govSummary?.run_id,
      inserted: govSummary?.inserted,
      updated: govSummary?.updated,
      failed: govSummary?.failed,
    });
  } catch (e) {
    govError = e?.message || String(e);
    console.error("gov opportunity scheduled ingest failed", govError);
  }

  // ── 2. Outreach send-due surface (read-only — NEVER auto-sends) ────────────
  // This query mirrors the send-due GET endpoint, but runs server-side so
  // the owner can see what is pending approval. It does NOT insert or dispatch.
  try {
    const rows = await env.LEADS_DB.prepare(`
      SELECT p.id AS prospect_id, p.business_name, s.id AS source_id,
             s.name AS source_name, os.step_order, os.delay_days,
             os.require_manual_approval, os.subject_template, os.body_template,
             p.last_sent_at, p.last_contact_at, p.created_at
      FROM prospects p
      JOIN prospect_sources s ON s.id = p.source AND s.active = 1
      JOIN outreach_steps os ON os.source_id = s.id
        AND os.step_order = (
          SELECT MIN(os2.step_order)
          FROM outreach_steps os2
          WHERE os2.source_id = s.id AND os2.active = 1
            AND os2.require_manual_approval = 1
            AND NOT EXISTS (
              SELECT 1 FROM prospect_sends ps
              WHERE ps.prospect_id = p.id AND ps.draft_id = os2.id
                AND ps.status IN ('sent','delivered','replied')
            )
        )
      WHERE p.status = 'queued'
        AND os.active = 1
        AND (s.enforce_30day = 0 OR datetime(p.created_at) <= datetime('now', '-30 days'))
        AND (p.last_contact_at IS NULL OR datetime(p.last_contact_at) <= datetime('now', '-' || s.dedup_days || ' days'))
        AND (os.skip_if_replied = 0 OR NOT EXISTS (
          SELECT 1 FROM prospect_replies pr
          JOIN reply_classifications rc ON rc.reply_id = pr.id
          WHERE pr.prospect_id = p.id AND rc.label IN ('interest','warm','replied')
        ))
        AND (p.last_sent_at IS NULL OR datetime(p.last_sent_at, '+' || os.delay_days || ' days') <= datetime('now'))
      ORDER BY s.id, os.step_order
    `).all();

    outreachSummary = {
      send_due_count: (rows.results || []).length,
      pending_prospects: (rows.results || []).map(r => ({
        prospect_id: r.prospect_id,
        business_name: r.business_name,
        source_name: r.source_name,
        step_order: r.step_order,
      })),
    };
    console.info("outreach send-due surfaced", { count: outreachSummary.send_due_count });
  } catch (e) {
    outreachError = e?.message || String(e);
    console.error("outreach send-due query failed", outreachError);
  }

  // Always log so /admin can see what happened.
  await logCronRun(env, {
    triggered_at: startedAt.toISOString(),
    duration_ms: Date.now() - startedAt.getTime(),
    gov: govSummary
      ? {
          ok: !govError,
          run_id: govSummary.run_id,
          usaspending_fetched: govSummary.usaspending?.fetched,
          sam_fetched: govSummary.sam?.fetched,
          sam_skipped: govSummary.sam?.skipped,
          inserted: govSummary.inserted,
          updated: govSummary.updated,
          failed: govSummary.failed,
          blocked_count: govSummary.blocked_count,
        }
      : { ok: false, error: govError },
    outreach: outreachSummary
      ? { ok: !outreachError, send_due_count: outreachSummary.send_due_count }
      : { ok: false, error: outreachError },
    source: "cloudflare-pages-scheduled",
  });
}
