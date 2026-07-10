#!/usr/bin/env bash
# Section K Audit-record-tracking probe (turn-042 new check)
#
# Catches the "audit .md exists on disk but never landed in git" drift that
# turn-041 manually closed. The failure mode: a past tick writes an audit
# record at `.hermes/audit/turn-NNN.md` and journals it in VISION.md, but
# the actual `git add .hermes/audit/turn-NNN.md` is forgotten. The file
# exists on disk; VISION.md references it; but `git ls-files` does NOT
# contain it. Worst case: a `git status --short` that ignores .hermes/
# masks it; a `rm -rf .hermes/audit/` cleanup destroys it; a clone of
# the repo on another machine is missing the audit trail.
#
# The invariant the loop verifies on every LOOP-BOOT tick:
#
#   For every `.hermes/audit/turn-NNN*.md` file on disk, the same path
#   must appear in `git ls-files`. The reverse direction (in-repo but
#   missing on disk) is also caught — git tracks the deletion but the
#   disk file is gone.
#
# Diff is bidirectional:
#   on-disk \ in-repo   -> ORPHAN (file on disk not in repo)
#   in-repo \ on-disk   -> STALE   (file in repo but gone from disk)
#
# Run from repo root.
#   bash .hermes/probe-section-K.sh
# Exit 0 PASS, exit 1 FAIL, exit 2 INDETERMINATE.

set -u

echo "=== K Audit-record-tracking probe (turn-042 new check) ==="

# Locate the audit directory relative to the script's own location so the
# probe works whether invoked from repo root (the loop's pattern) or from
# elsewhere (CI, ad-hoc). The script lives at .hermes/probe-section-K.sh,
# so audit/ is one dir up.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AUDIT_DIR="$SCRIPT_DIR/audit"

if [ ! -d "$AUDIT_DIR" ]; then
  echo "K INDETERMINATE: audit directory not found at $AUDIT_DIR"
  exit 2
fi

# Snapshot on-disk audit records (turn-NNN*.md) into a temp file.
ON_DISK=$(mktemp)
trap 'rm -f "$ON_DISK" "$IN_REPO"' EXIT

# Use find for portability (MSYS find has -printf on some versions but not all).
find "$AUDIT_DIR" -maxdepth 1 -type f -name 'turn-*.md' 2>/dev/null \
  | sed "s|^$AUDIT_DIR/||" \
  | sort > "$ON_DISK" || true

# Snapshot in-repo audit records.
IN_REPO=$(mktemp)
git ls-files '.hermes/audit/turn-*.md' 2>/dev/null \
  | sed 's|^\.hermes/audit/||' \
  | sort > "$IN_REPO" || true

ON_DISK_COUNT=$(wc -l < "$ON_DISK" | tr -d ' ')
IN_REPO_COUNT=$(wc -l < "$IN_REPO" | tr -d ' ')
echo "on-disk audit .md files: $ON_DISK_COUNT"
echo "in-repo audit .md files: $IN_REPO_COUNT"

# Bidirectional diff. comm -23 = "in first file only" = on-disk only.
# comm -13 = "in second file only" = in-repo only.
ORPHANS=$(comm -23 "$ON_DISK" "$IN_REPO")
STALE=$(comm -13 "$ON_DISK" "$IN_REPO")

FAIL=0
if [ -n "$ORPHANS" ]; then
  echo "K FAIL: orphan audit .md files on disk but NOT in git:"
  echo "$ORPHANS" | sed 's/^/  - /'
  echo "  Fix: git add .hermes/audit/<name>.md and re-run probe."
  FAIL=1
fi

if [ -n "$STALE" ]; then
  echo "K FAIL: stale audit .md files in git but NOT on disk:"
  echo "$STALE" | sed 's/^/  - /'
  echo "  Fix: git rm .hermes/audit/<name>.md or restore the file from git."
  FAIL=1
fi

if [ "$FAIL" -eq 0 ]; then
  echo "K PASS: $ON_DISK_COUNT audit .md files on disk, $IN_REPO_COUNT in git — drift closed"
  exit 0
fi

echo "K FAIL: audit-record-tracking drift detected (see lines above)"
exit 1