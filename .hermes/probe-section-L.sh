#!/usr/bin/env bash
# Section L Open-ticket-id-reference probe (turn-043 new check)
#
# Catches the "ticket-id cited in state.md/diary/audit/learned but the id
# no longer exists in the mehyar-us kanban DB" drift. The failure mode:
# a past tick writes `t_xxxxxxxx` into .hermes/state.md or docs/VISION.md
# referencing a closed ticket; later, the ticket is archived/cleaned/
# never-existed; state.md still claims it; the user re-verifies on receipt
# and the citation is a fabrication.
#
# Sections G/H/J/K pin the bundle and the audit trail. Section L is the
# cousin class for ticket-id references — the third "stale identifier"
# surface the loop carries. Cheaper than a kanban-cli round-trip because
# it reads directly from the SQLite DB.
#
# The invariant the loop verifies on every LOOP-BOOT tick:
#
#   For every ticket-id of the form t_<8 hex chars> referenced in
#   .hermes/state.md, docs/VISION.md, docs/QA-MEHYARSOFT-B2B-BASELINE-*,
#   .hermes/audit/learned.md, or .hermes/audit/turn-*.md, that id MUST
#   exist as a row in the mehyar-us kanban DB.
#
# The reverse direction (in-DB but never cited) is informational, not
# a failure — open tickets are not required to be cited anywhere. Most
# open tickets aren't cited in state.md; that's normal.
#
# Run from repo root.
#   bash .hermes/probe-section-L.sh
# Exit 0 PASS, exit 1 FAIL, exit 2 INDETERMINATE.
#
# Implementation note: uses python's stdlib sqlite3 module, NOT the
# sqlite3 CLI on PATH. The CLI on this Windows host is the Android
# platform-tools sqlite3.exe which fails to open the user's kanban DB
# (it returns "unable to open database file" on a real Windows path).
# Python's sqlite3 uses the same SQLite engine and reads the DB fine.

set -u

echo "=== L Open-ticket-id-reference probe (turn-043 new check) ==="

# Locate the repo root relative to the script's own location so the probe
# works whether invoked from repo root (the loop's pattern) or from
# elsewhere (CI, ad-hoc). The script lives at .hermes/probe-section-L.sh,
# so repo root is one dir up.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# The mehyar-us kanban DB is the canonical source for ticket ids cited
# in this repo's state/docs/audit. Path is the OS-default install location
# on Windows; override with $MEHYAR_US_KANBAN_DB if you keep it elsewhere.
DB="${MEHYAR_US_KANBAN_DB:-$HOME/AppData/Local/hermes/kanban/boards/mehyar-us/kanban.db}"

