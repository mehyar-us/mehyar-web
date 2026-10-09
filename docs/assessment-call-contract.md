# Assessment Call — Brain Contract

The conversation engine for the free assessment call (brain/closer crew).
Infra crew: this is the interface your turn-taking loop programs against.
Red-team crew: `simulateTurn()` is your entry point.

## Entry points

```js
import { respond, simulateTurn, newSession, scoreFindings, closeReadiness }
  from "./_shared/assessmentBrain.js";
```

### `respond(env, userText, session, deps) → { replyText, actions, session }`

- `env` — worker env (LLM + decide transports, D1). Pass `null` only in simulation.
- `userText` — the caller's latest utterance (post-STT), plain string.
- `session` — mutable brain session object. Create with `newSession()`, persist
  between turns (the infra crew owns storage; the `/api/assessment/*` routes use
  D1 via `assessmentStore.js`). **Never** store the raw caller email in your own
  tables — the brain keeps it in-memory only; the route hashes it on write.
- `deps` — all optional, all injectable (tests/red-team stub these):
  - `chatFn(env, messages) → { text }` — default: `llmChat.chat` (Workers AI,
    `@cf/openai/gpt-oss-120b`, max 220 tokens). The LLM drafts the spoken reply
    inside the guardrailed persona prompt.
  - `decideFn` — default: shared `decide()` on clef-flash.
  - `diagnoseFn(url)` — default: live `diagnoseUrl` (server-side fetch, browser UA).
  - `nowMs()` — default `Date.now`; the state machine tracks call minutes.

**Returns:** `{ replyText, actions, session }`.
- `replyText` — SHORT spoken reply (≤ ~450 chars, no lists, no spelled-out URLs).
  Speak it via TTS verbatim.
- `actions` — array the loop must honor, in order:
  - `{ type: "transition", to }` — informational; `session.stage` already updated.
  - `{ type: "endCall" }` — hang up after speaking `replyText`.
  - `{ type: "captureEmail", email }` — email just captured; persist per your flow.
  - `{ type: "bookAudit", booking_url }` — caller is booking; open/speak the
    prefilled audit URL (added by the `/api/assessment/turn` route, which mints
    the token — the raw brain emits bare `bookAudit`).
  - `{ type: "followupQueued" }` — wrap with the follow-up email path.

### `simulateTurn(session, userText, deps) → same shape`

Identical to `respond()` with `env = null`. Drive full text conversations:

```js
const session = newSession();
const deps = { chatFn: stubChat, decideFn: stubDecide, diagnoseFn: stubDiagnose, nowMs: fakeClock };
let r = await simulateTurn(session, "yes", deps);   // consent
r = await simulateTurn(session, "I run a plumbing company", deps);
// ... r.replyText is what the avatar would say; r.session.stage tracks the arc
```

Stub `chatFn` to return canned lines per stage for deterministic red-team runs;
stub `decideFn` to force close-ready / objection paths; stub `diagnoseFn` to
return fixture findings. See `functions/api/_shared/assessmentSimulation.test.js`
for a worked example.

## State machine

```
consent → open → discovery → diagnosis → pitch → depth → wrap
```

| Stage | Target | Behavior |
|---|---|---|
| `consent` | min 0–1 | Consent script. Explicit yes → open. No / 2× ambiguous → endCall (declined). **Nothing proceeds without consent.** |
| `open` | min 1–3 | Framing script, then discovery Q1. |
| `discovery` | min 3–8 | ≤4 questions (category, businessName, url, acquisition), one per turn. URL → inline `diagnoseFn` → scored findings → diagnosis. No URL after 4 → diagnosis with `diagnosisError: "no_url"`. |
| `diagnosis` | min 5–12 | One REAL finding per turn, spoken. After 3 findings or minute ≥ 15 → pitch. Findings come only from `diagnoseFn` — never invented. |
| `pitch` | min 10–15 | $330 prescription tied to the diagnosed flaws. Price plain, no subscription, all sales final. Assumptive close → email. Objections routed (price/skepticism/timing/authority). |
| `depth` | min 15–40 | Objection handling, deeper findings, email capture, follow-up consent (one question, stop-anytime). |
| `wrap` | min 40–45 | Outcome-based close (booked / followup / declined) + `endCall`. |

The pitch **must** land by minute 15 (`PITCH_BY_MINUTE`); it may land as early
as minute 5 (`PITCH_EARLIEST_MINUTE`) when close-readiness is high.

## decide() integration (fail closed)

