# learned.md — mehyar.us improve-loop (rolling 1-line notes)

Each tick appends ONE line. The audit/turn-NNN.md file is the long-form
counterpart; this file is the O(1) warm-start index for "what does the loop
currently know?"

2026-07-10 · turn-050 — ship-the-WIP pattern: working tree often accumulates real value from interrupted/parallel ticks; cheap check `git status --porcelain | head -20` surfaces shippable WIP for a no-judgment, zero-risk tick. Caught and shipped 4 PWA icon files + sw.js cache bump that had been sitting uncommitted. Lesson is also a closure note: the WIP pile-up is a real recurring failure mode worth a dedicated sweep every ~10 ticks.

2026-07-10 · turn-051 — ship-the-WIP self-applies (caught 1 sweep earlier than the turn-060-ish schedule the turn-050 lesson named). Closed 4-file turn-050 WIP + deleted 9 transient probe-WIP files + .gitignore +6 patterns so the .hermes/<...>-tNNN-*.{html,js,py} drift class won't recur. Section K probe FAIL->PASS delta (36/36 audit files). Three secondary lessons: (a) probe-M intermediate cache files leak the SHAs the probe is inspecting into filenames — a `find .hermes -name '.probe-*-cited.*' | wc -l` probe-O (~2s) would catch this automatically; (b) `learned.md` rolling 1-line format needs `git log --all --oneline -- .hermes/audit/learned.md` as the out-of-band history pointer, not `git log -50`; (c) merge abort with "dirty working tree" + clean `git status` = CRLF-line-ending pre-check confusion, retry once.

(prior notes in git log `git log --all --oneline -- .hermes/audit/learned.md` and .hermes/audit/turn-NNN.md history)
