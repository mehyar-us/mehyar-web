#!/usr/bin/env bash
# Section J Build-artifact-integrity probe (turn-040 new check)
#
# Catches the "shipped something that doesn't match what's on disk" drift.
# The pattern: a src/ literal is changed in a commit, the bundle is rebuilt,
# but the live bundle never re-rolls (e.g. turn-030's scripts/-only deploy
# rolled shell files but left the bundle hash on the previous build).
# Section H already catches the inverse — "bundle has a literal that's
# not in any src/ file" — but doesn't catch "src/ has a literal that's
# not in the bundle". Section J closes the loop.
#
# The invariant: every visitor-facing copy literal in committed src/ must
# appear in the live bundle at least once. If a src/ literal is missing
# from the live bundle, the live site is serving stale content for that
# surface — that's a P0 integrity bug (the founder is shipping "X" but
# visitors see "Y" from the previous build).
#
# Run from repo root.
#   bash .hermes/probe-section-J.sh
# Exit 0 on PASS, 1 on FAIL, 2 on INDETERMINATE.

set -u

LIVE_BUNDLE_URL="https://mehyar.us/assets/main-BKU1Uoxy.js"
BUNDLE=".hermes/.probe-section-J-bundle.js"

echo "=== J Build-artifact-integrity probe (turn-040 new check) ==="

# Fetch the live bundle fresh; same hash turn-036 deployed and that
# turn-031/034/036/037/038/039 all confirmed is the live canonical bundle.
if ! curl -sSL --max-time 30 "$LIVE_BUNDLE_URL" -o "$BUNDLE" 2>/dev/null; then
  echo "J INDETERMINATE: could not fetch $LIVE_BUNDLE_URL"
  exit 2
fi

if [ ! -s "$BUNDLE" ]; then
  echo "J INDETERMINATE: bundle fetch returned 0 bytes"
  exit 2
fi

BUNDLE_BYTES=$(wc -c < "$BUNDLE")
echo "live bundle: $BUNDLE_BYTES bytes (expect ~574069)"

FAIL=0

# Canonical literals per the committed src/ tree.
# Each row is "<src-relative-file-glob> :: <literal>".
# We assert: for each literal, the src/ file exists in git tree AND
# the live bundle contains the literal at least once.
PROBES=(
  "client/src/pages/Newsletter.tsx :: Skip to the \$330 audit"
  "client/src/components/hero-section.tsx :: See the leak ladder"
  "client/src/components/pricing-section.tsx :: \$150"
  "client/src/components/pricing-section.tsx :: \$250"
  "client/src/components/pricing-section.tsx :: \$330"
  "client/src/components/pricing-section.tsx :: Free Tech Audit"
  "client/src/components/pricing-section.tsx :: Website Diagnosis"
  "client/src/components/Navbar.tsx :: MehyarSoft home"
  "client/src/components/Navbar.tsx :: Toggle menu"
)

for probe in "${PROBES[@]}"; do
  src_file="${probe%% :: *}"
  literal="${probe##* :: }"

  if [ ! -f "$src_file" ]; then
    echo "J FAIL: $src_file missing from working tree (rubric drift — file renamed?)"
    FAIL=1
    continue
  fi

  src_count=$(grep -c -F -- "$literal" "$src_file" 2>/dev/null || echo 0)
  bundle_count=$(grep -c -F -- "$literal" "$BUNDLE" 2>/dev/null || echo 0)

  if [ "$src_count" -lt 1 ]; then
    echo "J FAIL: literal '$literal' not found in $src_file (rubric drift — fix the probe)"
    FAIL=1
    continue
  fi

  if [ "$bundle_count" -lt 1 ]; then
    echo "J FAIL: $src_file has '$literal' (src=$src_count) but live bundle has 0 — stale deploy"
    FAIL=1
    continue
  fi

  echo "J OK $src_file: '$literal' src=$src_count bundle=$bundle_count"
done

if [ "$FAIL" -eq 0 ]; then
  echo "J PASS"
  exit 0
else
  echo "J FAIL: build artifact integrity broken"
  exit 1
fi