1. **Finding-severity scoring** (`scoreFindings`): one batched decide() call per
   diagnosis — per finding a `choice{low,medium,high}` + a factual `noul`. Verdict
   `auto` → adopt; `review` → keep deterministic severity + `needsReview: true`;
   transport failure → deterministic severities. Never presented as AI fact.
2. **Close-readiness** (`closeReadiness`): per turn in pitch/depth — `closeReady`
   noul, `objection` choice, `engagement` score. Drives pitch-vs-diagnose and the
   objection scripts. On `{ ok:false }` → deterministic fallback
   (`{ closeReady:false, objection:"none", engagement:50 }`).

## Reply safety net (in `draftReply`)

Every LLM-drafted reply passes: forbidden-phrase scan (fake urgency, invented
social proof, "as an AI", guarantees — see `FORBIDDEN_PHRASES`), no raw URLs,
450-char cap with sentence-boundary truncation. Any violation → fail closed to
the canned stage script. If the LLM is down → canned script. The call never
goes silent and never emits an unvetted line.

## Failure modes

| Failure | Behavior |
|---|---|
| decide() transport down | Deterministic severity + close-readiness; call continues |
| LLM down | Canned stage scripts; call continues |
| URL fetch fails / SSRF-blocked | `DIAGNOSIS_FETCH_FAILED_SCRIPT`; diagnose from conversation; never invent flaws |
| No consent | Polite end, outcome `declined`, no data captured |
| Caller goes silent | Infra loop owns reprompt/timeout; brain treats empty text as a turn |

## What the brain does NOT do

- No audio, no STT/TTS, no WebRTC — infra crew.
- No email sending — `/api/assessment/end` route (single transactional send).
- No checkout — the audit-tab crew's $330 flow.
- No persistence — routes + `assessmentStore.js` (D1 `LEADS_DB`).

## Identity decision log (D2 — Mayor's explicit order, compliance flag)

