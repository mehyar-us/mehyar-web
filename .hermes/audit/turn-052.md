# turn-052 — 2026-07-10 — Section O Live-bundle-URL auto-discovery probe (closes "probe validates stale bundle" drift)

## Headline

**Closed the "probe silently validates a stale bundle" drift.** CF Pages has rolled the bundle hash on every `src/` change since turn-027 (`main-P-x17WD-.js` → `main-BKU1Uoxy.js` → `main-1wxJxxD5.js`). The H/J probes' hard-coded `main-BKU1Uoxy.js` URL kept fetching a valid stale bundle from CF's edge cache — every literal check still PASSed, but on a file no visitor was loading. The "what visitors load" vs "what the probe validates" gap had been open for at least 4-5 ticks (turn-046 through turn-051 all reported J PASS, all on the wrong file). Ship-the-WIP turn-052 closes it.

## What shipped (5 files / +466/-6 logical)

| File | Lines | What |
|---|---|---|
| `.hermes/probe-section-O.sh` | 183 (new) | Auto-discover live bundle URL from home shell, cross-check 4 routes, literal sentinel |
| `.hermes/probe-section-H.sh` | +45/-4 | Refactor: source same `discover_live_bundle_url()` helper instead of hard-coded URL |
| `.hermes/probe-section-J.sh` | +45/-4 | Same refactor + bonus CRLF bug fix on `grep -c` integer comparison |
| `docs/QA-MEHYARSOFT-B2B-BASELINE-2026-05-11.md` | +185/-0 | Section O added (15 sections total A-O); 7-row failure-mode catalog, 6 implementation notes, negative-test recipe |
| `.gitignore` | +6/-0 | New `main-*.js` pattern blocks root-level stale-bundle captures |

Commit: `59429c4` (improver/turn-052-probe-section-O) → `2fde704` (main, no-ff merge). Local SHA = remote SHA verified.

## What Section O does (the invariant)

For every probe that fetches the live JS bundle, the bundle URL MUST be the one the home page shell currently references. Section O enforces this:

1. **Fetch home shell.** curl `https://mehyar.us/` into `.hermes/.probe-section-O-home.html`. If fetch fails → exit 2 INDETERMINATE.
2. **Extract bundle URL.** `grep -oE '/assets/main-[A-Za-z0-9_-]+\.js' | head -1`. If empty → exit 2 INDETERMINATE.
3. **Fetch discovered bundle.** curl with `-w "%{http_code}"`. Must be HTTP 200 with non-zero body. Otherwise FAIL exit 1.
4. **Cross-check 4 routes.** Hit `/`, `/booking`, `/micro-offer`, `/nonexistent-zzz` and confirm all four reference the same `main-XXXX.js` hash. Any mismatch → FAIL (CF Pages mid-deploy race).
5. **Literal sentinel.** Confirm the discovered bundle contains "Skip to the" (the skip-link literal). If missing → FAIL (discovery regex matched a sub-resource, not the main JS bundle).

**First-run output (this tick):**
```
discovered bundle URL: https://mehyar.us/assets/main-1wxJxxD5.js
discovered bundle: 575243 bytes (fetched HTTP 200)
  / -> main-1wxJxxD5.js
  /booking -> main-1wxJxxD5.js
  /micro-offer -> main-1wxJxxD5.js
  /nonexistent-zzz -> main-1wxJxxD5.js
discovered bundle contains 'Skip to the' literal: 1 occurrences
O PASS: live bundle auto-discovered, fetchable, canonical across 4 routes, contains expected literal
```

The H and J probes source the same `discover_live_bundle_url()` helper. `HERMES_BUNDLE_URL_OVERRIDE` in env bypasses auto-discovery (for local dev / air-gapped runs).

## The bug fix that fell out

While building Section O, the loop discovered that the J probe's `bundle_count=$(grep -c -F ...)` was returning `0\n` on Windows CRLF, which broke the integer comparison and silently false-positived on non-bundle URLs. Symptom: `[: 0\n0: integer expression expected` + "J PASS" — a probe that lied about passing.

**Fix:** `grep -c ... | tr -d '\n\r '` to strip newlines, then `${count:-0}` to default to 0 if empty.

**Why it didn't fire in production:** J's hard-coded URL `main-BKU1Uoxy.js` was always valid (even when stale). Section O's auto-discovery surfaces the latent bug because the override forces the URL-loading code path with a bad URL.

