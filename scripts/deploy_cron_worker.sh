#!/usr/bin/env bash
# scripts/deploy_cron_worker.sh
# Deploys the mehyar-cron-orchestrator CF Worker (separate from Pages).
# This is the only execution path for the Mayor engine in production
# (Path-B "nothing local" requirement).
#
# Usage:
#   bash scripts/deploy_cron_worker.sh
#
# Pre-reqs (set once in ~/.hermes/.env):
#   CLOUDFLARE_EMAIL=mrswelim@gmail.com
#   CLOUDFLARE_API_TOKEN=0dfa3336... (37-char Global Key)
#
# After deploy:
#   - Trigger fires at "0 13 * * *" UTC = 8 AM ET winter / 9 AM ET summer
#   - Verify with: `wrangler tail` (live logs)
#   - Manual fire:  curl -X POST https://mehyar-cron-orchestrator.<subdomain>.workers.dev/trigger
set -euo pipefail

# Load Hermes env (for the 37-char Global Key used by wrangler X-Auth-Key)
if [ -f "$HOME/.hermes/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$HOME/.hermes/.env"
  set +a
fi

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] || [ -z "${CLOUDFLARE_EMAIL:-}" ]; then
  echo "ERROR: CLOUDFLARE_API_TOKEN + CLOUDFLARE_EMAIL must be set" >&2
  exit 1
fi

cd "$(dirname "$0")/../cron-worker"

echo "==> Deploying mehyar-cron-orchestrator..."
echo "    Email:      ${CLOUDFLARE_EMAIL}"
echo "    Key length: ${#CLOUDFLARE_API_TOKEN}"
echo "    Cron:       0 13 * * * (8 AM ET winter)"
echo

# wrangler 4.x needs CLOUDFLARE_API_TOKEN + CLOUDFLARE_EMAIL as env vars
# and reads them via X-Auth-Email + X-Auth-Key headers when using Global Key.
CLOUDFLARE_API_KEY="$CLOUDFLARE_API_TOKEN" \
CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API_TOKEN" \
CLOUDFLARE_EMAIL="$CLOUDFLARE_EMAIL" \
npx wrangler deploy --config wrangler.toml

echo
echo "==> Deployment complete."
echo "    Manual fire:  curl -X POST https://mehyar-cron-orchestrator.<your-subdomain>.workers.dev/trigger"
echo "    Live tail:    cd cron-worker && wrangler tail"