# Convert MSYS-style /c/Users/... path to Windows C:/... style for Python.
# Python's posixpath on Windows rejects /c/... paths (os.path.exists
# returns False) even though bash sees the file fine. Native Windows path
# works in both layers.
case "$DB" in
  /c/*) DB="C:/${DB#/c/}" ;;
  /[A-Za-z]/*) DB="$(echo "$DB" | sed -E 's|^/([A-Za-z])/|\1:/|')" ;;
esac

if [ ! -f "$DB" ]; then
  echo "L INDETERMINATE: mehyar-us kanban DB not found at $DB"
  echo "  Set MEHYAR_US_KANBAN_DB env var to override."
  exit 2
fi

# Snapshot all cited ticket-ids from the canonical reference surfaces
# into a temp file. The pattern is t_<8 hex chars>. Anything longer or
# with non-hex chars is ignored.
# Use a tempdir under the repo so bash and python see the same files
# (MSYS bash /tmp != python /tmp on Windows).
CITED=$(mktemp -p "$REPO_ROOT/.hermes" .probe-L-cited.XXXXXX)
trap 'rm -f "$CITED" "$IN_DB"' EXIT

# grep -hoE = hidden filenames, only matching parts, extended regex.
# sort -u = unique, deterministic order.
# Source surfaces: state, docs, audit/learned, audit/turn-*.md.
# The docs/QA-*.md file is the LOOP-BOOT rubric itself; it can cite
# ticket ids too (e.g. turn-031 references t_b3048d53).
{
  grep -hoE 't_[a-f0-9]{8}' "$REPO_ROOT/.hermes/state.md" 2>/dev/null
  grep -hoE 't_[a-f0-9]{8}' "$REPO_ROOT/docs/VISION.md" 2>/dev/null
  grep -hoE 't_[a-f0-9]{8}' "$REPO_ROOT/docs/QA-MEHYARSOFT-B2B-BASELINE-2026-05-11.md" 2>/dev/null
  grep -hoE 't_[a-f0-9]{8}' "$REPO_ROOT/.hermes/audit/learned.md" 2>/dev/null
  grep -hoE 't_[a-f0-9]{8}' "$REPO_ROOT/.hermes/audit/"*.md 2>/dev/null
} | sort -u > "$CITED"

CITED_COUNT=$(wc -l < "$CITED" | tr -d ' ')
echo "cited ticket-ids in state/docs/audit: $CITED_COUNT"

# Snapshot all ticket-ids that exist as rows in the mehyar-us kanban DB.
# Use python (stdlib sqlite3) because the sqlite3 CLI on this Windows host
# can't open the user's DB (Android platform-tools binary). Use a tempdir
# under the repo so bash and python see the same files (MSYS bash /tmp
# != python /tmp on Windows).
IN_DB=$(mktemp -p "$REPO_ROOT/.hermes" .probe-L-in-db.XXXXXX)
# Convert MSYS-style /c/... path to Windows C:/... style for Python.
# Python's posixpath on Windows rejects /c/... paths.
IN_DB_PY="$IN_DB"
case "$IN_DB_PY" in
  /c/*) IN_DB_PY="C:/${IN_DB_PY#/c/}" ;;
  /[A-Za-z]/*) IN_DB_PY="$(echo "$IN_DB_PY" | sed -E 's|^/([A-Za-z])/|\1:/|')" ;;
esac
python - "$DB" "$IN_DB_PY" <<'PYEOF' || true
import sqlite3, sys
db_path, out_path = sys.argv[1], sys.argv[2]
conn = sqlite3.connect(db_path)
cur = conn.cursor()
ids = [row[0] for row in cur.execute("SELECT id FROM tasks") if row and row[0]]
conn.close()
# newline='' keeps Python from translating to CRLF on Windows, so the
# file is LF-terminated and matches bash grep output (CRLF mismatch
# would make comm -23 report every cited id as stale).
with open(out_path, 'w', encoding='utf-8', newline='') as f:
    for tid in sorted(set(ids)):
        f.write(tid + '\n')
PYEOF

DB_COUNT=$(wc -l < "$IN_DB" | tr -d ' ')
echo "ticket-ids in mehyar-us kanban DB:    $DB_COUNT"

# One-way diff: cited \ in-db = STALE-CITATION (cited but missing in DB).
# The reverse (in-db \ cited) is informational and not flagged as a
# failure — open tickets are not required to appear in state.md.
STALE=$(comm -23 "$CITED" "$IN_DB")

FAIL=0
if [ -n "$STALE" ]; then
  echo "L FAIL: stale ticket-id citations in state/docs/audit (id cited but missing from DB):"
  echo "$STALE" | sed 's/^/  - /'
  echo "  Fix: either restore the ticket to the mehyar-us board, OR remove the citation from state.md/docs/audit/learned."
  FAIL=1
fi

if [ "$FAIL" -eq 0 ]; then
  echo "L PASS: all $CITED_COUNT cited ticket-ids resolve to real DB rows (drift closed)"
  exit 0
fi

echo "L FAIL: open-ticket-id-reference drift detected (see lines above)"
exit 1