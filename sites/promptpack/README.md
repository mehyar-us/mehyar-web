PromptPack paid-page repair overrides
====================================

These two public HTML files were recovered from the complete production
deployment `3bf9b3cb-8cbb-402f-ad49-1b4e63bf4d97` on 2026-10-01. The original
standalone source directory was not available in this checkout or its connected
GitHub organization. They are overrides, not a replacement site scaffold.

`scripts/deploy-promptpack-readiness.mjs` recovers every asset from the pinned
live deployments into temporary storage, retains PromptPack's existing complete
Functions bundle and routing, and applies these two overrides. For mehyar-web it
reuses the complete production asset manifest while compiling the committed
Functions into Wrangler's multipart Worker bundle. Existing repository header
and redirect rules remain part of that upload. Live route rewriting makes
three HTML assets unsuitable for HTTP recovery, so their original hashes are
reused directly from Cloudflare's existing asset store.
Preview promotion requires unchanged hashes for every existing static file
except these two paid pages. It retains a journal of deployment attempts and
IDs; never repeat an uncertain deployment without reconciling that journal.

The private bearer-token pages omit GTM and GA4 and use no-referrer policy.
Confirmed payment automatically opens the generation page. Generation still
runs in the buyer's browser, which must remain open until the pack is ready.
PDF export uses the browser's Print / Save as PDF dialog.

Run from a clean checkout of the pushed repair commit, using existing process
Cloudflare credentials only:

    node scripts/deploy-promptpack-readiness.mjs prepare
    node scripts/test-promptpack-browser.mjs <recovered-promptpack-public-directory>
    node scripts/deploy-promptpack-readiness.mjs preview
    node scripts/deploy-promptpack-readiness.mjs production

Production applies only additive migration 0033. A delivery claim in unknown or
claimed state must be reconciled against the email provider before any manual
retry. Never clear a claim merely because its timestamp is old: the provider
may have accepted that message. No scheduled automatic retry is enabled.

Rollback targets are recorded per project in the release journal. Cloudflare
Pages can restore those production deployments without deleting the additive
claim table. Do not delete claims during rollback; they protect against replay.

All regression fixtures intercept network traffic. They prove code behavior
with synthetic content; they do not verify a real paid order, model response,
actual email delivery, or customer willingness to pay.
