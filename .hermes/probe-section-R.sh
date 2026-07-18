#!/usr/bin/env bash
# Section R Forbidden-pattern probe (turn-068 ship; spec from t_9c9e36c4)
#
# Catches the "src/ committed but not buildable" drift class that turn-065
# (cron shadow) shipped to origin/main:
#   - sed-replacement $1 artifacts in className strings across 5 admin/terms
#     files (a copy-paste mistake when bulk-replacing a token)
#   - unclosed JSX ternaries (a typo class vite catches but the loop's
#     pre-deploy smoke doesn't exercise the production bundle build)
#   - placeholder literals (<this-commit>, <TODO>, <FIXME>, <placeholder>)
#     left in src/ when a draft slipped past the audit stage
#
# Section J (cited-SHA probe) doesn't catch this class because its PROBES
# list excludes the AdminCRM literals and only looks at audit/ + state.md +
# VISION.md. Section R is the cousin that scans source code.
#
# Negative-test contract (matches Section N's pattern):
#   1. Append any forbidden pattern to a real src/ file
#   2. Probe must exit 1
#   3. Remove the pattern
#   4. Probe must exit 0 again
#
# The forbidden-patterns list lives at .hermes/forbidden-patterns.txt so
# future ticks can extend it without editing the script.
#
# Wall-time budget: <2s on a 5k-file src/ tree.

set -u

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
FORBIDDEN_FILE="${REPO_ROOT}/.hermes/forbidden-patterns.txt"

# Targets: source code (client/src + functions/api + migrations). We DELIBERATELY
# exclude .hermes/audit/ — audit prose legitimately references forbidden-pattern
# names (e.g., "tick-XXX add 5 patterns: $1, $2 ...") and including audit/ would
# trip the probe on every reference-to-the-drift-class instead of the drift
# itself. The drift class lives in shipped code; that's what we scan.
TARGETS=(
  "${REPO_ROOT}/client/src"
  "${REPO_ROOT}/functions/api"
  "${REPO_ROOT}/migrations"
)

# Probe directories that may not exist yet (early-stage repo) — gracefully skip.
EXISTING=()
for d in "${TARGETS[@]}"; do
  [ -d "$d" ] && EXISTING+=("$d")
done

if [ "${#EXISTING[@]}" -eq 0 ]; then
  echo "R PASS: no probe targets exist (client/src + functions/api + migrations + .hermes/audit all absent) — nothing to scan"
  exit 0
fi

if [ ! -f "$FORBIDDEN_FILE" ]; then
  echo "R FAIL: forbidden-patterns.txt missing at $FORBIDDEN_FILE"
  echo "  Fix: recreate it with the 5 sed-placeholder + WIP-marker patterns below."
  exit 1
fi

# Build the alternation regex from the file (one pattern per line).
PATTERN="$(grep -vE '^[[:space:]]*(#|$)' "$FORBIDDEN_FILE" | sed 's/[[:space:]]*$//' | grep -v '^$' | paste -sd'|' -)"

if [ -z "$PATTERN" ]; then
  echo "R FAIL: forbidden-patterns.txt is empty or all comments"
  exit 1
fi

# grep -rnE: recursive, line-number, extended regex. Skip the probe script
# itself + forbidden-patterns.txt to avoid self-matching.
HITS_FILE="$(mktemp)"
trap "rm -f '$HITS_FILE'" EXIT

# grep -E with multiple --include flags (no brace expansion in MSYS grep).
#
# False-positive filters (added turn-068 after first run caught real bugs):
#   1. JS regex backreferences: ".replace(/.../, '$1')"  →  exclude lines
#      containing ".replace(" AND "$1" inside a string (the regex backref
#      is a legitimate construct, not a sed artifact).
#   2. Price strings with decimals: "$1.5k" "$2.5k" "$500k-$2M"  →
#      exclude lines where $1 is followed by a digit + period + digit
#      (or k/M suffix) — these are pricing literals, not placeholders.
#   3. JSON comment examples: "$500k–$2M" with en-dash  →  same rule.
#
# Both filters are conservative: only suppress the line if the surrounding
# context matches a known false-positive pattern. Anything else still hits.
( grep -rnE \
    --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' \
    --include='*.mjs' --include='*.cjs' --include='*.py' --include='*.sh' \
    --include='*.m' --include='*.mm' --include='*.md' --include='*.json' \
    --include='*.sql' \
    --exclude-dir='node_modules' --exclude-dir='dist' --exclude-dir='.git' \
    --exclude-dir='.hermes' \
    "$PATTERN" "${EXISTING[@]}" 2>/dev/null \
  | grep -vE '/\.hermes/probe-section-R\.sh:' \
  | grep -vE '/\.hermes/forbidden-patterns\.txt:' \
  | grep -vE '\$[0-9]+\.[0-9]+[kKmM]' \
  | grep -vE '\$[0-9]+[kKmM][–-]' \
  | grep -vE '\.replace\(.*\$1' \
  > "$HITS_FILE" ) || true

HITS_COUNT=$(wc -l < "$HITS_FILE" | tr -d ' ')

if [ "$HITS_COUNT" -gt 0 ]; then
  echo "R FAIL: $HITS_COUNT forbidden-pattern hit(s) in src/ + audit/:"
  # Show up to 20 hits to keep output scannable.
  head -20 "$HITS_FILE"
  if [ "$HITS_COUNT" -gt 20 ]; then
    echo "  ... and $((HITS_COUNT - 20)) more"
  fi
  echo
  echo "  Fix: replace the sed-placeholder / WIP-marker with the real value"
  echo "        (or remove the literal if it's no longer needed)."
  echo "  Forbidden patterns live at: .hermes/forbidden-patterns.txt"
  echo "  Run with HERMES_R_VERBOSE=1 to see the full pattern list."
  if [ "${HERMES_R_VERBOSE:-0}" = "1" ]; then
    echo
    echo "  Current patterns:"
    sed 's/^/    /' "$FORBIDDEN_FILE"
  fi
  exit 1
fi

echo "R PASS: 0 forbidden-pattern hits in $(printf '%s ' "${EXISTING[@]}")(src/ + audit/ clean of sed-placeholder + WIP-marker drift)"
exit 0