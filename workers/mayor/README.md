# mehyar-mayor worker — source recovery

Live worker: `mehyar-mayor` → https://mayor.mehyar.us (Cloudflare Workers,
proxied AAAA). This directory is the **recovery scaffold**, not the source.

## Status (2026-10-06)

- The worker's real source is **not in this repo and not on GitHub**.
  Last wrangler deploys: 2026-10-04/05 (source location unknown — likely
  Mayor's PC; ask him which folder it was deployed from).
- What exists here:
  - `wrangler.toml` — reconstructed from the **live** worker settings
    (bindings verified via API 2026-10-06). Secrets are NOT included;
    set them with `wrangler secret put` or the dashboard.
  - `ROUTES.md` — API surface recovered from the deployed bundle.
  - `BINDINGS.md` — live bindings + backing D1 databases.
- A snapshot of the deployed bundle (6 MB, esbuild output — not source)
  is archived at `~/workspace/mayor-worker-recovery/` on the sandbox,
  kept OUT of git.

## To complete the consolidation

1. Find the real source (ask Mayor where the Oct 4–5 wrangler deploys ran).
2. Copy it into `workers/mayor/src/` (replacing this scaffold's TODOs).
3. Fill in the Durable Object class names in `wrangler.toml`
   (live namespaces: `MAYOR_PHONE`, `MAYOR_VOICE` — class names unknown).
4. `wrangler deploy --config workers/mayor/wrangler.toml` from a verified
   checkout, then confirm https://mayor.mehyar.us/health.
5. Delete this README's recovery notice once real source lands.

## Deploy note

This worker deploys via **wrangler directly**, not via the mehyar-web
GitHub Actions Pages pipeline. Adding files under `workers/` does not
trigger a Pages deploy (workflow paths filter). Keep it that way until
someone deliberately unifies the pipelines.
