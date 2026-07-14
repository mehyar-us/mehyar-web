// Cloudflare Worker scheduled handler (independent from Pages).
// Hits the Pages endpoint that runs the actual ingest + writes the
// cron_runs log row. This Worker exists ONLY so we have a cron trigger
// fired by Cloudflare (Pages Functions cron triggers are not in the
// public REST API as of 2026-05, but Workers' [triggers].crons is).
//
// Logs land on Pages in D1 cron_runs — same table /admin/cron/runs reads.

interface Env {
  LEADS_DB: D1Database;
  PAGES_BASE?: string;
  GOV_INGEST_TOKEN?: string;
}

interface ScheduledEvent {
  scheduledTime: number;
  cron: string;
}

export default {
  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    const startedAt = new Date();
    const base = env.PAGES_BASE || "https://mehyar.us";
    const token = env.GOV_INGEST_TOKEN || "";

    let result: { ok: boolean; httpStatus: number; bodyPreview: string } = {
      ok: false,
      httpStatus: 0,
      bodyPreview: "",
    };

    try {
      const r = await fetch(`${base}/api/admin/gov-opportunities/ingest`, {
        method: "POST",
        headers: {
          "origin": base,
          "content-type": "application/json",
          "x-gov-ingest-token": token,
          "x-scheduled-source": "mehyar-cron-worker",
        },
        body: JSON.stringify({ triggered_from: "mehyar-cron-worker", scheduled_at: startedAt.toISOString() }),
      });
      const text = (await r.text()).slice(0, 1000);
      result = { ok: r.ok, httpStatus: r.status, bodyPreview: text };
      console.info("mehyar-cron: Pages ingest response", { http_status: r.status, ok: r.ok });
    } catch (e) {
      result = { ok: false, httpStatus: 0, bodyPreview: String((e as Error)?.message || e) };
      console.error("mehyar-cron: Pages ingest failed", e);
    }

    // Mirror the run into the same D1 cron_runs table so /admin shows it.
    try {
      await env.LEADS_DB.prepare(
        `CREATE TABLE IF NOT EXISTS cron_runs (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
      ).run();

      await env.LEADS_DB.prepare(
        `INSERT INTO cron_runs (id, name, payload_json, created_at)
         VALUES (?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        "mehyar-cron-worker",
        JSON.stringify({
          triggered_at: startedAt.toISOString(),
          ok: result.ok,
          http_status: result.httpStatus,
          body_preview: result.bodyPreview,
          source: "cloudflare-worker-scheduled",
        }),
        startedAt.toISOString(),
      ).run();
    } catch (e) {
      console.error("mehyar-cron: cron_runs mirror failed", e);
    }
  },
};
