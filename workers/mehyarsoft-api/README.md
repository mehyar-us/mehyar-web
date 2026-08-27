# MehyarSoft API Worker

This directory is the version-controlled source for the existing `api.mehyar.us` Cloudflare Worker. The baseline was recovered from the production deployment before the Zoho Calendar work so the existing API, mail, analytics, and scheduled jobs remain intact.

The Worker owns the Zoho OAuth client credentials and refresh token. Calendar endpoints are admin-gated and are called server-to-server by the `mehyar-web` Pages Functions; browser clients never receive Zoho credentials or access tokens.

Calendar booking policy:

- Monday-Friday, 9:00 AM-5:00 PM America/New_York
- 30-minute phone calls
- 15-minute collision buffer
- 24-hour minimum notice
- 30-day booking horizon
- Zoho Calendar free/busy is checked again immediately before event creation
- booking IDs are idempotent in KV for 90 days

Deploy from this directory with `npx wrangler deploy`. Existing secret bindings are intentionally not in `wrangler.toml`; Cloudflare preserves them when a new Worker version is deployed.
