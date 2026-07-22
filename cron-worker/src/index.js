/**
 * mehyar-cron-orchestrator
 *
 * Single-purpose CF Worker (separate from Pages project) that fires 4×/day
 * on CF-native cron triggers and POSTs the matching Pages endpoint on the
 * mehyar.us origin. This is the ONLY path that runs the Mayor engine in
 * production.
 *
 * Four windows per day (UTC):
 *   12:00 →  discover + outreach         (the full morning pipeline)
 *   14:00 →  outreach only              (catch up any new prospects)
 *   19:00 →  followup                    (3-step bump sequences)
 *   23:00 →  digest + weekly summary     (Mon adds weekly)
 *
 * For each window we route to a specific `?job=` query on
 * /api/admin/cron/run so the Pages orchestrator only does work relevant
 * to that window — keeps wall-clock low + log noise minimal.
 *
 * Auth: GOV_INGEST_TOKEN (40-char bearer) read from wrangler.toml [vars]
 * and passed as Authorization header on the POST.
 *
 * Logs: structured console.log lines; visible via `wrangler tail`.
 */

const ROUTES = {
  // 12 UTC — discover + outreach
  12: { job: "discover,outreach" },
  // 14 UTC — outreach (catch-up)
  14: { job: "outreach" },
  // 19 UTC — followup
  19: { job: "followup" },
  // 23 UTC — digest (always); weekly summary on Mondays
  23: { job: "digest,weekly" },
};

function pickRoute() {
  const h = new Date().getUTCHours();
  return ROUTES[h] || { job: "discover,outreach" };
}

export default {
  async scheduled(event, env, ctx) {
    const startedAt = new Date();
    const route = pickRoute();
    const target =
      `${env.PAGES_ORIGIN || "https://mehyar.us"}/api/admin/cron/run?job=${encodeURIComponent(route.job)}`;
    const body = JSON.stringify({
      source: "cf-worker-cron",
      fired_at: startedAt.toISOString(),
      route,
    });

    console.log(`[cron-orchestrator] firing at ${startedAt.toISOString()} → ${target}`);

    try {
      const ctrl = new AbortController();
      // 5-minute ceiling per window. Pages orchestrator fans out to N
      // mayor endpoints + email send. 300s is well above the wall-clock
      // budget of a single window.
      const timer = setTimeout(() => ctrl.abort(), 300_000);

      const resp = await fetch(target, {
        method: "POST",
        headers: {
          "authorization": `Bearer ${env.GOV_INGEST_TOKEN}`,
          "content-type": "application/json",
          // Identify this request as the orchestrator cron. Avoids the CF
          // WAF bot-default 403 that hits bare Python urllib requests with
          // missing/short User-Agent headers.
          "user-agent": "cf-worker-cron-orchestrator/2.0 (+https://mehyar.us/admin/mayor)",
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
        job: route.job,
        hour_utc: new Date().getUTCHours(),
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
   * HTTP handler — for /health verification and /trigger manual ops runs.
   * POST /trigger accepts {"job": "..."} body to force a specific pipeline.
   */
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({
        ok: true,
        worker: "mehyar-cron-orchestrator",
        version: "2.0",
        schedule: Object.entries(ROUTES).map(([h, r]) => ({ hour_utc: Number(h), job: r.job })),
        now_utc_hour: new Date().getUTCHours(),
        next_route: pickRoute(),
      }), { headers: { "content-type": "application/json" } });
    }

    if (url.pathname === "/trigger" && request.method === "POST") {
      // Manual ops trigger: read body for override job
      let overrideJob = null;
      try {
        const j = await request.json().catch(() => ({}));
        if (j?.job && typeof j.job === "string") overrideJob = j.job;
      } catch {}
      const route = overrideJob ? { job: overrideJob } : pickRoute();
      const target =
        `${env.PAGES_ORIGIN || "https://mehyar.us"}/api/admin/cron/run?job=${encodeURIComponent(route.job)}`;
      const body = JSON.stringify({ source: "cf-worker-cron-manual", route });

      try {
        const resp = await fetch(target, {
          method: "POST",
          headers: {
            "authorization": `Bearer ${env.GOV_INGEST_TOKEN}`,
            "content-type": "application/json",
            "user-agent": "cf-worker-cron-orchestrator/2.0-manual",
          },
          body,
        });
        const txt = await resp.text();
        let parsed; try { parsed = JSON.parse(txt); } catch { parsed = { raw: txt.slice(0, 1000) }; }
        return new Response(JSON.stringify({
          ok: resp.ok,
          status: resp.status,
          job: route.job,
          response: parsed,
        }), { headers: { "content-type": "application/json" } });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: e?.message || String(e) }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }
    }

    return new Response("mehyar-cron-orchestrator — POST /trigger or GET /health", {
      status: 404,
    });
  },
};
