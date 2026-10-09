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

## Session-issuance interface — post-payment follow-up booking (R1, SHIPPED)

The $330 follow-up deep-dive is with MAYOR HIMSELF personally (AI mayor → human
Mayor). It is a **request/confirmation** flow on his real calendar — manual
approve, never an auto-call. The old WebRTC `booking_url` concept is withdrawn.

| Endpoint | Purpose |
|---|---|
| `GET /api/assessment/booking-availability?days=14` | Open 45-min slots: Tue/Thu 10:00–16:00 ET minus active holds (`requested`/`confirmed`). 24h min notice. |
| `POST /api/assessment/book-followup` `{ audit_id, access_token, slot_start }` | Verify payment (402 if unpaid) → create request (`requested`, slot held) → email Mayor one-click approve/decline. Idempotent per audit. |
| `GET /api/assessment/booking-confirm?token=abt_…` | Mayor's one-click APPROVE → `confirmed` + Google Calendar template link (one click onto his calendar). |
| `GET /api/assessment/booking-decline?token=abt_…` | Mayor's one-click DECLINE → hold released, buyer notified to pick another slot. |
| `GET /api/assessment/booking-status?booking_id=…` | Booking state for funnel polling / buyer pages. No raw PII. |

**Confirmation mechanics — DECISION (Mayor's "human-in-the-loop", his phrase):**
manual approve. Tentative hold + 24h SLA + one-click links. Requests expire
after 48h. Auto-confirm inside office hours stays a future flip on his word.

**Calendar:** no server-side Google Calendar path exists in this runtime
(`hatch_gws_cli` is agent-local only; repo `/api/calendar/*` proxies to a
Zoho-backed upstream). `createCalendarEvent()` in `assessmentBooking.js` is the
seam: today it returns a Google Calendar template link + structured event
fields; when the mehyarsoft admin API gains a Google path, wire it there.

**Buyer notifications:** we store `email_hash` only — the audit crew's emailer
owns buyer email. Configure `BOOKING_NOTIFY_URL` (webhook): we POST
`booking.requested|confirmed|declined|expired` events
(`bookingWebhookPayload()`); they send. Manage tokens are opaque
(`abt_`+64hex), SHA-256 stored, like prefill tokens.

## Proactive mid-call agency (R3, SHIPPED)

The avatar takes the business URL **by voice** and analyzes it **live in the
background while the conversation continues** — never blocking the audio path.

- **Voice capture:** `spokenUrlToUrl()` (`assessmentDiagnose.js`) handles
  "acmeplumbing dot com", "www dot acme dot com", letter spell-outs
  ("a c m e dot com"), filler ("my site is…"), and keeps the SSRF guards.
- **State machine** (`session.diagnosisStatus`):
  `idle → analyzing → ready | failed → (spell-out retry) → ready | interview`.
- **Background engine:** `backgroundDiagnose(env, sessionId, url, deps)` —
  site fetch (browser UA) + signal extraction + decide() severity scoring,
  writes findings + `bgEvents[]` entry. Fired via `waitUntil` in `turn.js` on
  the `{ type: "diagnoseUrl", url }` action; runs inline in `simulateTurn`.
- **Weave:** when findings land mid-call, the next turn presents the first one
  with "while you were talking I had a look at your site in the background…".
- **Spell-out fallback:** fetch fails → avatar asks them to spell the domain
  (`SPELL_OUT_SCRIPT`) → retry; second failure or unparseable spelling →
  **interview mode** (funnel questions from their answers — never invented
  flaws, never a dead end).
- **Objection safety:** the pitch-transition turn runs `closeReadiness` first
  (`routeObjection`) — the avatar never pitches OVER a live price/skepticism/
  timing objection raised during diagnosis.
- The AI's intro line (R1, Mayor's word): **"Hi, I'm the mayor."**
  (`INTRO_LINE`, prepended to the consent script in `start.js`).

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
| **Background site analysis** (`backgroundDiagnose` → `scoreFindings` → decide/Clef) | `decide` + `backgroundCalls` |

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

## Ship-checklist: tracking + SEO (Mayor, standing — definition of done)

