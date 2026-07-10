#!/usr/bin/env bash
# Section N File-path-reference probe (turn-046 new check)
#
# Catches the "file path cited in state.md/diary/audit/learned/PRICING-LADDER
# but the file does not exist on disk" drift. The failure mode: a past tick
# writes `docs/SOMETHING.md` into prose, references it from VISION.md or
# state.md as if it's a real artifact, but the file was never created OR was
# renamed OR was gitignored-cleaned OR lived only in an earlier turn's
# worktree. The user re-verifies on receipt and the citation is a lie.
#
# Sections G/H/J pin the bundle and the source tree. Sections K/L pin the
# audit trail and the ticket-id references. Section N is the third cousin:
# pin the docs/*.md file paths the loop cites in prose.
#
# Concrete cases this probe catches (real, from this loop's history):
#   - turn-028 recreated docs/QA-MEHYARSOFT-B2B-BASELINE-2026-05-11.md +
#     docs/FINAL-ACCEPTANCE-GATE-MEHYARSOFT-V1-2026-05-11.md after VISION.md
#     referenced them but they were missing on disk
#   - turn-029 then had to fix the VISION.md "Current state" line itself
#     (wrong filenames / wrong count) even AFTER the files were restored
#   - turn-041 found 4 audit .md files on disk that were never added to git
#     (the on-disk-but-not-in-repo direction; Section K catches that class)
#   - any future reference to docs/PERSUASION-PROPOSAL.md or
#     docs/PRICING-LADDER-DRIFT-2026-07-09.md needs the file to actually
#     exist when the user clicks the link
#
# The invariant the loop verifies on every LOOP-BOOT tick:
#
#   For every `docs/<name>.md` path referenced in
#   .hermes/state.md, docs/VISION.md, docs/QA-MEHYARSOFT-B2B-BASELINE-*,
#   docs/FINAL-ACCEPTANCE-GATE-*, .hermes/learned.md, or .hermes/audit/turn-*.md,
#   that path MUST resolve to a real file under docs/ in this repo.
#
# Note: the docs/PRICING-LADDER-DRIFT-2026-07-09.md is a real (founder-
# decision-blocked) doc that awaits the founder's reply; it's a positive
# presence, not a fabrication. The probe asserts the file exists at the
# cited path so the user CAN click it.
#
# Run from repo root.
#   bash .hermes/probe-section-N.sh
# Exit 0 PASS, exit 1 FAIL, exit 2 INDETERMINATE.

set -u

echo "=== N File-path-reference probe (turn-046 new check) ==="

# Locate the repo root relative to the script's own location so the probe
# works whether invoked from repo root (the loop's pattern) or from
# elsewhere (CI, ad-hoc). The script lives at .hermes/probe-section-N.sh,
# so repo root is one dir up.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Snapshot all cited docs/*.md paths from the canonical reference surfaces
# into a temp file. Use a tempdir under the repo for portability across
# the MSYS / Windows Python boundary (Section L pattern).
CITED=$(mktemp -p "$REPO_ROOT/.hermes" .probe-N-cited.XXXXXX)
trap 'rm -f "$CITED"' EXIT

# Reference surfaces: state.md, VISION.md, the two rubric/gate docs,
# learned.md, all audit turn-*.md records. Also include the pricing-
# drift doc itself so the probe catches self-references.
SOURCES=(
  "$REPO_ROOT/.hermes/state.md"
  "$REPO_ROOT/docs/VISION.md"
  "$REPO_ROOT/docs/QA-MEHYARSOFT-B2B-BASELINE-2026-05-11.md"
  "$REPO_ROOT/docs/FINAL-ACCEPTANCE-GATE-MEHYARSOFT-V1-2026-05-11.md"
  "$REPO_ROOT/docs/PRICING-LADDER-DRIFT-2026-07-09.md"
  "$REPO_ROOT/.hermes/learned.md"
)
# Add every audit/turn-*.md file (glob, not literal — turn-NNN expands at runtime).
for f in "$REPO_ROOT/.hermes/audit/"turn-*.md; do
  [ -f "$f" ] && SOURCES+=("$f")
done

