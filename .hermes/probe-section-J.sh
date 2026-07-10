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

# Auto-discover the live bundle URL from the home page shell. See
# .hermes/probe-section-O.sh for the full rationale; the short version
# is that CF Pages rolls the bundle hash on every src/ change, and a
# hard-coded URL would fetch a valid but stale bundle from the edge
# cache. The stale bundle is still an ancestor of the canonical one,
# so H/J checks would still PASS — on the wrong file. Auto-discovery
# keeps H/J in lockstep with what visitors actually load.
#
# Override: set HERMES_BUNDLE_URL_OVERRIDE in env to bypass auto-discovery
# (useful for local dev or air-gapped test runs).
discover_live_bundle_url() {
  if [ -n "${HERMES_BUNDLE_URL_OVERRIDE:-}" ]; then
    echo "$HERMES_BUNDLE_URL_OVERRIDE"
    return 0
  fi
  local HOME_URL="https://mehyar.us/"
  local SHELL=".hermes/.probe-section-discover-home.html"
  if ! curl -sSL --max-time 15 "$HOME_URL" -o "$SHELL" 2>/dev/null; then
    return 2
  fi
  if [ ! -s "$SHELL" ]; then
    return 2
  fi
  local PATH_MATCH
  PATH_MATCH=$(grep -oE '/assets/main-[A-Za-z0-9_-]+\.js' "$SHELL" | head -1)
  rm -f "$SHELL"
  if [ -z "$PATH_MATCH" ]; then
    return 2
  fi
  echo "https://mehyar.us${PATH_MATCH}"
  return 0
}

LIVE_BUNDLE_URL=$(discover_live_bundle_url)
DISCOVER_RC=$?
if [ "$DISCOVER_RC" -ne 0 ] || [ -z "$LIVE_BUNDLE_URL" ]; then
  echo "J INDETERMINATE: auto-discovery of live bundle URL failed (home unreachable or no main-*.js reference)"
  exit 2
fi
BUNDLE=".hermes/.probe-section-J-bundle.js"

echo "=== J Build-artifact-integrity probe (turn-040 new check) ==="
echo "discovered bundle URL: $LIVE_BUNDLE_URL"

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
echo "live bundle: $BUNDLE_BYTES bytes (auto-discovered, fresh; not a fixed-baseline assertion)"

FAIL=0

# Canonical literals per the committed src/ tree.
# Each row is "<src-relative-file-glob> :: <literal>".
# We assert: for each literal, the src/ file exists in git tree AND
# the live bundle contains the literal at least once.
#
# turn-059 note: dropped `pricing-section.tsx :: $330` from the J probe set.
# turn-058 deliberately removed the `$330 audit and $250 diagnosis` substring
# from the home pricing subtitle (it contradicted the on-page tier cards
# which list $150/$250 ladder while /micro-offer charges $330 -- the
# underlying $150 vs $330 drift is what Section G watches, not J).
# The $330 literal still appears in Newsletter.tsx ("Skip to the $330 audit")
# and MicroOffer.tsx (49 bundle mentions) where it is correct. J now tests
# the 8 src/bundle-pin literals that should match; Section G remains the
# structural-pricing-drift sentinel.
PROBES=(
  "client/src/pages/Newsletter.tsx :: Skip to the \$330 audit"
  "client/src/components/hero-section.tsx :: See the leak ladder"
  "client/src/components/pricing-section.tsx :: \$150"
  "client/src/components/pricing-section.tsx :: \$250"
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

  src_count=$(grep -c -F -- "$literal" "$src_file" 2>/dev/null | tr -d '\n\r ' || echo 0)
  src_count=${src_count:-0}
  bundle_count=$(grep -c -F -- "$literal" "$BUNDLE" 2>/dev/null | tr -d '\n\r ' || echo 0)
  bundle_count=${bundle_count:-0}

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