Brain-crew surfaces are API-only (no rendered pages), so our obligation is the
contract below; the page-owning crews implement it. Audited 2026-10-09:

1. **Google tag** — `client/src/components/GoogleAnalytics.tsx` exists and is
   reusable (page_view fires automatically on wouter route change; explicit
   events via `trackPublicAnalyticsEvent`). The infra crew added
   `client/src/lib/assessment-call/analytics.ts` (`trackAssessmentCallEvent`:
   `call_join` / `call_start` / `call_end`) following the same gating.
   **Funnel milestone events** (names agreed here; page crews fire them):
   `email_captured` (assessment email OR audit prefill submit),
   `payment_started` (Stripe checkout opened), `payment_completed`,
   `booking_requested` (book-followup 200), `booking_confirmed`.
2. **Meta pixel + GTM — GAP, flagged not invented.** Grep-verified 2026-10-09:
   no `fbq`/fbevents snippet and no GTM container anywhere in
   `client/index.html` or `client/src`. `PrivacyPolicy.tsx` discloses
   "We do not embed Facebook Pixel, Google Ads conversion tags, or similar."
   If the business wants Meta/GTM, that's a separate decision + privacy-policy
   update — not something to sneak in.
3. **SEO** — `client/src/components/SeoManager.tsx` carries the route registry
   (title/description/OG per route). Every new funnel route
   (`/call`, audit prefill page, booking pages) must be registered there by
   the page-owning crew before ship.
4. **Verification** — `MEHYAR_PUBLIC_ANALYTICS_DRY_RUN=true` before ship:
   tags must fire (dry-run logs) on every new surface. Tags-firing is part of
   the ship gate, alongside the red-team gate.

## Running the brain/closer tests

