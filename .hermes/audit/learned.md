# learned.md — mehyar.us improve-loop (rolling 1-line notes)

Each tick appends ONE line. The audit/turn-NNN.md file is the long-form
counterpart; this file is the O(1) warm-start index for "what does the loop
currently know?"

2026-07-10 · turn-050 — ship-the-WIP pattern: working tree often accumulates real value from interrupted/parallel ticks; cheap check `git status --porcelain | head -20` surfaces shippable WIP for a no-judgment, zero-risk tick. Caught and shipped 4 PWA icon files + sw.js cache bump that had been sitting uncommitted. Lesson is also a closure note: the WIP pile-up is a real recurring failure mode worth a dedicated sweep every ~10 ticks.

2026-07-10 · turn-051 — ship-the-WIP self-applies (caught 1 sweep earlier than the turn-060-ish schedule the turn-050 lesson named). Closed 4-file turn-050 WIP + deleted 9 transient probe-WIP files + .gitignore +6 patterns so the .hermes/<...>-tNNN-*.{html,js,py} drift class won't recur. Section K probe FAIL->PASS delta (36/36 audit files). Three secondary lessons: (a) probe-M intermediate cache files leak the SHAs the probe is inspecting into filenames — a `find .hermes -name '.probe-*-cited.*' | wc -l` probe-O (~2s) would catch this automatically; (b) `learned.md` rolling 1-line format needs `git log --all --oneline -- .hermes/audit/learned.md` as the out-of-band history pointer, not `git log -50`; (c) merge abort with "dirty working tree" + clean `git status` = CRLF-line-ending pre-check confusion, retry once.

2026-07-10 · turn-052 — Section O Live-bundle-URL auto-discovery probe shipped (closes 'probe silently validates stale bundle' drift that had been open 4-5 ticks since turn-027 bundle-roll). H/J refactored to source same discover_live_bundle_url() helper; bonus CRLF bug fix on J probe's grep -c integer compare (latent from turn-040, never fired in prod). Rubric grew 14→15 sections A-O (mnemonic: O = origin URL). Five lessons: (1) a rubric probe that pins its own input is a self-referential invariant — source from the live system on every run, don't hardcode; (2) latent CRLF bugs hide in (grep -c ...) on Windows — fix pattern is `tr -d '\n
 '` + `${var:-0}`, codify as a Windows-safe helper; (3) negative-test every new probe with synthetic drift injection — HERMES_BUNDLE_URL_OVERRIDE=https://mehyar.us/assets/main-NONEXISTENT.js is Section O's round-trip; (4) O = origin URL preserves A-N mnemonics; (5) parallel-tick working-tree WIP is ship-the-WIP-eligible at first sighting, regardless of scheduled cadence.

(prior notes in git log `git log --all --oneline -- .hermes/audit/learned.md` and .hermes/audit/turn-NNN.md history)
