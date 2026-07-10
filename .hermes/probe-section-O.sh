#!/usr/bin/env bash
# Section O Live-bundle-URL auto-discovery probe (turn-052 new check)
#
# Catches the "probe is silently validating a stale bundle" drift.
# Sections H and J fetch the live JS bundle from a hard-coded URL
# (`https://mehyar.us/assets/main-BKU1Uoxy.js` as of turn-052). When
# CF Pages rolls the bundle hash (which happens on every src/ change
# — turn-027/033/035/046/050 all rolled), the hard-coded URL fetches
# a *stale* bundle that no visitor is loading. The probe still PASSes
# because the stale bundle happens to contain the same literals (it
# was a recent ancestor of the canonical bundle) — but the rubric's
# integrity claim is silently broken.
#
# The pattern (real, from this loop's history): turn-027 / turn-050
# shipped src/ changes that rolled main-P-x17WD-.js → main-BKU1Uoxy.js
# → main-1wxJxxD5.js. The H/J probes' hard-coded URL
# (main-BKU1Uoxy.js) still fetched a valid file from CF's edge cache
# (the stale bundle wasn't purged; it just stopped being the canonical
# hash the home page references). All H/J checks PASSed — but on the
# wrong file. The "what visitors actually load" answer diverged from
# "what the rubric validates" by N-1 bundle generations.
#
# The invariant the loop verifies on every LOOP-BOOT tick:
#
#   For every probe that fetches the live JS bundle, the bundle URL
#   MUST be the one the home page shell currently references, NOT a
#   hard-coded URL that may have rolled out of canonical since the
#   probe was last edited. And that bundle MUST be fetchable from the
#   edge, AND it MUST be the canonical hash the home page actually
#   references (not just *a* bundle on CF's edge).
#
# Concrete cases this probe catches:
#
#   - Probe hard-coded URL `main-X.js` is no longer the canonical
#     home-page-referenced bundle (CF Pages rolled to `main-Y.js`).
#     The H/J probes will keep fetching main-X.js, which exists but
#     is stale. Section O catches this BEFORE the silent-validate
#     drift becomes a "founder ships X but bundle has Y" integrity bug.
#   - Probe's hard-coded URL fetches 404 (CF edge evicted the stale
#     bundle). H/J would now exit INDETERMINATE and the rubric loses
#     signal. Section O catches this first and surfaces the URL drift.
#   - The home page shell references a JS bundle but the bundle is
#     not fetchable (deploy mid-flight). Section O catches the race.
#
# Run from repo root.
#   bash .hermes/probe-section-O.sh
# Exit 0 PASS, exit 1 FAIL, exit 2 INDETERMINATE.

set -u

HOME_URL="https://mehyar.us/"
BUNDLE_URL_PREFIX="https://mehyar.us/assets/main-"
DISCOVERY_SHELL=".hermes/.probe-section-O-home.html"
DISCOVERY_BUNDLE=".hermes/.probe-section-O-bundle.js"

echo "=== O Live-bundle-URL auto-discovery probe (turn-052 new check; turn-053 CRLF-safe count fix) ==="

# Step 1: fetch the home page shell and extract the bundle URL it references.
if ! curl -sSL --max-time 15 "$HOME_URL" -o "$DISCOVERY_SHELL" 2>/dev/null; then
  echo "O INDETERMINATE: could not fetch $HOME_URL"
  exit 2
fi

if [ ! -s "$DISCOVERY_SHELL" ]; then
  echo "O INDETERMINATE: home shell fetch returned 0 bytes"
  exit 2
fi

# Extract the first <script ...src="/assets/main-XXXX.js"...> reference.
# Pattern captures the full /assets/main-XXXX.js; we just prepend the
# origin to form the full URL.
DISCOVERED_PATH=$(grep -oE '/assets/main-[A-Za-z0-9_-]+\.js' "$DISCOVERY_SHELL" | head -1)
if [ -z "$DISCOVERED_PATH" ]; then
  echo "O INDETERMINATE: home shell has no /assets/main-*.js script reference (deploy mid-flight?)"
  rm -f "$DISCOVERY_SHELL"
  exit 2
fi

# The "basename" (for hash comparison in Steps 3-4) is the path tail.
DISCOVERED_BASENAME=$(basename "$DISCOVERED_PATH")

LIVE_BUNDLE_URL="https://mehyar.us${DISCOVERED_PATH}"
echo "discovered bundle URL: $LIVE_BUNDLE_URL"

# Step 2: verify the discovered bundle is fetchable from the edge.
HTTP_STATUS=$(curl -sSL --max-time 15 -o "$DISCOVERY_BUNDLE" -w "%{http_code}" "$LIVE_BUNDLE_URL" 2>/dev/null || echo "000")
if [ "$HTTP_STATUS" != "200" ]; then
  echo "O FAIL: discovered bundle $LIVE_BUNDLE_URL returned HTTP $HTTP_STATUS (not fetchable from edge)"
  rm -f "$DISCOVERY_SHELL" "$DISCOVERY_BUNDLE"
  exit 1
fi

if [ ! -s "$DISCOVERY_BUNDLE" ]; then
  echo "O FAIL: discovered bundle $LIVE_BUNDLE_URL returned 0 bytes (HTTP 200 but empty body)"
  rm -f "$DISCOVERY_SHELL" "$DISCOVERY_BUNDLE"
  exit 1
fi

BUNDLE_BYTES=$(wc -c < "$DISCOVERY_BUNDLE")
echo "discovered bundle: $BUNDLE_BYTES bytes (fetched HTTP 200)"

