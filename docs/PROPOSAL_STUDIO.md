# Client Proposal Studio

The owner dashboard at `dashboard.mehyar.us/admin/clients` includes Calendar, Leads, Forms, AI Proposals, and Replies.

## Architecture

- Cloudflare Pages serves the dashboard, public proposal pages, and authenticated proxy functions.
- `mehyarsoft-proposal-studio` is a dedicated Worker at `studio-api.mehyar.us`.
- Cloudflare Browser Rendering converts a submitted public website into research text.
- Cloudflare Workflows makes generation durable so the owner can leave the page and return later.
- Workers AI calls use Cloudflare's REST AI interface with `cf-aig-gateway-id: mehyar-us`.
- D1 stores proposals, jobs, revisions, complete source context, and generation metadata.
- R2 stores generated proposal images.

## Secrets

Never commit either value:

- `PROPOSAL_STUDIO_SERVICE_TOKEN`: shared by Pages and the proposal Worker.
- `AI_GATEWAY_RUN_TOKEN`: scoped Workers AI token stored only on the proposal Worker.

## Privacy and publishing

New proposals are `unlisted`. Unlisted pages work with their direct URL but are not shown in the public directory. Only the owner can mark a proposal `featured`; `private` proposals are unavailable publicly. Public proposal responses use `noindex` so a client page is not automatically placed in search results.

## Deployment

```powershell
npx wrangler deploy --config workers/proposal-studio/wrangler.toml
npm run build
python scripts/deploy_pages_direct.py --no-build --branch=main
```

Apply `migrations/0022_dashboard_proposal_studio.sql` to `mehyar_leads_prod` before the first release. Production currently contains older migration-ledger drift, so inspect `d1_migrations` before replaying any historical migration batch.

## Verification

Check the Worker health endpoint, create an unlisted proposal from the owner dashboard, wait for the job to reach `complete`, verify its public URL and hero asset, revise it by prompt, and confirm a second revision is retained.
