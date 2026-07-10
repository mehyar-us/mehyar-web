#!/usr/bin/env bash
# Section G pricing-consistency probe (turn-038)
# Run from repo root.
set -u

echo "=== G Pricing-consistency probe (turn-038 new check) ==="

# 1. Tier-1 price from pricing-section.tsx (matches `price: "$NNN"`)
TIER1_PRICE=$(grep -oE 'price: ?"\$[0-9]+"' client/src/components/pricing-section.tsx | head -1 | grep -oE '\$[0-9]+')

# 2. Most-frequent $ price string in MicroOffer.tsx (the intake page that tier-1 routes to)
INTAKE_PRICE=$(grep -oE '\$[0-9]+' client/src/pages/MicroOffer.tsx | sort | uniq -c | sort -rn | head -1 | grep -oE '\$[0-9]+')

echo "tier-1 price (pricing-section.tsx): ${TIER1_PRICE:-<none>}"
echo "intake price (MicroOffer.tsx most-frequent): ${INTAKE_PRICE:-<none>}"

if [ -z "${TIER1_PRICE:-}" ] || [ -z "${INTAKE_PRICE:-}" ]; then
  echo "G INDETERMINATE: one or both probes returned empty (regex / file path issue)"
  exit 2
fi

if [ "$TIER1_PRICE" = "$INTAKE_PRICE" ]; then
  echo "G PASS"
  exit 0
else
  echo "G FAIL: tier-1=$TIER1_PRICE intake=$INTAKE_PRICE"
  exit 1
fi