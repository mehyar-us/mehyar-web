#!/usr/bin/env bash
# Direct deploy to Cloudflare Pages using wrangler CLI.
# This is the script that actually works for Pages + Functions.
# Bypasses GitHub Actions entirely.
#
# Usage:
#   ./scripts/deploy_pages_wrangler.sh              # build + deploy main
#   ./scripts/deploy_pages_wrangler.sh --no-build   # skip build
#
# Required env vars: CLOUDFLARE_API_KEY (or CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN)
# Will pull other secrets from .env or environment automatically.

set -euo pipefail

PROJ_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJ_DIR"

NO_BUILD=false
for arg in "$@"; do
  case "$arg" in
    --no-build) NO_BUILD=true ;;
  esac
done

echo "============================================================"
echo "1. Build the client bundle"
echo "============================================================"
if [ "$NO_BUILD" = false ]; then
  npm run build:client 2>&1 | tail -8
else
  echo "  (skipped)"
fi

echo
echo "============================================================"
echo "2. Direct Upload via wrangler (handles BOTH assets AND functions)"
echo "============================================================"
# wrangler pages deploy dist/public --project-name=mehyar-web --branch=main
# detects functions/ sibling and bundles them automatically (via esbuild).
npx wrangler pages deploy dist/public \
  --project-name=mehyar-web \
  --branch=main \
  --commit-dirty=true

echo
echo "============================================================"
echo "3. Verify"
echo "============================================================"
ACCT="621600637337cc1c9ecb7095508bc732"
sleep 6
curl -sS "https://api.cloudflare.com/client/v4/accounts/$ACCT/pages/projects/mehyar-web/deployments?page=1&per_page=1" \
  -H "X-Auth-Email: mrswelim@gmail.com" \
  -H "X-Auth-Key: $CLOUDFLARE_API_KEY" 2>/dev/null \
  | python -c "
import sys, json
d = json.load(sys.stdin)['result'][0]
print(f\"   latest deploy: {d['id'][:8]} created={d['created_on'][:19]} status={d['latest_stage']['status']}\")"

echo
echo "============================================================"
echo "✅ Done. Live at https://mehyar.us"
echo "============================================================"
