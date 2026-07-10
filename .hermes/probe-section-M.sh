#!/usr/bin/env bash
# Section M Commit-SHA-reference probe (turn-044 new check)
#
# Catches the "commit-SHA cited in state.md / docs / audit / learned
# no longer exists in `git log`" drift. The failure mode: a past tick
# writes `sha 5f49f9c` into .hermes/state.md or docs/VISION.md diary
# line, then the commit is force-pushed away or amended; the prose
# still claims it; the user re-verifies on receipt and the citation
# is a fabrication.
#
# Section L (added turn-043) is the cousin class for ticket-id
# references; Section M catches the same drift class for commit-SHA
# references. Both are "stale identifier references" — the loop
# citing a name that no longer resolves. Sections G/H/J/K catch
# *file-level* drift (src/, build artifacts, audit records); L+M
# catch *identifier-reference* drift (ticket ids + commit SHAs).
#
# The invariant the loop verifies on every LOOP-BOOT tick:
#
#   For every 7-char commit-SHA referenced in .hermes/state.md,
#   docs/VISION.md, docs/QA-MEHYARSOFT-B2B-BASELINE-*, .hermes/audit/
#   learned.md, or .hermes/audit/turn-*.md, that SHA MUST exist as
#   a prefix of some commit in `git log --all`.
#
# The reverse direction (commit in git but never cited) is
# informational only — most commits aren't cited, that's normal.
#
# Run from repo root.
#   bash .hermes/probe-section-M.sh
# Exit 0 PASS, exit 1 FAIL, exit 2 INDETERMINATE.
#
# Implementation notes:
# - Strip t_<8 hex chars> (ticket-ids, captured by Section L) before
#   running the SHA match — same word-shape, must not double-count.
# - Strip 6829435 (telegram chat id) before the SHA match — it's a
#   7-char decimal, but the word-boundary \b still pulls it into a
#   hex-class match; the probe filters it explicitly.
# - 7-char SHAs are the canonical short form git itself prints in
#   `git log --oneline`. 40-char full SHAs are accepted as a strict
#   superset (a full SHA is also a valid 7+ prefix). The probe matches
#   the 7-char form because that's what every diary line uses.

set -u

echo "=== M Commit-SHA-reference probe (turn-044 new check) ==="

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Convert MSYS-style /c/... path to Windows C:/... style for git.
# git -C on this Windows host rejects /c/... paths with "cannot change
# to '/c/...': No such file or directory" even though bash sees the
# file fine. Native Windows path works for both grep/mktemp and git.
case "$REPO_ROOT" in
  /c/*) REPO_ROOT_GIT="C:/${REPO_ROOT#/c/}" ;;
  /[A-Za-z]/*) REPO_ROOT_GIT="$(echo "$REPO_ROOT" | sed -E 's|^/([A-Za-z])/|\1:/|')" ;;
  *) REPO_ROOT_GIT="$REPO_ROOT" ;;
esac

# Snapshot all cited 7-char SHAs from the canonical reference surfaces
# into a temp file. The pattern is \b[0-9a-f]{7}\b — word-boundary
# hex chars. We pre-strip ticket-ids (t_xxxxxxxx) and the telegram
# chat id (6829435) so they don't enter the cited-SHA set.
CITED=$(mktemp -p "$REPO_ROOT/.hermes" .probe-M-cited.XXXXXX)
trap 'rm -f "$CITED" "$GIT_SHA"' EXIT

{
  for f in \
      "$REPO_ROOT/.hermes/state.md" \
      "$REPO_ROOT/docs/VISION.md" \
      "$REPO_ROOT/docs/QA-MEHYARSOFT-B2B-BASELINE-2026-05-11.md" \
      "$REPO_ROOT/.hermes/audit/learned.md" \
      "$REPO_ROOT"/.hermes/audit/turn-*.md; do
    [ -f "$f" ] || continue
    # Strip ticket-ids, chat-id, AND inline-code spans (``...``)
    # before the hex grep. The negative-test prose documents a
    # synthetic SHA (e.g. `abc1234`) inside backticks to describe
    # what the probe WOULD flag; that prose is not a real citation.
    # Without stripping backticks first, every audit doc that
    # describes the negative-test re-breaks the probe. Markdown
    # links (`[text](url)`) and bare URLs are NOT stripped —
    # only the inline-code span shape that holds example prose.
    sed -E 's/t_[a-f0-9]{8}//g; s/\b6829435\b//g' "$f" 2>/dev/null \
      | sed -E 's/`[^`]*`//g' \
      | grep -hoE '\b[0-9a-f]{7}\b' || true
  done
} | sort -u > "$CITED"

CITED_COUNT=$(wc -l < "$CITED" | tr -d ' ')
echo "cited commit-SHAs in state/docs/audit: $CITED_COUNT"

# Snapshot every 7-char prefix of every commit in `git log --all`.
# `git log --format=%H` prints full 40-char SHAs; take the first 7
# chars of each and sort -u.
GIT_SHA=$(mktemp -p "$REPO_ROOT/.hermes" .probe-M-git.XXXXXX)
git -C "$REPO_ROOT_GIT" log --all --format='%H' 2>/dev/null \
  | cut -c1-7 \
  | sort -u > "$GIT_SHA" || true

GIT_COUNT=$(wc -l < "$GIT_SHA" | tr -d ' ')
echo "7-char SHA prefixes in git log:        $GIT_COUNT"

# One-way diff: cited \ git = STALE-CITATION (cited but missing in git).
# The reverse (git \ cited) is informational and not flagged — most
# commits aren't cited anywhere, that's normal.
STALE=$(comm -23 "$CITED" "$GIT_SHA")

FAIL=0
if [ -n "$STALE" ]; then
  echo "M FAIL: stale commit-SHA citations in state/docs/audit (sha cited but missing from git log):"
  echo "$STALE" | sed 's/^/  - /'
  echo "  Fix: either restore the commit (force-push / amend undo), OR remove the citation from state.md/docs/audit/learned."
  FAIL=1
fi

if [ "$FAIL" -eq 0 ]; then
  echo "M PASS: all $CITED_COUNT cited commit-SHAs resolve to real commits (drift closed)"
  exit 0
fi

echo "M FAIL: commit-SHA-reference drift detected (see lines above)"
exit 1