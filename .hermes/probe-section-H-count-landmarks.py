"""Count semantic landmark tags in a minified JS bundle.

Handles all known minifier-emit shapes for jsx():
  (a) direct         jsx("tag"     or jsx(`tag`
  (b) alias-renamed  (0,X.jsx)("tag"  or (0,X.jsx)(`tag`

The (0,X.jsx) form has the literal `(0,X.jsx)` followed by `(` then a
quoted tag literal. The "0" in the wrapper is a numeric index (the
minifier uses `(0, X.jsx)` as a way to call the jsx export without
shadowing a local variable named jsx).

Usage:
  python count_landmarks.py <bundle.js>

Returns:
  Integer count printed to stdout. Exit code 0 always.
"""
import re
import sys

LANDMARKS = ("main", "nav", "header", "footer", "article", "section")
LANDMARKS_GROUP = "|".join(LANDMARKS)

# Union of two shapes. Group 1 captures the landmark tag in both:
#   (a) bare jsx("tag" / jsx(`tag` / jsx(`tag`,
#   (b) alias (0,X.jsx)("tag" / (0,X.jsx)(`tag` / (0,X.jsx)(`tag`,
# The opening quote is OPTIONAL — some minifiers omit it for single-word
# tag names (rare but seen). The closing quote + optional comma is not
# required — the landmark call emits exactly one such match per call
# regardless of what follows.
PATTERN = re.compile(
    r"(?:"
    r"\([0-9]+,[A-Za-z_$]+\.jsx\)\("   # (b) alias wrapper "(0,N.jsx)("
    r"|"
    r"jsx\("                            # (a) bare "jsx("
    r")"
    r"[\"'`]?"                          # optional opening quote
    r"(" + LANDMARKS_GROUP + r")"       # landmark tag
)


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: count_landmarks.py <bundle.js>", file=sys.stderr)
        return 2
    path = sys.argv[1]
    with open(path, "rb") as f:
        data = f.read().decode("utf-8", errors="ignore")
    matches = PATTERN.findall(data)
    print(len(matches))
    return 0


if __name__ == "__main__":
    sys.exit(main())