**Decision (2026-10-09, Mayor's word):** the avatar NEVER mentions it's AI. It
introduces itself as "the mayor," speaks casually like a regular person, zero
robotic phrasing. "The mayor" is the product brand — the avatar literally is
the Mayor avatar — which is the defensible framing for the persona.

**Compliance flag (logged, not hidden):** several states now require AI
disclosure on sales calls; undisclosed-AI selling is the one real legal
exposure in this build. This conflicts with the earlier "keep the closer
compliant" order. Mayor was informed of the tension and confirmed "do the full
thing" (2026-10-09 ~11:53 ET) — implementing as ordered. Every OTHER guardrail
stands untouched: no fabricated findings, real 7-day link expiry, $330 stated
plainly, consent before diagnosis, no fake urgency, no fake social proof.

Enforcement: `FORBIDDEN_PHRASES` includes "as an AI", "I'm an AI",
"artificial intelligence", "language model", "AI assistant" — any LLM output
containing them fails closed to the canned script. If asked what it is, the
avatar says: "I'm the Mayor — I run these assessments myself."

## Personality adaptivity (D1)

Caller persona is classified live by decide()/Clef-flash:
- **First 1–2 minutes:** awaited `detectPersona()` on every early turn (fast,
  feeds the opening).
- **Rest of call:** persona is one question in the background `backgroundScoring()`
  batch (see D4), plus per-turn in `closeReadiness()` during pitch/depth.

Matrix (8): warm, cold, rude, skeptical, rushed, chatty, guarded, neutral.
The detected persona injects a `PERSONA_STEER` line into the system prompt —
delivery adapts, facts and guardrails never do. `session.personaLog[]` records
every classification (timestamp, persona, prospect score) for the red-team.

## Real-time background decide() (D4)

`backgroundScoring(env, sessionId, userText)` — exported from
`assessmentBrain.js`. One batched decide() call per turn:
1. **prospect score** (0–100) → tier hot (≥70) / warm (≥40) / cold.
2. **next-best-action**: `ask_url` | `keep_flow` | `diagnose_deeper` |
   `go_pitch` | `capture_email` | `wrap_up`.
3. **persona** re-detection.

**Never blocks the audio path:** the `/api/assessment/turn` route awaits
`respond()`, saves, returns the reply — then fires `backgroundScoring` via
`waitUntil` (fire-and-forget). Results merge into the session; the NEXT turn
reads them (`prospectTier === "hot"` → pitch by minute 5; `nextBestAction ===
"ask_url"` → prioritize the URL question). Fail closed: decide down → session
untouched. Every run appends to `session.bgEvents[]` (timestamped summaries,
no PII) — the red-team's observability feed. Closed calls are skipped.

In simulation, `simulateTurn()` runs it inline (awaited) unless
`deps.runBackground === false`.

## Session-issuance interface — follow-up call booking (D7b, proposed)

After the $330 checkout clears, the deeper follow-up call is issued by:

`POST /api/assessment/book-followup` `{ audit_id, access_token }`
→ verifies payment against `audit_business_reports` (status paid|generating|ready
+ token match; 402 if unpaid — calls are NEVER issued unpaid)
→ mints a session with `kind: "followup"`, `followup_of: <audit_id>`
→ returns `{ session_id, booking_url }`.

**Proposed booking URL (needs infra-crew confirmation):**
`https://mehyar.us/call?session=<session_id>&mode=followup`
— the same WebRTC experience as the assessment call, with the avatar opening
from the buyer's audit context (`session.followupContext`). The audit-tab
crew's Stripe fulfill webhook calls this endpoint (one fetch) and emails the
buyer the `booking_url`. Until infra confirms the URL shape, treat it as
proposed.

## Per-call usage ledger — pricing unit economics (Mayor's reporting add)

Every session carries `session.usage` (persisted inside `state_json`), accumulated
at every model call site:

| Call site | Ledger bucket |
|---|---|
| Brain reply drafting (`draftReply` → Workers AI chat) | `llm` |
| Finding-severity scoring (`scoreFindings` → decide/Clef) | `decide` |
| Close-readiness + persona, per turn (`closeReadiness`) | `decide` |
| Early persona detection (`detectPersona`) | `decide` |
| **Background mid-turn scoring** (`backgroundScoring`: prospect score + next-best-action + persona) | `decide` + `backgroundCalls` |

**Honesty rule:** measured numbers only. Token counts are added only when the
provider reports `usage` on the response; otherwise the call still counts and
`unreported` increments — tokens are never estimated or modeled.

**Agreed rollup object** — `getUsageSummary(session)` (exported from
`assessmentBrain.js`); the infra crew rolls this into the session record for
the pricing report. Field names are frozen:

```jsonc
{
  "llm_calls": 12,            // brain reply drafts (Workers AI chat)
  "llm_input_tokens": 18402,  // provider-reported; 0 when unreported
  "llm_output_tokens": 2310,
  "llm_unreported": 0,        // calls where the provider returned no usage
  "decide_calls": 9,          // ALL decide()/Clef invocations (foreground + background)
  "decide_input_tokens": 5410,
  "decide_output_tokens": 0,  // Clef-flash output is free
  "decide_unreported": 0,
  "background_decide_calls": 5, // subset of decide_calls (mid-turn scoring)
  "measured": true             // always true — this object never carries modeled numbers
}
```

The `usage` object is also returned on every `POST /api/assessment/turn`
response (running total) and on `POST /api/assessment/end` (final per-call
total). Pricing math (tokens × provider rates) belongs to the coordinator's
report — this crew supplies measured inputs only.

## Running the brain/closer tests

```bash
npm run test:assessment
# or directly (no npm script needed):
node functions/api/_shared/assessmentDiagnose.test.js && \
node functions/api/_shared/assessmentBrain.test.js && \
node functions/api/_shared/assessmentDeltas.test.js && \
node functions/api/_shared/assessmentSimulation.test.js && \
node functions/api/_shared/uploadLimits.test.js && \
node functions/api/assessment/book-followup.test.js
```
All suites are self-contained (no network, no credentials, no D1). Exit
non-zero on any failure.

## Latency posture (Mayor's "flawless, like a real phone call" bar)

- Replies are drafted with `max_tokens: 220`, short system prompt, no
  chain-of-thought — one fast Workers AI call per turn.
- decide() calls: finding-severity is one batched call per diagnosis;
  close-readiness one batched call per pitch/depth turn (Clef-flash ~39ms
  median); prospect/next-best/persona run OFF the audio path via waitUntil.
- If the LLM is slow/down, the canned stage script answers — the call never
  waits on a hanging model.

---

## Infra session layer (infra crew — appended 2026-10-09)

The voice team owns transport/STT/TTS; you own the conversation. This section
is the INFRA record both sides program against. Endpoints live under
`functions/api/assessment-call/`; tables in migration `0041_assessment_call_infra.sql`.

### Session pairing

The call UI creates two sessions and links them:

1. `POST /api/assessment/start` → `{ session_id, reply_text }` (yours — brain session)
2. `POST /api/assessment-call/session` `{ consent: true, adult: true, brainSessionId }`
   → `{ sessionId, expiresAt, secondsRemaining, heartbeatSec }` (ours — infra session)

`assessment_call_sessions.brain_session_id` is the join key. Consent is two
layers: our UI checkboxes (timestamped `consent_at`) + your spoken consent
script / consent stage. Rate limits: 5 sessions/day/IP on our endpoint (yours
has its own 5/day on `/start`); daily neuron guard (8,000) on admission.

### Per-turn latency log (we store, voice stack supplies)

`POST /api/assessment-call/turn-complete`
`{ sessionId, userText, replyText, timings: { sttMs, tttMs, brainMs, ttsMs } }`
→ appends the user + assistant turn rows (text only — audio never stored).
Field ownership: `stt_ms` voice team · `ttt_ms` adapter · `brain_ms` you (optional)
· `tts_ms` voice team. Table: `assessment_call_turns`.

### Lifecycle endpoints (all JSON, same-origin)

- `POST /api/assessment-call/heartbeat` `{ sessionId }` → `{ ok, secondsRemaining }`
  (30s cadence; 45-min hard cap — the backstop behind your wrap stage).
- `POST /api/assessment-call/end` `{ sessionId }` → `{ ok, turnCount, durationSec }`.
- `POST /api/assessment-call/interrupt` `{ sessionId }` → marks the latest
  assistant turn `interrupted=1` (barge-in receipt).
- `POST /api/assessment-call/delete` `{ sessionId }` → hard-deletes our session
  row + turn log (compliance item 20). Your `assessment_sessions` row is yours
  to delete — tell us if you want a joint delete and we'll wire it.

### What the infra does NOT do

- No STT/TTS/audio — voice team. No conversation/brain — you.
- No duplicate follow-up issuance: D7b post-payment booking is your
  `/api/assessment/book-followup` (your `0041_assessment_call_followup.sql`);
  a follow-up call gets its own infra session row here, linked the same way.
- The full voice-team interface (transport API, event schema, timing, hooks)
  is frozen in `docs/voice-adapter-contract.md` — including the
  NEEDS-FROM-VOICE-TEAM list.

### Per-call usage reporting (pricing rethink — Mayor 2026-10-09)

After red-team testing Mayor rethinks the $330 price on measured unit
economics. Our session row carries the rollup (`usage_json`, `cost_usd_est`
on `assessment_call_sessions`; `POST /turn-complete` accepts a `usage`
object). **Brain crew: please include this `usage` object in every
`POST /api/assessment/turn` response** (our adapter passes it through):

```jsonc
"usage": {
  "llmInputTokens": 412,     // your LLM call, input tokens (REAL)
  "llmOutputTokens": 96,     // your LLM call, output tokens (REAL)
  "llmModel": "@cf/openai/gpt-oss-120b",
  "decideCalls": 1,          // decide()/Clef calls this turn
  "decideInputTokens": 180   // decide input tokens (REAL when known)
}
```

Until you report real tokens we estimate from text lengths and mark the
rollup `estimated: true`. Field names above are frozen — implement against
them; if your route can't see a value, omit the key (never send 0 for
unknown).

