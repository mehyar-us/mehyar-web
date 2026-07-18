"""Negative-test probe-section-H-count-landmarks.py.

Verifies:
  1. Real bundle returns 49 (Section H design baseline, verified turn-062).
  2. Synthetic fixtures for both jsx() shapes return expected counts.
  3. Empty file returns 0.
  4. File with non-landmark tags returns 0.
"""
import os
import subprocess
import sys
import tempfile

PROBE = ".hermes/probe-section-H-count-landmarks.py"
BUNDLE = ".hermes/.probe-section-H-bundle.js"


def run(path: str) -> int:
    r = subprocess.run(["python", PROBE, path], capture_output=True, text=True)
    if r.returncode != 0:
        print(f"FAIL: subprocess exited {r.returncode}: {r.stderr}")
        return 1
    return int(r.stdout.strip())


def main() -> int:
    if not os.path.exists(BUNDLE):
        print(f"missing {BUNDLE}; run probe-section-H.sh first to fetch it")
        return 1

    # 1. Real bundle
    n = run(BUNDLE)
    print(f"real bundle: {n} landmarks (expect 49)")
    if n != 49:
        print("FAIL: real bundle count off")
        return 1

    # 2. Synthetic fixtures
    with tempfile.TemporaryDirectory() as td:
        # Shape (a) bare jsx("tag", ...) — turn-039/062 era
        a = os.path.join(td, "shape-a.js")
        with open(a, "w") as f:
            f.write(
                'jsx("main", null), jsx("nav", null), jsx("header", null), '
                'jsx("footer", null), jsx("article", null), jsx("section", null), '
                'jsx("div", null)'
            )
        n_a = run(a)
        print(f"shape (a) bare jsx: {n_a} landmarks (expect 6)")
        if n_a != 6:
            print("FAIL: shape (a)")
            return 1

        # Shape (b) alias (0,X.jsx)("tag", ...) — turn-063 era
        b = os.path.join(td, "shape-b.js")
        with open(b, "w") as f:
            f.write(
                '(0,N.jsx)("main", null), (0,N.jsx)("nav", null), '
                '(0,N.jsx)("header", null), (0,N.jsx)("footer", null), '
                '(0,N.jsx)("article", null), (0,N.jsx)("section", null), '
                '(0,N.jsx)("div", null)'
            )
        n_b = run(b)
        print(f"shape (b) alias jsx: {n_b} landmarks (expect 6)")
        if n_b != 6:
            print("FAIL: shape (b)")
            return 1

        # Backtick variant
        c = os.path.join(td, "shape-c.js")
        with open(c, "w") as f:
            f.write(
                '(0,N.jsx)(`main`, null), (0,N.jsx)(`nav`, null), '
                '(0,N.jsx)(`header`, null), (0,N.jsx)(`footer`, null), '
                '(0,N.jsx)(`article`, null), (0,N.jsx)(`section`, null)'
            )
        n_c = run(c)
        print(f"shape (c) alias backtick: {n_c} landmarks (expect 6)")
        if n_c != 6:
            print("FAIL: shape (c)")
            return 1

        # Empty file
        e = os.path.join(td, "empty.js")
        open(e, "w").close()
        n_e = run(e)
        print(f"empty file: {n_e} landmarks (expect 0)")
        if n_e != 0:
            print("FAIL: empty file")
            return 1

        # No landmarks
        d = os.path.join(td, "no-landmarks.js")
        with open(d, "w") as f:
            f.write('(0,N.jsx)("div", null), (0,N.jsx)("span", null), (0,N.jsx)("p", null)')
        n_d = run(d)
        print(f"no-landmark file: {n_d} (expect 0)")
        if n_d != 0:
            print("FAIL: no-landmark file")
            return 1

    print("PASS: all 5 negative-test cases")
    return 0


if __name__ == "__main__":
    sys.exit(main())
