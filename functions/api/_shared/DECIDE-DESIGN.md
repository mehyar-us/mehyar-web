# decide() — Decision-Model Integration Design

**Status:** built + unit-tested 2026-10-09. Model availability verified live.
**Owner directive:** Mayor, 2026-10-09 — build shared `decide()` on Cloudflare Clef-flash, weave into every LLM-judgment call site, test everything, commit+push (no prod deploy beyond normal CI).

## 1. What was verified live (2026-10-09)

- `@cf/cloudflare/clef` (27B, $0.24/1M in) and `@cf/cloudflare/clef-flash`
  (9B, $0.09/1M in, output free) are listed on the mehyar.us account
  (`621600637337cc1c9ecb7095508bc732`), 64K context, vision:true, created 2026-09-29.
- Real inference probe succeeded (HTTP 200, ~2.7s via REST):
  - Endpoint: `POST /accounts/{acct}/ai/run/@cf/cloudflare/clef-flash`
  - Request: `{ model:"clef-flash", state, questions:{ id:{type,instructions,criteria} } }`
    - `questions` must be a MAP (object), not an array.
    - `model` is the short name (`clef-flash`), not the `@cf/...` id.
    - types: `noul` (yes/no), `choice` (options as `criteria` object),
      `score` (levels as `criteria` array).
  - Response: `{ result:{ model, answers:{ id:{type, noul|choice|score,
    probabilities, legend, confidence} }, usage:{input_tokens, output_tokens:0} } }`
  - Image input verified: `state` as array of
    `{type:"text",text}` / `{type:"image_url",image_url:{url:"data:..."}}`
    parts (top-level `images` key is rejected).
  - `noul` answers may omit `confidence`; `score` returns fractional
    index-scale values (e.g. 2.0289 on 0–4) plus per-level probabilities.
- Pricing math: free tier = 10,000 neurons/day. A typical decision call
  (~400 input tokens) is a fraction of a neuron-equivalent; decision
  volumes fit comfortably inside free.

## 2. Design decisions

### 2.1 Module placement
Canonical source: `functions/api/_shared/decide.js` in `mehyar-us/mehyar-web`.
Rationale: every Pages Function and the cron worker import from
`functions/api/_shared/` by relative path already (llmChat.js, cloudflareAI.js
live here); the mayor worker is TypeScript in the same repo and can import
the JS module. Workers in OTHER repos vendor the file verbatim (header carries
the sync note) — one logic, no forks.

### 2.2 Signature
`decide(env, state, questions, opts)` → `{ ok, answers, model, latency_ms,
usage, via, error?, fallback? }`.
Developer-facing questions use `ask`/`options`/`levels` (friendlier than
`instructions`/`criteria`); the module translates to the Jev wire shape.
`opts.transport` is the adapter seam (default: Jev over Workers AI).

### 2.3 Transport order
1. `env.AI` binding when present (`env.AI.run('@cf/cloudflare/clef-flash',
   {model:'clef-flash', state, questions})`) — mayor worker already binds AI.
2. Workers AI REST with legacy `X-Auth-Email` + `X-Auth-Key` (Pages Functions;
   same auth that llmChat.js uses; bearer tokens do NOT work for Workers AI).
3. Neither → `{ ok:false, error:"decide_no_transport" }`; caller runs legacy path.

### 2.4 Answer normalization
- `noul` → `{ decision:boolean (p>=0.5), confidence:max(p,1-p) }`
- `choice` → `{ decision:label, confidence:P(winner) }`
- `score` → `{ decision:0–100 normalized from index scale, confidence:max level P }`
Malformed per-question answers → `{ ok:false }` for that question only;
the rest still normalize.

### 2.5 Act-vs-escalate convention
`verdict(answer, {autoAt, reviewAt})` → `"auto" | "review" | "fail"`.
Defaults autoAt=0.8, reviewAt=0.5; per-domain presets in
`DECIDE_THRESHOLDS` (ticketbeat_winnable 0.85/0.6, email_classify 0.75/0.5,
mayor_intent 0.8/0.55, mayor_urgency 0.8/0.55, bounty_triage 0.85/0.6,
aimech_triage 0.7/0.45, twiluna_qc 0.8/0.55, affiliate_intent 0.8/0.55,
campaign_judge 0.7/0.4). Consequential actions never auto-act below their
domain threshold — fail closed to the previous path or a human.

### 2.6 Audit / privacy
`decide()` never logs state text. Audit entry = `{ ts, tag, model, via,
questions:[{id,type,ok,decision,confidence}], latency_ms, usage }`.
`opts.audit` callback or `console.log` fallback. Callers needing
correlation pass a hashed id inside state (hash-only convention).

### 2.7 Batching
Questions chunked at 64/request automatically; answers merged.