**Negative-test verification:** `HERMES_BUNDLE_URL_OVERRIDE=https://mehyar.us/assets/main-NONEXISTENT.js bash .hermes/probe-section-J.sh` → J exits 1 with 7 FAIL lines (the 2 false-positives where CF's 404 HTML happens to contain `$150`/`$330` strings are acceptable; 7 FAILs drive the exit code). Section O's step-5 literal check is the canonical cross-defense (non-existent URLs return HTML, not JS, and the literal check fails).

## Probe suite this tick (all green except G)

| Section | Probe | Exit | Notes |
|---|---|---|---|
| G | Pricing-consistency | 1 (FAIL) | tier-1=$150 intake=$330 — founder-blocked, expected |
| H | Accessibility/SEO smoke | 0 (PASS) | auto-discovered main-1wxJxxD5.js; 9/9 green |
| J | Build-artifact-integrity | 0 (PASS) | auto-discovered main-1wxJxxD5.js; 9/9 green |
| K | Audit-record-tracking | 0 (PASS) | 37/37 audit .md files on disk and in git |
| L | Open-ticket-id-reference | 0 (PASS) | all 29 cited ticket-ids resolve to real DB rows |
| M | Commit-SHA-reference | 0 (PASS) | all 51 cited commit-SHAs resolve to real commits |
| N | File-path-reference | 0 (PASS) | all 9 cited docs/*.md paths resolve to real files |
| **O** | **Live-bundle-URL auto-discovery** | **0 (PASS)** | **NEW this tick; main-1wxJxxD5.js canonical across 4 routes** |

Other gates: tsc green, test:intake green, 4-screen 200/200/200/404. Voice 5/5. Anti-slop 0 hits on local + live.

## What didn't change

- **Live site.** Docs-only ship. Live bundle stays on turn-050 `main-1wxJxxD5.js`. No CF Pages deploy this tick.
- **Pricing ladder.** Section G still FAIL exit 1. Founder decision still pending on `docs/PRICING-LADDER-DRIFT-2026-07-09.md` (3 options A/B/C).
- **Persuasion shape.** W5-PERSUADE (t_45ea76a8, ready) still awaiting founder `ship A/B/C/A+B+C/hold`.

## Lessons

1. **A rubric probe that pins its own input is a hard-rule invariant.** Sections H/J used to hard-code the bundle URL — a value the rubric's own deployment cycle controls. That's a self-referential reference that silently rots. Section O closes the loop by making the probe self-discover its input on every run. The same pattern applies to any "audit X" probe where X's identity can drift: build probes that fetch X from the live source instead of accepting a hand-written identifier.
2. **Latent CRLF bugs hide in `(grep -c ...)` on Windows.** `grep -c` returns a count followed by a newline; on CRLF hosts the count becomes `"0\r\n"` or `"0\n"` and bash's integer comparison `[$count -lt 1]` fails with `integer expression expected` (not a clear error). The fix — `tr -d '\n\r '` + `${var:-0}` — is the canonical Windows-safe pattern. Worth codifying into a helper.
3. **Negative-test every new probe with a synthetic drift injection.** Section O's value isn't "does it pass on a healthy bundle" (any passing probe does that); it's "does it FAIL when the discovery is wrong." The `HERMES_BUNDLE_URL_OVERRIDE=https://mehyar.us/assets/main-NONEXISTENT.js` round-trip is the cheapest way to prove the probe actually catches what it claims to catch. Same pattern turn-042 baked into Section K and turn-046 into Section N.
4. **The ship-the-WIP pattern self-applies at unexpected times.** Turn-051's lesson named a ~10-tick cadence for deliberate ship-the-WIP sweeps; this tick caught the WIP 1 sweep earlier than scheduled because the work was already on disk and the drift (stale-bundle validation) was the kind of bug the loop's own rubric should never have missed for 4-5 ticks. Lesson: when a parallel-tick artifact appears in `git status`, don't wait for the scheduled sweep — the cost of a docs-only ship is ~5 min and the integrity value is high.
5. **Section O mnemonic:** "O = origin URL" (the auto-discovery target). Append-at-end pattern preserved (Sections A-N unchanged). A future worker profile referencing "QA §O" still resolves correctly.

## Failure-mode catalog (Section O, for future workers)

| Drift pattern | Detection | Action |
|---|---|---|
| Probe hard-coded URL `main-X.js` no longer matches home page's `main-Y.js` | Section O PASS + H/J PASS on discovered URL | Impossible post-this-tick — H/J also auto-discover |
| Probe's hard-coded URL fetches 404 (CF edge evicted the stale bundle) | Section O step 3 FAIL on HTTP status | Fix the hard-code; until fixed, J's "stale deploy" FAIL is the signal |
| Home page references different bundle hashes across routes (mid-deploy race) | Section O step 4 FAIL on route-hash mismatch | Retry next tick; if persistent, deploy is racing itself |
| Discovery regex matches a sub-resource that isn't the main JS bundle | Section O step 5 FAIL on literal miss | Update regex pattern |
| Vite switches to modulepreload or inlines the bundle | Section O step 1 INDETERMINATE | Broaden the discovery regex |

## Next-tick candidates

- **Section P (candidate):** if/when the loop starts to cite outbound URL patterns (CF API endpoints, GitHub API endpoints, internal audit doc URLs), a probe that validates them with `curl -sS -o /dev/null -w '%{http_code}'` could be added. Skip until a class of citation rot surfaces.
- **CRLF-on-Windows hardening rubric (candidate):** if more `grep -c` / `wc -l` / `cut -d... -f...` patterns surface that silently break on CRLF, codify the `tr -d '\n\r '` + `${var:-0}` Windows-safe helper into a shared utility. Add Section P only when 3+ scripts exhibit the same fix pattern.
- **Founder decision still pending:** pricing-drift (Section G) + persuasion shape (W5-PERSUADE). The cheapest loop move is waiting for these.

---

**Files touched:**
- `.hermes/probe-section-O.sh` (new, 183 lines)
- `.hermes/probe-section-H.sh` (+45/-4, refactor to auto-discovery)
- `.hermes/probe-section-J.sh` (+45/-4, refactor + CRLF fix)
- `docs/QA-MEHYARSOFT-B2B-BASELINE-2026-05-11.md` (+185/-0, new Section O)
- `.gitignore` (+6/-0, main-*.js pattern)

**Commit chain:** `59429c4` → `2fde704` (main, no-ff). Local = remote verified.