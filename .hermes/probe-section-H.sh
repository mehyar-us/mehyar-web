#!/usr/bin/env bash
# Section H Accessibility/SEO smoke probe (turn-039)
# Runs against the LIVE bundle (not src/) so it measures what visitors get,
# not what developers wrote. All checks are grep-based against the
# minified bundle, which preserves tag names, attribute names, and the
# aria-* / role= / alt= literals.
#
# Run from repo root.
#   bash .hermes/probe-section-H.sh
# Exit 0 on PASS, 1 on FAIL, 2 on INDETERMINATE.

set -u

# Auto-discover the live bundle URL from the home page shell. This avoids
# the "probe is silently validating a stale bundle" drift turn-052 caught:
# when CF Pages rolls the bundle hash on a src/ change, the home page
# reference changes too. A hard-coded LIVE_BUNDLE_URL would fetch a
# *valid* stale bundle from the edge cache and pass the probe — but
# visitors are loading a different bundle. See .hermes/probe-section-O.sh
# for the cross-check that validates the discovery is canonical.
#
# The discovery returns a single string on stdout: the full bundle URL.
# Returns exit 2 INDETERMINATE if discovery fails (home unreachable,
# shell has no /assets/main-*.js reference, etc.). On INDETERMINATE,
# the calling probe should also exit 2 — surfacing "I can't verify
# what visitors are loading" rather than silently probing the wrong URL.
#
# Override: set HERMES_BUNDLE_URL_OVERRIDE in env to bypass auto-discovery
# (useful for local dev or air-gapped test runs).
discover_live_bundle_url() {
  if [ -n "${HERMES_BUNDLE_URL_OVERRIDE:-}" ]; then
    echo "$HERMES_BUNDLE_URL_OVERRIDE"
    return 0
  fi
  local HOME_URL="https://mehyar.us/"
  local SHELL=".hermes/.probe-section-H-discover-home.html"
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
  echo "H INDETERMINATE: auto-discovery of live bundle URL failed (home unreachable or no main-*.js reference)"
  exit 2
fi
# Use CWD-relative path for the bundle because /tmp doesn't exist on
# this Windows host (MSYS). Repo-relative keeps the probe portable.
BUNDLE=".hermes/.probe-section-H-bundle.js"

echo "=== H Accessibility/SEO smoke probe (turn-039 new check) ==="
echo "discovered bundle URL: $LIVE_BUNDLE_URL"

# Fetch the live bundle fresh; this is the same hash turn-036 deployed and
# that turn-031/034/036/037/038 all confirmed is the live canonical bundle.
if ! curl -sSL --max-time 30 "$LIVE_BUNDLE_URL" -o "$BUNDLE" 2>/dev/null; then
  echo "H INDETERMINATE: could not fetch $LIVE_BUNDLE_URL"
  exit 2
fi

if [ ! -s "$BUNDLE" ]; then
  echo "H INDETERMINATE: bundle fetch returned 0 bytes"
  exit 2
fi

BUNDLE_BYTES=$(wc -c < "$BUNDLE")
echo "live bundle: $BUNDLE_BYTES bytes (auto-discovered, fresh; not a fixed-baseline assertion)"

FAIL=0

# 1. Skip-link / skip-to-content — Lighthouse "Skip to main content" tap target
SKIP=$(grep -oE 'Skip to[^"]{0,40}' "$BUNDLE" | head -1)
if [ -z "$SKIP" ]; then
  echo "H FAIL: no 'Skip to <content>' link found (a11y: keyboard users can't bypass nav)"
  FAIL=1
else
  echo "H OK skip-link: '$SKIP'"
fi

# 2. Semantic landmarks — <main>, <nav>, <header>, <footer>, <article>, <section>
# The minifier emits jsx() in one of these shapes depending on tree-shaking
# and aliasing:
#   (a) direct         jsx("tag"     or jsx(`tag`
#   (b) alias-renamed  (0,X.jsx)("tag"  or (0,X.jsx)(`tag`
# Turn-039 originally matched shape (a) with double-quote.
# Turn-062 caught a backtick-vs-double-quote switch.
# Turn-063 catches the alias-renamed wrapper "(0,X.jsx)(" form that landed
# between turn-061 (main-p303-96M.js, 666,443 bytes) and turn-063
# (main--TRCB9Vb.js, 655,228 bytes). The count must be >= 6 (one of
# each: main + nav + header + footer + article + section), and the
# design baseline is 49 (turn-062 verified). The python helper handles
# both shapes with both quote styles in one regex without the shell-
# quoting pitfalls that bit turn-062's inline-regex attempt (the
# alternation `("|"`\``\`) gets eaten by both bash and grep -oE).
# See .hermes/probe-section-H-count-landmarks.py for the helper and
# .hermes/probe-section-H-count-landmarks-negative-test.py for the
# 5-case verification (real bundle 49 + shape a/b/c 6/6/6 + empty 0 +
# no-landmarks 0).
LANDMARKS=$(python .hermes/probe-section-H-count-landmarks.py "$BUNDLE")
if [ "$LANDMARKS" -lt 6 ]; then
  echo "H FAIL: only $LANDMARKS semantic landmark tags (expect >= 6 — main+nav+header+footer+article+section)"
  FAIL=1
else
  echo "H OK landmarks: $LANDMARKS semantic landmark tag occurrences"
fi

# 3. ARIA — must have aria-hidden (icon decoration hiding) and aria-label (icon-only buttons)
ARIA_HIDDEN=$(grep -oE 'aria-hidden' "$BUNDLE" | wc -l)
ARIA_LABEL=$(grep -oE 'aria-label' "$BUNDLE" | wc -l)
SR_ONLY=$(grep -oE 'sr-only' "$BUNDLE" | wc -l)
if [ "$ARIA_HIDDEN" -lt 10 ]; then
  echo "H FAIL: aria-hidden count = $ARIA_HIDDEN (expect >= 10 — decorative icons hidden from AT)"
  FAIL=1
else
  echo "H OK aria-hidden: $ARIA_HIDDEN occurrences"
fi
if [ "$ARIA_LABEL" -lt 1 ]; then
  echo "H FAIL: aria-label count = 0 (icon-only buttons need labels)"
  FAIL=1
else
  echo "H OK aria-label: $ARIA_LABEL occurrences"
fi
if [ "$SR_ONLY" -lt 1 ]; then
  echo "H FAIL: sr-only count = 0 (visually-hidden text for AT)"
  FAIL=1
else
  echo "H OK sr-only: $SR_ONLY occurrences"
fi

# 4. lang + viewport on every public shell — fetch home shell and check
HOME_SHELL=".hermes/.probe-section-H-home.html"
if curl -sSL --max-time 15 "https://mehyar.us/" -o "$HOME_SHELL" 2>/dev/null; then
  LANG=$(grep -oE 'lang="[^"]+"' "$HOME_SHELL" | head -1)
  if [ -z "$LANG" ]; then
    echo "H FAIL: home shell missing lang attribute on <html>"
    FAIL=1
  else
    echo "H OK lang: $LANG"
  fi
  VIEWPORT=$(grep -oE 'meta name="viewport"' "$HOME_SHELL" | wc -l)
  if [ "$VIEWPORT" -lt 1 ]; then
    echo "H FAIL: home shell missing viewport meta"
    FAIL=1
  else
    echo "H OK viewport: present"
  fi
  CANONICAL=$(grep -oE 'rel="canonical"' "$HOME_SHELL" | wc -l)
  if [ "$CANONICAL" -lt 1 ]; then
    echo "H FAIL: home shell missing canonical link"
    FAIL=1
  else
    echo "H OK canonical: present"
  fi
else
  echo "H INDETERMINATE: could not fetch home shell"
  exit 2
fi

# 5. JSON-LD on home shell — already covered by Section C, but cheap to re-check
JSONLD=$(grep -oE 'application/ld\+json' "$HOME_SHELL" | wc -l)
if [ "$JSONLD" -lt 2 ]; then
  echo "H FAIL: home shell has only $JSONLD JSON-LD blocks (expect >= 2)"
  FAIL=1
else
  echo "H OK JSON-LD: $JSONLD blocks on home shell"
fi

if [ "$FAIL" -eq 0 ]; then
  echo "H PASS"
  RC=0
else
  echo "H FAIL (see lines above)"
  RC=1
fi

# Cleanup probe temp files (don't pollute repo with bundle downloads).
# These start with ".probe-section-H-" so they're easy to identify and
# can also be matched by `git status -- ':!.hermes/.probe-*'` if the
# loop wants to keep them as audit artifacts.
rm -f "$BUNDLE" "$HOME_SHELL"

exit $RC
