// Cloudflare Pages scheduled handler — runs daily via the Pages Trigger UI
// or wrangler (see .github/workflows/deploy-cloudflare-pages.yml post-deploy
// step). When fire, it pulls fresh SAM.gov opportunities + writes a run
// row into D1 so /admin can show the history.
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
  let summary = null;
  let error = null;
  try {
    summary = await runGovOpportunityIngest({ env, now: scheduledTime ? new Date(scheduledTime) : new Date() });
    console.info("gov opportunity scheduled ingest complete", {
      run_id: summary?.run_id,
      inserted: summary?.inserted,
      updated: summary?.updated,
      failed: summary?.failed,
    });
  } catch (e) {
    error = e?.message || String(e);
    console.error("gov opportunity scheduled ingest failed", error);
  }

  // Always log so /admin can see what happened.
  await logCronRun(env, {
    triggered_at: startedAt.toISOString(),
    ok: !error,
    duration_ms: Date.now() - startedAt.getTime(),
    summary: summary
      ? {
          run_id: summary.run_id,
          usaspending_fetched: summary.usaspending?.fetched,
          sam_fetched: summary.sam?.fetched,
          sam_skipped: summary.sam?.skipped,
          inserted: summary.inserted,
          updated: summary.updated,
          failed: summary.failed,
          blocked_count: summary.blocked_count,
        }
      : null,
    error,
    source: "cloudflare-pages-scheduled",
  });
}
