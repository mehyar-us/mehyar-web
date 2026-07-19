/**
 * mehyar-cron-orchestrator
 *
 * Single-purpose CF Worker (separate from Pages project) that fires on a
 * CF-native cron schedule and POSTs /api/admin/cron/run?job=all on the
 * mehyar.us Pages origin. This is the ONLY path that runs the Mayor engine
 * pipeline in production (Path-B "nothing local" requirement).
 *
 * Triggers configured in wrangler.toml:
 *   - "0 13 * * *"  daily 8 AM ET (winter) — full Mayor pipeline
 *
 * Auth: GOV_INGEST_TOKEN (40-char bearer) read from `wrangler.toml [vars]`
 * and passed as Authorization header on the POST.
 *
 * Logs: structured console.log lines; visible via `wrangler tail`.
 * No external storage / no DB writes — every aspect of the run is logged
 * inside the Pages endpoint we call (which already writes to cron_runs).
 */

export default {
  /**
   * CF-native cron trigger. Runs inside Cloudflare's edge; no local machine,
   * no Hermes cron, no GitHub Actions involved.
   */
  async scheduled(event, env, ctx) {
    const startedAt = new Date();
    const target = `${env.PAGES_ORIGIN || "https://mehyar.us"}/api/admin/cron/run?job=all`;
    const body = JSON.stringify({ source: "cf-worker-cron" });

    console.log(`[cron-orchestrator] firing at ${startedAt.toISOString()} → ${target}`);

    try {
      const ctrl = new AbortController();
      // 5 minute ceiling — orchestrator fans out to 4 mayor endpoints +
      // email send. 300s is well above the wall-clock budget of the orchestrator.
      const timer = setTimeout(() => ctrl.abort(), 300_000);

      const resp = await fetch(target, {
        method: "POST",
        headers: {
          "authorization": `Bearer ${env.GOV_INGEST_TOKEN}`,
          "content-type": "application/json",
          // Identify this request as the orchestrator cron. Avoids the CF
          // WAF bot-default 403 that hits bare Python urllib requests with
          // missing/short User-Agent headers.
          "user-agent": "cf-worker-cron-orchestrator/1.0 (+https://mehyar.us/admin/mayor)",
        },
        body,
        signal: ctrl.signal,
      });
      clearTimeout(timer);

      const text = await resp.text();
      let parsed;
      try { parsed = JSON.parse(text); } catch { parsed = { raw: text.slice(0, 1000) }; }

      const durationMs = Date.now() - startedAt.getTime();
      const summary = {
        ok: resp.ok && parsed?.ok !== false,
        http_status: resp.status,
        duration_ms: durationMs,
        run_id: parsed?.run_id || null,
        mayor: {
          discover_ok: parsed?.mayor_discover?.ok ?? null,
          outreach_ok: parsed?.mayor_outreach?.ok ?? null,
          outreach_sent: parsed?.mayor_outreach?.sent ?? null,
          followup_ok: parsed?.mayor_followup?.ok ?? null,
          followup_sent: parsed?.mayor_followup?.sent ?? null,
          digest_ok: parsed?.mayor_digest?.ok ?? null,
          digest_provider_id: parsed?.mayor_digest?.provider_id ?? null,
          digest_delivered: parsed?.mayor_digest?.delivered ?? null,
          digest_error: parsed?.mayor_digest?.error ?? null,
        },
      };

      console.log(`[cron-orchestrator] complete (${durationMs}ms):`, JSON.stringify(summary));

      if (!resp.ok) {
        console.error(`[cron-orchestrator] non-2xx response: HTTP ${resp.status}`, text.slice(0, 1000));
      }
    } catch (err) {
      console.error(`[cron-orchestrator] failed:`, err?.message || String(err), err?.stack);
    }
  },

  /**
   * HTTP handler — used only for manual trigger via curl from the admin
   * console or for ops verification. NOT the production cron path.
   */
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({
        ok: true,
        worker: "mehyar-cron-orchestrator",
        version: "1.0",
        // The scheduled handler is wired via wrangler.toml [[triggers]].
        // We can confirm via env. CF_PAGES_URL or by reading the cron from
        // a known constant — actual cron expr is in wrangler.toml, not env.
      }), {
        headers: { "content-type": "application/json" },
      });
    }

    if (url.pathname === "/trigger" && request.method === "POST") {
      // Same path as the scheduled handler — useful for manual ops runs.
      const ev = { scheduledTime: new Date(), cron: "manual" };
      const ctx = { waitUntil: () => {} };
      await this.scheduled(ev, env, ctx);
      return new Response(JSON.stringify({ ok: true, triggered: true }), {
        headers: { "content-type": "application/json" },
      });
    }

    return new Response("mehyar-cron-orchestrator — POST /trigger or GET /health", {
      status: 404,
    });
  },
};