# grep -hoE = hidden filenames, only matching parts, extended regex.
# Pattern: docs/ followed by a basename of letters/digits/dots/dashes,
# ending in .md. Captures the path without an anchor on either side so
# citations in the middle of a sentence ("see docs/X.md for ...") are
# still caught. sort -u = unique, deterministic order.
#
# Three pre-grep filters:
#   1. Strip inline-code backtick spans (`...`). Example paths inside
#      backticks (`docs/X.md`) describe the failure-mode shape; not real
#      citations. Same pattern Section M uses for synthetic SHAs.
#   2. Strip the negative-test path literal (docs/NEGATIVE-TEST-N.md) —
#      this path is documented BARE-PROSE in the Section N audit record
#      ("synthetic docs/NEGATIVE-TEST-N.md → exit 1 → restore → exit 0")
#      and in state.md last_learned, because that's how the negative-test
#      scenario is naturally described (unlike SHAs/ticket-ids which fit
#      cleanly inside backticks). Bare-prose literal needs an explicit
#      strip or every audit doc that mentions the negative-test re-breaks
#      the probe on every run. Same approach Section L uses for synthetic
#      ticket-id literals (strip via sed pre-grep).
#   3. Strip the secondary negative-test literal (docs/FAB-TEST-N.md) —
#      turn-047 introduced this synthetic path when verifying the fix
#      round-trip ("synthetic docs/FAB-TEST-N.md injection → exit 1 →
#      restore → exit 0"). It's a forward-looking test path documented
#      in the same bare-prose shape, just under a different name. Strip
#      it the same way as the primary negative-test literal.
#   4. Strip the generic placeholder path (docs/X.md) — this is the
#      shape used in failure-mode catalog examples ("docs/X.md → docs/Y.md",
#      "git checkout HEAD~ -- docs/X.md") and in audit lesson prose
#      ("synthetic docs/X.md"). It's a placeholder, not a citation;
#      stripping it preserves the prose's illustrative intent without
#      re-breaking the probe.
# Markdown links and other bare URLs are NOT stripped — only these four
# literal paths (and the backtick span strip above). Lesson baked in
# from turn-047: a cousin probe always needs the negative-test literal-
# strip matched to HOW the negative-test is documented in prose
# (backticks vs bare), not just to the probe's alphabet. When a new
# tick introduces a NEW synthetic placeholder, add it to this strip.
{
  for s in "${SOURCES[@]}"; do
    [ -f "$s" ] || continue
    sed -E 's/`[^`]*`//g; s|docs/NEGATIVE-TEST-N\.md||g; s|docs/FAB-TEST-N\.md||g; s|docs/X\.md||g; s|docs/Y\.md||g' "$s" 2>/dev/null \
      | grep -hoE 'docs/[A-Za-z0-9_./-]+\.md' || true
  done
} | sort -u > "$CITED"

CITED_COUNT=$(wc -l < "$CITED" | tr -d ' ')
echo "cited docs/*.md paths: $CITED_COUNT"

# Verify each cited path resolves to a real file under the repo root.
# Failure mode: a citation references a path that does not exist on disk
# (renamed, deleted, never created). The fix is either (a) restore the
# file (e.g. recreate docs/X.md from a journaled source) or (b) update
# the citation to point at the actual current path.
MISSING=()
while IFS= read -r relpath; do
  [ -z "$relpath" ] && continue
  # Strip a leading "./" if present (grep -hoE doesn't add it, but be safe).
  abs="${REPO_ROOT}/${relpath#./}"
  if [ ! -f "$abs" ]; then
    MISSING+=("$relpath")
  fi
done < "$CITED"

if [ "${#MISSING[@]}" -gt 0 ]; then
  echo "N FAIL: cited docs/*.md paths that do NOT exist on disk:"
  for p in "${MISSING[@]}"; do
    echo "  - $p"
  done
  echo "  Fix: either (a) restore the missing file (recreate from VISION.md journal entry),"
  echo "        or (b) update the citation in state.md / docs/VISION.md / audit to point at"
  echo "        the actual current path."
  echo "N FAIL: file-path-reference drift detected (see lines above)"
  exit 1
fi

echo "N PASS: all $CITED_COUNT cited docs/*.md paths resolve to real files under docs/ (drift closed)"
exit 0