### 2.8 What decide() does NOT replace
Text generation (drafts, summaries, bullets, chat replies) stays on chat
models. decide() replaces only judgment calls: classification, routing,
scoring, triage — the "ask LLM to output JSON, then parse it" pattern.

## 3. Insertion points (woven 2026-10-09)

| # | Pipeline | File | Change | Test |
|---|----------|------|--------|------|
| 1 | mehyar-web SAM ingest fit-score | `functions/api/_shared/cloudflareAI.js` (`fitScoreOne`) + `govOpportunities.js` (caller accepts `used_decision_model`) | decide()-first: high-confidence score ≤35 → `pass` without the 70b call; everything else → existing LLM path unchanged | `fitScoreDecide.test.js` — 13 pass |
| 2 | TicketBeat coach | `ticketbeat-repo/functions/api/chat.js` (`classifyOffTopic`; decide.js vendored to `functions/api/_shared/`) | decide()-first TICKET/OTHER choice; fail-open posture preserved (low-confidence/down → legacy 1b → allow) | `chatDecide.test.js` — 5 pass |
| 3 | AI Mechanic | `aimech-deploy/repo/worker/shared/diagnosis.ts` (`classifyIntentDecide`; decide.js vendored to `worker/shared/`) | decide()-first 4-mode choice; `hasMedia` still forces `diagnose` deterministically; regex fallback | `classifyIntentDecide.test.mjs` — 9 pass |
| 4 | Node-A bounce drain | `ovh/node-a/bin/bounce_classify.py` (`classify_bounce_with_decide`; decide.py vendored to `bin/`), wired in `drain_event_inbox.py` | ambiguous DSNs (regex miss + real 4.x.x/5.x.x code) → decide choice; ≥0.9 auto `hard_bounce` → suppression tagged `decide_hard_bounce`; all else → `(False, None)` as today | `bounce_classify_decide_test.py` — 12 pass |
| 5 | Affiliate DM agent | `affiliate/dm_agent.py` (`decide_wants_fix_link`; decide.py vendored) | non-keyword comments on @aimechanicapp → ≥0.85 auto `wants_link` → fix DM; else skip as today. (DM agent cron currently archived/dormant — weave is fail-closed in place.) | `dm_agent_decide_test.py` — 7 pass |
| 6 | Mayor harness | `workers/mayor/src/business-harness.ts` (`deduplicateHarnessTaskDraftsDecide`; decide.js + decide.d.ts vendored to `src/`) | batched noul "is this draft a duplicate of the open task?" per surviving pair (≤64); strictly additive suppression, same priority folding; any failure → sync result | `business-harness-dedupe-decide.test.ts` — 4 pass; 44 existing harness tests pass |

Shared modules: JS canonical `functions/api/_shared/decide.js` (+`decide.test.js`, 45 pass);
Python canonical `~/workspace/skills/campaign-manager/bin/decide.py` (+`decide_test.py`, 36 pass).

### Deliberately NOT woven (verified no such pattern exists)
- TicketBeat "dismissal probability → auto-send vs human review": does not exist — odds are deterministic DOF data by contract; letter drafting is generation, not judgment.
- Mayor inbound intent routing (booking/cancel/price/spam) and missed-call urgency scoring: do not exist as LLM paths — regex/SQL deterministic by design.
- Bug bounty: judgments live in agent-written markdown triage; no callable code to wrap.
- Twiluna QC: deterministic classical CV only — a decide() vision gate would be net-new capability, not a replacement; ready-to-wire via `stateParts(text, [imageUrls])` when the pipeline wants it.
- Campaign judge panel (`campaign_tracker.py` 70b): deliberative 3-persona scoring with fail-loud semantics and text critiques feeding `--auto-rewrite` — decide() cannot generate critiques; left on the 70b.
- Affiliate/DM keyword flows: deterministic and working; only the ambiguous-intent assist (#5) added.

## 4. Test plan
- `decide.test.js`: 45 unit tests, mocked transport — normalization, wire
  shape, verdict thresholds, transport failure, malformed answers, 64-chunk
  batching, validation, audit privacy, stateParts. Run: `node
  functions/api/_shared/decide.test.js`.
- Per-pipeline integration tests: mock `opts.transport`, assert the call
  site branches correctly on auto/review/fail and that the legacy path is
  byte-identical when `decide()` returns `ok:false`.
- Regression: low-confidence → previous path; existing behavior unchanged
  when the decision backend is down.

## 5. Free-tier budget
clef-flash input $0.09/1M tokens, output free. A 400-token decision call ≈
$0.000036. 10k neurons/day covers ~millions of such calls; every result
returns `usage.input_tokens` so callers can budget like cloudflareAI.js does.
No new vendors, no new keys — uses the existing Workers AI access.