### Follow-up call is human (Mayor 2026-10-09 ~12:25 ET)

The paid follow-up call is with Mayor himself personally (AI mayor →
human Mayor funnel continuity); post-payment booking lands on his real
calendar (human-in-the-loop). Infra impact: none — a follow-up call opens
an infra session row here exactly like an assessment call (linked via
`brain_session_id`); the calendar/human booking is the brain crew's
`book-followup` domain.

### R1: post-payment human booking mechanics (2026-10-09, WITHDRAWN same day)

The infra crew drafted a parallel booking system under this heading and
**withdrew it before commit** when the brain crew shipped the real R1 system
on this branch (commit `01c155e`, ~12:4x ET): `POST
/api/assessment/book-followup` now takes `slot_start` and creates the booking
request (status=requested, slot held, one-click approve/decline email to
Mayor); `GET /api/assessment/booking-availability` (office hours minus
holds); `GET /api/assessment/booking-decline?token=` (Mayor's one-click
decline); `GET /api/assessment/booking-status?booking_id=`; `migrations/
0042_assessment_bookings.sql`; shared logic in
`functions/api/_shared/assessmentBooking.js`; Google Calendar template-link
seam in `createCalendarEvent()`. Manual Mayor approval (not auto-confirm),
Tue/Thu 10:00–16:00 ET office hours, 45-min slots, 24h notice, 48h TTL.
The infra crew coordinates with this system and builds no parallel one.