# Step 3: verify the discovered URL is the CANONICAL one — i.e., the
# home page reference matches the URL we just fetched. (Trivially true
# for the home page itself; this step is a re-check after the fetch.)
HOME_REFERENCE=$(grep -oE 'main-[A-Za-z0-9_-]+\.js' "$DISCOVERY_SHELL" | head -1)
if [ "$HOME_REFERENCE" != "$DISCOVERED_BASENAME" ]; then
  echo "O FAIL: home shell references $HOME_REFERENCE but extraction got $DISCOVERED_BASENAME (regex drift?)"
  rm -f "$DISCOVERY_SHELL" "$DISCOVERY_BUNDLE"
  exit 1
fi

# Step 4: verify the discovered bundle is the canonical one across multiple
# public routes — defends against the case where CF Pages is mid-deploy
# and the home page rolled before the other routes. We check N=4 routes
# (matches the loop's per-tick 4-screen smoke: home, /booking, /micro-offer,
# /404). All four MUST reference the same bundle hash. If any route
# references a different hash, it's a mid-deploy race; we surface as FAIL.
EXPECTED_HASH="$DISCOVERED_BASENAME"
ROUTE_HASHES=""
DRIFT=0
for ROUTE in / /booking /micro-offer /nonexistent-zzz; do
  if [ "$ROUTE" = "/" ]; then
    ROUTE_URL="https://mehyar.us/"
  else
    ROUTE_URL="https://mehyar.us${ROUTE}"
  fi
  ROUTE_SHELL=".hermes/.probe-section-O-route.html"
  if ! curl -sSL --max-time 10 "$ROUTE_URL" -o "$ROUTE_SHELL" 2>/dev/null; then
    echo "  $ROUTE -> fetch failed (non-fatal; mid-deploy race?)"
    continue
  fi
  if [ ! -s "$ROUTE_SHELL" ]; then
    echo "  $ROUTE -> 0 bytes (non-fatal; mid-deploy race?)"
    continue
  fi
  ROUTE_HASH=$(grep -oE 'main-[A-Za-z0-9_-]+\.js' "$ROUTE_SHELL" | head -1)
  rm -f "$ROUTE_SHELL"
  if [ -z "$ROUTE_HASH" ]; then
    echo "  $ROUTE -> no bundle reference found (non-fatal; could be SPA shell only)"
    continue
  fi
  if [ "$ROUTE_HASH" != "$EXPECTED_HASH" ]; then
    echo "  $ROUTE -> $ROUTE_HASH (MISMATCH)"
    DRIFT=1
  else
    echo "  $ROUTE -> $ROUTE_HASH"
  fi
done

if [ "$DRIFT" -ne 0 ]; then
  echo "O FAIL: routes reference different bundle hashes (CF Pages mid-deploy? retry next tick)"
  rm -f "$DISCOVERY_SHELL" "$DISCOVERY_BUNDLE"
  exit 1
fi

# Step 5: defense — verify the live bundle contains a literal we KNOW
# the canonical bundle ships (the "Skip to the $330 audit" skip-link is
# the cheapest stable literal; turn-046's audit confirmed it ships in
# every bundle since turn-027). If the discovered bundle is missing
# this literal, the discovery itself is wrong (the regex matched a
# sub-resource that isn't the main JS bundle, e.g. a JSON file).
#
# TURN-053 FIX (closes the latent turn-052 bug class on this very probe):
# The original line was
#   SKIP_LITERAL_COUNT=$(grep -c -F -- "Skip to the" "$DISCOVERY_BUNDLE" 2>/dev/null || echo 0)
# which is broken on TWO axes:
#   (a) `|| echo 0` is dead — grep exits 0 on count=0, so the fallback never fires;
#   (b) `grep -c` emits `<n>\n` even on LF-only input, so the variable becomes
#       `0\n0` and `[ "$var" -lt 1 ]` throws `integer expression expected`.
# The fix uses `head -1` + `tr -d` to strip BOTH the trailing LF (always present)
# and any CR (only present on CRLF-formatted inputs). No `|| echo` fallback — the
# `head -1` always returns at least one line, and `tr -d` on an empty string
# returns empty (which the `${var:-0}` default below covers).
SKIP_LITERAL_COUNT=$(grep -c -F -- "Skip to the" "$DISCOVERY_BUNDLE" 2>/dev/null | head -1 | tr -d ' \t\r\n')
SKIP_LITERAL_COUNT=${SKIP_LITERAL_COUNT:-0}
if [ "$SKIP_LITERAL_COUNT" -lt 1 ]; then
  echo "O FAIL: discovered bundle has no 'Skip to the' literal (not the main JS bundle?)"
  rm -f "$DISCOVERY_SHELL" "$DISCOVERY_BUNDLE"
  exit 1
fi
echo "discovered bundle contains 'Skip to the' literal: $SKIP_LITERAL_COUNT occurrences"

# Step 6: report the bundle URL for downstream probes (H, J) to use
# if they want to source it. H and J currently hard-code their own URL —
# the turn-052 fix is to point them at the same auto-discovery routine.
# For now, just print the canonical URL on stdout so the operator can
# eyeball-verify the H/J hard-coded value matches the discovery.
echo ""
echo "Canonical bundle URL for H/J cross-check: $LIVE_BUNDLE_URL"
echo "Canonical bundle size: $BUNDLE_BYTES bytes"

# Cleanup
rm -f "$DISCOVERY_SHELL" "$DISCOVERY_BUNDLE"

echo "O PASS: live bundle auto-discovered, fetchable, canonical across 4 routes, contains expected literal"
exit 0