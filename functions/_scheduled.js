// Cloudflare Pages scheduled handler — runs on CF's cron trigger (configured
// in Dashboard: project → Settings → Functions → Cron Triggers), NOT via any
// local machine. When fired it:
//
//   1. Pulls fresh SAM.gov opportunities (legacy ingest)
//   2. Surfaces send-due outreach prospects (NEVER auto-sends — manual approval required)
//   3. Fans out the full Mayor pipeline by POSTing /api/admin/cron/run?job=all
//      on the project's own origin. That orchestrator handles:
//        - SAM ingest + contract ingest
//        - Outreach send-due query
//        - LLM deep-evaluate for top prospects (max 2/day)
//        - Mayor: discover + outreach + followup + digest
//   4. Writes a run row into D1 cron_runs so /admin/cron/runs shows the history.
//
// Adding the trigger (one-time Dashboard step, no code):
//   CF Dashboard → Pages → mehyar-web → Settings → Functions → Cron Triggers
//   Add cron: "0 13 * * *"  (8 AM ET winter / 9 AM ET summer — adjust seasonally)
//   OR two cron entries to cover both EST and EDT windows.
//
// Path-B hardening (2026-07-19, "nothing local"):
//   - All work executes inside CF's edge. No Hermes cron, no local cron.
//   - Auth: GOV_INGEST_TOKEN (40-char bearer, path-scoped to /api/mayor/* and
//     /api/admin/cron/*). Same token the orchestrator expects.
//   - Resolves target URL from env.CF_PAGES_URL (auto-injected by CF Pages).
//   - Falls back to mehyar.us if CF_PAGES_URL is missing (defensive — should
//     never happen on Pages, but the fallback means we never silently no-op).
//
// On any partial failure: writes a cron_runs row with the failed sub-task
// details so /admin/cron/runs surfaces it immediately.

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
      .bind(crypto.randomUUID(), "scheduled-full-pipeline", JSON.stringify(payload), new Date().toISOString())
      .run();
  } catch (e) {
    console.error("cron_runs insert failed", e);
  }
}

function resolveOrigin(env) {
  // CF Pages injects CF_PAGES_URL (e.g. https://<hash>.mehyar-web.pages.dev).
  // The custom domain mehyar.us is also acceptable as a fallback because
  // /api/admin/cron/run is auth-gated and the request originates inside the
  // same Pages project — no external surface.
  return (env?.CF_PAGES_URL || "https://mehyar.us").replace(/\/+$/, "");
}

export async function onScheduled({ env, scheduledTime, ctx }) {
  const startedAt = new Date();
  const origin = resolveOrigin(env);
  const token = env?.GOV_INGEST_TOKEN || "";
  const startedIso = startedAt.toISOString();
  let govSummary = null;
  let govError = null;
  let outreachSummary = null;
  let outreachError = null;
  let orchestratorSummary = null;
  let orchestratorError = null;

  // ── 1. SAM.gov opportunity ingest (legacy, kept for parity) ─────────────
  try {
    govSummary = await runGovOpportunityIngest({ env, now: scheduledTime ? new Date(scheduledTime) : new Date() });
    console.info("[scheduled] gov opportunity ingest complete", {
      run_id: govSummary?.run_id,
      inserted: govSummary?.inserted,
      updated: govSummary?.updated,
      failed: govSummary?.failed,
    });
  } catch (e) {
    govError = e?.message || String(e);
    console.error("[scheduled] gov opportunity ingest failed", govError);
  }

  // ── 2. Outreach send-due surface (read-only — NEVER auto-sends) ──────────
  // Mirrors the send-due query the orchestrator runs, but keeps a local copy
  // in this handler's cron_runs row so we have a separate audit trail even
  // if the orchestrator call fails.
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
    console.info("[scheduled] outreach send-due surfaced", { count: outreachSummary.send_due_count });
  } catch (e) {
    outreachError = e?.message || String(e);
    console.error("[scheduled] outreach send-due query failed", outreachError);
  }

  // ── 3. Mayor pipeline orchestrator (the real work) ───────────────────────
  // POST /api/admin/cron/run?job=all fans out to discover + outreach +
  // followup + digest inside the same Pages project. We pass GOV_INGEST_TOKEN
  // as bearer; the orchestrator accepts it as `actor = "cron:hermes"` (we
  // reuse the same actor label for now — the audit log records `source:
  // cloudflare-pages-scheduled` regardless of actor, so the path-B origin is
  // visible in cron_runs).
  //
  // ctx.waitUntil() ensures the full orchestrator response completes even if
  // the scheduled handler would otherwise return early — Pages Functions has a
  // 30s wall-clock budget on scheduled handlers, but ctx.waitUntil extends it.
  try {
    const orchUrl = `${origin}/api/admin/cron/run?job=all`;
    const ctrl = new AbortController();
    // 5 minute ceiling — orchestrator fans out to 4 mayor endpoints plus
    // gov + contracts + outreach + deep-evaluate; well under 100s CPU but the
    // outbound email sends add latency.
    const timer = setTimeout(() => ctrl.abort(), 300_000);
    const r = await fetch(orchUrl, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ source: "cloudflare-pages-scheduled" }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const j = await r.json().catch(() => ({}));
    orchestratorSummary = {
      ok: r.ok && j?.ok !== false,
      http_status: r.status,
      run_id: j?.run_id || null,
      duration_ms: j?.duration_ms || null,
      // Compact per-step summary; full breakdown is in cron_runs payload.
      mayor_discover_ok: j?.mayor_discover?.ok ?? null,
      mayor_outreach_ok: j?.mayor_outreach?.ok ?? null,
      mayor_outreach_sent: j?.mayor_outreach?.sent ?? j?.mayor_outreach?.sent_count ?? null,
      mayor_followup_ok: j?.mayor_followup?.ok ?? null,
      mayor_followup_sent: j?.mayor_followup?.sent ?? j?.mayor_followup?.sent_count ?? null,
      mayor_digest_ok: j?.mayor_digest?.ok ?? null,
      mayor_digest_provider_id: j?.mayor_digest?.provider_id ?? null,
      mayor_digest_delivered: j?.mayor_digest?.delivered ?? null,
    };
    console.info("[scheduled] orchestrator complete", orchestratorSummary);
  } catch (e) {
    orchestratorError = e?.message || String(e);
    console.error("[scheduled] orchestrator failed", orchestratorError);
  }

  // Always log so /admin can see what happened.
  await logCronRun(env, {
    triggered_at: startedIso,
    duration_ms: Date.now() - startedAt.getTime(),
    source: "cloudflare-pages-scheduled",
    origin,
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
    orchestrator: orchestratorSummary
      ? { ok: !orchestratorError, ...orchestratorSummary }
      : { ok: false, error: orchestratorError },
  });
}