```bash
npm run test:assessment
# or directly (no npm script needed):
node functions/api/_shared/assessmentDiagnose.test.js && \
node functions/api/_shared/assessmentBrain.test.js && \
node functions/api/_shared/assessmentDeltas.test.js && \
node functions/api/_shared/assessmentSimulation.test.js && \
node functions/api/_shared/uploadLimits.test.js && \
node functions/api/assessment/booking.test.js
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

## Avatar component contract (avatar crew — appended 2026-10-09)

The 3D Mayor talking head + FaceTime-style call window. Source:
`client/src/lib/assessment-call/*`, `client/src/components/assessment-call/*`.
Full approach/perf/compliance writeup: `docs/assessment-call-avatar.md`.

### API (exact — no deviations from the 5-method brief)

```ts
import { mountAvatar, primeAvatarAudio } from "./lib/assessment-call/mayor-avatar.js";
import type { AvatarHandle } from "./lib/assessment-call/types.js";

const avatar: AvatarHandle = mountAvatar(container, opts?);
avatar.setSpeaking(speaking: boolean): void;
avatar.setState(state: "idle" | "listening" | "thinking" | "speaking"): void;
avatar.playSpeech(input: PlaySpeechInput, opts?: PlaySpeechOpts): Promise<void>;
avatar.dispose(): void;
```

**`playSpeech` input (reconciled with the infra crew's adapter contract):**
accepts every shape both crews specified — a superset, no conflicts:

| Input | Behavior |
|---|---|
| `ArrayBuffer` | Real lip-sync: decoded + played through the shared AudioContext, mouth driven per-frame from the analyser |
| `HTMLAudioElement` | Real lip-sync: tapped via `createMediaElementSource`; the avatar calls `el.play()` and resolves on `ended`. Same-origin/CORS audio only — tainted elements reject with `AvatarAudioError("cors")` |
| `{ kind: "audio", src }` | Same as above (the adapter's envelope form) |
| `{ kind: "text", text }` | **Text-rhythm visualization (NOT synced):** deterministic syllable-rhythm mouth animation for the text's estimated duration (chars ÷ 15/sec, 1.5s–120s), speaking state + body language. Use only when audio is unavailable |

`PlaySpeechOpts`: `{ text?: string, audible?: boolean }`. `audible: false`
analyzes at zero gain — for the integration where the voice transport plays
the audible copy and the avatar analyzes a copy (no double audio).

Errors are `AvatarAudioError` (`decode` / `autoplay` / `cors` /
`unsupported` / `aborted`). A second `playSpeech()` aborts the first
(its promise rejects `"aborted"`). `setState` is synchronous (same frame);
`setSpeaking(true)` without `playSpeech` keeps the mouth near-neutral —
**we never fake lip-sync.** All mount options, test seams
(`audioEngineFactory`, `onViseme`, `onAudioAttached`, `forceNullRenderer`),
and the auto-degrade FPS behavior are documented in the type headers.

### Audio wiring — avatar crew recommendation (for the voice team / adapter)

Mayor ordered **cheap + synced** (R2). Sync is only real when the avatar sees
the audio. Ranked:

1. **Preferred:** the voice transport exposes the played audio as an
   `HTMLAudioElement` (or `MediaStream` → element) → adapter passes it to
   `avatar.playSpeech(el)`. Real lip-sync, zero extra latency, one audible copy.
2. **Also good:** voice team returns the TTS audio bytes alongside `speak()`
   → adapter calls `avatar.playSpeech(buffer, { audible: false })` while the
   transport plays audibly. Real lip-sync; clock drift between the two copies
   is irrelevant for mouth animation (energy-driven, not sample-aligned).
3. **Degraded:** `avatar.playSpeech({ kind: "text", text: reply_text })` —
   rhythmic visualization only, not synced to the audio. Acceptable fallback,
   not the target.

**[NEED] from the voice team:** whichever of (1)/(2) you can provide, so the
adapter can pass real audio. Until then the adapter's `{ kind: "text" }` call
works today (it resolves; the avatar animates) — but the mouth won't be
synced to your audio.

### Latency (avatar's D5 contribution, measured headless-Chromium)

- `setState('speaking')` / `playSpeech()` → speaking state: **0–4 ms** (sync)
- Audio render start → first mouth movement: **~300 ms** (analyser prime + viseme attack)
- Mouth streams per-frame; nothing waits for a full clip
- Mount warms shaders + AudioContext up front; **`primeAvatarAudio()` must be
  called in the Join-click handler** (user gesture) — skips the ~1.5–2.5 s
  cold audio-service spin-up on first play
- Cost: **$0.00/min** server compute (100% client-side WebGL); ~34 draw calls,
  ~8.7k triangles, 24 µs/frame pose math; auto-degrades pixel ratio under
  28 fps. Compare D-ID ~$2.95–5.90/min, HeyGen ~$0.10–0.20/min streaming.

### Call-window UI (avatar crew)

- `AssessmentCallConsent` — pre-join recording-consent gate (unchecked by
  default, Join disabled until checked) + mehyar.us legal footer
- `AssessmentCallWindow` — FaceTime-style UI: avatar centered, mute/end call,
  captions toggle, connection pill, persistent REC indicator, aria-live state
  announcements; WCAG AA contrast verified (7/7 pairs ≥ 4.5:1, tested)
- Analytics: `trackAssessmentCallEvent("call_join"|"call_start"|"call_end")`
  in `lib/assessment-call/analytics.ts` (GA4 via gtag, dry-run aware, unit
  tested). **Meta Pixel / GTM are genuinely absent from the repo** — flagged
  gap, not invented. SEO: ready-to-paste `SeoMeta` entry for the call route
  (route TBD by infra — proposed `https://mehyar.us/call?...`) is in the
  avatar doc; register it in `client/src/components/SeoManager.tsx`.
- Tests: `npm run test:avatar` — 55/55 green (lip-sync 14, avatar-head 9,
  avatar-controller 18, real-audio 3, contrast 7, analytics 4) + `npm run
  check` clean + headless-Chromium E2E (screenshots QC'd by eye).

### Compliance decision log (avatar crew)

- **2026-10-09 11:47 ET — Mayor: "NEVER mention it's AI."** The call window
  ships without an AI-disclosure badge, implementing his explicit word
  (matches the brain crew's D2 log above). Logged as a compliance flag
  against checklist items 9/12 — implementing as ordered.
- Model provenance (item 19): the Mayor head is 100% code-authored
  (`avatar-head.ts`) — no downloaded/scraped model, no licensing exposure.
  Only new third-party dependency: `three` (MIT).

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
